import { defineCatalog } from '@tessera/catalog';
import { describe, expect, it } from 'vitest';
import { Scope, evaluate } from '../src/evaluate';
import { compile, resolveAll, systemPrompt, toFallbackMarkdown, type Resolution } from '../src/index';
import { find, render, text } from './helpers';

const catalog = defineCatalog();
const codes = (r: { diagnostics: readonly { code: string }[] }) => r.diagnostics.map((d) => d.code);

const PRODUCTS = {
  p1: { title: 'Sony WH-1000XM6', price: '¥2,899', merchant: '京东', rating: 4.8 },
  p2: { title: 'Bose QC Ultra', price: '¥2,499', merchant: '天猫', rating: 4.6 },
};

describe('tool data bindings', () => {
  it('reads values from the data table instead of the program text', () => {
    const r = compile('## {p1.title}\n价格 **{p1.price}**，来自 {p1.merchant}', { catalog, data: PRODUCTS });
    expect(r.diagnostics).toEqual([]);
    expect(r.code).not.toContain('2,899');
    expect(text(render(r).tree)).toBe('Sony WH-1000XM6价格 ¥2,899，来自 京东');
  });

  it('drops names that were not given (no made-up references)', () => {
    const r = compile('{p3.price}', { catalog, data: PRODUCTS });
    expect(codes(r)).toEqual(['unknown_identifier']);
  });

  it('reports a misspelt field but not methods or properties of real values', () => {
    expect(codes(compile('{p1.prcie}', { catalog, data: PRODUCTS }))).toEqual(['unknown_field']);
    expect(codes(compile('{p1.title.length} {p1.price.replace("¥", "")} {Object.keys(p1).length}', { catalog, data: PRODUCTS }))).toEqual([]);
    const list = { items: [{ name: 'a' }] };
    expect(codes(compile('{items.map((i) => i.name).join()} {items.length} {items[0].name} {items[0].nmae}', { catalog, data: list }))).toEqual([
      'unknown_field',
    ]);
  });

  it('does not report a missing last field that the expression already falls back on', () => {
    const pkg = { pkg: { name: 'tessera', meta: { tags: ['ui'] } } };
    const guarded = [
      '{pkg.version ?? "未声明"}',
      '{pkg["version"] ?? "未声明"}',
      '{pkg.version || "未声明"}',
      '{pkg.meta.owner ?? "—"}',
      '{pkg.links?.home}',
      '{pkg.links?.home ?? "—"}',
      '{pkg.format?.("x")}',
      '{@let ver = pkg.version ?? "0.0.0"}\n{ver}',
    ];
    for (const source of guarded) expect(codes(compile(source, { catalog, data: pkg })), source).toEqual([]);
    expect(text(render(compile('版本 {pkg.version ?? "未声明"}', { catalog, data: pkg })).tree)).toBe('版本 未声明');
  });

  it('still reports plain uses, and missing fields a fallback cannot catch', () => {
    const pkg = { pkg: { name: 'tessera', meta: null } };
    const reported = [
      ['{pkg.version}', 'pkg.version'],
      // The fallback guards the whole expression, not a missing field inside it.
      ['{pkg.version.trim() ?? "—"}', 'pkg.version'],
      ['{pkg.links.home ?? "—"}', 'pkg.links'],
      // Reading a key of null throws before ?? is reached.
      ['{pkg.meta.owner ?? "—"}', 'pkg.meta.owner'],
    ] as const;
    for (const [source, path] of reported) {
      const r = compile(source, { catalog, data: pkg });
      expect(r.diagnostics.map((d) => `${d.code}: ${d.message}`), source).toEqual([`unknown_field: ${path} does not exist in the tool data`]);
    }
  });

  it('does not let a directive shadow tool data', () => {
    expect(codes(compile('{@state p1 = 1}', { catalog, data: PRODUCTS }))).toEqual(['duplicate_name']);
  });

  it('lists the available data for the model', () => {
    const p = systemPrompt(catalog, { data: { ...PRODUCTS, list: [PRODUCTS.p1] } });
    expect(p).toContain('- p1: { title, price, merchant, rating }');
    expect(p).toContain('- list: list of 1 × { title, price, merchant, rating }');
  });
});

