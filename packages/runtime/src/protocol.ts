import type { RemoteConnection } from '@remote-dom/core';
import type { ComponentWire } from '@tessera/catalog';

/** A compiled program as produced by @tessera/lang. */
export interface Program {
  readonly code: string;
  readonly constants: readonly string[];
}

/** Interactions that leave the sandbox. The host decides what each one does. */
export type Action =
  | { readonly type: 'send'; readonly text: string }
  | { readonly type: 'copy'; readonly text: string }
  | { readonly type: 'open'; readonly url: string };

export type RuntimeIssueCode = 'expression_error' | 'handler_error' | 'program_error' | 'render_error' | 'unknown_component';

export interface RuntimeIssue {
  readonly code: RuntimeIssueCode;
  readonly message: string;
  /** Present for thrown errors, to help the host debug. */
  readonly stack?: string;
}

/** Functions the host passes to the worker; they are proxied across postMessage. */
export interface HostCallbacks {
  action(action: Action): void;
  issue(issue: RuntimeIssue): void;
}

export interface RenderResult {
  readonly ok: boolean;
  readonly error?: string;
}

/** What the sandbox worker exposes to the host. */
export interface RuntimeApi {
  mount(connection: RemoteConnection, components: readonly ComponentWire[], host: HostCallbacks): Promise<void>;
  /** Loads a program and renders it. State is keyed by name and survives across programs. */
  render(program: Program): Promise<RenderResult>;
}
