import { defineCatalog } from '@tessera/catalog';
import { compile } from '@tessera/lang';
import { describe, expect, it } from 'vitest';
import { SSEParser, applyOps, emptyDoc, encodeEvent, readTesseraStream, type PatchBatch, type StreamDoc } from '../src/index';
import { stringDiff } from '../src/patch';
import { createSSEStream, createStreamCompiler } from '../src/server';

const catalog = defineCatalog();

const TEAM = `## 团队套餐估价
拖动滑块，看看团队**每月**要花多少。
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">{price} 美元/月</Title>
<Caption>按年付相当于每月 {Math.round(price * 10 / 12)} 美元</Caption>
</Box>`;

/** Splits like a model would: short runs, CJK one or two characters at a time. */
function tokens(src: string): string[] {
  return src.match(/\s*(?:[A-Za-z_$]+|\d{1,3}|[一-鿿]{1,2}|[^\sA-Za-z0-9_$一-鿿]{1,3})|\s+$/g) ?? [];
}

describe('applyOps', () => {
  it('appends, replaces, pushes and shares untouched branches', () => {
    const doc: StreamDoc = { ...emptyDoc, constants: ['a', 'b'] };
    const next = applyOps(doc, [
      { op: 'append', path: '/text', value: 'hi' },
      { op: 'append', path: '/constants/1', value: 'c' },
      { op: 'add', path: '/constants/-', value: 'd' },
      { op: 'replace', path: '/done', value: true },
    ]);
    expect(next).toMatchObject({ text: 'hi', constants: ['a', 'bc', 'd'], done: true });
    expect(doc.constants).toEqual(['a', 'b']);
    expect(next.diagnostics).toBe(doc.diagnostics);
  });

  it('rejects ops that do not fit the document', () => {
    expect(() => applyOps(emptyDoc, [{ op: 'append', path: '/done', value: 'x' }])).toThrow();
    expect(() => applyOps(emptyDoc, [{ op: 'replace', path: '/constants/-', value: 'x' }])).toThrow();
    expect(() => applyOps(emptyDoc, [{ op: 'replace', path: '/text/x/y', value: 1 }])).toThrow();
  });
});

describe('createStreamCompiler', () => {
  const run = (chunks: string[], interval = 0) => {
    let clock = 0;
    const compiler = createStreamCompiler({ catalog, interval, now: () => clock });
    const batches: PatchBatch[] = [];
    let client = emptyDoc;
    for (const chunk of chunks) {
      clock += 10;
      const batch = compiler.push(chunk);
      if (batch) {
        batches.push(batch);
        client = applyOps(client, batch.ops);
        expect(client).toEqual(compiler.doc);
      }
    }
    const last = compiler.end();
    batches.push(last);
    client = applyOps(client, last.ops);
    return { batches, client, server: compiler.doc };
  };

  it('keeps the client document equal to the server document at every step', () => {
    const { client, server } = run(tokens(TEAM));
    expect(client).toEqual(server);
    expect(client.done).toBe(true);
    expect(client.text).toBe(TEAM);
  });

  it('ends with exactly the program a one-shot compile produces', () => {
    const { client } = run(tokens(TEAM));
    const full = compile(TEAM, { catalog });
    expect(client.code).toBe(full.code);
    expect(client.constants).toEqual(full.constants);
    expect(client.diagnostics).toEqual(full.diagnostics);
  });

  it('classifies updates and resends code only on structure changes', () => {
    const { batches } = run(tokens(TEAM));
    const kinds = batches.map((b) => b.kind);
    expect(kinds.at(-1)).toBe('final');
    expect(kinds.filter((k) => k === 'structure').length).toBeGreaterThan(3);
    expect(kinds.filter((k) => k === 'constants').length).toBeGreaterThan(3);
    expect(kinds.filter((k) => k === 'text').length).toBeGreaterThan(3);
    for (const b of batches) {
      const sendsCode = b.ops.some((o) => o.path === '/code');
      if (b.kind === 'constants' || b.kind === 'text') expect(sendsCode).toBe(false);
      if (b.kind === 'structure') expect(sendsCode).toBe(true);
    }
  });

  it('sends growing text as appends to the constants table', () => {
    const { batches } = run(['## 团队', '套餐', '估价']);
    expect(batches[1]!.kind).toBe('constants');
    expect(batches[1]!.ops).toContainEqual({ op: 'append', path: '/constants/0', value: '套餐' });
  });

  it('throttles recompiles but loses no text', () => {
    const chunks = tokens(TEAM);
    const eager = run(chunks, 0);
    const throttled = run(chunks, 50);
    expect(throttled.batches.length).toBeLessThan(eager.batches.length / 2);
    expect(throttled.client).toEqual(eager.client);
  });

  it('refuses input after the end', () => {
    const compiler = createStreamCompiler({ catalog });
    compiler.end();
    expect(() => compiler.push('x')).toThrow();
  });
});

