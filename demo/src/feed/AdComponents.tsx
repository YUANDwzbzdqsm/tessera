import type { TesseraComponents } from '@tessera/react';
import { useEffect, useState, type ReactNode } from 'react';
import { components as base } from '../components';
import { formatMoney } from './adCatalog';
import { adAssets } from './assets';

// The host's design for the ad catalog. The model never sees any of this: it writes <Seal icon="shipping" />, and
// what a seal looks like is decided here, once, by whoever turned the design into components.

type Kids = { children?: ReactNode };
type Tone = 'red' | 'orange' | 'teal' | 'ink';

/** A 24-point scalloped disc, like a coupon stamp. */
const SEAL_POINTS = Array.from({ length: 48 }, (_, i) => {
  const r = i % 2 ? 27.5 : 31;
  const a = (i / 48) * Math.PI * 2;
  return `${(32 + r * Math.cos(a)).toFixed(2)},${(32 + r * Math.sin(a)).toFixed(2)}`;
}).join(' ');

const SEAL_ICONS: Record<string, ReactNode> = {
  shipping: (
    <g fill="#fff">
      <rect x="2" y="6" width="12" height="10" rx="1.5" />
      <path d="M14 9h4.2l3.3 3.6V16H14z" />
      <circle cx="6.5" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="17" r="2.6" stroke="currentColor" strokeWidth="1.6" />
    </g>
  ),
  percent: (
    <g stroke="#fff" strokeWidth="2.4" fill="none" strokeLinecap="round">
      <circle cx="7" cy="7" r="2.6" />
      <circle cx="17" cy="17" r="2.6" />
      <path d="M18.5 5.5l-13 13" />
    </g>
  ),
  gift: (
    <g fill="#fff">
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <rect x="4.5" y="12.5" width="15" height="8.5" rx="1" />
      <path d="M12 8c-1.5-3.5-5.5-4.5-6-2s3 2 6 2zm0 0c1.5-3.5 5.5-4.5 6-2s-3 2-6 2z" />
      <rect x="11" y="8" width="2" height="13" fill="currentColor" />
    </g>
  ),
  bolt: <path d="M13.5 2L4.5 13.5h6.5L9.5 22l10-12.5H13z" fill="#fff" />,
  ticket: (
    <path
      d="M3 7a1 1 0 011-1h16a1 1 0 011 1v3a2 2 0 000 4v3a1 1 0 01-1 1H4a1 1 0 01-1-1v-3a2 2 0 000-4z M9 8.5v7"
      fill="#fff"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeDasharray="1.6 1.6"
    />
  ),
};

function Seal({ icon = 'ticket', tone = 'red' }: { icon?: string; tone?: Tone }) {
  return (
    <svg className={`ad-seal ad-tone-${tone}`} viewBox="0 0 64 64" aria-hidden="true">
      <polygon points={SEAL_POINTS} fill="currentColor" />
      <circle cx="32" cy="32" r="22.5" fill="none" stroke="#fff" strokeOpacity=".45" strokeWidth="1.2" strokeDasharray="2 2.4" />
      <svg x="18" y="18" width="28" height="28" viewBox="0 0 24 24">
        {SEAL_ICONS[icon] ?? SEAL_ICONS.ticket}
      </svg>
    </svg>
  );
}

function Headline({ size = 'lg', tone = 'red', children }: Kids & { size?: 'lg' | 'md'; tone?: Tone }) {
  return <div className={`ad-headline ad-headline-${size} ad-tone-${tone}`}>{children}</div>;
}

function PromoCode({ code, label = '促销码' }: { code?: string; label?: string }) {
  return (
    <div className="ad-code">
      {label}：<strong>{code}</strong>
    </div>
  );
}

function Price({ value, original, unit = '¥', tone = 'red' }: { value?: number; original?: number; unit?: string; tone?: Tone }) {
  return (
    <div className={`ad-price ad-tone-${tone}`}>
      <span className="ad-price-unit">{unit}</span>
      <span className="ad-price-value">{formatMoney(value)}</span>
      {original !== undefined && value !== undefined && original > value ? (
        <s className="ad-price-original">
          {unit}
          {formatMoney(original)}
        </s>
      ) : null}
    </div>
  );
}

function Countdown({ until, label = '距结束' }: { until?: string; label?: string }) {
  const end = until ? Date.parse(until) : NaN;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (Number.isNaN(end)) return null;
  const left = Math.max(0, Math.floor((end - now) / 1000));
  if (!left) return <div className="ad-countdown ad-countdown-over">已结束</div>;
  const parts = [Math.floor(left / 3600), Math.floor(left / 60) % 60, left % 60].map((n) => String(n).padStart(2, '0'));
  return (
    <div className="ad-countdown">
      <span>{label}</span>
      {parts.map((p, i) => (
        <span key={i} className="ad-countdown-cell">
          {i ? <i>:</i> : null}
          <b>{p}</b>
        </span>
      ))}
    </div>
  );
}

/** Draws only images from the asset library; the catalog already refuses anything but asset ids. */
function Thumb({ src, alt }: { src?: string; alt?: string }) {
  const url = src ? adAssets[src] : undefined;
  return <figure className="ad-thumb">{url ? <img src={url} alt={alt ?? ''} /> : null}</figure>;
}

function AdButton({ variant = 'primary', selected, disabled, onClick, children }: Kids & {
  variant?: 'primary' | 'secondary' | 'option';
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={`ad-button ad-button-${variant}${selected ? ' is-selected' : ''}`}
      disabled={disabled}
      onClick={() => onClick?.()}
    >
      {children}
    </button>
  );
}

export const adComponents: TesseraComponents = {
  ...base,
  Seal,
  Headline,
  PromoCode,
  Price,
  Countdown,
  Thumb,
  Perforation: () => <div className="ad-perforation" role="separator" />,
  Button: AdButton,
};
