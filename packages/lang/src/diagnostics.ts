export type DiagnosticCode =
  // Source cut short or malformed. While streaming these are expected and disappear as the source completes.
  | 'unterminated_expression'
  | 'unterminated_tag'
  | 'malformed_tag'
  | 'unclosed_element'
  | 'unclosed_block'
  | 'mismatched_close'
  | 'stray_block'
  // Catalog contract.
  | 'unknown_component'
  | 'unknown_prop'
  | 'invalid_literal'
  | 'children_not_allowed'
  // Directives and names.
  | 'unknown_directive'
  | 'directive_not_top_level'
  | 'duplicate_name'
  | 'reserved_name'
  // Expressions.
  | 'invalid_expression'
  | 'forbidden_syntax'
  | 'unknown_identifier'
  // Data from tools and server resolvers.
  | 'unknown_field'
  | 'dynamic_resolver_input';

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  /** Offset into the source. */
  readonly pos: number;
  /** `error` means something was dropped from the output; `warning` means it was repaired. */
  readonly severity: 'error' | 'warning';
}

export class Diagnostics {
  readonly list: Diagnostic[] = [];

  error(code: DiagnosticCode, message: string, pos: number): void {
    this.list.push({ code, message, pos, severity: 'error' });
  }

  warn(code: DiagnosticCode, message: string, pos: number): void {
    this.list.push({ code, message, pos, severity: 'warning' });
  }
}