describe('splicing changed code', () => {
  it('stringDiff reproduces the target string for arbitrary edits', () => {
    const samples = ['', 'a', 'abc', 'abcabc', '你好世界', 'x'.repeat(50), 'ab\ncd\nef'];
    for (const a of samples) {
      for (const b of samples) {
        for (const edit of [b, a + b, b + a, a.slice(1) + b, a.replace('b', 'zz')]) {
          const op = stringDiff('/code', a, edit);
          expect(applyOps({ ...emptyDoc, code: a }, [op]).code).toBe(edit);
        }
      }
    }
  });

  it('sends far fewer code bytes than resending the whole program', () => {
    const sizeOfCode = (spliceCode: boolean) => {
      const compiler = createStreamCompiler({ catalog, spliceCode });
      let bytes = 0;
      for (const chunk of tokens(TEAM)) {
        const batch = compiler.push(chunk);
        const code = batch?.ops.find((o) => o.path === '/code');
        if (code) bytes += JSON.stringify(code).length;
      }
      return bytes;
    };
    const full = sizeOfCode(false);
    const spliced = sizeOfCode(true);
    expect(spliced).toBeLessThan(full * 0.35);
  });
});

describe('tool data, resolvers and fallback', () => {
  const PRODUCTS = { p1: { title: 'Sony WH-1000XM6', price: '¥2,899' } };
  const SOURCE = '## {p1.title}\n价格 {p1.price}\n<Image query="头戴式降噪耳机" />';

  it('sends tool data once, with the first batch', () => {
    const compiler = createStreamCompiler({ catalog, data: PRODUCTS });
    const first = compiler.push('## ');
    expect(first!.ops[0]).toEqual({ op: 'replace', path: '/data', value: PRODUCTS });
    const later = compiler.push('{p1.title}');
    expect(later!.ops.some((o) => o.path === '/data')).toBe(false);
    expect(compiler.doc.code).toContain('__D["p1"]');
  });

  it('hands out each resolution once, when its tag completes', () => {
    const compiler = createStreamCompiler({ catalog, data: PRODUCTS });
    compiler.push('<Image query="头戴式');
    expect(compiler.takeResolutions()).toEqual([]);
    compiler.push('降噪耳机" />');
    const [r] = compiler.takeResolutions();
    expect(r).toMatchObject({ resolver: 'image', input: { query: '头戴式降噪耳机' } });
    compiler.push('\nmore text');
    expect(compiler.takeResolutions()).toEqual([]);
    const batch = compiler.resolved(r!.key, { url: 'https://img/1.png' })!;
    expect(batch.kind).toBe('data');
    expect(compiler.doc.data[r!.key]).toEqual({ url: 'https://img/1.png' });
  });

  async function* model(chunks: string[], delay = 0) {
    for (const c of chunks) {
      if (delay) await new Promise((r) => setTimeout(r, delay));
      yield c;
    }
  }

  it('streams data, resolver results and a fallback; the final batch waits for open resolutions', async () => {
    const kinds: string[] = [];
    const body = createSSEStream(model(tokens(SOURCE)), {
      catalog,
      data: PRODUCTS,
      interval: 0,
      resolvers: { image: async (input) => (await new Promise((r) => setTimeout(r, 60)), { url: `https://img/${String(input.query)}.png` }) },
    });
    const doc = await readTesseraStream(new Response(body), { onBatch: (_, b) => kinds.push(b.kind) });
    expect(kinds.at(-1)).toBe('final');
    expect(kinds.at(-2)).toBe('data');
    expect(Object.values(doc.data)).toContainEqual({ url: 'https://img/头戴式降噪耳机.png' });
    expect(doc.fallback).toBe('## Sony WH-1000XM6\n\n价格 ¥2,899\n\n![头戴式降噪耳机](https://img/头戴式降噪耳机.png)');
  });

  it('gives up on a slow resolver and still finishes', async () => {
    const body = createSSEStream(model(tokens(SOURCE)), {
      catalog,
      data: PRODUCTS,
      interval: 0,
      resolveTimeout: 30,
      resolvers: { image: () => new Promise(() => {}) },
    });
    const doc = await readTesseraStream(new Response(body));
    expect(doc.done).toBe(true);
    expect(doc.fallback).toContain('*[image: 头戴式降噪耳机]*');
  });
});

