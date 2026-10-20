import { defineCatalog } from '@tessera/catalog';
import { describe, expect, it } from 'vitest';
import { compile, type Manifest } from '../src/index';
import { render, type FakeNode } from './helpers';

const catalog = defineCatalog();

const TEAM = `## 团队套餐估价
拖动滑块，看看团队**每月**要花多少。
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{price} 美元/月</Title>
<Button onClick={() => ui.send(\`为 \${seats} 人做预算\`)}>生成方案</Button>
</Box>`;

const NESTED = `{@state rows = [[1, 2], [3]]}
{#each rows as row, i}<Box>{#each row as n, i}<Badge>{n}</Badge>{/each}</Box>{/each}`;

const BRANCHES = `{@state on = true}
{#if on}<Badge tone="info">on</Badge>{:else}<Progress value={1} max={4} />{/if}
<Button onClick={() => setOn(!on)}>切换</Button>`;

const MIXED = `# 标题
一段 *说明* 文字。
- 第一项
- 第二项 <Badge tone="success">新</Badge>

<Box gap={1}>
<Caption>里面的说明</Caption>
<Divider />
</Box>`;

/** Sites of the rendered tree in pre-order, as the host would see them. */
function renderedSites(nodes: (FakeNode | string)[]): string[] {
  return nodes.flatMap((n) => (typeof n === 'string' ? [] : [n.site ?? '?', ...renderedSites(n.children)]));
}

describe('manifest', () => {
  it('lists every component in source order with its props and place in the tree', () => {
    const { manifest, diagnostics } = compile(TEAM, { catalog });
    expect(diagnostics).toEqual([]);
    expect(manifest.sites.map((s) => [s.site, s.component, s.parent, s.origin])).toEqual([
      [0, 'Title', null, 'markdown'],
      [1, 'Text', null, 'markdown'],
      [2, 'Bold', 1, 'markdown'],
      [3, 'Box', null, 'tag'],
      [4, 'Slider', 3, 'tag'],
      [5, 'Title', 3, 'tag'],
      [6, 'Button', 3, 'tag'],
    ]);
    const [heading, , , box, slider, title, button] = manifest.sites;
    expect(heading!.literalProps).toEqual({ size: 'lg' });
    expect(heading!.pos).toBe(-1);
    expect(box!.literalProps).toEqual({ border: true, padding: 3, gap: 2 });
    expect(box!.pos).toBe(TEAM.indexOf('<Box'));
    expect(slider).toMatchObject({ literalProps: { min: 1, max: 50 }, dynamicProps: ['value'], events: ['onChange'] });
    expect(title!.literalProps).toEqual({ size: 'xl' });
    expect(button).toMatchObject({ literalProps: {}, dynamicProps: [], events: ['onClick'], loopDepth: 0, conditional: false });
  });

  it('summarises the layout and the declarations', () => {
    const { manifest } = compile(TEAM, { catalog });
    expect(manifest.skeleton).toBe('Title Text(Bold) Box(Slider Title Button)');
    expect(manifest.state).toEqual(['seats']);
    expect(manifest.lets).toEqual(['price']);
    expect(compile(MIXED, { catalog }).manifest.skeleton).toBe('Title Text(Italic) List(ListItem×2) Box(Caption Divider)');
  });

  it('leaves dropped props out', () => {
    const { manifest, diagnostics } = compile('<Badge tone="loud" colour="red">x</Badge>', { catalog });
    expect(diagnostics.map((d) => d.code)).toEqual(['invalid_literal', 'unknown_prop']);
    expect(manifest.sites[0]!.literalProps).toEqual({});
  });

  it('marks components inside {#each} and {#if}', () => {
    const nested = compile(NESTED, { catalog }).manifest;
    expect(nested.sites.map((s) => [s.component, s.parent, s.loopDepth])).toEqual([
      ['Box', null, 1],
      ['Badge', 0, 2],
    ]);
    expect(nested.skeleton).toBe('Box[](Badge[])');

    const branches = compile(BRANCHES, { catalog }).manifest;
    expect(branches.sites.map((s) => [s.component, s.conditional])).toEqual([
      ['Badge', true],
      ['Progress', true],
      ['Button', false],
    ]);
  });
});

describe('sites in the program', () => {
  it('passes each component its site, matching the manifest', () => {
    const program = compile(TEAM, { catalog });
    expect(renderedSites(render(program).tree)).toEqual(program.manifest.sites.map((s) => String(s.site)));
  });

  it('gives every item of {#each} its own instance id, even when nested loops reuse an index name', () => {
    const { tree } = render(compile(NESTED, { catalog }));
    expect(renderedSites(tree)).toEqual(['0:0', '1:0.0', '1:0.1', '0:1', '1:1.0']);
  });

  it('numbers {#if} branches in source order', () => {
    const program = compile(BRANCHES, { catalog });
    expect(renderedSites(render(program).tree)).toEqual(['0', '2']);
    expect(renderedSites(render(program, new Map([['on', false]])).tree)).toEqual(['1', '2']);
  });

  it('rejects loop variables that could shadow the program’s own names', () => {
    const { diagnostics, code } = compile('{@state xs = [1]}\n{#each xs as __k0}<Badge>x</Badge>{/each}', { catalog });
    expect(diagnostics.map((d) => d.code)).toEqual(['reserved_name']);
    expect(code).not.toContain('Badge');
  });

  it('keeps every finished component’s site while the source streams in', () => {
    for (const source of [TEAM, NESTED, BRANCHES, MIXED]) {
      const final = compile(source, { catalog }).manifest;
      for (let end = 1; end < source.length; end++) {
        const prefix = compile(source.slice(0, end), { catalog }).manifest;
        // Only the last component at each level can still change: it may be half written.
        const open = rightSpine(prefix);
        for (const site of prefix.sites) {
          if (open.has(site.site)) continue;
          expect(final.sites[site.site], `${JSON.stringify(source.slice(0, end))} site ${site.site}`).toEqual(site);
        }
      }
    }
  });
});

/** The last top-level component, its last child, and so on down: where the source is still being written. */
function rightSpine(manifest: Manifest): Set<number> {
  const open = new Set<number>();
  let parent: number | null = null;
  for (;;) {
    const last = manifest.sites.filter((s) => s.parent === parent).at(-1);
    if (!last) return open;
    open.add(last.site);
    parent = last.site;
  }
}
