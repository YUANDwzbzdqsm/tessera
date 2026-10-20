// End-to-end checks in a real Chrome, through playwright-core and the system browser (override with CHROME_PATH).
// Phase 1 runs against the production build (SES inside the bundled worker): the M1 interaction loop.
// Phase 2 runs against the dev server, which hosts the demo's SSE endpoint: M2 streaming.
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { build, createServer, preview } from 'vite';
import { buildSandbox } from './build-sandbox.mjs';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].filter(Boolean);

const executablePath = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome found; set CHROME_PATH');

const results = [];
const check = async (name, fn) => {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (e) {
    results.push({ name, ok: false });
    console.log(`  FAIL ${name}\n       ${String(e.message ?? e).split('\n')[0]}`);
  }
};

const waitText = (locator, text, timeout = 10_000) => locator.getByText(text).first().waitFor({ timeout });
const expectText = async (locator, expected) => {
  const actual = (await locator.innerText()).trim();
  if (actual !== expected) throw new Error(`expected "${expected}", got "${actual}"`);
};
const number = async (locator) => Number((await locator.innerText()).trim().replace(/%$/, ''));
const CSP_REPORT = /Content Security Policy|Refused to connect/;
/** Runs a probe that triggers CSP violations on purpose, then drops those (and only those) console errors. */
async function expectingCspErrors(errors, fn) {
  const before = errors.length;
  try {
    return await fn();
  } finally {
    const added = errors.splice(before);
    errors.push(...added.filter((e) => !CSP_REPORT.test(e)));
  }
}

async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(url);
  return { page, errors, preview: page.getByTestId('preview') };
}

const browser = await chromium.launch({ executablePath, headless: true });
mkdirSync('.e2e', { recursive: true });