describe('SSE', () => {
  it('round-trips events across arbitrary chunk boundaries', () => {
    const batch: PatchBatch = { seq: 0, kind: 'structure', ops: [{ op: 'append', path: '/text', value: 'a\nb "c"\n\n' }] };
    const wire = encodeEvent({ type: 'patch', batch }) + encodeEvent({ type: 'error', message: 'boom' });
    const parser = new SSEParser();
    const out = [...wire].flatMap((ch) => parser.push(ch)).map((e) => e.event);
    expect(out).toEqual([{ type: 'patch', batch }, { type: 'error', message: 'boom' }]);
  });

  async function* model(chunks: string[], pauseAt = -1, pause = 0) {
    for (let i = 0; i < chunks.length; i++) {
      if (i === pauseAt) await new Promise((r) => setTimeout(r, pause));
      yield chunks[i]!;
    }
  }

  it('streams a model through SSE into the same document', async () => {
    let stored: StreamDoc | undefined;
    const body = createSSEStream(model(tokens(TEAM)), { catalog, interval: 0, onDone: (d) => (stored = d) });
    const seen: string[] = [];
    const doc = await readTesseraStream(new Response(body), { onBatch: (_, b) => seen.push(b.kind) });
    expect(doc.code).toBe(compile(TEAM, { catalog }).code);
    expect(stored).toEqual(doc);
    expect(seen.at(-1)).toBe('final');
  });

  it('flushes buffered text when the model pauses', async () => {
    const chunks = ['## Hel', 'lo', ' world'];
    const body = createSSEStream(model(chunks, 2, 120), { catalog, interval: 60 });
    const texts: string[] = [];
    await readTesseraStream(new Response(body), { onBatch: (d, b) => b.kind !== 'final' && texts.push(d.text) });
    // "lo" arrives inside the throttle window and must be flushed during the pause, before " world".
    expect(texts.slice(0, 2)).toEqual(['## Hel', '## Hello']);
  });

  it('reports a failing model as an error event', async () => {
    async function* broken() {
      yield '## Hi';
      throw new Error('model went away');
    }
    await expect(readTesseraStream(new Response(createSSEStream(broken(), { catalog, interval: 0 })))).rejects.toThrow('model went away');
  });

  it('stops reading the model when the client aborts', async () => {
    let pulled = 0;
    async function* endless() {
      for (;;) {
        pulled++;
        yield 'x';
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    const abort = new AbortController();
    const reading = readTesseraStream(new Response(createSSEStream(endless(), { catalog, interval: 0 })), {
      signal: abort.signal,
      onBatch: (_, b) => b.seq === 3 && abort.abort(),
    });
    await expect(reading).rejects.toThrow(/abort/i);
    const at = pulled;
    await new Promise((r) => setTimeout(r, 50));
    expect(pulled - at).toBeLessThanOrEqual(1);
  });
});
