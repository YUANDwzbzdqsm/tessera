/// <reference lib="webworker" />
// Worker entry, also the source of the prebuilt bundle `@tessera/runtime/sandbox-worker.js` that the iframe sandbox runs.
// Order matters: the DOM polyfill and every library load first, then lockdown() freezes the intrinsics.
import '@remote-dom/core/polyfill';
import 'ses';
import { ThreadMessagePort } from '@quilted/threads';
import type { PortHandoff, RuntimeApi } from './protocol';
import { createRuntime } from './runtime';

lockdown({
  // Keep readable errors and console output while this is a development milestone.
  errorTaming: 'unsafe',
  consoleTaming: 'unsafe',
  stackFiltering: 'verbose',
  // Preact copies vnodes with a for-in assign, and vnodes carry an own `constructor` key. Assigning that onto a
  // plain object hits the frozen Object.prototype.constructor (the "override mistake"); 'severe' makes every
  // Object.prototype property overridable so the copy works.
  overrideTaming: 'severe',
});

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
