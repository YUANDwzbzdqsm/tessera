import { emptyDoc, readTesseraStream, type PatchBatch, type StreamDoc, type UpdateKind } from '@tessera/stream';
import { useCallback, useEffect, useRef, useState } from 'react';

export interface StreamStats {
  readonly updates: number;
  readonly byKind: Readonly<Record<UpdateKind, number>>;
  /** Bytes received on the wire. */
  readonly bytes: number;
  /** Bytes spent resending compiled code. */
  readonly codeBytes: number;
  readonly lastKind: UpdateKind | null;
}

export type StreamStatus = 'idle' | 'streaming' | 'done' | 'stopped' | 'error';

export interface TesseraStreamState {
  readonly doc: StreamDoc;
  readonly status: StreamStatus;
  readonly stats: StreamStats;
  readonly error?: string;
}

const emptyStats: StreamStats = {
  updates: 0,
  byKind: { structure: 0, constants: 0, text: 0, data: 0, final: 0 },
  bytes: 0,
  codeBytes: 0,
  lastKind: null,
};

const initial: TesseraStreamState = { doc: emptyDoc, status: 'idle', stats: emptyStats };

/**
 * Reads a Tessera SSE stream into state. Pass the returned `doc` (code + constants) to <TesseraView program>.
 * `start` takes a function that performs the request, so you choose the URL, method, body and auth.
 */
export function useTesseraStream() {
  const [state, setState] = useState<TesseraStreamState>(initial);
  const abortRef = useRef<AbortController | null>(null);

  const stop = useCallback(() => abortRef.current?.abort(), []);
  useEffect(() => stop, [stop]);

  const start = useCallback(async (request: (signal: AbortSignal) => Promise<Response>) => {
    abortRef.current?.abort();
    const abort = new AbortController();
    abortRef.current = abort;
    setState({ ...initial, status: 'streaming' });
    const encoder = new TextEncoder();
    const onBatch = (doc: StreamDoc, batch: PatchBatch, bytes: number) => {
      const code = batch.ops.find((o) => o.path === '/code');
      const codeBytes = code ? encoder.encode(JSON.stringify(code.value)).length : 0;
      setState((s) => ({
        ...s,
        doc,
        stats: {
          updates: s.stats.updates + 1,
          byKind: { ...s.stats.byKind, [batch.kind]: s.stats.byKind[batch.kind] + 1 },
          bytes: s.stats.bytes + bytes,
          codeBytes: s.stats.codeBytes + codeBytes,
          lastKind: batch.kind,
        },
      }));
    };
    try {
      const doc = await readTesseraStream(await request(abort.signal), { signal: abort.signal, onBatch });
      setState((s) => ({ ...s, doc, status: doc.done ? 'done' : 'error', error: doc.done ? undefined : 'Stream ended before completion' }));
    } catch (e) {
      const aborted = abort.signal.aborted;
      setState((s) => ({ ...s, status: aborted ? 'stopped' : 'error', error: aborted ? undefined : String((e as Error)?.message ?? e) }));
    }
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(initial);
  }, []);

  return { ...state, start, stop, reset };
}
