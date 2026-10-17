/// <reference lib="webworker" />
// Worker entry. Import it from a module worker file in your app: `import '@tessera/runtime/worker';`
// Order matters: the DOM polyfill and every library load first, then lockdown() freezes the intrinsics.
import '@remote-dom/core/polyfill';
import 'ses';
import { ThreadWebWorker } from '@quilted/threads';
import type { RuntimeApi } from './protocol';
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

ThreadWebWorker.export<RuntimeApi>(self as unknown as Worker, createRuntime());
