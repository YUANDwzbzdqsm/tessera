// Host-safe entry: types only, no DOM polyfill and no lockdown. The sandbox lives in `@tessera/runtime/worker`
// (source, for a worker you bundle yourself) and `@tessera/runtime/sandbox-worker.js` (prebuilt, for the iframe).
export type {
  Action,
  HostCallbacks,
  PortHandoff,
  Program,
  RenderResult,
  RuntimeApi,
  RuntimeIssue,
  RuntimeIssueCode,
} from './protocol';
