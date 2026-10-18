// Screenshots of chosen beats of an episode page, with tessera's playwright-core and the local Chrome.
// Usage: node shots.mjs <url> <outDir> <beat,beat,...> [mobileBeat,...]
import { existsSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const [url, outDir, list, mobileList = ''] = process.argv.slice(2);
const require = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json'));
const { chromium } = require('playwright-core');
// Same browser lookup as scripts/e2e.mjs: CHROME_PATH first, then the usual install locations.
const executablePath = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
].find((p) => p && existsSync(p));
if (!executablePath) throw new Error('No Chrome found; set CHROME_PATH');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ executablePath, headless: true });
const errors = [];
async function shoot(viewport, beatsToShoot, tag) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(url);
  await page.waitForTimeout(1500);
  await page.evaluate(() => (document.getElementById('overlay').hidden = true));
  for (const i of beatsToShoot) {
    await page.evaluate((n) => go(n - 1 < 0 ? 0 : n - 1, { autoplay: false }), i);
    await page.waitForTimeout(150);
    await page.evaluate((n) => go(n, { autoplay: false }), i);
    await page.waitForTimeout(Number(process.env.WAIT || 2600));
    const stage = await page.$('#stage');
    await stage.screenshot({ path: join(outDir, `${tag}-b${String(i).padStart(2, '0')}.png`) });
  }
  await page.close();
}
await shoot({ width: 1180, height: 900 }, list.split(',').filter(Boolean).map(Number), 'desk');
if (mobileList) await shoot({ width: 390, height: 844 }, mobileList.split(',').filter(Boolean).map(Number), 'phone');
await browser.close();
console.log(errors.length ? 'page errors:\n' + errors.join('\n') : 'no page errors');
