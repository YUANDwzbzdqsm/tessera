// Runs in Node inside the Vite dev server (loaded with ssrLoadModule), standing in for a real backend:
// a fake model replays the given source token by token, and the streaming compiler turns it into SSE.
import { createSSEStream, sseHeaders } from '@tessera/stream/server';
import { catalog } from '../catalog';
import { resolvers } from '../resolvers';

export { sseHeaders };

export interface StreamRequest {
  readonly source: string;
  /** Characters per second the fake model produces. */
  readonly cps?: number;
  /** Tool results the answer refers to by name, as the backend's tools would have returned them. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export function streamBody({ source, cps = 120, data }: StreamRequest, signal: AbortSignal): ReadableStream<Uint8Array> {
  const speed = Math.min(Math.max(Number(cps) || 120, 5), 5000);
  const toolData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  return createSSEStream(fakeModel(String(source ?? ''), speed, signal), { catalog, data: toolData, resolvers, interval: 100 });
}

/** Token-sized chunks like a real model: words, short punctuation runs, one or two CJK characters. */
function tokens(src: string): string[] {
  return src.match(/\s*(?:[A-Za-z_$]+|\d{1,3}|[一-鿿]{1,2}|[^\sA-Za-z0-9_$一-鿿]{1,3})|\s+$/g) ?? [];
}

export async function* fakeModel(source: string, cps: number, signal: AbortSignal): AsyncGenerator<string> {
  for (const token of tokens(source)) {
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, (token.length / cps) * 1000));
    yield token;
  }
}
