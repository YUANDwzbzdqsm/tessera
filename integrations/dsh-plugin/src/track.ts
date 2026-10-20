import type { CompileResult } from '@tessera/lang';
import { useTesseraSite, type TesseraComponents } from '@tessera/react';
import type { Action } from '@tessera/runtime';
import { createElement, Fragment, useLayoutEffect, useRef, type ComponentType } from 'react';
import type { TelemetryEvent } from './telemetry';

// Browser side of the telemetry: one reporter per page posts batches to the collector, and one ViewTracker per
// interface turns what happens on screen into events. All of it is best effort: a failure never reaches the UI.

type Body = TelemetryEvent extends infer E ? (E extends unknown ? Omit<E, 'ts' | 'session' | 'call'> : never) : never;

// ---- reporter ----

const FLUSH_MS = 2000;
const RETRY_MS = 10_000;
const MAX_QUEUE = 2000;
const BATCH = 200;
const COLLECTOR = /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/;

let endpoint: string | null = null;
const queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let listening = false;

/** The collector named by a render_ui result. Until one arrives, events wait in the queue (the oldest are dropped). */
export function setEndpoint(url: unknown): void {
  if (typeof url !== 'string' || !COLLECTOR.test(url)) return;
  endpoint = url;
  if (!listening && typeof window !== 'undefined') {
    listening = true;
    // A closing page cannot wait for fetch; sendBeacon still delivers what is left.
    window.addEventListener('pagehide', () => {
      if (!endpoint || !queue.length) return;
      navigator.sendBeacon?.(`${endpoint}/api/events`, new Blob([JSON.stringify({ events: queue.splice(0, BATCH) })], { type: 'text/plain' }));
    });
  }
  schedule(0);
}

function report(event: TelemetryEvent): void {
  queue.push(event);
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
  schedule(FLUSH_MS);
}

function schedule(ms: number): void {
  if (timer === undefined) timer = setTimeout(flush, ms);
}

async function flush(): Promise<void> {
  timer = undefined;
  if (!endpoint || !queue.length) return;
  const batch = queue.splice(0, BATCH);
  try {
    // text/plain keeps it a simple request: no preflight.
    const res = await fetch(`${endpoint}/api/events`, { method: 'POST', body: JSON.stringify({ events: batch }), headers: { 'content-type': 'text/plain' } });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    queue.unshift(...batch);
    if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE);
    schedule(RETRY_MS);
    return;
  }
  if (queue.length) schedule(0);
}

// ---- one interface ----

const TICK_MS = 1000;
const REPORT_MS = 5000;
/** An action within this long after touching a component is attributed to it. */
const ATTRIBUTION_MS = 1500;

interface Target {
  readonly site: string | null;
  readonly component: string | null;
  visible: boolean;
}

interface Pending {
  readonly site: string;
  readonly component: string;
  readonly event: string;
  count: number;
  last?: number | boolean;
}

/** State keys present before and after whose values differ; additions (a new {@state} while streaming) are not changes. */
export function changedState(before: Readonly<Record<string, unknown>>, after: Readonly<Record<string, unknown>>) {
  const keys: string[] = [];
  const values: Record<string, number | boolean> = {};
  for (const [key, value] of Object.entries(after)) {
    if (!(key in before) || JSON.stringify(before[key]) === JSON.stringify(value)) continue;
    keys.push(key);
    if (typeof value === 'number' || typeof value === 'boolean') values[key] = value;
  }
  return { keys, values };
}

/** Mostly on screen: half of it, or half the viewport for something taller than that. */
function mostlyVisible(entry: IntersectionObserverEntry): boolean {
  if (!entry.isIntersecting) return false;
  const viewport = entry.rootBounds?.height ?? window.innerHeight;
  return entry.intersectionRatio >= 0.5 || entry.intersectionRect.height >= viewport / 2;
}

export class ViewTracker {
  readonly #session: string;
  readonly #call: string;
  readonly #targets = new Map<Element, Target>();
  readonly #exposure = new Map<string, { site: string | null; component: string | null; ms: number }>();
  readonly #interactions = new Map<string, Pending>();
  #observer: IntersectionObserver | null = null;
  #timers: ReturnType<typeof setInterval>[] = [];
  #touched: { site: string; component: string; at: number } | null = null;
  #state: Readonly<Record<string, unknown>> | null;
  #generated = false;
  /** A frame was painted since the last tick. */
  #painted = false;

  constructor(session: string, call: string, initialState?: Readonly<Record<string, unknown>>) {
    this.#session = session;
    this.#call = call;
    // A restored state is the baseline: the runtime only reports it again once it changes.
    this.#state = initialState ?? null;
  }

