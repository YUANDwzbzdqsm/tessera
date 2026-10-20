import type { Manifest } from '@tessera/lang';

// What the browser half reports about each render_ui interface, and how the collector sums it up for the stats page.
// Shared by both halves; nothing here touches the DOM or Node.

/**
 * Key in a render_ui result's presentation metadata that holds the collector's URL. Only set while the host's
 * collector is running, so the browser reports nothing when telemetry is off or the port was taken.
 */
export const TELEMETRY_KEY = 'tesseraTelemetry';

/** The collector URL a render_ui tool/result event carries, if any. */
export function resultTelemetry(eventData: any): string | undefined {
  const url = eventData?.meta?.[TELEMETRY_KEY];
  return typeof url === 'string' ? url : undefined;
}

interface Base {
  readonly ts: number;
  readonly session: string;
  /** The render_ui call: one interface. */
  readonly call: string;
}

/** A settled interface: what it is made of. Sent once per mount; the summary keeps the latest per call. */
export interface GeneratedEvent extends Base {
  readonly type: 'generated';
  readonly manifest: Manifest;
  readonly errors: number;
  readonly warnings: number;
  /** Diagnostic codes, one per diagnostic. */
  readonly codes: readonly string[];
  readonly chars: number;
}

/** Time a component (or, with site null, the whole interface) spent at least half visible, since the last report. */
export interface ExposureEvent extends Base {
  readonly type: 'exposure';
  readonly site: string | null;
  readonly component: string | null;
  readonly ms: number;
}

/** Event props the user triggered on one component instance, since the last report. */
export interface InteractionEvent extends Base {
  readonly type: 'interaction';
  readonly site: string;
  readonly component: string;
  readonly event: string;
  readonly count: number;
  /** The last value for numbers and booleans (a slider position, a checkbox); omitted otherwise. */
  readonly last?: number | boolean;
}

/** ui.send / ui.copy / ui.open. `site` is the component the user touched just before, when there was one. */
export interface ActionEvent extends Base {
  readonly type: 'action';
  readonly action: 'send' | 'copy' | 'open';
  readonly site: string | null;
  readonly component: string | null;
}

/** Keyed state that changed after the first paint. Values only for numbers and booleans. */
export interface StateEvent extends Base {
  readonly type: 'state';
  readonly keys: readonly string[];
  readonly values: Readonly<Record<string, number | boolean>>;
}

/** A host or runtime issue while the interface was shown. */
export interface IssueEvent extends Base {
  readonly type: 'issue';
  readonly code: string;
}

export type TelemetryEvent = GeneratedEvent | ExposureEvent | InteractionEvent | ActionEvent | StateEvent | IssueEvent;

const TYPES = new Set(['generated', 'exposure', 'interaction', 'action', 'state', 'issue']);

/** A plausible event from the browser; anything else is dropped (the collector accepts posts from local pages). */
export function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!value || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  if (!TYPES.has(e.type as string) || typeof e.ts !== 'number' || typeof e.session !== 'string' || typeof e.call !== 'string') return false;
  if (e.session.length > 200 || e.call.length > 200) return false;
  switch (e.type) {
    case 'generated':
      return !!e.manifest && typeof e.manifest === 'object' && Array.isArray((e.manifest as Manifest).sites);
    case 'exposure':
      return typeof e.ms === 'number' && e.ms >= 0 && e.ms < 3_600_000;
    case 'interaction':
      return typeof e.site === 'string' && typeof e.component === 'string' && typeof e.event === 'string' && typeof e.count === 'number';
    case 'action':
      return e.action === 'send' || e.action === 'copy' || e.action === 'open';
    case 'state':
      return Array.isArray(e.keys);
    default:
      return typeof e.code === 'string';
  }
}

// ---- summary ----

export interface ComponentRow {
  readonly component: string;
  /** Interfaces using it at least once. */
  readonly interfaces: number;
  /** Times it appears in the source across interfaces ({#each} counts once). */
  readonly sites: number;
  readonly visibleMs: number;
  readonly interactions: number;
  /** Sites with an event prop, and how many of those were used at least once. */
  readonly interactive: number;
  readonly used: number;
}

export interface CountRow {
  readonly key: string;
  readonly count: number;
}

export interface SiteRow {
  readonly site: number;
  readonly component: string;
  readonly depth: number;
  readonly origin: 'tag' | 'markdown';
  readonly props: string;
  readonly visibleMs: number;
  readonly interactions: number;
}

export interface InterfaceRow {
  readonly session: string;
  readonly call: string;
  readonly first: number;
  readonly last: number;
  readonly skeleton: string | null;
  readonly components: number;
  readonly visibleMs: number;
  readonly interactions: number;
  readonly actions: number;
  readonly errors: number;
  readonly sites: readonly SiteRow[];
}

export interface Summary {
  readonly events: number;
  readonly interfaces: number;
  readonly first: number | null;
  readonly last: number | null;
  readonly visibleMs: number;
  readonly interactions: number;
  readonly components: readonly ComponentRow[];
  /** `Component.prop=value` for literal props. */
  readonly props: readonly CountRow[];
  readonly skeletons: readonly CountRow[];
  /** `send ← Button`, or just `send` when no component was touched before it. */
  readonly actions: readonly CountRow[];
  readonly diagnostics: readonly CountRow[];
  readonly issues: readonly CountRow[];
  readonly state: readonly CountRow[];
  /** Most recent first. */
  readonly list: readonly InterfaceRow[];
  readonly recent: readonly TelemetryEvent[];
}

