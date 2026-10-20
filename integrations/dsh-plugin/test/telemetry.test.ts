import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compile } from '@tessera/lang';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { allowedOrigin, startCollector, type Collector } from '../src/collector';
import { apply, DEFAULT_TELEMETRY_PORT, telemetryOptions } from '../src/host';
import { catalog } from '../src/shared';
import { isTelemetryEvent, summarize, TELEMETRY_KEY, type TelemetryEvent } from '../src/telemetry';
import { changedState, setEndpoint, ViewTracker } from '../src/track';

const SOURCE = `## 估价
{@state n = 2}
<Box border padding={3}>
<Slider min={1} max={9} value={n} onChange={setN} />
<Button variant="outline" onClick={() => ui.send(\`要 \${n} 份\`)}>下单</Button>
</Box>`;

const program = compile(SOURCE, { catalog });
const base = { session: 's1', call: 'c1' };

function generated(ts: number, extra: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return { type: 'generated', ts, ...base, manifest: program.manifest, errors: 0, warnings: 0, codes: [], chars: SOURCE.length, ...extra } as TelemetryEvent;
}

describe('summarize', () => {
  const events: TelemetryEvent[] = [
    generated(1),
    { type: 'exposure', ts: 2, ...base, site: null, component: null, ms: 4000 },
    { type: 'exposure', ts: 2, ...base, site: '2', component: 'Slider', ms: 3000 },
    { type: 'interaction', ts: 3, ...base, site: '2', component: 'Slider', event: 'onChange', count: 5, last: 7 },
    { type: 'state', ts: 3, ...base, keys: ['n'], values: { n: 7 } },
    { type: 'action', ts: 4, ...base, action: 'send', site: '3', component: 'Button' },
    { type: 'interaction', ts: 4, ...base, site: '3', component: 'Button', event: 'onClick', count: 1 },
    // A reload remounts the row and reports the interface again.
    generated(5),
    { type: 'generated', ts: 6, session: 's1', call: 'c2', manifest: compile('<Badge tone="info">新</Badge>', { catalog }).manifest, errors: 1, warnings: 0, codes: ['unknown_prop'], chars: 30 },
    { type: 'issue', ts: 7, session: 's1', call: 'c2', code: 'expression_error' },
  ];
  const s = summarize(events);

  it('counts interfaces once, however often they were reported', () => {
    expect(s.interfaces).toBe(2);
    expect(s.events).toBe(events.length);
    expect(s.visibleMs).toBe(4000);
    expect(s.interactions).toBe(6);
    expect(s.list.map((v) => v.call)).toEqual(['c2', 'c1']);
  });

  it('joins what happened on screen to the components of the manifest', () => {
    const row = (name: string) => s.components.find((c) => c.component === name)!;
    expect(row('Slider')).toEqual({ component: 'Slider', interfaces: 1, sites: 1, visibleMs: 3000, interactions: 5, interactive: 1, used: 1 });
    expect(row('Button')).toMatchObject({ interactions: 1, interactive: 1, used: 1 });
    expect(row('Box')).toMatchObject({ interactive: 0, used: 0 });
    expect(row('Badge')).toMatchObject({ interfaces: 1, sites: 1 });
    const c1 = s.list.find((v) => v.call === 'c1')!;
    expect(c1.sites.map((x) => [x.component, x.depth])).toEqual([['Title', 0], ['Box', 0], ['Slider', 1], ['Button', 1]]);
    expect(c1.sites[2]).toMatchObject({ visibleMs: 3000, interactions: 5, props: 'min=1 max=9' });
  });

  it('counts styles, layouts, actions, state, diagnostics and issues', () => {
    expect(s.props).toContainEqual({ key: 'Button.variant=outline', count: 1 });
    expect(s.props).toContainEqual({ key: 'Box.border=true', count: 1 });
    expect(s.skeletons).toEqual([{ key: 'Badge', count: 1 }, { key: 'Title Box(Slider Button)', count: 1 }]);
    expect(s.actions).toEqual([{ key: 'send ← Button', count: 1 }]);
    expect(s.state).toEqual([{ key: 'n', count: 1 }]);
    expect(s.diagnostics).toEqual([{ key: 'unknown_prop', count: 1 }]);
    expect(s.issues).toEqual([{ key: 'expression_error', count: 1 }]);
  });

  it('maps item instances inside {#each} back to their site', () => {
    const each = compile('{@state xs = [1, 2]}\n{#each xs as x}<Button onClick={() => ui.send(String(x))}>{x}</Button>{/each}', { catalog });
    const out = summarize([
      generated(1, { manifest: each.manifest }),
      { type: 'interaction', ts: 2, ...base, site: '0:0', component: 'Button', event: 'onClick', count: 1 },
      { type: 'interaction', ts: 2, ...base, site: '0:1', component: 'Button', event: 'onClick', count: 2 },
    ]);
    expect(out.components).toEqual([{ component: 'Button', interfaces: 1, sites: 1, visibleMs: 0, interactions: 3, interactive: 1, used: 1 }]);
    expect(out.skeletons).toEqual([{ key: 'Button[]', count: 1 }]);
  });
});

