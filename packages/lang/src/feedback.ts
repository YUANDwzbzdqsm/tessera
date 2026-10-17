import type { Diagnostic } from './diagnostics';

/** Anything with a code and a message, e.g. runtime issues from the sandbox. */
export interface FeedbackIssue {
  readonly code: string;
  readonly message: string;
}

export interface FeedbackOptions {
  /** Runtime problems seen while the interface was shown (expression errors, hangs). */
  readonly runtimeIssues?: readonly FeedbackIssue[];
  /** The interface state the user left behind, from TesseraView's onStateChange. */
  readonly state?: Readonly<Record<string, unknown>>;
  readonly maxItems?: number;
}

// "…; the expression was dropped", "… and was dropped", "…; they were dropped": the model only needs the cause.
const SUFFIXES = /(?:;| and) (?:(?:the (?:expression|prop)|it|they|the rest of the source) )?(?:was|were) dropped$/;

/**
 * Text for the next turn's context, so the model learns what went wrong with its last interface and what the user
 * did with it. Returns null when there is nothing to say. Compile diagnostics should be the final ones, from
 * compiling the complete answer, not from a streaming prefix.
 */
export function feedbackForModel(diagnostics: readonly Diagnostic[], options: FeedbackOptions = {}): string | null {
  const { runtimeIssues = [], state, maxItems = 8 } = options;
  const seen = new Set<string>();
  const lines: string[] = [];
  const ordered = [...diagnostics.filter((d) => d.severity === 'error'), ...diagnostics.filter((d) => d.severity === 'warning'), ...runtimeIssues];
  for (const item of ordered) {
    const line = `- ${item.code}: ${item.message.replace(SUFFIXES, '')}`;
    if (seen.has(line)) continue;
    seen.add(line);
    lines.push(line);
  }

  const parts: string[] = [];
  if (lines.length) {
    const shown = lines.slice(0, maxItems);
    if (lines.length > maxItems) shown.push(`- and ${lines.length - maxItems} more`);
    parts.push(
      'Your previous interface had these problems. The affected parts were left out when it was shown; avoid them next time:',
      ...shown,
    );
  }
  if (state && Object.keys(state).length) {
    parts.push(`The user left the interface in this state: ${JSON.stringify(state)}`);
  }
  return parts.length ? `[Interface feedback]\n${parts.join('\n')}` : null;
}
