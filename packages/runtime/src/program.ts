/// <reference types="ses" />
import type { Action, Program, RuntimeIssue } from './protocol';

export type Safe = <T>(fn: () => T, fallback: T) => T;

export interface UiEndowment {
  readonly api: Readonly<{ send(text: unknown): void; copy(text: unknown): void; open(url: unknown): void }>;
  useState(key: string, init: () => unknown): [unknown, (next: unknown) => void];
  /** Normalises an interpolated value into something renderable. */
  value(v: unknown): unknown;
}

export interface Endowments {
  readonly h: (...args: any[]) => unknown;
  readonly Fragment: unknown;
  readonly ui: UiEndowment;
  readonly safe: Safe;
}

/** Wraps expressions so a throw removes one value and is reported once, instead of breaking the render. */
export function createSafe(report: (issue: RuntimeIssue) => void): Safe {
  return (fn, fallback) => {
    try {
      return fn();
    } catch (e) {
      report({ code: 'expression_error', message: errorMessage(e) });
      return fallback;
    }
  };
}

export interface UiOptions {
  /** State lives outside the program, keyed by name, so it survives a new program from a recompile. */
  readonly store: Map<string, unknown>;
  readonly onChange: () => void;
  readonly onAction: (action: Action) => void;
  readonly safe: Safe;
  readonly isElement: (v: unknown) => boolean;
}

export function createUi({ store, onChange, onAction, safe, isElement }: UiOptions): UiEndowment {
  const setters = new Map<string, (next: unknown) => void>();
  const value = (v: unknown): unknown => {
    if (v === null || v === undefined || typeof v === 'boolean') return null;
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (Array.isArray(v)) return v.map(value);
    if (isElement(v)) return v;
    return safe(() => JSON.stringify(v), String(v));
  };
  return {
    api: Object.freeze({
      send: (text: unknown) => onAction({ type: 'send', text: String(text) }),
      copy: (text: unknown) => onAction({ type: 'copy', text: String(text) }),
      open: (url: unknown) => onAction({ type: 'open', url: String(url) }),
    }),
    useState(key, init) {
      if (!store.has(key)) store.set(key, init());
      let setter = setters.get(key);
      if (!setter) {
        setter = (next: unknown) => {
          const prev = store.get(key);
          const resolved = typeof next === 'function' ? safe(() => (next as (p: unknown) => unknown)(prev), prev) : next;
          if (Object.is(prev, resolved)) return;
          store.set(key, resolved);
          onChange();
        };
        setters.set(key, setter);
      }
      return [store.get(key), setter];
    },
    value,
  };
}

/** What compiled code evaluates to: called with the endowments and the constants table, it returns the root render function. */
export type ProgramFactory = (...args: unknown[]) => unknown;

export function createCompartment(): Compartment {
  return new Compartment({ __options__: true, name: 'tessera-program' });
}

/**
 * Evaluates compiled program code in an SES compartment. The compartment's global object holds only the
 * frozen JavaScript intrinsics: no fetch, timers, postMessage, DOM or host objects. Everything the program can
 * reach is passed in explicitly. `lockdown()` must have run before this is called.
 */
export function evaluateProgram(code: string, compartment: Compartment = createCompartment()): ProgramFactory {
  const factory: unknown = compartment.evaluate(code);
  if (typeof factory !== 'function') throw new TypeError('Program did not evaluate to a function');
  return factory as ProgramFactory;
}

/** Binds a factory to a constants table. Cheap: a constants-only update reuses the evaluated factory. */
export function instantiate(factory: ProgramFactory, constants: readonly string[], { h, Fragment, ui, safe }: Endowments): () => unknown {
  const root = factory(harden(h), Fragment, harden(ui), harden([...constants]), harden(safe));
  if (typeof root !== 'function') throw new TypeError('Program did not return a component');
  return root as () => unknown;
}

export function loadProgram(program: Program, endowments: Endowments, compartment?: Compartment): () => unknown {
  return instantiate(evaluateProgram(program.code, compartment), program.constants, endowments);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}
