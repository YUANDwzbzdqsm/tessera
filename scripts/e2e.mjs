// End-to-end checks in a real Chrome, through playwright-core and the system browser (override with CHROME_PATH).
// Phase 1 runs against the production build (SES inside the bundled worker): the M1 interaction loop.
// Phase 2 runs against the dev server, which hosts the demo's SSE endpoint: M2 streaming.
import { existsSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
import { build, createServer, preview } from 'vite';

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
const number = async (locator) => Number((await locator.innerText()).trim());

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

  await check('no console errors (production build)', async () => {
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
