import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join } from 'node:path';
import page from './stats.html?raw';
import { isTelemetryEvent, summarize, type TelemetryEvent } from './telemetry';

// The telemetry collector the host half runs beside the harness: the browser half posts what each interface did,
// this appends it to a local file, and serves a stats page over it. Bound to 127.0.0.1 only.

export interface CollectorOptions {
  /** 0 picks a free port (tests). */
  readonly port: number;
  /** Where events.ndjson lives. */
  readonly dir: string;
}

export interface Collector {
  /** e.g. http://127.0.0.1:4317 */
  readonly url: string;
  readonly file: string;
  close(): Promise<void>;
}

const MAX_BODY = 512 * 1024;
const MAX_EVENTS_PER_POST = 500;
/** Events read back for the summary; older lines stay in the file. */
const KEEP = 20_000;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/**
 * Pages that may post events: the harness (served from loopback, or from an app scheme in the desktop build) and
 * clients without an Origin header such as curl. Websites cannot, so a page on the internet cannot fill the stats.
 */
export function allowedOrigin(origin: string | undefined): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'http:' || url.protocol === 'https:') return LOOPBACK.has(url.hostname);
    return true;
  } catch {
    // Including "null", the origin of sandboxed iframes and file pages, which any website can create.
    return false;
  }
}

export async function startCollector({ port, dir }: CollectorOptions): Promise<Collector> {
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'events.ndjson');
  // Appends one after another, so lines from two posts never interleave.
  let writes: Promise<void> = Promise.resolve();
  const append = (events: readonly TelemetryEvent[]) => {
    const text = events.map((e) => JSON.stringify(e) + '\n').join('');
    writes = writes.then(() => appendFile(file, text, 'utf8')).catch(() => undefined);
    return writes;
  };
  const readEvents = async (): Promise<TelemetryEvent[]> => {
    await writes;
    let text: string;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      return [];
    }
    const out: TelemetryEvent[] = [];
    for (const line of text.split('\n').slice(-KEEP - 1)) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line) as unknown;
        if (isTelemetryEvent(event)) out.push(event);
      } catch {
        // A line cut short by a crash; skip it.
      }
    }
    return out;
  };

  let self = '';
  const server = createServer((req, res) => {
    handle(req, res).catch(() => send(res, 500, { error: 'internal error' }));
  });

  async function handle(req: IncomingMessage, res: ServerResponse) {
    // Only requests addressed to this machine by name: a page that rebinds its own domain to 127.0.0.1 is refused.
    const host = req.headers.host ?? '';
    if (!LOOPBACK.has(host.replace(/:\d+$/, ''))) return send(res, 403, { error: 'forbidden host' });
    const origin = req.headers.origin;
    const path = new URL(req.url ?? '/', self).pathname;

    if (req.method === 'OPTIONS') {
      if (!allowedOrigin(origin)) return send(res, 403, { error: 'forbidden origin' });
      res.writeHead(204, {
        ...cors(origin),
        'access-control-allow-methods': 'POST, GET',
        'access-control-allow-headers': 'content-type',
        'access-control-allow-private-network': 'true',
      });
      return res.end();
    }
    if (req.method === 'POST' && path === '/api/events') {
      if (!allowedOrigin(origin)) return send(res, 403, { error: 'forbidden origin' });
      const body = await readBody(req);
      if (body === null) return send(res, 413, { error: 'too large' }, origin);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        return send(res, 400, { error: 'not JSON' }, origin);
      }
      const list = Array.isArray(parsed) ? parsed : (parsed as { events?: unknown })?.events;
      const events = (Array.isArray(list) ? list : []).filter(isTelemetryEvent).slice(0, MAX_EVENTS_PER_POST);
      if (events.length) await append(events);
      return send(res, 200, { accepted: events.length }, origin);
    }
    if (req.method === 'GET' && path === '/api/summary') return send(res, 200, summarize(await readEvents()));
    if (req.method === 'GET' && path === '/api/events') return send(res, 200, await readEvents());
    if (req.method === 'POST' && path === '/api/clear') {
      // Only the stats page itself may wipe the file.
      if (origin !== self) return send(res, 403, { error: 'forbidden origin' });
      await writes;
      await writeFile(file, '', 'utf8');
      return send(res, 200, { cleared: true });
    }
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(page);
    }
    return send(res, 404, { error: 'not found' });
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  self = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : port}`;

  return {
    url: self,
    file,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function cors(origin: string | undefined): Record<string, string> {
  return origin ? { 'access-control-allow-origin': origin, vary: 'origin' } : {};
}

function send(res: ServerResponse, status: number, body: unknown, origin?: string) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...(origin && allowedOrigin(origin) ? cors(origin) : {}) });
  res.end(JSON.stringify(body));
}

/** The body as text, or null when it is larger than MAX_BODY. */
function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    // Past the limit the rest is read and dropped, so the 413 can still be sent on the same connection.
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= MAX_BODY) chunks.push(chunk);
    });
    req.on('end', () => resolve(size > MAX_BODY ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