describe('isTelemetryEvent', () => {
  it('accepts what the browser sends and drops the rest', () => {
    expect(isTelemetryEvent(generated(1))).toBe(true);
    expect(isTelemetryEvent({ type: 'action', ts: 1, ...base, action: 'send', site: null, component: null })).toBe(true);
    expect(isTelemetryEvent({ type: 'action', ts: 1, ...base, action: 'delete' })).toBe(false);
    expect(isTelemetryEvent({ type: 'exposure', ts: 1, ...base, site: null, ms: -5 })).toBe(false);
    expect(isTelemetryEvent({ type: 'generated', ts: 1, ...base })).toBe(false);
    expect(isTelemetryEvent({ type: 'nope', ts: 1, ...base })).toBe(false);
    expect(isTelemetryEvent('x')).toBe(false);
  });
});

describe('browser side', () => {
  it('reports only state that changed, not state that appeared', () => {
    expect(changedState({ n: 1, s: 'a' }, { n: 2, s: 'b', added: 3 })).toEqual({ keys: ['n', 's'], values: { n: 2 } });
    expect(changedState({ n: 1 }, { n: 1 })).toEqual({ keys: [], values: {} });
  });

  describe('ViewTracker', () => {
    const posted: TelemetryEvent[] = [];
    beforeAll(() => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
        posted.push(...(JSON.parse(init.body) as { events: TelemetryEvent[] }).events);
        return { ok: true };
      });
      setEndpoint('http://127.0.0.1:4317');
    });
    afterAll(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });
    const drain = async () => {
      await vi.advanceTimersByTimeAsync(3000);
      return posted.splice(0);
    };

    it('attributes an action to the component touched just before it', async () => {
      const t = new ViewTracker('s', 'c');
      t.interact('3', 'Button', 'onClick', undefined);
      t.action({ type: 'send', text: 'x' });
      vi.advanceTimersByTime(5000);
      t.action({ type: 'copy', text: 'x' });
      const events = await drain();
      expect(events.filter((e) => e.type === 'action').map((e) => [e.action, e.component])).toEqual([
        ['send', 'Button'],
        ['copy', null],
      ]);
    });

    it('takes the first state report as the baseline, unless a state was restored', async () => {
      const fresh = new ViewTracker('s', 'fresh');
      fresh.state({ n: 2 });
      fresh.state({ n: 3 });
      const restored = new ViewTracker('s', 'restored', { n: 5 });
      restored.state({ n: 6 });
      const events = (await drain()).filter((e) => e.type === 'state');
      expect(events.map((e) => [e.call, e.values])).toEqual([
        ['fresh', { n: 3 }],
        ['restored', { n: 6 }],
      ]);
    });

    it('reports a settled interface once, and sums interactions until the next report', async () => {
      const t = new ViewTracker('s', 'g');
      t.generated(program, SOURCE.length);
      t.generated(program, SOURCE.length);
      for (const v of [3, 4, 5]) t.interact('2', 'Slider', 'onChange', v);
      t.stop();
      const events = await drain();
      expect(events.filter((e) => e.type === 'generated')).toHaveLength(1);
      expect(events.find((e) => e.type === 'interaction')).toMatchObject({ site: '2', component: 'Slider', count: 3, last: 5 });
    });
  });
});