// ---------- Phase 1: production build ----------
await buildSandbox();
await build({ root: 'demo', logLevel: 'warn' });
const staticServer = await preview({ root: 'demo', preview: { port: 5181, strictPort: true }, logLevel: 'warn' });
console.log(`phase 1: production build at ${staticServer.resolvedUrls.local[0]}`);
{
  const { page, errors, preview: pane } = await openPage(browser, staticServer.resolvedUrls.local[0]);
  const modelCalls = page.getByTestId('model-calls');

  await check('the sandbox renders the compiled program', async () => {
    await waitText(pane, '232 美元/月');
    await waitText(pane, '团队套餐估价');
  });

  await check('dragging the slider updates the price inside the sandbox, with 0 model calls', async () => {
    await pane.locator('input[type=range]').focus();
    await page.keyboard.press('ArrowRight');
    await waitText(pane, '261 美元/月');
    await expectText(modelCalls, '0');
  });

  await check('ui.send leaves the sandbox as an action and counts as one model call', async () => {
    await pane.getByRole('button', { name: '生成方案' }).click();
    await waitText(page.getByTestId('log'), '为 9 人的团队做一份年度预算，每月 261 美元');
    await expectText(modelCalls, '1');
  });

  await check('a recompiled program keeps keyed state (seats stays 9)', async () => {
    const source = page.getByTestId('source');
    await source.fill((await source.inputValue()).replace('seats * 29', 'seats * 30'));
    await waitText(pane, '270 美元/月');
  });

  await check('lists, conditionals and checkbox events work', async () => {
    await page.getByRole('button', { name: '出行清单' }).click();
    await waitText(pane, '帐篷、睡袋、头灯、防蚊液');
    for (const label of ['帐篷', '睡袋', '头灯', '防蚊液']) await pane.getByLabel(label).check();
    await waitText(pane, '全部带齐了');
  });

  await check('the compiler drops what breaks the catalog or the guard, and keeps the rest', async () => {
    await page.getByRole('button', { name: '出错的写法' }).click();
    await waitText(pane, '正常的表达式：5');
    const diagnostics = await page.getByTestId('diagnostics').innerText();
    for (const code of ['unknown_component', 'invalid_literal', 'unknown_prop', 'unknown_identifier', 'forbidden_syntax', 'unterminated_tag']) {
      if (!diagnostics.includes(code)) throw new Error(`missing diagnostic ${code}`);
    }
  });

  await check('the feedback for the model lists what was dropped', async () => {
    await page.getByRole('tab', { name: '给模型的反馈' }).click();
    const text = await page.getByTestId('feedback').innerText();
    for (const part of ['[Interface feedback]', '- unknown_component: <Rocket> is not in the catalog', '- forbidden_syntax:', 'The user left the interface in this state:']) {
      if (!text.includes(part)) throw new Error(`missing "${part}"`);
    }
    if (/was dropped/.test(text)) throw new Error('boilerplate not stripped');
    await page.getByRole('tab', { name: /诊断/ }).click();
  });

  await check('tool data is bound by name: values on screen come from the data table, not the program text', async () => {
    await page.getByRole('button', { name: '商品对比' }).click();
    await waitText(pane, '¥2,899');
    await waitText(pane, '¥2,499');
    await waitText(pane, '便宜 400 元');
    await page.getByRole('tab', { name: '编译结果' }).click();
    const compiled = await page.getByTestId('compiled').innerText();
    if (compiled.includes('2,899') || !compiled.includes('__D["p1"]')) throw new Error('price was copied into the program');
  });

  await check('server-resolved images arrive after their tags and are drawn by the host', async () => {
    await pane.locator('figure.t-image[data-state="resolved"] img').nth(1).waitFor({ timeout: 10_000 });
    const sources = await pane.locator('figure.t-image img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src')));
    if (sources.length !== 2 || sources.some((s) => !s.startsWith('data:image/svg+xml;charset=utf-8,'))) throw new Error(JSON.stringify(sources.map((s) => s.slice(0, 40))));
  });

  await check('the Markdown fallback evaluates bound values, computed text and found images', async () => {
    await page.getByRole('tab', { name: 'Markdown 降级版' }).click();
    const md = await page.getByTestId('fallback').innerText();
    for (const part of ['## 降噪耳机怎么选', '# ¥2,899', '![索尼 头戴式降噪耳机 黑色](data:image/svg+xml', '更便宜的是 **Bose QuietComfort Ultra**，便宜 400 元。', '[就买便宜的]']) {
      if (!md.includes(part)) throw new Error(`missing "${part}"`);
    }
    await page.getByRole('tab', { name: /诊断/ }).click();
  });

  await check('a fixed-design component steps through its states: conflicts -> ready -> merged, inside the sandbox', async () => {
    await page.getByRole('button', { name: '合并请求' }).click();
    const card = (status) => pane.locator(`article.t-pr[data-status="${status}"]`);
    await card('conflicts').waitFor({ timeout: 10_000 });
    await waitText(pane, '与 main 有 3 处冲突');
    const calls = await modelCalls.innerText();
    await pane.getByRole('button', { name: '解决冲突' }).click();
    await card('ready').waitFor({ timeout: 5_000 });
    // main was merged into the branch: the graph gains the synced commit
    await card('ready').locator('.t-pr-synced').waitFor({ timeout: 5_000 });
    await pane.getByRole('button', { name: '合并', exact: true }).click();
    await card('merged').waitFor({ timeout: 5_000 });
    await waitText(pane, '已合并到 main');
    await expectText(modelCalls, calls);
    await pane.getByRole('button', { name: '重新演示' }).click();
    await card('conflicts').waitFor({ timeout: 5_000 });
  });

  await check('every PullRequest status renders, switched from the controls sample', async () => {
    await page.getByRole('button', { name: 'PR 状态切换' }).click();
    const states = { 创建中: 'opening', 检查中: 'checking', 有冲突: 'conflicts', 解决中: 'resolving', 可以合并: 'ready', 合并中: 'merging', 已合并: 'merged', 已关闭: 'closed' };
    for (const [label, status] of Object.entries(states)) {
      await pane.getByRole('button', { name: label, exact: true }).click();
      await pane.locator(`article.t-pr[data-status="${status}"]`).waitFor({ timeout: 5_000 });
    }
    await pane.getByRole('button', { name: '有冲突', exact: true }).click();
  });

  await check('normal flows report no host or runtime issues (props removed on switch are not sent as "")', async () => {
    // The flow above switched team -> checklist -> broken: Box lost padding/border, Title/Text were reused.
    const issues = (await page.getByTestId('log').innerText()).split('\n').filter((l) => /^\[(host|runtime)\]/.test(l.trim()));
    if (issues.length) throw new Error(issues.join(' | '));
  });

  await check('programs run in an opaque-origin iframe that cannot read this page, its storage or the network', async () => {
    const iframes = page.locator('iframe[data-tessera-sandbox]');
    if ((await iframes.count()) !== 1) throw new Error(`expected 1 sandbox iframe, found ${await iframes.count()}`);
    if ((await iframes.first().getAttribute('sandbox')) !== 'allow-scripts') throw new Error('iframe sandbox attribute changed');
    const frame = page.frames().find((f) => f.url() === 'about:srcdoc');
    if (!frame) throw new Error('sandbox frame not found');
    const probe = await expectingCspErrors(errors, () => frame.evaluate(async () => {
      const attempt = async (fn) => {
        try {
          return `allowed:${String(await fn())}`;
        } catch (e) {
          return `blocked:${e.name}`;
        }
      };
      return {
        origin: self.origin,
        cookie: await attempt(() => document.cookie),
        storage: await attempt(() => localStorage.length),
        parent: await attempt(() => parent.document.title),
        fetch: await attempt(() => fetch('/').then((r) => r.status)),
      };
    }));
    const expected = { origin: 'null', cookie: 'blocked:SecurityError', storage: 'blocked:SecurityError', parent: 'blocked:SecurityError', fetch: 'blocked:TypeError' };
    if (JSON.stringify(probe) !== JSON.stringify(expected)) throw new Error(JSON.stringify(probe));
  });

  await check('the sandbox worker itself cannot reach the network (it inherits the iframe CSP)', async () => {
    const worker = page.workers().find((w) => w.url().startsWith('blob:null/'));
    if (!worker) throw new Error('sandbox worker not visible to the test');
    const target = staticServer.resolvedUrls.local[0];
    const result = await expectingCspErrors(errors, () =>
      worker.evaluate((url) => fetch(url).then((r) => `allowed:${r.status}`, (e) => `blocked:${e.name}`), target),
    );
    if (result !== 'blocked:TypeError') throw new Error(result);
  });

  // While a replacement sandbox starts, the last good frame stays on screen but is inert (its sandbox is gone).
  // Interact only after the replacement has redrawn, i.e. once the old element is detached.
  const waitReplaced = (handle) => page.waitForFunction((el) => !el.isConnected, handle, { timeout: 10_000 });

  await check('a hang in an event handler: the watchdog replaces the sandbox and restores the last good state', async () => {
    const plusOne = () => pane.getByRole('button', { name: '正常加一' });
    await page.getByRole('button', { name: '卡死的程序' }).click();
    await waitText(pane, '点了 0 次');
    await plusOne().click();
    await plusOne().click();
    await waitText(pane, '点了 2 次');
    const stale = await plusOne().elementHandle();
    await pane.getByRole('button', { name: '跑一个停不下来的计算' }).click();
    await waitText(page.getByTestId('log'), 'sandbox_restarted', 15_000);
    await waitReplaced(stale);
    await waitText(pane, '点了 2 次');
    await plusOne().click();
    await waitText(pane, '点了 3 次');
    if ((await page.locator('iframe[data-tessera-sandbox]').count()) !== 1) throw new Error('old sandbox iframe was not removed');
  });

  await check('a hang while rendering: the program is quarantined and the last good frame stays', async () => {
    await page.getByRole('button', { name: '团队估价' }).click();
    await waitText(pane, '美元/月');
    const stale = await pane.locator('input[type=range]').elementHandle();
    const source = page.getByTestId('source');
    const boom = '\n{@let boom = Array.from({ length: 100000 }).reduce((sum) => sum + Array.from({ length: 100000 }).length, 0)}';
    await source.fill((await source.inputValue()) + boom);
    await waitText(page.getByTestId('log'), 'that program is quarantined', 15_000);
    await waitReplaced(stale);
    await waitText(pane, '美元/月');
    await pane.locator('input[type=range]').focus();
    await page.keyboard.press('ArrowRight');
    await waitText(pane, '290 美元/月'); // seats 9 -> 10 in the redrawn last good program
  });

  await check('the interface state survives a page reload', async () => {
    await page.reload();
    await waitText(pane, '290 美元/月', 20_000);
    const state = await page.getByTestId('ui-state').innerText();
    if (!state.includes('"seats":10') || !state.includes('"count":3')) throw new Error(state);
  });

  await check('no console errors (production build)', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });
  await page.close();
}
{
  const { page, errors, preview: pane } = await openPage(browser, staticServer.resolvedUrls.local[0] + '?isolation=worker');
  await check('plain-worker isolation also works (no iframe)', async () => {
    // browser.newPage() opens a fresh context: no saved state, so the sample starts at 8 seats.
    await expectText(page.getByTestId('isolation'), '仅 Worker');
    await waitText(pane, '232 美元/月');
    if ((await page.locator('iframe[data-tessera-sandbox]').count()) !== 0) throw new Error('unexpected sandbox iframe');
    await pane.locator('input[type=range]').focus();
    await page.keyboard.press('ArrowRight');
    await waitText(pane, '261 美元/月');
    if (errors.length) throw new Error(errors.join(' | '));
  });
  await page.close();
}
await new Promise((resolve) => staticServer.httpServer.close(resolve));

