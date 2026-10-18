// Runs the Tessera benchmark (eval/cases.mjs) against a real model through any OpenAI-compatible
// Chat Completions endpoint, streaming the answer through the same compiler the product uses.
//
//   node scripts/eval.mjs --base-url https://api.deepseek.com --model deepseek-flash --key-env DEEPSEEK_API_KEY
//
// Options:
//   --only id,id       run a subset of cases
//   --repair           send feedbackForModel() back once for failing cases and record whether the model fixes them
//   --concurrency n    parallel requests (default 3); timings are wall-clock per request
//   --label name       results folder name (default: the model id)
//   --extra json       extra request fields, e.g. '{"thinking":{"type":"disabled"}}'
//   --prompt-extra s   appended to the system prompt (for prompt experiments)
//   --timeout ms       per request (default 300000; thinking models can take minutes)
//   --regrade dir      no model calls: re-check the answers saved in an earlier results folder with the current code
//
// The API key is read from the environment variable named by --key-env. It is never printed or written.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { createServer } from 'vite';
import { cases as allCases } from '../eval/cases.mjs';

const args = parseArgs(process.argv.slice(2));
const regrade = args.regrade ? String(args.regrade) : null;
if (!regrade) {
  for (const required of ['base-url', 'model', 'key-env']) {
    if (!args[required]) throw new Error(`Missing --${required}`);
  }
}
const apiKey = regrade ? '' : process.env[args['key-env']];
if (!regrade && !apiKey) throw new Error(`Environment variable ${args['key-env']} is not set`);
const requestTimeout = Number(args.timeout ?? 300_000);

const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({
  root,
  configFile: false,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
});
const { defineCatalog } = await vite.ssrLoadModule('/packages/catalog/src/index.ts');
const lang = await vite.ssrLoadModule('/packages/lang/src/index.ts');
const { createStreamCompiler } = await vite.ssrLoadModule('/packages/stream/src/server.ts');
const catalog = defineCatalog();