  #emit(body: Body): void {
    report({ ...body, ts: Date.now(), session: this.#session, call: this.#call } as TelemetryEvent);
  }

  start(): void {
    if (this.#observer || typeof IntersectionObserver === 'undefined') return;
    this.#observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const target = this.#targets.get(entry.target);
          if (target) target.visible = mostlyVisible(entry);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of this.#targets.keys()) this.#observer.observe(el);
    this.#timers.push(
      setInterval(() => this.#tick(), TICK_MS),
      setInterval(() => this.#report(), REPORT_MS),
    );
  }

  stop(): void {
    this.#report();
    this.#observer?.disconnect();
    this.#observer = null;
    for (const t of this.#timers) clearInterval(t);
    this.#timers = [];
  }

  /** Starts timing an element: a component's root (with its site) or the whole interface (site null). */
  observe(el: Element, site: string | null, component: string | null): () => void {
    this.#targets.set(el, { site, component, visible: false });
    this.#observer?.observe(el);
    return () => {
      this.#targets.delete(el);
      this.#observer?.unobserve(el);
    };
  }

  /**
   * Counts only time the user could be looking: the page visible, the window focused, and frames being painted.
   * Without painting, IntersectionObserver stops reporting, so what it last said about visibility may be stale.
   */
  #tick(): void {
    const painted = this.#painted;
    this.#painted = false;
    requestAnimationFrame(() => {
      this.#painted = true;
    });
    if (!painted || document.visibilityState !== 'visible' || !document.hasFocus()) return;
    for (const t of this.#targets.values()) {
      if (!t.visible) continue;
      const key = t.site ?? '';
      const row = this.#exposure.get(key) ?? { site: t.site, component: t.component, ms: 0 };
      row.ms += TICK_MS;
      this.#exposure.set(key, row);
    }
  }

  #report(): void {
    for (const row of this.#exposure.values()) this.#emit({ type: 'exposure', ...row });
    this.#exposure.clear();
    for (const row of this.#interactions.values()) this.#emit({ type: 'interaction', ...row });
    this.#interactions.clear();
  }

  interact(site: string, component: string, event: string, value: unknown): void {
    const key = `${site}\u0000${event}`;
    const row = this.#interactions.get(key) ?? { site, component, event, count: 0 };
    row.count++;
    if (typeof value === 'number' || typeof value === 'boolean') row.last = value;
    this.#interactions.set(key, row);
    this.#touched = { site, component, at: Date.now() };
  }

  action(action: Action): void {
    const touched = this.#touched && Date.now() - this.#touched.at <= ATTRIBUTION_MS ? this.#touched : null;
    this.#emit({ type: 'action', action: action.type, site: touched?.site ?? null, component: touched?.component ?? null });
  }

  state(next: Readonly<Record<string, unknown>>): void {
    // Without a restored state, the first report is the defaults after the first paint, not a change.
    if (this.#state === null) {
      this.#state = next;
      return;
    }
    const { keys, values } = changedState(this.#state, next);
    this.#state = next;
    if (keys.length) this.#emit({ type: 'state', keys, values });
  }

  issue(code: string): void {
    this.#emit({ type: 'issue', code });
  }

  /** Once per mount, for a settled interface: the summary keeps the latest per call. */
  generated(program: CompileResult, chars: number): void {
    if (this.#generated) return;
    this.#generated = true;
    const errors = program.diagnostics.filter((d) => d.severity === 'error').length;
    this.#emit({
      type: 'generated',
      manifest: program.manifest,
      errors,
      warnings: program.diagnostics.length - errors,
      codes: program.diagnostics.map((d) => d.code),
      chars,
    });
  }
}

/**
 * The host components, each wrapped so the tracker sees it: an invisible marker before it locates the element it
 * draws (for visibility), and its event props are counted before they run. Markers are display:none, so they are
 * not laid out and take no flex gap. Components that draw no element of their own are only counted, not timed.
 */
export function instrument(components: TesseraComponents, tracker: ViewTracker): TesseraComponents {
  return Object.fromEntries(Object.entries(components).map(([name, component]) => [name, tracked(name, component, tracker)]));
}

function tracked(name: string, Component: ComponentType<any>, tracker: ViewTracker): ComponentType<any> {
  function Tracked(props: Record<string, unknown>) {
    const site = useTesseraSite();
    const marker = useRef<HTMLElement>(null);
    useLayoutEffect(() => {
      const el = marker.current?.nextElementSibling;
      return site && el ? tracker.observe(el, site, name) : undefined;
    }, [site]);
    const wrapped: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(props)) {
      wrapped[key] =
        /^on[A-Z]/.test(key) && typeof value === 'function'
          ? (arg: unknown) => {
              if (site) tracker.interact(site, name, key, arg);
              return (value as (arg: unknown) => unknown)(arg);
            }
          : value;
    }
    return createElement(
      Fragment,
      null,
      createElement('i', { ref: marker, style: { display: 'none' }, 'data-tessera-site': site ?? undefined }),
      createElement(Component, wrapped),
    );
  }
  Tracked.displayName = `Tracked(${name})`;
  return Tracked;
}
