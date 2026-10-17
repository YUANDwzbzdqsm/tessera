import react from '@vitejs/plugin-react';
import type { IncomingMessage } from 'node:http';
import { defineConfig, type Plugin } from 'vite';

/**
 * POST /api/stream in the dev server: a stand-in backend that streams the posted source through a fake model and
 * the Tessera streaming compiler. Loaded through ssrLoadModule so the TypeScript workspace packages work as-is.
 * Only available under `vite` (dev); a static build has no backend.
 */
function streamEndpoint(): Plugin {
  return {
    name: 'tessera-demo-stream-endpoint',
    configureServer(server) {
      server.middlewares.use('/api/stream', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end();
          return;
        }
        try {
          const body = JSON.parse((await readBody(req)) || '{}');
          const endpoint = await server.ssrLoadModule('/src/server/endpoint.ts');
          const abort = new AbortController();
          const reader = (endpoint.streamBody(body, abort.signal) as ReadableStream<Uint8Array>).getReader();
          res.on('close', () => {
            abort.abort();
            void reader.cancel().catch(() => undefined);
          });
          res.writeHead(200, endpoint.sseHeaders);
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
    },
  };
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

export default defineConfig({
  plugins: [react(), streamEndpoint()],
  worker: { format: 'es' },
  server: { port: 5180, strictPort: true },
});