// ---------- Phase 2: dev server with the SSE endpoint ----------
const devServer = await createServer({ root: 'demo', server: { port: 5182, strictPort: true }, logLevel: 'warn' });
await devServer.listen();
const devUrl = devServer.resolvedUrls.local[0];
console.log(`phase 2: dev server with SSE endpoint at ${devUrl}`);
{
  const { page, errors, preview: pane } = await openPage(browser, devUrl);
  const status = page.getByTestId('stream-status');
  await waitText(pane, '232 美元/月', 20_000);
  const original = await page.getByTestId('source').inputValue();
  await page.getByTestId('stream-speed').selectOption('40');

  await check('the interface grows while the model is still writing', async () => {
    await page.getByTestId('stream-start').click();
    await waitText(pane, '团队套餐估价');
    await expectText(status, '生成中');
    if ((await pane.locator('input[type=range]').count()) !== 0) throw new Error('slider appeared before its tag was written');
  });

  await check('the slider appears mid-stream, and dragging it keeps its value through later recompiles', async () => {
    await pane.locator('input[type=range]').waitFor({ timeout: 15_000 });
    await expectText(status, '生成中');
    await pane.locator('input[type=range]').focus();
    await page.keyboard.press('ArrowRight');
    await expectText(status, '生成中');
    await waitText(status, '完成', 30_000);
    await waitText(pane, '261 美元/月');
  });

  await check('updates are classified, and the final text matches the source', async () => {
    const structure = await number(page.getByTestId('stat-structure'));
    const constants = await number(page.getByTestId('stat-constants'));
    const updates = await number(page.getByTestId('stat-updates'));
    if (structure < 3 || constants < 1 || updates < structure + constants) {
      throw new Error(`unexpected stats: ${updates} updates, ${structure} structure, ${constants} constants`);
    }
    const text = await page.getByTestId('source').inputValue();
    if (text !== original) throw new Error('streamed text differs from the source');
    if (await page.getByTestId('source').getAttribute('readonly')) throw new Error('editor still read-only after the stream');
  });

  await check('stopping keeps the partial answer on screen without overwriting the source', async () => {
    const source = page.getByTestId('source');
    await page.getByTestId('stream-start').click();
    await waitText(pane, '团队套餐估价');
    await page.getByTestId('stream-stop').click();
    await waitText(status, '已停止');
    await waitText(pane, '团队套餐估价');
    const partial = await source.inputValue();
    if (partial === original || !original.startsWith(partial)) throw new Error('editor should show the partial output');
    await page.getByTestId('stream-dismiss').click();
    if ((await source.inputValue()) !== original) throw new Error('the original source was overwritten');
    await waitText(pane, '美元/月');
  });

  await check('changed code travels as splices: code is a small share of the stream', async () => {
    // Before M4 the full program was resent on every structure change (49% of the bytes for this sample).
    const share = await number(page.getByTestId('stat-code-share'));
    if (!(share <= 30)) throw new Error(`code share ${share}%`);
  });

  await check('a streamed answer with tool data gets its images from the server while it streams', async () => {
    await page.getByRole('button', { name: '商品对比' }).click();
    await page.getByTestId('stream-speed').selectOption('600');
    await page.getByTestId('stream-start').click();
    await waitText(status, '完成', 20_000);
    await waitText(pane, '¥2,899');
    await pane.locator('figure.t-image[data-state="resolved"] img').nth(1).waitFor({ timeout: 5_000 });
    const data = await number(page.getByTestId('stat-data'));
    if (data < 2) throw new Error(`expected at least 2 data updates, got ${data}`);
  });

  await check('streaming reports no host or runtime issues', async () => {
    const issues = (await page.getByTestId('log').innerText()).split('\n').filter((l) => /^\[(host|runtime)\]/.test(l.trim()));
    if (issues.length) throw new Error(issues.join(' | '));
  });

  await check('no console errors (streaming)', async () => {
    if (errors.length) throw new Error(errors.join(' | '));
  });

  await page.getByTestId('stream-speed').selectOption('600');
  await page.getByTestId('stream-start').click();
  await waitText(status, '完成', 20_000).catch(() => {});
  await page.screenshot({ path: '.e2e/demo.png', fullPage: true });
  await page.close();
}
await devServer.close();
await browser.close();

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed. Screenshot: .e2e/demo.png`);
process.exit(failed ? 1 : 0);
