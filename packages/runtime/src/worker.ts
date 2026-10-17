/// <reference lib="webworker" />
// Worker entry, also the source of the prebuilt bundle `@tessera/runtime/sandbox-worker.js` that the iframe sandbox runs.
// Order matters: the DOM polyfill and every library load first, then lockdown() freezes the intrinsics.
import '@remote-dom/core/polyfill';
import 'ses';
import { ThreadMessagePort } from '@quilted/threads';
import { LOCKDOWN_OPTIONS } from './lockdown-options';
import type { PortHandoff, RuntimeApi } from './protocol';
import { createRuntime } from './runtime';

lockdown(LOCKDOWN_OPTIONS);

// The host (directly, or through the sandbox iframe) hands over one MessagePort and talks only through it.
// Anything else posted to the worker is ignored, and only the first handoff is accepted.
const onMessage = (event: MessageEvent) => {
  const data = event.data as Partial<PortHandoff> | null;
  if (data?.type !== 'tessera:port' || !(data.port instanceof MessagePort)) return;
  self.removeEventListener('message', onMessage);
  ThreadMessagePort.export<RuntimeApi>(data.port, createRuntime());
  data.port.start();
};
self.addEventListener('message', onMessage);