const MARKDOWN = new Set(['Title', 'Text', 'Bold', 'Italic', 'Code', 'CodeBlock', 'List', 'ListItem']);
const FENCED_BLOCK = /^ {0,3}(`{3,}|~{3,})[^\n]*\n([\s\S]*?)(?:^ {0,3}\1[ \t]*$|(?![\s\S]))/gm;

/** Whether a code block holds Tessera markup: the model fenced the interface instead of writing it. Code itself is fine. */
function fencedMarkup(text) {
  for (const [, , body] of text.matchAll(FENCED_BLOCK)) {
    if (/\{[@#]/.test(body)) return true;
    for (const [, name] of body.matchAll(/<([A-Z]\w*)/g)) if (catalog.get(name) && !MARKDOWN.has(name)) return true;
  }
  return false;
}
const INTERACTIVE = new Set(['Slider', 'Checkbox', 'Button']);
const WIDGET = /__h\("(Slider|Checkbox|Button|Image)"/;

const only = args.only ? new Set(String(args.only).split(',')) : null;
const cases = allCases.filter((c) => !only || only.has(c.id));

if (regrade) {
  // Same checks, current compiler and prompt-independent: shows what a code change alone does to saved answers.
  const failedRequests = new Set(JSON.parse(readFileSync(join(regrade, 'report.json'), 'utf8')).cases.filter((r) => r.error).map((r) => r.id));
  let pass = 0;
  let graded = 0;
  for (const c of cases) {
    const file = join(regrade, 'answers', `${c.id}.md`);
    if (failedRequests.has(c.id) || !existsSync(file)) continue;
    const text = readFileSync(file, 'utf8');
    const r = await evaluateAnswer(c, text, {});
    graded++;
    if (r.pass) pass++;
    const diags = [...r.errors, ...r.warnings].map((d) => d.split(':')[0]).join(' ');
    console.log(`  ${c.id.padEnd(12)} ${r.pass ? 'pass' : `FAIL ${r.failed.join(', ')}`}${diags ? `  [${diags}]` : ''}`);
  }
  console.log(`\nregraded ${regrade}: ${pass}/${graded} pass with the current code`);
  await vite.close();
  process.exit(0);
}
const extra = args.extra ? JSON.parse(args.extra) : {};
const label = String(args.label ?? args.model).replace(/[^\w.-]+/g, '_');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = join(root, 'eval', 'results', label, stamp);
mkdirSync(join(outDir, 'answers'), { recursive: true });

console.log(`Tessera eval: ${cases.length} cases on ${args.model} (${args['base-url']})`);
const results = await pool(cases, Number(args.concurrency ?? 3), async (c) => {
  const first = await attempt(c, messagesFor(c));
  let repair = null;
  if (args.repair && first.result && !first.result.pass) {
    const feedback = feedbackText(first.result);
    if (feedback) {
      const follow = [...messagesFor(c), { role: 'assistant', content: first.result.text }, { role: 'user', content: feedback }];
      repair = await attempt(c, follow);
      repair.feedback = feedback;
    }
  }
  const line = first.error ? `ERROR ${first.error}` : `${first.result.pass ? 'pass' : 'FAIL'} ${first.result.failed.join(', ')}`;
  console.log(`  ${c.id.padEnd(12)} ${line}${repair?.result ? ` | repair: ${repair.result.pass ? 'fixed' : 'still failing'}` : ''}`);
  writeFileSync(join(outDir, 'answers', `${c.id}.md`), first.result?.text ?? first.error ?? '');
  if (repair?.result) writeFileSync(join(outDir, 'answers', `${c.id}.repair.md`), repair.result.text);
  return { case: c, first, repair };
});
await vite.close();

const report = buildReport(results);
writeFileSync(join(outDir, 'report.json'), JSON.stringify(report.json, null, 2));
writeFileSync(join(outDir, 'report.md'), report.markdown);
console.log(`\n${report.summaryLine}\nReport: ${join(outDir, 'report.md')}`);

// ---------- one request ----------

function messagesFor(c) {
  let system = lang.systemPrompt(catalog, { data: c.data, extra: args['prompt-extra'] });
  if (c.data) {
    // Stands in for tool results in the conversation: the model sees the values, and must still refer to them by name.
    system += `\nTool results (you can read these values; in your answer refer to them as {name.field}, never retype them):\n${JSON.stringify(c.data, null, 2)}\n`;
  }
  return [
    { role: 'system', content: system },
    { role: 'user', content: c.prompt },
  ];
}

async function attempt(c, messages) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), requestTimeout);
  const t0 = performance.now();
  const ms = () => Math.round(performance.now() - t0);
  const m = { firstReasoningMs: null, firstTokenMs: null, firstRenderMs: null, firstRenderChars: null, firstWidgetMs: null, firstWidgetChars: null, reasoningChars: 0, usage: null };
  const compiler = createStreamCompiler({ catalog, data: c.data ?? {}, interval: 0 });
  let text = '';
  try {
    for await (const ev of chatStream(messages, abort.signal)) {
      if (ev.usage) m.usage = ev.usage;
      if (ev.reasoning) {
        m.firstReasoningMs ??= ms();
        m.reasoningChars += ev.reasoning.length;
      }
      if (!ev.content) continue;
      m.firstTokenMs ??= ms();
      text += ev.content;
      compiler.push(ev.content);
      const code = compiler.doc.code;
      if (m.firstRenderMs === null && code.includes('__h("')) {
        m.firstRenderMs = ms();
        m.firstRenderChars = text.length;
      }
      if (m.firstWidgetMs === null && WIDGET.test(code)) {
        m.firstWidgetMs = ms();
        m.firstWidgetChars = text.length;
      }
    }
    compiler.end();
    m.totalMs = ms();
    return { result: await evaluateAnswer(c, text, m) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

async function* chatStream(messages, signal) {
  const url = `${String(args['base-url']).replace(/\/$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: args.model, messages, stream: true, stream_options: { include_usage: true }, temperature: 0.3, ...extra }),
    signal,
  });
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') return;
      const json = JSON.parse(payload);
      const delta = json.choices?.[0]?.delta ?? {};
      yield { content: delta.content ?? '', reasoning: delta.reasoning_content ?? '', usage: json.usage ?? null };
    }
  }
}

// ---------- checks ----------

