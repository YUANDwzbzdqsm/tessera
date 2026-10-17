// Host-safe entry: types only, no DOM polyfill and no lockdown. The sandbox lives in `@tessera/runtime/worker`.
export type {
  Action,
  HostCallbacks,
  Program,
  RenderResult,
  RuntimeApi,
  RuntimeIssue,
  RuntimeIssueCode,
} from './protocol';