describe('server-resolved components', () => {
  it('turns an Image into a resolution with a stable key, and reads the result from data', () => {
    const r = compile('<Image query="slow-roasted lamb" aspect="4:3" />', { catalog });
    expect(r.diagnostics).toEqual([]);
    expect(r.resolutions).toHaveLength(1);
    const [res] = r.resolutions as [Resolution];
    expect(res).toMatchObject({ resolver: 'image', component: 'Image', input: { aspect: '4:3', query: 'slow-roasted lamb' } });
    expect(res.key).toMatch(/^resolve:image:[0-9a-f]{8}$/);
    // Same element, different attribute order or an extra prefix around it: same key.
    expect(compile('## Menu\n<Image aspect="4:3" query="slow-roasted lamb" />', { catalog }).resolutions[0]!.key).toBe(res.key);

    const pending = find(render(r).tree, 'Image')!;
    expect(pending.props.resolved).toBeUndefined();
    const done = find(render({ ...r, data: { [res.key]: { url: 'https://img/lamb.png' } } }).tree, 'Image')!;
    expect(done.props.resolved).toEqual({ url: 'https://img/lamb.png' });
  });

  it('needs literal input, valid input, and never lets the model write the result', () => {
    expect(codes(compile('{@state q = "cat"}\n<Image query={q} />', { catalog }))).toEqual(['dynamic_resolver_input']);
    const empty = compile('<Image query="" />', { catalog });
    expect(codes(empty)).toEqual(['invalid_literal']);
    expect(empty.resolutions).toEqual([]);
    expect(codes(compile('<Image query="cat" resolved={{ url: "https://evil" }} />', { catalog }))).toEqual(['unknown_prop']);
  });

  it('resolveAll runs resolvers in parallel and skips unknown, failing and slow ones', async () => {
    const r = compile('<Image query="a" />\n<Image query="b" />\n<Image query="slow" />\n<Image query="boom" />', { catalog });
    const errors: string[] = [];
    const results = await resolveAll(
      [...r.resolutions, { key: 'resolve:video:x', resolver: 'video', component: 'Video', input: {} }],
      {
        image: async (input) => {
          if (input.query === 'boom') throw new Error('boom');
          if (input.query === 'slow') await new Promise((res) => setTimeout(res, 200));
          return { url: `https://img/${String(input.query)}.png` };
        },
      },
      { timeout: 50, onError: (res, e) => errors.push(`${String(res.input.query)}: ${(e as Error).message}`) },
    );
    expect(Object.values(results)).toEqual([{ url: 'https://img/a.png' }, { url: 'https://img/b.png' }]);
    expect(errors.sort()).toEqual(['boom: boom', 'slow: Resolver did not finish within 50 ms']);
  });
});

describe('evaluate', () => {
  const scope = new Scope();
  scope.vars.set('items', [{ n: 'a', q: 2 }, { n: 'b', q: 0 }, { n: 'c', q: 5 }]);
  scope.vars.set('p', PRODUCTS.p1);
  const ev = (src: string) => evaluate(src, scope);

  it('handles the everyday pure subset', () => {
    expect(ev('1 + 2 * 3')).toBe(7);
    expect(ev('`${p.title} – ${p.price}`')).toBe('Sony WH-1000XM6 – ¥2,899');
    expect(ev('items.filter((i) => i.q > 0).map((i) => i.n).join("、")')).toBe('a、c');
    expect(ev('items.reduce((sum, i) => sum + i.q, 0)')).toBe(7);
    expect(ev('Math.round(p.rating * 10) / 10')).toBe(4.8);
    expect(ev('p.missing?.deep ?? "none"')).toBe('none');
    expect(ev('items.length > 2 ? "many" : "few"')).toBe('many');
    expect(ev('((x) => { const y = x * 2; return y + 1; })(4)')).toBe(9);
  });

  it('refuses what it cannot do safely', () => {
    expect(() => ev('Math.constructor')).toThrow();
    expect(() => ev('Math.random()')).toThrow();
    expect(() => ev('new Date()')).toThrow();
    expect(() => ev('Array.from({ length: 1e9 })')).toThrow();
    expect(() => ev('"x".repeat(1e9)')).toThrow();
  });

  it('always terminates: deep work runs out of fuel', () => {
    const started = Date.now();
    expect(() => ev('Array.from({ length: 10000 }).reduce((s) => s + Array.from({ length: 10000 }).length, 0)')).toThrow(/fuel/);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe('toFallbackMarkdown', () => {
  const TEAM = `## 团队套餐估价
拖动滑块，看看团队**每月**要花多少。
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider label="席位" min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{price} 美元/月</Title>
<Button onClick={() => ui.send("x")}>生成方案</Button>
</Box>`;

  it('renders computed values at the initial state', () => {
    expect(toFallbackMarkdown(TEAM, { catalog })).toBe(
      ['## 团队套餐估价', '拖动滑块，看看团队**每月**要花多少。', '席位: 8 (1–50)', '# 232 美元/月', '[生成方案]'].join('\n\n'),
    );
  });

  it('can render the state the user left instead', () => {
    expect(toFallbackMarkdown(TEAM, { catalog, state: { seats: 30 } })).toContain('# 870 美元/月');
  });

  it('expands lists and conditionals', () => {
    const src = `{@state items = ["帐篷", "睡袋"]}
{@state done = ["帐篷"]}
{#each items as item}
<Checkbox label={item} checked={done.includes(item)} onChange={(on) => setDone([])} />
{/each}
{#if done.length === items.length}
全部带齐了
{:else}
还差 **{items.length - done.length}** 样
{/if}
1. 第一
2. 第二`;
    expect(toFallbackMarkdown(src, { catalog })).toBe('- [x] 帐篷\n\n- [ ] 睡袋\n\n还差 **1** 样\n\n1. 第一\n2. 第二');
  });

  it('uses tool data and resolver results, and placeholders for what it cannot evaluate', () => {
    const r = compile('<Image query="耳机" />', { catalog });
    const key = r.resolutions[0]!.key;
    const md = toFallbackMarkdown('{p1.title} {p1.price}\n<Image query="耳机" />\n<Image query="无图" />\n{Date.now()}', {
      catalog,
      data: { ...PRODUCTS, [key]: { url: 'https://img/headphones.png' } },
    });
    expect(md).toBe('Sony WH-1000XM6 ¥2,899\n\n![耳机](https://img/headphones.png)\n\n*[image: 无图]*\n\n…');
  });
});
