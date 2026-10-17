import type { ImageResult } from '@tessera/catalog';
import type { Resolver } from '@tessera/lang';

// Stand-in for a real image search, shared by the page (local compiles) and the dev-server endpoint (streaming).
// It draws a labelled placeholder for the query instead of calling any external service, so the demo runs
// offline and costs nothing. A real app would plug a search API in here and keep the same result shape.

const DELAY_MS = 400;

function hue(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h % 360;
}

const escapeXml = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function placeholderImage(query: string, aspect = '4:3'): string {
  const [w, h] = aspect === '1:1' ? [400, 400] : aspect === '16:9' ? [480, 270] : [400, 300];
  const base = hue(query);
  const label = query.length > 18 ? query.slice(0, 17) + '…' : query;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<rect width="${w}" height="${h}" fill="hsl(${base} 45% 88%)"/>
<circle cx="${w * 0.72}" cy="${h * 0.38}" r="${h * 0.22}" fill="hsl(${(base + 40) % 360} 50% 70%)"/>
<rect x="${w * 0.12}" y="${h * 0.55}" width="${w * 0.46}" height="${h * 0.2}" rx="12" fill="hsl(${(base + 200) % 360} 35% 60%)"/>
<text x="${w / 2}" y="${h - 22}" text-anchor="middle" font-family="sans-serif" font-size="18" fill="hsl(${base} 40% 25%)">${escapeXml(label)}</text>
</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export const imageSearch: Resolver = async (input) => {
  await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
  const query = String(input.query ?? '');
  return {
    url: placeholderImage(query, typeof input.aspect === 'string' ? input.aspect : undefined),
    title: query,
    source: '演示图库（本地生成的占位图）',
  } satisfies ImageResult;
};

export const resolvers = { image: imageSearch } as const;
