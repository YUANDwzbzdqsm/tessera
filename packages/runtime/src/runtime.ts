import type { RemoteConnection } from '@remote-dom/core';
import { BatchingRemoteConnection, RemoteRootElement, createRemoteElement } from '@remote-dom/core/elements';
import type { ComponentWire } from '@tessera/catalog';
import { Fragment, h as createElement, isValidElement, render } from 'preact';
import { createCompartment, createSafe, createUi, errorMessage, evaluateProgram, instantiate, type ProgramFactory } from './program';
import { createPropsInterner } from './props';
import type { HostCallbacks, Program, RenderResult, RuntimeApi, RuntimeIssue } from './protocol';

/**
 * The sandbox side. Preact renders the program into remote-dom elements (inside the DOM polyfill),
 * and remote-dom mirrors that tree to the host as mutation records. Nothing is drawn here.
 *
 * While streaming, render() is called with a new program every few hundred milliseconds:
 * - the root component is a stable wrapper, so a new program diffs against the old tree instead of remounting it;
 * - a program whose code is unchanged (only constants grew) reuses the evaluated factory;
 * - a program that fails to load or render leaves the last good output on screen.
 */
export function createRuntime(): RuntimeApi {
  const components = new Map<string, ComponentWire>();
  const store = new Map<string, unknown>();
  const reported = new Set<string>();
  let host: HostCallbacks | null = null;
  let root: Element | null = null;
  let compartment: Compartment | null = null;
  let current: { code: string; factory: ProgramFactory } | null = null;
  let renderProgram: (() => unknown) | null = null;
  let lastOutput: unknown = null;
  let scheduled = false;
  let reportedState = '{}';

  const report = (issue: RuntimeIssue) => {
    const key = issue.code + issue.message;
    if (reported.has(key)) return;
    reported.add(key);
    host?.issue(issue);
  };
  const safe = createSafe(report);

  /** Same component type on every render, so Preact keeps the tree; the program itself is called as a function. */
  const Host = () => {
    if (!renderProgram) return null;
    try {
      lastOutput = renderProgram();
    } catch (e) {
      report({ code: 'render_error', message: errorMessage(e), stack: (e as Error)?.stack });
    }
    return lastOutput as never;
  };

  const paint = () => {
    if (!root) return;
    try {
      render(createElement(Host, null), root);
    } catch (e) {
      report({ code: 'render_error', message: errorMessage(e), stack: (e as Error)?.stack });
      return;
    }
    reportState();
  };

  /** Mirrors JSON-safe state to the host after a paint completed, only when it changed. */
  const reportState = () => {
    const snapshot: Record<string, unknown> = {};
    for (const [key, value] of store) {
      try {
        const json = JSON.stringify(value);
        if (json !== undefined) snapshot[key] = JSON.parse(json);
      } catch {
        // Not JSON-safe (cyclic, BigInt): kept in the sandbox only.
      }
    }
    const serialised = JSON.stringify(snapshot);
    if (serialised === reportedState) return;
    reportedState = serialised;
    host?.state(snapshot);
  };
  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      paint();
    });
  };

  const ui = createUi({ store, safe, onChange: schedule, onAction: (a) => host?.action(a), isElement: isValidElement });
  const intern = createPropsInterner();

  /**
   * The `h` a program calls: catalog name -> custom element whose declared props travel as one `props` object,
   * event props -> listeners that pass event.detail, and the compiler's `__site` -> the element's `site` property.
   */
  const h = (type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) => {
    if (type === Fragment) return createElement(Fragment, props, ...(children as []));
    const wire = typeof type === 'string' ? components.get(type) : undefined;
    if (!wire) {
      report({ code: 'unknown_component', message: `Unknown component ${String(type)}` });
      return null;
    }
    const data: Record<string, unknown> = {};
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props ?? {})) {
      if (value === undefined) continue;
      if (key === 'key') {
        out.key = value;
        continue;
      }
      // Beside `props`, not in it: a site never changes, so it costs one update when the element first appears.
      if (key === '__site') {
        if (typeof value === 'string') out.site = value;
        continue;
      }
      const event = wire.events.find((e) => e.prop === key);
      if (event) {
        if (typeof value === 'function') {
          out['on' + event.event] = (e: Event) => {
            try {
              (value as (detail: unknown) => void)((e as CustomEvent).detail);
            } catch (err) {
              report({ code: 'handler_error', message: errorMessage(err) });
            }
          };
        }
        continue;
      }
      // Functions are never valid prop values (events are handled above); the host would reject them anyway.
      if (wire.props.includes(key) && typeof value !== 'function') data[key] = value;
    }
    out.props = intern(data);
    return createElement(wire.tag, out, ...(children as []));
  };

  return {
    async mount(connection: RemoteConnection, wires: readonly ComponentWire[], callbacks: HostCallbacks, initialState?: Readonly<Record<string, unknown>>) {
      host = callbacks;
      for (const [key, value] of Object.entries(initialState ?? {})) store.set(key, value);
      reportedState = JSON.stringify(initialState ?? {});
      for (const wire of wires) {
        components.set(wire.name, wire);
        if (customElements.get(wire.tag)) continue;
        customElements.define(
          wire.tag,
          createRemoteElement({
            properties: { props: { attribute: false }, site: { attribute: false } },
            events: wire.events.map((e) => e.event),
          }),
        );
      }
      if (!customElements.get('remote-root')) customElements.define('remote-root', RemoteRootElement);
      const el = document.createElement('remote-root') as RemoteRootElement;
      el.connect(new BatchingRemoteConnection(connection));
      root = el;
    },

    async render(program: Program): Promise<RenderResult> {
      let factory = current?.code === program.code ? current.factory : null;
      if (!factory) {
        try {
          compartment ??= createCompartment();
          factory = evaluateProgram(program.code, compartment);
        } catch (e) {
          // Keep the last program that worked.
          const message = errorMessage(e);
          report({ code: 'program_error', message });
          return { ok: false, error: message };
        }
        reported.clear();
        current = { code: program.code, factory };
      }
      try {
        renderProgram = instantiate(factory, program.constants, program.data, { h, Fragment, ui, safe });
      } catch (e) {
        const message = errorMessage(e);
        report({ code: 'program_error', message });
        return { ok: false, error: message };
      }
      paint();
      return { ok: true };
    },

    async ping() {
      return 'pong';
    },
  };
}
