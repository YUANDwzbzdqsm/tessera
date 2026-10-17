import type { Catalog } from '@tessera/catalog';
import { compile } from '@tessera/lang';
import { applyOps } from './patch';
import { emptyDoc, type PatchBatch, type PatchOp, type StreamDoc, type UpdateKind } from './protocol';
import { encodeEvent } from './sse';

export interface StreamCompilerOptions {
  readonly catalog: Catalog;
  /** Minimum milliseconds between recompiles. Text that arrives in between waits for the next flush. 0 compiles on every push. */
  readonly interval?: number;
  readonly now?: () => number;
}

export interface StreamCompiler {
  /** Adds model output. Returns a batch when a recompile was due, otherwise null. */
  push(chunk: string): PatchBatch | null;
  /** Recompiles now with whatever has arrived. Returns null when nothing changed. */
  flush(): PatchBatch | null;
  /** Final recompile; the batch always carries `done: true`. */
  end(): PatchBatch;
  /** The server's copy of the document, identical to the client's after it applies every batch. */
  readonly doc: StreamDoc;
}

/**
 * Recompiles the whole prefix on each flush and sends only what changed.
 * Compiling from scratch keeps this simple and robust against half-written input; the code is resent only
 * when the structure changes, and growing text is sent as appends to the constants table.
 */
export function createStreamCompiler({ catalog, interval = 0, now = Date.now }: StreamCompilerOptions): StreamCompiler {
  let doc = emptyDoc;
  let pending = '';
  let lastFlush = -Infinity;
  let seq = 0;

  const emit = (kind: UpdateKind, ops: PatchOp[]): PatchBatch => {
    doc = applyOps(doc, ops);
    return { seq: seq++, kind, ops };
  };

  const diff = (done: boolean): { kind: UpdateKind; ops: PatchOp[] } => {
    const ops: PatchOp[] = [];
    if (pending) ops.push({ op: 'append', path: '/text', value: pending });
    const source = doc.text + pending;
    pending = '';
    const next = compile(source, { catalog });

    let kind: UpdateKind = 'text';
    if (next.code !== doc.code) {
      ops.push({ op: 'replace', path: '/code', value: next.code });
      kind = 'structure';
    }
    const constantOps = diffConstants(doc.constants, next.constants);
    if (constantOps.length) {
      ops.push(...constantOps);
      if (kind === 'text') kind = 'constants';
    }
    if (JSON.stringify(next.diagnostics) !== JSON.stringify(doc.diagnostics)) {
      ops.push({ op: 'replace', path: '/diagnostics', value: next.diagnostics });
    }
    if (done) {
      ops.push({ op: 'replace', path: '/done', value: true });
      kind = 'final';
    }
    return { kind, ops };
  };

  const flush = () => {
    lastFlush = now();
    if (!pending) return null;
    const { kind, ops } = diff(false);
    return emit(kind, ops);
  };

  return {
    push(chunk) {
      if (doc.done) throw new Error('Stream already ended');
      pending += chunk;
      return now() - lastFlush >= interval ? flush() : null;
    },
    flush,
    end() {
      if (doc.done) throw new Error('Stream already ended');
      const { kind, ops } = diff(true);
      return emit(kind, ops);
    },
    get doc() {
      return doc;
    },
  };
}

/** Constants only grow at the end while streaming: append to a string that grew, push new ones, replace otherwise. */
function diffConstants(prev: readonly string[], next: readonly string[]): PatchOp[] {
  if (next.length < prev.length) return [{ op: 'replace', path: '/constants', value: next }];
  const ops: PatchOp[] = [];
  next.forEach((value, i) => {
    const old = prev[i];
    if (old === undefined) ops.push({ op: 'add', path: '/constants/-', value });
    else if (value === old) return;
    else if (value.startsWith(old)) ops.push({ op: 'append', path: `/constants/${i}`, value: value.slice(old.length) });
    else ops.push({ op: 'replace', path: `/constants/${i}`, value });
  });
  return ops;
}

export interface SSEStreamOptions extends Omit<StreamCompilerOptions, 'now'> {
  /** Called with the server's final document, e.g. to store the message. */
  readonly onDone?: (doc: StreamDoc) => void;
}

/**
 * Turns a stream of model text into an SSE body (`text/event-stream`). If the model pauses, pending text is
 * flushed after `interval` so the client never waits on a stalled buffer. Cancelling the body stops reading the model.
 */
export function createSSEStream(chunks: AsyncIterable<string>, { interval = 120, onDone, ...options }: SSEStreamOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.asyncIterator]();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const compiler = createStreamCompiler({ ...options, interval });
      const send = (batch: PatchBatch | null) => {
        if (batch && !closed) controller.enqueue(encoder.encode(encodeEvent({ type: 'patch', batch })));
      };
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || closed) break;
          clearTimeout(timer);
          send(compiler.push(value));
          timer = setTimeout(() => send(compiler.flush()), interval);
        }
        clearTimeout(timer);
        if (!closed) {
          send(compiler.end());
          onDone?.(compiler.doc);
        }
      } catch (e) {
        clearTimeout(timer);
        if (!closed) controller.enqueue(encoder.encode(encodeEvent({ type: 'error', message: e instanceof Error ? e.message : String(e) })));
      }
      if (!closed) {
        closed = true;
        controller.close();
      }
    },
    async cancel() {
      closed = true;
      clearTimeout(timer);
      await iterator.return?.();
    },
  });
}

/** Headers for an SSE response. */
export const sseHeaders: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
});