describe('collector', () => {
  let dir: string;
  let collector: Collector;
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'tessera-telemetry-'));
    collector = await startCollector({ port: 0, dir });
  });
  afterAll(async () => {
    await collector.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const post = (path: string, body: unknown, origin?: string) =>
    fetch(collector.url + path, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain', ...(origin ? { origin } : {}) } });

  it('keeps events from local pages and sums them up', async () => {
    const res = await post('/api/events', { events: [generated(1), { type: 'bogus' }] }, 'http://127.0.0.1:3091');
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('http://127.0.0.1:3091');
    expect(await res.json()).toEqual({ accepted: 1 });
    const summary = await (await fetch(collector.url + '/api/summary')).json();
    expect(summary.interfaces).toBe(1);
    expect(readFileSync(collector.file, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  it('refuses posts from websites and requests for other host names', async () => {
    expect((await post('/api/events', { events: [generated(2)] }, 'https://example.com')).status).toBe(403);
    expect((await post('/api/events', { events: [generated(2)] }, 'null')).status).toBe(403);
    const status = await new Promise<number>((resolve) => {
      const url = new URL(collector.url + '/api/summary');
      request({ host: url.hostname, port: url.port, path: url.pathname, headers: { host: 'attacker.example' } }, (res) => resolve(res.statusCode ?? 0)).end();
    });
    expect(status).toBe(403);
  });

  it('refuses a body that is too large', async () => {
    const res = await post('/api/events', { events: [], pad: 'x'.repeat(600 * 1024) }, 'http://localhost:3091');
    expect(res.status).toBe(413);
  });

  it('serves the stats page, and lets only that page clear the data', async () => {
    const page = await fetch(collector.url + '/');
    expect(page.headers.get('content-type')).toContain('text/html');
    expect(await page.text()).toContain('Tessera 统计');
    expect((await post('/api/clear', {}, 'http://127.0.0.1:3091')).status).toBe(403);
    expect((await post('/api/clear', {}, collector.url)).status).toBe(200);
    expect((await (await fetch(collector.url + '/api/summary')).json()).events).toBe(0);
  });

  it('accepts the harness from loopback or an app scheme, nothing else', () => {
    for (const ok of [undefined, 'http://127.0.0.1:3091', 'http://localhost:5173', 'app://dsh']) expect(allowedOrigin(ok)).toBe(true);
    for (const bad of ['null', 'https://example.com', 'http://192.168.1.2:3091', 'garbage']) expect(allowedOrigin(bad)).toBe(false);
  });
});

describe('plugin config', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is on by default at a fixed port in the plugin folder, and can be turned off', () => {
    expect(telemetryOptions(undefined)).toMatchObject({ port: DEFAULT_TELEMETRY_PORT });
    expect(telemetryOptions(undefined)!.dir.replace(/\\/g, '/')).toMatch(/dsh-plugin\/\.telemetry$/);
    expect(telemetryOptions({ telemetry: { port: 5000, dir: '/tmp/x' } })).toEqual({ port: 5000, dir: '/tmp/x' });
    expect(telemetryOptions({ telemetry: false })).toBeNull();
  });

  it('starts the collector under the harness effect and tells the browser where it is', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    const dir = mkdtempSync(join(tmpdir(), 'tessera-telemetry-'));
    const tools: { output: { presentationMeta(args: unknown, value: unknown): Record<string, unknown> } }[] = [];
    let dispose: (() => void) | undefined;
    apply(
      { tools: { register: (d) => (tools.push(d as never), () => {}) }, effect: (setup) => void (dispose = setup()) },
      { telemetry: { port: 0, dir } },
    );
    const meta = () => tools[0]!.output.presentationMeta({}, { shown: true, errors: 0, warnings: 0, text: '' });
    await vi.waitFor(() => expect(meta()[TELEMETRY_KEY]).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/));
    dispose!();
    expect(meta()).toEqual({});
    rmSync(dir, { recursive: true, force: true });
  });
});
