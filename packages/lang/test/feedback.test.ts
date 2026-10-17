import { defineCatalog } from '@tessera/catalog';
import { describe, expect, it } from 'vitest';
import { compile, feedbackForModel } from '../src/index';

const catalog = defineCatalog();

describe('feedbackForModel', () => {
  it('returns null when there is nothing to report', () => {
    expect(feedbackForModel(compile('## Fine', { catalog }).diagnostics)).toBeNull();
    expect(feedbackForModel([], { state: {} })).toBeNull();
  });

  it('lists errors before warnings, without the "was dropped" boilerplate', () => {
    const { diagnostics } = compile('<Box gap="1">\n<Rocket />\n## unclosed', { catalog });
    const text = feedbackForModel(diagnostics)!;
    expect(text.startsWith('[Interface feedback]\n')).toBe(true);
    const lines = text.split('\n').filter((l) => l.startsWith('- '));
    const order = lines.map((l) => l.slice(2).split(':')[0]);
    expect(order.slice(0, 2).sort()).toEqual(['invalid_literal', 'unknown_component']);
    expect(order[2]).toBe('unclosed_element');
    expect(text).not.toMatch(/was dropped/);
  });

  it('includes runtime issues and the state the user left', () => {
    const text = feedbackForModel([], {
      runtimeIssues: [{ code: 'expression_error', message: 'SyntaxError: Unexpected end of JSON input' }],
      state: { seats: 30 },
    })!;
    expect(text).toContain('- expression_error: SyntaxError: Unexpected end of JSON input');
    expect(text).toContain('The user left the interface in this state: {"seats":30}');
  });

  it('deduplicates and caps the list', () => {
    const issues = Array.from({ length: 12 }, (_, i) => ({ code: 'expression_error', message: `problem ${i % 10}` }));
    const lines = feedbackForModel([], { runtimeIssues: issues, maxItems: 4 })!.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(5);
    expect(lines.at(-1)).toBe('- and 6 more');
  });
});