async function evaluateAnswer(c, text, metrics) {
  const data = c.data ?? {};
  const compiled = lang.compile(text, { catalog, data });
  const errors = compiled.diagnostics.filter((d) => d.severity === 'error');
  const warnings = compiled.diagnostics.filter((d) => d.severity === 'warning');
  const components = [...new Set([...compiled.code.matchAll(/__h\("([A-Z]\w*)"/g)].map((x) => x[1]))].sort();
  const replay = await replayProgram(compiled);
  const fallback = lang.toFallbackMarkdown(text, { catalog, data });
  const nonMarkdown = components.filter((n) => !MARKDOWN.has(n));
  const e = c.expect;
  const checks = {
    compiles: errors.length === 0,
    renders: replay.ok === true && replay.before.nodes > 0,
    runtimeClean: replay.ok === true && replay.issues.length === 0,
    markupNotFenced: !fencedMarkup(text),
    uiChoice: e.ui ? nonMarkdown.length > 0 : !components.some((n) => INTERACTIVE.has(n)),
    usesExpected: (e.use ?? []).every((n) => components.includes(n)),
    containsExpected: (e.contains ?? []).every((s) => fallback.includes(s)),
    noCopiedValues: !(e.noCopy ?? []).some((s) => text.includes(s)),
  };
  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return {
    pass: failed.length === 0,
    failed,
    checks,
    text,
    metrics,
    diagnostics: compiled.diagnostics,
    errors: errors.map((d) => `${d.code}: ${d.message}`),
    warnings: warnings.map((d) => `${d.code}: ${d.message}`),
    components,
    resolutions: compiled.resolutions.length,
    replay,
    fallback,
    copied: (e.noCopy ?? []).filter((s) => text.includes(s)),
  };
}

function replayProgram(compiled) {
  return new Promise((resolve) => {
    const worker = new Worker(new URL('../eval/replay-worker.mjs', import.meta.url), {
      workerData: { code: compiled.code, constants: [...compiled.constants], data: compiled.data },
    });
    const timer = setTimeout(() => {
      void worker.terminate();
      resolve({ ok: false, issues: [], error: 'timeout: the program did not finish rendering within 3 s' });
    }, 3000);
    worker.once('message', (msg) => {
      clearTimeout(timer);
      void worker.terminate();
      resolve(msg);
    });
    worker.once('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, issues: [], error: String(err) });
    });
  });
}

function feedbackText(result) {
  const parts = [];
  const fromCompiler = lang.feedbackForModel(result.diagnostics, {
    runtimeIssues: [...(result.replay.issues ?? []), ...(result.replay.error ? [result.replay.error] : [])].map((s) => ({ code: s.split(':')[0], message: s })),
  });
  if (fromCompiler) parts.push(fromCompiler);
  if (!result.checks.markupNotFenced) parts.push('- Do not put the interface in a code block: write the markup directly. Code blocks are only for code.');
  if (!result.checks.noCopiedValues) parts.push(`- You retyped values from the tool results (${result.copied.join(', ')}); refer to them as {name.field} instead.`);
  if (!result.checks.usesExpected || !result.checks.uiChoice) parts.push('- This request calls for an interactive interface built from the catalog components.');
  if (!parts.length) return null;
  return `${parts.join('\n')}\n\nPlease answer the same request again, fixing these problems. Output the complete answer.`;
}

// ---------- report ----------

