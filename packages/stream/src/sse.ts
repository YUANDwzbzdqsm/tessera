import { applyOps } from './patch';
import { emptyDoc, type PatchBatch, type StreamDoc, type StreamEvent } from './protocol';

/** One SSE event. JSON.stringify never emits raw newlines, so a single data line is always valid. */
export function encodeEvent(event: StreamEvent): string {
  const payload = event.type === 'patch' ? event.batch : { message: event.message };
  return `event: ${event.type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** Incremental SSE parser: feed decoded text in any chunking, get whole events out. */
export class SSEParser {
  #buffer = '';

  push(text: string): { event: StreamEvent; size: number }[] {
    this.#buffer += text.replace(/\r\n/g, '\n');
    const out: { event: StreamEvent; size: number }[] = [];
    let end: number;
    while ((end = this.#buffer.indexOf('\n\n')) >= 0) {
      const block = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 2);
      const event = parseBlock(block);
      if (event) out.push({ event, size: new TextEncoder().encode(block).length + 2 });
    }
    return out;
  }
}

function parseBlock(block: string): StreamEvent | null {
  let type = 'message';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') type = value;
    else if (field === 'data') data.push(value);
  }
  if (!data.length) return null;
  const payload = JSON.parse(data.join('\n'));
  if (type === 'patch') return { type: 'patch', batch: payload as PatchBatch };
  if (type === 'error') return { type: 'error', message: String(payload.message) };
  return null;
}

export interface ReadOptions {
  /** Called after each batch is applied, with the event's size on the wire in bytes. */
  readonly onBatch?: (doc: StreamDoc, batch: PatchBatch, bytes: number) => void;
  readonly signal?: AbortSignal;
}

/** Reads a Tessera SSE response to the end and returns the final document. */
export async function readTesseraStream(response: Response, { onBatch, signal }: ReadOptions = {}): Promise<StreamDoc> {
  if (!response.ok || !response.body) throw new Error(`Stream request failed: ${response.status}`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SSEParser();
  let doc = emptyDoc;
  let expected = 0;
  const onAbort = () => void reader.cancel();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      for (const { event, size } of parser.push(decoder.decode(value, { stream: true }))) {
        if (event.type === 'error') throw new Error(event.message);
        if (event.batch.seq !== expected) throw new Error(`Patch ${event.batch.seq} arrived, expected ${expected}`);
        expected++;
        doc = applyOps(doc, event.batch.ops);
        onBatch?.(doc, event.batch, size);
      }
    }
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
  if (signal?.aborted) throw new DOMException('Stream aborted', 'AbortError');
  return doc;
}
