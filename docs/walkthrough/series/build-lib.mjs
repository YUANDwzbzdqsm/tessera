// Shared build for v2 episodes: real code lines, reference checks, timing report, template fill.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { commit, links, related, series, seriesDiagram } from './common.mjs';

const seriesDir = dirname(fileURLToPath(import.meta.url));
/** The tessera checkout this walkthrough lives in: docs/walkthrough/series → repository root. */
export const repo = join(seriesDir, '..', '..', '..');
const CPS = 3.6;
const SPEED = 1.2;
const GAP = 0.7;
const MIN_BEAT = 2.5;

/** Vite in middleware mode on the tessera checkout, for running the repo's real modules at build time. */
export async function openRepo() {
  const { createServer } = await import(pathToFileURL(createRequire(join(repo, 'package.json')).resolve('vite')).href);
  return createServer({ root: repo, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null } });
}

/**
 * A file as it was at the commit the scripts were written against, so later changes to the code do not shift the
 * highlighted lines under the narration.
 */
export function readAtCommit(path) {
  return execFileSync('git', ['show', `${commit}:${path}`], { cwd: repo, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

export function readCapture(file) {
  // CRLF checkouts (Windows autocrlf) would otherwise hide every blank line between SSE messages.
  return readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n\n').filter((f) => f.trim());
}

export function buildEpisode({ outFile, script, extra = {} }) {
  const { meta, files, stations, chapters, localDiagram } = script;
  const code = {};
  for (const [id, f] of Object.entries(files)) {
    const lines = readAtCommit(f.path).replace(/\r\n/g, '\n').split('\n');
    code[id] = { path: f.path, start: f.from, lines: lines.slice(f.from - 1, f.to) };
  }
  const diagrams = { series: seriesDiagram, local: localDiagram };
  const allIds = (d) => new Set([...d.zones, ...d.nodes, ...d.edges].map((x) => x.id));
  for (const d of Object.values(diagrams)) {
    const seen = new Set();
    for (const x of [...d.zones, ...d.nodes, ...d.edges]) {
      if (seen.has(x.id)) throw new Error(`duplicate board id ${x.id}`);
      seen.add(x.id);
    }
    const nodes = new Set(d.nodes.map((n) => n.id));
    for (const e of d.edges) if (!nodes.has(e.from) || !nodes.has(e.to)) throw new Error(`edge ${e.id} has a missing end`);
  }
  let current = null;
  for (const ch of chapters) {
    for (const b of ch.beats) {
      if (b.view === 'code') {
        const c = code[b.file];
        if (!c) throw new Error(`${ch.title}: unknown file ${b.file}`);
        const end = c.start + c.lines.length - 1;
        for (const [a, z] of Array.isArray(b.lines[0]) ? b.lines : [b.lines]) {
          if (a < c.start || z > end || a > z) throw new Error(`${ch.title}: lines ${a}-${z} outside ${c.path} ${c.start}-${end}`);
        }
      }
      if (b.view === 'wire') for (const f of b.frames) if (!extra.frames?.[f]) throw new Error(`${ch.title}: no frame ${f}`);
      if (b.view === 'diff' && !extra.diffs?.[b.frame]) throw new Error(`${ch.title}: no diff for frame ${b.frame}`);
      if (b.view === 'doc' && !extra.docs?.[b.frame]) throw new Error(`${ch.title}: no doc for frame ${b.frame}`);
      if (b.view === 'buffer' && !extra.buffer?.[b.step]) throw new Error(`${ch.title}: no buffer step ${b.step}`);
      if (b.view === 'panel' && !extra.panels?.[b.panel]) throw new Error(`${ch.title}: no panel ${b.panel}`);
      const bd = b.board || {};
      if (bd.diagram) current = bd.diagram;
      if (!b.board) continue;
      if (!current) throw new Error(`${ch.title}: board before any diagram`);
      const known = allIds(diagrams[current]);
      for (const id of [...(bd.add || []), ...(bd.focus || []), ...(bd.stop || []), ...(bd.flows || []).map((f) => f.edge)]) {
        if (!known.has(id)) throw new Error(`${ch.title}: unknown board id ${id} on ${current}`);
      }
    }
  }

  const sentences = (t) => t.match(/[^。！？；]+[。！？；]?/g).map((s) => s.trim()).filter(Boolean);
  const chars = (t) => t.replace(/\s+/g, '').length;
  let total = 0;
  for (const ch of chapters) {
    let d = 0;
    for (const b of ch.beats) {
      const s = sentences(b.text).map((x) => Math.max(1.2, chars(x) / CPS));
      d += Math.max(MIN_BEAT, s.reduce((a, x) => a + x, 0)) + GAP;
    }
    total += d;
    console.log(`${ch.title.padEnd(12, '　')} ${ch.beats.length} 段  ${fmt(d / SPEED)}`);
  }
  console.log(`total at ${SPEED}x ${fmt(total / SPEED)}  (${chapters.reduce((a, c) => a + c.beats.reduce((x, b) => x + chars(b.text), 0), 0)} chars)`);

  const data = JSON.stringify({ meta, code, frames: [], ...extra, chapters, stations, series, links, related, diagrams }).replace(/</g, '\\u003c');
  const html = readFileSync(join(seriesDir, 'player.html'), 'utf8')
    .replace('__TITLE__', meta.title)
    .replace('__EYEBROW__', meta.eyebrow)
    .replace('__H1__', meta.h1)
    .replace('__LEDE__', meta.lede)
    .replace('__SHORT__', meta.short)
    .replace('/*__DATA__*/null', data);
  new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]); // fails the build if the page script does not parse
  writeFileSync(outFile, html);
  console.log('wrote', outFile.split(/[\\/]/).pop(), Math.round(html.length / 1024), 'KB');
}

function fmt(s) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}
