import type { Diagnostic } from '@tessera/lang';

/**
 * The message being streamed. Server and client hold the same document; the server sends patches to it.
 * `text` is the raw model output, `code` + `constants` are the compiled program for that text.
 */
export interface StreamDoc {
  readonly text: string;
  readonly code: string;
  readonly constants: readonly string[];
  readonly diagnostics: readonly Diagnostic[];
  readonly done: boolean;
}

/**
 * A small JSON-Patch-like op set. `append` is the one extension: it concatenates onto a string,
 * so growing text costs only the new characters. `add` with a trailing `/-` pushes onto an array.
 */
export type PatchOp =
  | { readonly op: 'append'; readonly path: string; readonly value: string }
  | { readonly op: 'replace'; readonly path: string; readonly value: unknown }
  | { readonly op: 'add'; readonly path: string; readonly value: unknown };

/**
 * - `structure`: the compiled code changed (a component, statement or block completed); the full code is resent.
 * - `constants`: only static text changed; the code is unchanged.
 * - `text`: only raw text arrived, e.g. the model is in the middle of a tag; the interface does not change.
 * - `final`: the stream is complete.
 */
export type UpdateKind = 'structure' | 'constants' | 'text' | 'final';

export interface PatchBatch {
  readonly seq: number;
  readonly kind: UpdateKind;
  readonly ops: readonly PatchOp[];
}

export type StreamEvent = { readonly type: 'patch'; readonly batch: PatchBatch } | { readonly type: 'error'; readonly message: string };

export const emptyDoc: StreamDoc = Object.freeze({ text: '', code: '', constants: Object.freeze([]), diagnostics: Object.freeze([]), done: false });