interface View {
  session: string;
  call: string;
  first: number;
  last: number;
  generated?: GeneratedEvent;
  visible: number;
  siteVisible: Map<number, number>;
  siteInteractions: Map<number, number>;
  interactions: number;
  actions: number;
}

/** "4:1.0" -> 4: telemetry comes per instance, the manifest per site. */
const baseSite = (site: string) => Number.parseInt(site, 10);

const add = (map: Map<string, number>, key: string, n = 1) => map.set(key, (map.get(key) ?? 0) + n);

const rows = (map: Map<string, number>, limit = 50): CountRow[] =>
  [...map].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, limit);

const formatValue = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > 24 ? text.slice(0, 23) + '…' : text;
};

export function summarize(events: readonly TelemetryEvent[], { list = 50, recent = 30 } = {}): Summary {
  const views = new Map<string, View>();
  const actions = new Map<string, number>();
  const diagnostics = new Map<string, number>();
  const issues = new Map<string, number>();
  const state = new Map<string, number>();
  let visibleMs = 0;
  let interactions = 0;

  for (const e of events) {
    const id = `${e.session}\u0000${e.call}`;
    let view = views.get(id);
    if (!view) {
      view = { session: e.session, call: e.call, first: e.ts, last: e.ts, visible: 0, siteVisible: new Map(), siteInteractions: new Map(), interactions: 0, actions: 0 };
      views.set(id, view);
    }
    view.first = Math.min(view.first, e.ts);
    view.last = Math.max(view.last, e.ts);
    switch (e.type) {
      case 'generated':
        // A reload remounts the row and reports it again; the latest report wins.
        if (!view.generated || e.ts >= view.generated.ts) view.generated = e;
        break;
      case 'exposure':
        if (e.site === null) {
          view.visible += e.ms;
          visibleMs += e.ms;
        } else {
          const site = baseSite(e.site);
          view.siteVisible.set(site, (view.siteVisible.get(site) ?? 0) + e.ms);
        }
        break;
      case 'interaction': {
        const site = baseSite(e.site);
        view.siteInteractions.set(site, (view.siteInteractions.get(site) ?? 0) + e.count);
        view.interactions += e.count;
        interactions += e.count;
        break;
      }
      case 'action':
        view.actions++;
        add(actions, e.component ? `${e.action} ← ${e.component}` : e.action);
        break;
      case 'state':
        for (const key of e.keys) add(state, key);
        break;
      case 'issue':
        add(issues, e.code);
        break;
    }
  }

  const components = new Map<string, { interfaces: number; sites: number; visibleMs: number; interactions: number; interactive: number; used: number }>();
  const props = new Map<string, number>();
  const skeletons = new Map<string, number>();
  const list_: InterfaceRow[] = [];

  for (const view of views.values()) {
    const g = view.generated;
    if (g) {
      add(skeletons, g.manifest.skeleton || '(空)');
      for (const code of g.codes) add(diagnostics, code);
      const seen = new Set<string>();
      for (const s of g.manifest.sites) {
        const row = components.get(s.component) ?? { interfaces: 0, sites: 0, visibleMs: 0, interactions: 0, interactive: 0, used: 0 };
        if (!seen.has(s.component)) {
          row.interfaces++;
          seen.add(s.component);
        }
        row.sites++;
        row.visibleMs += view.siteVisible.get(s.site) ?? 0;
        const n = view.siteInteractions.get(s.site) ?? 0;
        row.interactions += n;
        if (s.events.length) {
          row.interactive++;
          if (n > 0) row.used++;
        }
        components.set(s.component, row);
        for (const [prop, value] of Object.entries(s.literalProps)) add(props, `${s.component}.${prop}=${formatValue(value)}`);
      }
    }
    const depth = (site: number): number => {
      const parent = g?.manifest.sites[site]?.parent;
      return parent === null || parent === undefined ? 0 : 1 + depth(parent);
    };
    list_.push({
      session: view.session,
      call: view.call,
      first: view.first,
      last: view.last,
      skeleton: g?.manifest.skeleton ?? null,
      components: g?.manifest.sites.length ?? 0,
      visibleMs: view.visible,
      interactions: view.interactions,
      actions: view.actions,
      errors: g?.errors ?? 0,
      sites: (g?.manifest.sites ?? []).map((s) => ({
        site: s.site,
        component: s.component,
        depth: depth(s.site),
        origin: s.origin,
        props: Object.entries(s.literalProps).map(([k, v]) => `${k}=${formatValue(v)}`).join(' '),
        visibleMs: view.siteVisible.get(s.site) ?? 0,
        interactions: view.siteInteractions.get(s.site) ?? 0,
      })),
    });
  }

  list_.sort((a, b) => b.first - a.first);
  const times = events.map((e) => e.ts);
  return {
    events: events.length,
    interfaces: [...views.values()].filter((v) => v.generated).length,
    first: times.length ? Math.min(...times) : null,
    last: times.length ? Math.max(...times) : null,
    visibleMs,
    interactions,
    components: [...components]
      .map(([component, r]) => ({ component, ...r }))
      .sort((a, b) => b.sites - a.sites || a.component.localeCompare(b.component)),
    props: rows(props),
    skeletons: rows(skeletons, 20),
    actions: rows(actions),
    diagnostics: rows(diagnostics),
    issues: rows(issues),
    state: rows(state),
    list: list_.slice(0, list),
    recent: events.slice(-recent).reverse(),
  };
}
