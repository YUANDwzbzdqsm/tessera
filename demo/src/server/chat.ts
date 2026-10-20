// Runs in Node inside the Vite dev server (loaded with ssrLoadModule): forwards the conversation to an
// OpenAI-compatible Chat Completions API (DeepSeek by default) with the Tessera system prompt, and streams the
// answer through the streaming compiler as SSE. The API key stays on the server; the page never sees it.
import { systemPrompt } from '@tessera/lang';
import { createSSEStream, sseHeaders } from '@tessera/stream/server';
import { catalog } from '../catalog';
import { resolvers } from '../resolvers';

export { sseHeaders };

export interface ChatMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly messages?: readonly ChatMessage[];
}

export interface ModelConfig {
  readonly apiKey?: string;
  readonly baseUrl: string;
  readonly model: string;
}

const MAX_MESSAGES = 20;
const MAX_CHARS = 20_000;
const SYSTEM = systemPrompt(catalog, { extra: 'Reply in the language the user writes in.' });

export function chatBody({ messages }: ChatRequest, signal: AbortSignal, config: ModelConfig): ReadableStream<Uint8Array> {
  const history = (Array.isArray(messages) ? messages : [])
    .filter((m): m is ChatMessage => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim() !== '')
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CHARS) }));
  return createSSEStream(modelText([{ role: 'system', content: SYSTEM }, ...history], signal, config), { catalog, resolvers, interval: 100 });
}

/** The answer's text as it streams. Reasoning tokens, if the model sends any, are skipped. */
export async function* modelText(
  messages: readonly { role: string; content: string }[],
  signal: AbortSignal,
  config: ModelConfig,
  temperature = 0.3,
): AsyncGenerator<string> {
  if (!config.apiKey) throw new Error('服务端没有配置 DEEPSEEK_API_KEY（环境变量，或 demo/.env.local）');
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ model: config.model, messages, stream: true, temperature }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`模型接口返回 HTTP ${response.status}：${(await response.text()).slice(0, 200)}`);

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      const content = (JSON.parse(payload) as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }
}
