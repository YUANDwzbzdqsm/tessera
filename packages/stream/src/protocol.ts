import type { Diagnostic } from '@tessera/lang';

/**
 * The message being streamed. Server and client hold the same document; the server sends patches to it.
 * `text` is the raw model output, `code` + `constants` are the compiled program for that text.
 */
export interface StreamDoc {
  readonly text: string;
  readonly code: string;
  readonly constants: readonly string[];
  /** Tool results by name, and resolver results (e.g. found images) by resolution key. */
  readonly data: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly Diagnostic[];
  /** Plain-Markdown version of the final answer, set with the final batch. */
  readonly fallback?: string;
  readonly done: boolean;
}

/**
 * A small JSON-Patch-like op set with two string extensions: `append` concatenates (growing text costs only the
 * new characters) and `splice` replaces a range (a recompiled program differs from the last one only in the
 * middle, so only that part is sent). `add` with a trailing `/-` pushes onto an array.
 */
export type PatchOp =
  | { readonly op: 'append'; readonly path: string; readonly value: string }
  | { readonly op: 'splice'; readonly path: string; readonly start: number; readonly remove: number; readonly value: string }
  | { readonly op: 'replace'; readonly path: string; readonly value: unknown }
  | { readonly op: 'add'; readonly path: string; readonly value: unknown };

/**
 * - `structure`: the compiled code changed (a component, statement or block completed); the changed part is sent.
 * - `constants`: only static text changed; the code is unchanged.
 * - `text`: only raw text arrived, e.g. the model is in the middle of a tag; the interface does not change.
 * - `data`: a server-resolved value arrived (e.g. an image search finished).
 * - `final`: the stream is complete.
 */
export type UpdateKind = 'structure' | 'constants' | 'text' | 'data' | 'final';

export interface PatchBatch {
  readonly seq: number;
  readonly kind: UpdateKind;
  readonly ops: readonly PatchOp[];
}

export type StreamEvent = { readonly type: 'patch'; readonly batch: PatchBatch } | { readonly type: 'error'; readonly message: string };

export const emptyDoc: StreamDoc = Object.freeze({
  text: '',
  code: '',
  constants: Object.freeze([]),
  data: Object.freeze({}),
  diagnostics: Object.freeze([]),
  done: false,
});
