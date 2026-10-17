// Isomorphic entry: protocol, patch application and SSE parsing. No compiler here; that is `@tessera/stream/server`.
export { applyOps } from './patch';
export { emptyDoc, type PatchBatch, type PatchOp, type StreamDoc, type StreamEvent, type UpdateKind } from './protocol';
export { SSEParser, encodeEvent, readTesseraStream, type ReadOptions } from './sse';
