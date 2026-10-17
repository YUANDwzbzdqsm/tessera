import type { Catalog } from '@tessera/catalog';
import { compile, toFallbackMarkdown, type Resolution, type Resolver } from '@tessera/lang';
import { applyOps, pointer, stringDiff } from './patch';
import { emptyDoc, type PatchBatch, type PatchOp, type StreamDoc, type UpdateKind } from './protocol';
import { encodeEvent } from './sse';

export interface StreamCompilerOptions {
  readonly catalog: Catalog;
  /** Tool results by name. Sent once with the first batch; the model refers to them as {name.field}. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Minimum milliseconds between recompiles. Text that arrives in between waits for the next flush. 0 compiles on every push. */
  readonly interval?: number;
  readonly now?: () => number;
  /** Add a Markdown fallback to the final batch (default true). */
  readonly fallback?: boolean;
  /** Send changed code as a splice of the changed part instead of the whole program (default true). */
  readonly spliceCode?: boolean;
}

export interface StreamCompiler {
  /** Adds model output. Returns a batch when a recompile was due, otherwise null. */
  push(chunk: string): PatchBatch | null;
  /** Recompiles now with whatever has arrived. Returns null when nothing changed. */
  flush(): PatchBatch | null;
  /** Resolutions requested by compiles so far that have not been handed out yet; each is handed out once. */
  takeResolutions(): Resolution[];
  /** Adds a resolver's result to the data table. Null once the stream has ended. */
  resolved(key: string, value: unknown): PatchBatch | null;
  /** Final recompile; the batch carries the fallback (unless disabled) and `done: true`. */
  end(): PatchBatch;
  /** The server's copy of the document, identical to the client's after it applies every batch. */
  readonly doc: StreamDoc;
}

/**
 * Recompiles the whole prefix on each flush and sends only what changed.
 * Compiling from scratch keeps this simple and robust against half-written input. Only the changed middle of the
 * code is sent, growing text goes out as appends to the constants table, and tool data is sent once.
 */
export function createStreamCompiler({ catalog, data = {}, interval = 0, now = Date.now, fallback = true, spliceCode = true }: StreamCompilerOptions): StreamCompiler {
  let doc = emptyDoc;
  let pending = '';
  let lastFlush = -Infinity;
  let seq = 0;
  let dataSent = false;
  const requested = new Set<string>();
  let queue: Resolution[] = [];

  const emit = (kind: UpdateKind, ops: PatchOp[]): PatchBatch => {
    doc = applyOps(doc, ops);
    return { seq: seq++, kind, ops };
  };

  const diff = (done: boolean): { kind: UpdateKind; ops: PatchOp[] } => {
    const ops: PatchOp[] = [];
    let kind: UpdateKind = 'text';
    if (!dataSent && Object.keys(data).length) {
      ops.push({ op: 'replace', path: '/data', value: { ...doc.data, ...data } });
      dataSent = true;
      kind = 'data';
    }
    if (pending) ops.push({ op: 'append', path: '/text', value: pending });
    const source = doc.text + pending;
    pending = '';
    const next = compile(source, { catalog, data });

    if (next.code !== doc.code) {
      ops.push(spliceCode && doc.code ? stringDiff('/code', doc.code, next.code) : { op: 'replace', path: '/code', value: next.code });
      kind = 'structure';
    }
    const constantOps = diffConstants(doc.constants, next.constants);
    if (constantOps.length) {
      ops.push(...constantOps);
      if (kind === 'text' || kind === 'data') kind = 'constants';
    }
    if (JSON.stringify(next.diagnostics) !== JSON.stringify(doc.diagnostics)) {
      ops.push({ op: 'replace', path: '/diagnostics', value: next.diagnostics });
    }
    for (const r of next.resolutions) {
      if (requested.has(r.key)) continue;
      requested.add(r.key);
      queue.push(r);
    }
    if (done) {
      if (fallback) ops.push({ op: 'replace', path: '/fallback', value: toFallbackMarkdown(source, { catalog, data: { ...doc.data, ...data } }) });
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
    takeResolutions() {
      const out = queue;
      queue = [];
      return out;
    },
    resolved(key, value) {
      if (doc.done) return null;
      return emit('data', [{ op: 'add', path: `/data/${pointer(key)}`, value }]);
    },
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
  /** Resolvers by name, e.g. `{ image: (input) => searchImages(input.query) }`. Run as soon as a component's tag completes. */
  readonly resolvers?: Readonly<Record<string, Resolver>>;
  /** Per resolution, in milliseconds (default 5000). The final batch waits at most this long for open resolutions. */
  readonly resolveTimeout?: number;
  /** Called with the server's final document, e.g. to store the message. */
  readonly onDone?: (doc: StreamDoc) => void;
}

/**
 * Turns a stream of model text into an SSE body (`text/event-stream`). If the model pauses, pending text is
 * flushed after `interval` so the client never waits on a stalled buffer. Resolvers run while the model keeps
 * writing; their results arrive as `data` batches. Cancelling the body stops reading the model.
 */
export function createSSEStream(
  chunks: AsyncIterable<string>,
  { interval = 120, resolvers = {}, resolveTimeout = 5000, onDone, ...options }: SSEStreamOptions,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const iterator = chunks[Symbol.asyncIterator]();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const compiler = createStreamCompiler({ ...options, interval });
      const running = new Set<Promise<void>>();
      const send = (batch: PatchBatch | null) => {
        if (batch && !closed) controller.enqueue(encoder.encode(encodeEvent({ type: 'patch', batch })));
      };
      const resolveNew = () => {
        for (const r of compiler.takeResolutions()) {
          const resolver = resolvers[r.resolver];
          if (!resolver) continue;
          const task: Promise<void> = withTimeout(resolver(r.input, r), resolveTimeout)
            .then((value) => {
              if (!closed) send(compiler.resolved(r.key, value));
            })
            .catch(() => undefined)
            .finally(() => running.delete(task));
          running.add(task);
        }
      };
      const step = (batch: PatchBatch | null) => {
        send(batch);
        resolveNew();
      };
      try {
        for (;;) {
          const { value, done } = await iterator.next();
          if (done || closed) break;
          clearTimeout(timer);
          step(compiler.push(value));
          timer = setTimeout(() => step(compiler.flush()), interval);
        }
        clearTimeout(timer);
        if (!closed) {
          step(compiler.flush());
          // Images and other resolutions requested by the last parts of the answer get their chance to arrive.
          await Promise.allSettled([...running]);
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

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Resolver did not finish within ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** Headers for an SSE response. */
export const sseHeaders: Readonly<Record<string, string>> = Object.freeze({
  'content-type': 'text/event-stream; charset=utf-8',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
});
