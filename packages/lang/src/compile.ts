import type { Catalog } from '@tessera/catalog';
import { bindingNames, generate } from './codegen';
import { Diagnostics, type Diagnostic } from './diagnostics';
import { toUI } from './markdown';
import { parse } from './parse';
import type { Resolution } from './resolve';
import { tokenize } from './tokenize';

export interface CompileOptions {
  readonly catalog: Catalog;
  /**
   * Tool results by name, e.g. `{ p1: { title, price } }`. The model writes `{p1.price}`; the value comes from here
   * at run time, never from the model's text. Unknown names are dropped; unknown fields are reported.
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** What the runtime needs to render. Plain data: safe to store with a message and send over postMessage. */
export interface CompiledProgram {
  readonly code: string;
  readonly constants: readonly string[];
  /** Tool results plus resolver results (by resolution key). */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface CompileResult extends CompiledProgram {
  readonly data: Readonly<Record<string, unknown>>;
  readonly diagnostics: readonly Diagnostic[];
  /** Components the server should resolve; merge each result into `data` under its key. */
  readonly resolutions: readonly Resolution[];
}

/**
 * Compiles Tessera markup. Works on complete sources and on streaming prefixes alike:
 * incomplete constructs at the end are dropped and unclosed elements with content are closed.
 */
export function compile(source: string, { catalog, data = {} }: CompileOptions): CompileResult {
  const diags = new Diagnostics();
  const tokens = tokenize(source, diags);
  const { nodes, directives } = parse(tokens, diags);
  const ui = toUI(nodes, catalog, diags);
  const constants: string[] = [];
  const resolutions: Resolution[] = [];
  const code = generate(directives, ui, { catalog, diags, constants, data, bindings: new Set(bindingNames(data)), resolutions });
  return { code, constants, data, diagnostics: diags.list, resolutions };
}
