// The advertiser's asset library for the demo: images by id, drawn locally so nothing is fetched. Ad data refers to
// them as asset:<id>; the host's Thumb looks the id up here and draws nothing for an unknown one.

function shoe(upper: string, accent: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 130">
<ellipse cx="122" cy="117" rx="102" ry="7" fill="#000" opacity=".2"/>
<path d="M14 95 Q12 110 30 110 L198 110 Q222 108 230 95 L232 86 L14 86 Z" fill="#f5f6f8"/>
<path d="M16 101 Q42 96 68 101 T120 101 T172 101 T222 99" stroke="#dfe2e8" stroke-width="2" fill="none"/>
<path d="M14 86 L232 86 L231 92 L14 92 Z" fill="${accent}"/>
<path d="M16 87 C11 72 12 58 20 44 Q24 37 31 40 Q45 48 60 44 Q72 30 84 27 L100 32 L150 60 Q198 64 220 74 Q234 81 232 87 Z" fill="${upper}"/>
<path d="M16 87 C11 72 12 58 20 44 Q24 37 31 40 L36 87 Z" fill="#000" opacity=".18"/>
<path d="M33 43 Q46 51 61 47" stroke="#fff" stroke-opacity=".6" stroke-width="3" fill="none" stroke-linecap="round"/>
<path d="M99 36 l-6 9 M113 43 l-6 9 M127 50 l-6 9" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
<path d="M44 76 Q84 62 124 72 T206 78" stroke="#fff" stroke-opacity=".85" stroke-width="4" fill="none" stroke-linecap="round"/>
<circle cx="70" cy="58" r="9" fill="#fff"/>
<text x="70" y="62.5" font-size="12" font-weight="800" text-anchor="middle" fill="${upper}" font-family="Arial, sans-serif">R</text>
</svg>`;
}

export const shoeSvg = shoe('#2f6bff', '#ff4f6d');

const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export const adAssets: Readonly<Record<string, string>> = {
  'asset:runlite-cloud3': svgUrl(shoeSvg),
  'asset:runlite-cloud3-coral': svgUrl(shoe('#ff6a4d', '#2f6bff')),
};

export const shoeImage = adAssets['asset:runlite-cloud3']!;
