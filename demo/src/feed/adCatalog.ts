import { defineCatalog, defineComponent, starterComponents } from '@tessera/catalog';
import { systemPrompt } from '@tessera/lang';
import { z } from 'zod';

// The catalog for the sponsored card in the feed demo. The platform owns the card's frame and close button; the
// model writes only what goes inside, from these components. Every visual decision (the scalloped seal, the red
// headline, the ticket tear line, the full-width button) is the host's (AdComponents.tsx): the model picks
// components, tones from a fixed palette, and binds facts from the ad data.

export const AD_TONES = ['red', 'orange', 'teal', 'ink'] as const;
const tone = z.enum(AD_TONES).optional();
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** Assets come from the advertiser's library by id, never as URLs the model could make up. */
export const assetId = z.string().regex(/^asset:[a-z0-9-]+$/, 'must be an asset id like asset:runlite-cloud3');

/** An ISO date-time the countdown can parse. */
const dateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be an ISO date-time');

export function formatMoney(n: unknown): string {
  const value = Number(n);
  if (!Number.isFinite(value)) return '';
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

const adSpecs = [
  defineComponent({
    name: 'Seal',
    description:
      'Round scalloped badge with an icon, the eye-catcher at the left of a coupon. icon: shipping (free shipping), ' +
      'percent (discount), gift, bolt (flash sale), ticket (coupon).',
    props: z.object({ icon: z.enum(['shipping', 'percent', 'gift', 'bolt', 'ticket']), tone }),
    fallback: () => '',
  }),
  defineComponent({
    name: 'Headline',
    description: 'The big line of the card, e.g. 包邮 or 限时特价. size lg (default) for the main line, md for a product name. tone defaults to red.',
    props: z.object({ size: z.enum(['lg', 'md']).optional(), tone }),
    children: 'inline',
    fallback: (_, children) => `**${children}**`,
  }),
  defineComponent({
    name: 'PromoCode',
    description: 'A promo code shown as "促销码：CODE". Bind it from the data: code={offer.code}.',
    props: z.object({ code: z.string().min(1).max(24), label: z.string().max(8).optional() }),
    fallback: (p) => `${text(p.label) || '促销码'}：**${text(p.code)}**`,
  }),
  defineComponent({
    name: 'Price',
    description: 'A price with an optional struck-through original. value and original are numbers; unit defaults to ¥. The original is hidden unless it is higher.',
    props: z.object({ value: z.number().min(0), original: z.number().min(0).optional(), unit: z.string().max(2).optional(), tone }),
    fallback: (p) => {
      const unit = text(p.unit) || '¥';
      const original = Number(p.original) > Number(p.value) ? ` ~~${unit}${formatMoney(p.original)}~~` : '';
      return `**${unit}${formatMoney(p.value)}**${original}`;
    },
  }),
  defineComponent({
    name: 'Countdown',
    description: 'Live countdown to until (an ISO date-time from the data); shows 已结束 once it has passed. label defaults to 距结束.',
    props: z.object({ until: dateTime, label: z.string().max(8).optional() }),
    fallback: (p) => `${text(p.label) || '距结束'}：${new Date(String(p.until)).toLocaleString('zh-CN', { hour12: false })} 截止`,
  }),
  defineComponent({
    name: 'Thumb',
    description: "Product image from the advertiser's asset library. src is an asset id from the data, e.g. src={deal.image}; never a URL.",
    props: z.object({ src: assetId, alt: z.string().optional() }),
    fallback: (p) => `*[商品图：${text(p.alt) || '商品'}]*`,
  }),
  defineComponent({
    name: 'Perforation',
    description: 'The tear line of a coupon, between the body and the button.',
    fallback: () => '- - -',
  }),
  defineComponent({
    name: 'Button',
    description:
      'variant primary (default): the full-width call to action, one per card. secondary: an outlined button. ' +
      'option: a choice chip; pass selected for the chosen one.',
    props: z.object({
      variant: z.enum(['primary', 'secondary', 'option']).optional(),
      selected: z.boolean().optional(),
      disabled: z.boolean().optional(),
    }),
    events: ['onClick'],
    children: 'inline',
    fallback: (_, children) => `[${children}]`,
  }),
];

/** Layout and a few read-outs from the starter set; its Button is replaced by the ad one. */
const fromStarter = new Set(['Box', 'Caption', 'Badge', 'Slider', 'Progress']);

export const adCatalog = defineCatalog([...starterComponents.filter((s) => fromStarter.has(s.name)), ...adSpecs]);

const INTRO = `You write the content of one sponsored card in Tessera markup. The card sits over a short vertical video
in a phone feed and is about 290px wide. The platform draws its frame, background and close button; you write only
what goes inside. Always answer with the markup alone: no explanation before or after it, and no code fence.`;

const RULES = `Ad card rules
- It must read in two seconds: at most about five short lines of text. No # headings, lists or long paragraphs.
- A typical layout: <Box direction="row" gap={3} align="center"> holding a <Seal> or <Thumb> and a <Box gap={1}> column
  with the <Headline>, the key fact and a <Caption> with the conditions; then <Perforation /> and one primary <Button>.
- Every fact (codes, prices, quantities, deadlines, product names, images, links) comes from the ad data by name.
  Compute with them in @let when needed. Never retype a value from the data, not even inside a sentence or a string.
- Copy is Simplified Chinese unless the brief says otherwise. No absolute claims such as 最, 第一 or 100%.
- Buttons: ui.copy(code) for a promo code (the platform shows a toast), ui.open(url) for a landing page. Never ui.send.
- Colors come only from tone props; there is no other way to style.`;

/** The system prompt for one ad card: the Tessera guide for this catalog, the data's names and fields, the ad rules. */
export function adSystemPrompt(data: Readonly<Record<string, unknown>>): string {
  return systemPrompt(adCatalog, { intro: INTRO, data, extra: RULES });
}

/** The user turn: the brief, plus the data's values for context, so the copy fits the product. */
export function adUserMessage(brief: string, data: Readonly<Record<string, unknown>>): string {
  return (
    `需求：${brief.trim()}\n\n` +
    '广告数据的值只供你理解，写的时候按名字引用（比如 {offer.code}），不要把值抄进源码：\n' +
    JSON.stringify(data, null, 2)
  );
}