function buildReport(rows) {
  const ok = rows.filter((r) => r.first.result);
  const res = ok.map((r) => r.first.result);
  const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '–');
  const count = (f) => res.filter(f).length;
  const median = (xs) => {
    const v = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b);
    return v.length ? v[Math.floor((v.length - 1) / 2)] : null;
  };
  const tokens = res.map((r) => r.metrics.usage?.completion_tokens).filter((x) => typeof x === 'number');
  const dataCases = res.filter((r, i) => ok[i].case.expect.noCopy);
  const diagCounts = {};
  for (const r of res) for (const d of [...r.errors, ...r.warnings]) diagCounts[d.split(':')[0]] = (diagCounts[d.split(':')[0]] ?? 0) + 1;
  const repaired = rows.filter((r) => r.repair?.result);

  const summary = {
    model: args.model,
    baseUrl: args['base-url'],
    date: new Date().toISOString(),
    cases: rows.length,
    requestErrors: rows.length - ok.length,
    pass: count((r) => r.pass),
    compiles: count((r) => r.checks.compiles),
    renders: count((r) => r.checks.renders),
    runtimeClean: count((r) => r.checks.runtimeClean),
    markupNotFenced: count((r) => r.checks.markupNotFenced),
    uiChoice: count((r) => r.checks.uiChoice),
    noCopiedValues: `${dataCases.filter((r) => r.checks.noCopiedValues).length}/${dataCases.length}`,
    medianFirstTokenMs: median(res.map((r) => r.metrics.firstTokenMs)),
    medianFirstRenderMs: median(res.map((r) => r.metrics.firstRenderMs)),
    medianFirstRenderChars: median(res.map((r) => r.metrics.firstRenderChars)),
    medianFirstWidgetMs: median(res.map((r) => r.metrics.firstWidgetMs)),
    medianTotalMs: median(res.map((r) => r.metrics.totalMs)),
    medianCompletionTokens: median(tokens),
    totalTokens: res.reduce((s, r) => s + (r.metrics.usage?.total_tokens ?? 0), 0),
    repairAttempted: repaired.length,
    repairFixed: repaired.filter((r) => r.repair.result.pass).length,
  };

  const md = [];
  md.push(`# Tessera eval: ${args.model}`, '', `${summary.date} · ${summary.cases} cases · ${args['base-url']}`, '');
  md.push('| Metric | Value |', '| --- | --- |');
  md.push(`| All checks pass | ${summary.pass}/${ok.length} (${pct(summary.pass, ok.length)}) |`);
  md.push(`| Compiles without errors | ${summary.compiles}/${ok.length} |`);
  md.push(`| Renders in the sandbox | ${summary.renders}/${ok.length} |`);
  md.push(`| No runtime issues (incl. firing every handler) | ${summary.runtimeClean}/${ok.length} |`);
  md.push(`| Markup not inside code fences | ${summary.markupNotFenced}/${ok.length} |`);
  md.push(`| UI vs plain text chosen as expected | ${summary.uiChoice}/${ok.length} |`);
  md.push(`| Tool values not retyped | ${summary.noCopiedValues} |`);
  md.push(`| Median first token | ${summary.medianFirstTokenMs ?? '–'} ms |`);
  md.push(`| Median first render (anything on screen) | ${summary.medianFirstRenderMs ?? '–'} ms, after ${summary.medianFirstRenderChars ?? '–'} chars |`);
  md.push(`| Median first interactive widget | ${summary.medianFirstWidgetMs ?? '–'} ms |`);
  md.push(`| Median total time | ${summary.medianTotalMs ?? '–'} ms |`);
  md.push(`| Median completion tokens | ${summary.medianCompletionTokens ?? '–'} |`);
  md.push(`| Total tokens | ${summary.totalTokens} |`);
  if (summary.requestErrors) md.push(`| Request errors | ${summary.requestErrors} |`);
  if (repaired.length) md.push(`| Repair round fixed | ${summary.repairFixed}/${summary.repairAttempted} |`);
  md.push('', '## Cases', '', '| Case | Result | Failed checks | Components | First render | First widget | Total | Tokens | Diagnostics |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const r of rows) {
    const f = r.first.result;
    if (!f) {
      md.push(`| ${r.case.id} | request error | ${r.first.error.replace(/\|/g, '/')} | | | | | | |`);
      continue;
    }
    const diags = [...f.errors, ...f.warnings].map((d) => d.split(':')[0]);
    md.push(
      `| ${r.case.id} | ${f.pass ? 'pass' : 'FAIL'}${r.repair?.result ? (r.repair.result.pass ? ' → fixed' : ' → still failing') : ''} | ${f.failed.join(', ')} | ${f.components.filter((n) => !MARKDOWN.has(n)).join(' ')} | ${f.metrics.firstRenderMs ?? '–'} ms / ${f.metrics.firstRenderChars ?? '–'} ch | ${f.metrics.firstWidgetMs ?? '–'} ms | ${f.metrics.totalMs} ms | ${f.metrics.usage?.completion_tokens ?? '–'} | ${diags.join(' ')} |`,
    );
  }
  if (Object.keys(diagCounts).length) {
    md.push('', '## Diagnostics across cases', '', ...Object.entries(diagCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`));
  }
  const issues = res.flatMap((r, i) => [...(r.replay.issues ?? []), ...(r.replay.error ? [r.replay.error] : [])].map((s) => `- ${ok[i].case.id}: ${s}`));
  if (issues.length) md.push('', '## Runtime issues', '', ...issues);
  md.push('', 'Answers are in `answers/`. Timings are wall-clock per request with the configured concurrency.');

  return {
    json: { summary, cases: rows.map((r) => ({ id: r.case.id, error: r.first.error, ...stripText(r.first.result), repair: r.repair?.result ? stripText(r.repair.result) : undefined })) },
    markdown: md.join('\n') + '\n',
    summaryLine: `${summary.pass}/${ok.length} pass · compiles ${summary.compiles}/${ok.length} · UI choice ${summary.uiChoice}/${ok.length} · median first render ${summary.medianFirstRenderMs ?? '–'} ms`,
  };
}

function stripText(result) {
  if (!result) return undefined;
  const { text: _text, fallback: _fallback, ...rest } = result;
  return rest;
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
