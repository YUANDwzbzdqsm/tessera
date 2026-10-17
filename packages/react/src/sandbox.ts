import { ThreadMessagePort } from '@quilted/threads';
import type { PortHandoff, RuntimeApi } from '@tessera/runtime';

export interface SandboxConnection {
  readonly runtime: ReturnType<typeof ThreadMessagePort.import<RuntimeApi>>;
  /** Stops the sandbox for good: closes the channel and removes the iframe or worker. */
  terminate(): void;
}

/** Starts one sandbox. The controller calls it again to replace a sandbox that stopped answering. */
export type SandboxFactory = () => Promise<SandboxConnection>;

/**
 * The sandbox iframe's own policy. Nothing may load or connect; only the inline bootstrap below runs, the worker
 * comes from a Blob it creates, and 'unsafe-eval' is there for SES compartments. A worker started from a Blob
 * inherits this policy, so the runtime itself cannot fetch either.
 */
export const SANDBOX_CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:";

// A classic worker: a module worker started from a Blob URL of an opaque origin fails its CORS check and never loads.
// The worker is kept on `window`: an unreferenced Worker object can be garbage-collected, which terminates the worker.
const BOOTSTRAP = `
addEventListener('message', function boot(event) {
  if (event.source !== parent || !event.data || event.data.type !== 'tessera:boot' || !event.ports[0]) return;
  removeEventListener('message', boot);
  var url = URL.createObjectURL(new Blob([event.data.source], { type: 'text/javascript' }));
  var worker = new Worker(url, { name: 'tessera-sandbox' });
  worker.addEventListener('error', function (e) { console.error('Tessera sandbox worker failed:', e.message || 'load error'); });
  window.tesseraWorker = worker;
  worker.postMessage({ type: 'tessera:port', port: event.ports[0] }, [event.ports[0]]);
});`;

export const RUNNER_HTML = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${SANDBOX_CSP}"><script>${BOOTSTRAP}</script>`;

function openChannel(handOff: (port: MessagePort) => void) {
  const channel = new MessageChannel();
  const abort = new AbortController();
  const runtime = ThreadMessagePort.import<RuntimeApi>(channel.port1, { signal: abort.signal });
  channel.port1.start();
  handOff(channel.port2);
  return {
    runtime,
    close() {
      abort.abort();
      channel.port1.close();
    },
  };
}

export interface IframeSandboxOptions {
  /** URL of the prebuilt `@tessera/runtime/sandbox-worker.js`, e.g. imported with Vite's `?url`. */
  readonly workerUrl: string | URL;
}

/**
 * The recommended sandbox: a hidden iframe with `sandbox="allow-scripts"` (an opaque origin: no cookies, storage
 * or access to this page) and a CSP that blocks every network request, running the worker inside it.
 * The host talks to the worker over a MessageChannel; the iframe only boots it.
 */
export function iframeSandbox({ workerUrl }: IframeSandboxOptions): SandboxFactory {
  let source: Promise<string> | null = null;
  return async () => {
    source ??= fetch(workerUrl).then(async (response) => {
      if (!response.ok) throw new Error(`Cannot load the sandbox worker from ${String(workerUrl)}: ${response.status}`);
      return response.text();
    });
    const code = await source.catch((error: unknown) => {
      source = null;
      throw error;
    });

    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', 'allow-scripts');
    iframe.setAttribute('aria-hidden', 'true');
    iframe.setAttribute('data-tessera-sandbox', '');
    iframe.title = 'Tessera sandbox';
    iframe.tabIndex = -1;
    iframe.style.display = 'none';
    iframe.srcdoc = RUNNER_HTML;
    const loaded = new Promise<void>((resolve) => iframe.addEventListener('load', () => resolve(), { once: true }));
    document.body.appendChild(iframe);
    await loaded;

    const target = iframe.contentWindow;
    if (!target) {
      iframe.remove();
      throw new Error('The sandbox iframe has no window');
    }
    // The iframe's origin is opaque, so '*' is the only possible target; the port is the real capability.
    const { runtime, close } = openChannel((port) => target.postMessage({ type: 'tessera:boot', source: code }, '*', [port]));
    return {
      runtime,
      terminate() {
        close();
        iframe.remove();
      },
    };
  };
}

/**
 * A plain worker on this page's origin, without the iframe layer. Lighter, but the worker shares the page's
 * origin and network access; prefer `iframeSandbox` for model-written programs.
 * `createWorker` should start a module worker whose entry imports `@tessera/runtime/worker`.
 */
export function workerSandbox(createWorker: () => Worker): SandboxFactory {
  return async () => {
    const worker = createWorker();
    const { runtime, close } = openChannel((port) => worker.postMessage({ type: 'tessera:port', port } satisfies PortHandoff, [port]));
    return {
      runtime,
      terminate() {
        close();
        worker.terminate();
      },
    };
  };
}
