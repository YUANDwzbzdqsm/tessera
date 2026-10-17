import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin, type ViteDevServer } from 'vite';

/**
 * Stand-in backend routes in the dev server, loaded through ssrLoadModule so the TypeScript workspace packages
 * work as-is. Only available under `vite` (dev); a static build has no backend.
 * - POST /api/stream: streams the posted source through a fake model and the Tessera streaming compiler.
 * - POST /api/chat: sends the conversation to DeepSeek (OpenAI-compatible) and streams the answer the same way.
 *   DEEPSEEK_API_KEY (plus optional DEEPSEEK_BASE_URL / DEEPSEEK_MODEL) come from the environment or demo/.env.local,
 *   are read here on the server, and are never exposed to the page (only VITE_-prefixed variables are).
 */
function endpoints(env: Record<string, string>): Plugin {
  const model = {
    apiKey: env.DEEPSEEK_API_KEY,
    baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
    model: env.DEEPSEEK_MODEL || 'deepseek-flash',
  };
  return {
    name: 'tessera-demo-endpoints',
    configureServer(server) {
      sseRoute(server, '/api/stream', async (body, signal) => (await server.ssrLoadModule('/src/server/endpoint.ts')).streamBody(body, signal));
      sseRoute(server, '/api/chat', async (body, signal) => (await server.ssrLoadModule('/src/server/chat.ts')).chatBody(body, signal, model));
    },
  };
}

function sseRoute(server: ViteDevServer, path: string, open: (body: unknown, signal: AbortSignal) => Promise<ReadableStream<Uint8Array>>) {
  server.middlewares.use(path, async (req, res) => {
    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.end();
      return;
    }
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const abort = new AbortController();
      const reader = (await open(body, abort.signal)).getReader();
      res.on('close', () => {
        abort.abort();
        void reader.cancel().catch(() => undefined);
      });
      const { sseHeaders } = await server.ssrLoadModule('/src/server/endpoint.ts');
      res.writeHead(200, sseHeaders);
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        res.write(value);
      }
      res.end();
    } catch (e) {
      if (!res.headersSent) res.statusCode = 500;
      res.end(String(e));
    }
  });
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), endpoints(loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'DEEPSEEK_'))],
  worker: { format: 'es' },
  server: { port: 5180, strictPort: true },
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        chat: fileURLToPath(new URL('./chat.html', import.meta.url)),
      },
    },
  },
}));
