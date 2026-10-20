// The real runtime, as the worker runs it: DOM polyfill and libraries first, then lockdown().
import '@remote-dom/core/polyfill';
import 'ses';
import { NODE_TYPE_ELEMENT } from '@remote-dom/core';
import { RemoteReceiver, type RemoteReceiverElement, type RemoteReceiverParent } from '@remote-dom/core/receivers';
import { defineCatalog } from '@tessera/catalog';
import { compile } from '@tessera/lang';
import { beforeAll, describe, expect, it } from 'vitest';
import { LOCKDOWN_OPTIONS } from '../src/lockdown-options';
import type { RuntimeIssue } from '../src/protocol';
import { createRuntime } from '../src/runtime';

beforeAll(() => {
  lockdown(LOCKDOWN_OPTIONS);
});

const catalog = defineCatalog();

const TEAM = `## 团队套餐估价
{@state seats = 8}
<Box border padding={3}>
<Slider min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{seats * 29} 美元/月</Title>
</Box>`;

async function mounted() {
  const receiver = new RemoteReceiver();
  const runtime = createRuntime();
  const issues: RuntimeIssue[] = [];
  await runtime.mount(receiver.connection, catalog.wire(), { action() {}, issue: (i) => issues.push(i), state() {} });
  return { receiver, runtime, issues };
}

/** Mutations are flushed on a microtask; a macrotask later the receiver has them all. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What the host receives, in pre-order: component name, site and props of every element. */
function received(receiver: RemoteReceiver, parent: RemoteReceiverParent = receiver.root) {
  const out: { component: string; site: unknown; props: Record<string, unknown> }[] = [];
  for (const child of receiver.get<RemoteReceiverParent>({ id: parent.id })?.children ?? []) {
    if (child.type !== NODE_TYPE_ELEMENT) continue;
    const el = receiver.get<RemoteReceiverElement>({ id: child.id })!;
    out.push({
      component: catalog.byTag(el.element)?.name ?? el.element,
      site: el.properties.site,
      props: el.properties.props as Record<string, unknown>,
    });
    out.push(...received(receiver, el));
  }
  return out;
}

describe('sites reach the host', () => {
  it('sends each component’s site beside its props, matching the manifest', async () => {
    const { receiver, runtime, issues } = await mounted();
    const program = compile(TEAM, { catalog });
    expect(await runtime.render(program)).toEqual({ ok: true });
    await settle();
    const elements = received(receiver);
    expect(elements.map((e) => [e.component, e.site])).toEqual(program.manifest.sites.map((s) => [s.component, String(s.site)]));
    expect(elements.find((e) => e.component === 'Box')!.props).toEqual({ border: true, padding: 3 });
    for (const e of elements) expect(e.props).not.toHaveProperty('__site');
    expect(issues).toEqual([]);
  });

  it('keeps the sites of elements already on screen when a longer prefix is rendered', async () => {
    const { receiver, runtime } = await mounted();
    const cut = TEAM.indexOf('<Title size');
    await runtime.render(compile(TEAM.slice(0, cut), { catalog }));
    await settle();
    const before = new Map(received(receiver).map((e) => [e.component, e.site]));
    await runtime.render(compile(TEAM, { catalog }));
    await settle();
    const after = received(receiver);
    expect(before.get('Slider')).toBe('2');
    expect(after.find((e) => e.component === 'Slider')!.site).toBe(before.get('Slider'));
    expect(after.map((e) => e.site)).toEqual(['0', '1', '2', '3']);
  });

  it('sends one instance id per item of {#each}', async () => {
    const { receiver, runtime } = await mounted();
    await runtime.render(compile('{@state rows = [[1, 2], [3]]}\n{#each rows as row, i}<Box>{#each row as n, i}<Badge>{n}</Badge>{/each}</Box>{/each}', { catalog }));
    await settle();
    expect(received(receiver).map((e) => e.site)).toEqual(['0:0', '1:0.0', '1:0.1', '0:1', '1:1.0']);
  });
});
