import type { Catalog } from '@tessera/catalog';
import { generate } from './codegen';
import { Diagnostics, type Diagnostic } from './diagnostics';
import { toUI } from './markdown';
import { parse } from './parse';
import { tokenize } from './tokenize';

export interface CompileOptions {
  readonly catalog: Catalog;
}

/** What the runtime needs to render. Plain data: safe to store with a message and send over postMessage. */
export interface CompiledProgram {
  readonly code: string;
  readonly constants: readonly string[];
}

export interface CompileResult extends CompiledProgram {
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Compiles Tessera markup. Works on complete sources and on streaming prefixes alike:
 * incomplete constructs at the end are dropped and unclosed elements with content are closed.
 */
export function compile(source: string, { catalog }: CompileOptions): CompileResult {
  const diags = new Diagnostics();
  const tokens = tokenize(source, diags);
  const { nodes, directives } = parse(tokens, diags);
  const ui = toUI(nodes, catalog, diags);
  const constants: string[] = [];
  const code = generate(directives, ui, { catalog, diags, constants });
  return { code, constants, diagnostics: diags.list };
}
