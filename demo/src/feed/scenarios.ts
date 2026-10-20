// Ad scenarios for the feed demo. Each has a brief for the model, the ad data the card binds to, and a hand-written
// sample: what a good answer looks like, replayable through the fake model when no model is configured.

export interface AdScenario {
  readonly id: string;
  readonly name: string;
  readonly brief: string;
  /** A function so that dates are relative to now. */
  readonly data: () => Record<string, unknown>;
  readonly sample: string;
}

/** Tonight 23:59:59 local time, as an ISO date-time with the local offset. */
function tonight(): string {
  const d = new Date();
  const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const offset = -d.getTimezoneOffset();
  const sign = offset >= 0 ? '+' : '-';
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:59:59${sign}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

export const SCENARIOS: readonly AdScenario[] = [
  {
    id: 'coupon',
    name: '包邮券',
    brief:
      '给 RunLite 云感 3 跑鞋做一张包邮券卡片：左边一个包邮图标，右边是大标题、促销码和使用条件；' +
      '下面一个领取按钮，点了复制促销码，按钮变成已领取。',
    data: () => ({
      offer: { title: 'Free shipping', code: 'U8GDT', minQty: 1, audience: '已注册用户', product: 'RunLite 云感 3 跑鞋' },
    }),
    sample: `{@state claimed = false}
<Box direction="row" gap={3} align="center">
<Seal icon="shipping" />
<Box gap={1}>
<Headline>{offer.title}</Headline>
<PromoCode code={offer.code} />
<Caption>{offer.audience}购买数量满 {offer.minQty} 件可用</Caption>
</Box>
</Box>
<Perforation />
<Button variant={claimed ? "secondary" : "primary"} onClick={() => { setClaimed(true); ui.copy(offer.code) }}>{claimed ? "已领取，点击再次复制" : "领取"}</Button>
`,
  },
  {
    id: 'deal',
    name: '限时特价',
    brief: '限时特价卡片：商品图、商品名、现价和划线原价、今晚截止的倒计时；按钮写出能省多少钱，点了打开落地页。',
    data: () => ({
      deal: {
        name: 'RunLite 云感 3 缓震跑鞋',
        price: 399,
        original: 599,
        endsAt: tonight(),
        image: 'asset:runlite-cloud3',
        url: 'https://example.com/runlite/cloud3',
      },
    }),
    sample: `{@let save = deal.original - deal.price}
<Box direction="row" gap={3} align="center">
<Thumb src={deal.image} alt={deal.name} />
<Box gap={1}>
<Badge tone="danger">限时特价</Badge>
<Headline size="md" tone="ink">{deal.name}</Headline>
<Price value={deal.price} original={deal.original} />
</Box>
</Box>
<Countdown until={deal.endsAt} />
<Perforation />
<Button onClick={() => ui.open(deal.url)}>立省 {save} 元，去抢购</Button>
`,
  },
  {
    id: 'bundle',
    name: '凑单计算',
    brief: '做一张可以拖动选择件数的凑单卡片：满 2 件、满 3 件各有折扣，实时显示到手价和省了多少，按钮去下单。',
    data: () => ({
      bundle: { name: 'RunLite 云感 3', price: 399, rate2: 0.9, rate3: 0.8, url: 'https://example.com/runlite/bundle' },
    }),
    sample: `{@state qty = 2}
{@let rate = qty >= 3 ? bundle.rate3 : qty >= 2 ? bundle.rate2 : 1}
{@let full = bundle.price * qty}
{@let total = Math.round(full * rate)}
<Box direction="row" gap={3} align="center">
<Seal icon="percent" tone="orange" />
<Box gap={1}>
<Headline tone="orange">多买多省</Headline>
<Caption>{bundle.name} 满 2 件 {Math.round(bundle.rate2 * 100) / 10} 折，满 3 件 {Math.round(bundle.rate3 * 100) / 10} 折</Caption>
</Box>
</Box>
<Slider min={1} max={5} value={qty} onChange={setQty} label="件数" />
<Box direction="row" gap={2} align="center">
<Caption>到手价</Caption>
<Price value={total} original={full} tone="orange" />
</Box>
<Perforation />
<Button onClick={() => ui.open(bundle.url)}>{full > total ? \`下单立省 \${full - total} 元\` : "去下单"}</Button>
`,
  },
];

/**
 * Values from the data that appear in the source verbatim: the model retyped a fact instead of binding it.
 * Bindings are written as names (offer.code), so a value showing up anywhere in the source means it was copied.
 */
export function retypedValues(source: string, data: unknown): string[] {
  const found = new Set<string>();
  const visit = (v: unknown) => {
    if (typeof v === 'string') {
      if (v.length >= 3 && !/^(asset:|https?:)/.test(v) && source.includes(v)) found.add(v);
    } else if (typeof v === 'number') {
      if (Math.abs(v) >= 100 && new RegExp(`(?<![\\d.])${String(v).replace('.', '\\.')}(?![\\d.])`).test(source)) found.add(String(v));
    } else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === 'object') Object.values(v).forEach(visit);
  };
  visit(data);
  return [...found];
}
