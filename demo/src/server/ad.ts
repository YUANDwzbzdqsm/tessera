// Runs in Node inside the Vite dev server (loaded with ssrLoadModule): streams one sponsored card for the feed demo.
// "model" asks the configured model (DeepSeek by default) for a card from the brief; "replay" plays a hand-written
// source through the fake model. Either way the text goes through the streaming compiler with the ad catalog and
// the ad data, so the page renders the card while it is being written.
import { createSSEStream, sseHeaders } from '@tessera/stream/server';
import { adCatalog, adSystemPrompt, adUserMessage } from '../feed/adCatalog';
import { modelText, type ModelConfig } from './chat';
import { fakeModel } from './endpoint';

export { sseHeaders };

export interface AdRequest {
  readonly mode?: 'model' | 'replay';
  readonly brief?: string;
  /** For replay: the source to play. */
  readonly source?: string;
  /** The ad data the card binds to by name. */
  readonly data?: Readonly<Record<string, unknown>>;
  readonly cps?: number;
}

const MAX_BRIEF = 2000;
/** Some variety between generations of the same brief: picking among variants is the point. */
const TEMPERATURE = 0.8;

export function adBody({ mode, brief, source, data, cps }: AdRequest, signal: AbortSignal, config: ModelConfig): ReadableStream<Uint8Array> {
  const adData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  const text =
    mode === 'replay'
      ? fakeModel(String(source ?? ''), Math.min(Math.max(Number(cps) || 90, 5), 5000), signal)
      : modelText(
          [
            { role: 'system', content: adSystemPrompt(adData) },
            { role: 'user', content: adUserMessage(String(brief ?? '').slice(0, MAX_BRIEF), adData) },
          ],
          signal,
          config,
          TEMPERATURE,
        );
  return createSSEStream(text, { catalog: adCatalog, data: adData, interval: 100 });
}
