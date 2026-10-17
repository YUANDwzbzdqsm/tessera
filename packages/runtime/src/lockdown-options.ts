/** The options the sandbox worker passes to SES `lockdown()`, shared with the sandbox tests so they test the same thing. */
export const LOCKDOWN_OPTIONS = {
  // Keep readable errors and console output while this is a development milestone.
  errorTaming: 'unsafe',
  consoleTaming: 'unsafe',
  stackFiltering: 'verbose',
  // Preact copies vnodes with a for-in assign, and vnodes carry an own `constructor` key. Assigning that onto a
  // plain object hits the frozen Object.prototype.constructor (the "override mistake"); 'severe' makes every
  // Object.prototype property overridable so the copy works.
  overrideTaming: 'severe',
  // The default ('safe') replaces toLocaleString with toString and localeCompare with a code-unit comparison, for
  // determinism and to hide the host's locale. Programs here render text for the person in their own browser, so
  // they need real formatting: models write x.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) and sort
  // Chinese names with localeCompare. It does not widen what a program can reach.
  localeTaming: 'unsafe',
} as const;
