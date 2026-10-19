import { imageResult } from '@tessera/catalog';
import type { TesseraComponents } from '@tessera/react';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { PullRequestCard } from './PullRequestCard';

// The host's own implementation of every catalog component. The model never sees this code;
// it only picks components by name and passes props that the catalog has already validated.

type Kids = { children?: ReactNode };
const unit = (n: number | undefined) => (n === undefined ? undefined : `${n * 4}px`);

function Title({ size = 'lg', children }: Kids & { size?: 'xl' | 'lg' | 'md' | 'sm' }) {
  return <div className={`t-title t-title-${size}`}>{children}</div>;
}

function Box({ direction = 'column', gap = 2, padding, border, align, children }: Kids & {
  direction?: 'column' | 'row';
  gap?: number;
  padding?: number;
  border?: boolean;
  align?: 'start' | 'center' | 'end' | 'stretch';
}) {
  const style: CSSProperties = {
    flexDirection: direction,
    gap: unit(gap),
    padding: unit(padding),
    alignItems: align === 'start' || align === 'end' ? `flex-${align}` : align,
  };
  return (
    <div className={border ? 't-box t-box-border' : 't-box'} style={style}>
      {children}
    </div>
  );
}

/**
 * Keeps a local copy of the value so dragging stays smooth: the worker's answer arrives a moment later,
 * and a plain controlled input would snap back in between.
 */
function Slider({ min, max, step = 1, value, label, onChange }: {
  min?: number;
  max?: number;
  step?: number;
  value?: number;
  label?: string;
  onChange?: (value: number) => void;
}) {
  const [local, setLocal] = useState(value ?? min ?? 0);
  useEffect(() => {
    if (value !== undefined) setLocal(value);
  }, [value]);
  return (
    <label className="t-slider">
      {label && <span className="t-slider-label">{label}</span>}
      <input
        type="range"
        min={min ?? 0}
        max={max ?? 100}
        step={step}
        value={local}
        onChange={(e) => {
          const next = Number(e.currentTarget.value);
          setLocal(next);
          onChange?.(next);
        }}
      />
      <output>{local}</output>
    </label>
  );
}

/** Same local-copy pattern as Slider, so the box does not flicker back while the worker answers. */
function Checkbox({ checked = false, label, onChange }: { checked?: boolean; label?: string; onChange?: (on: boolean) => void }) {
  const [local, setLocal] = useState(checked);
  useEffect(() => setLocal(checked), [checked]);
  return (
    <label className="t-check">
      <input
        type="checkbox"
        checked={local}
        onChange={(e) => {
          const next = e.currentTarget.checked;
          setLocal(next);
          onChange?.(next);
        }}
      />
      <span>{label}</span>
    </label>
  );
}

function Button({ variant = 'solid', disabled, onClick, children }: Kids & {
  variant?: 'solid' | 'outline' | 'ghost';
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className={`t-button t-button-${variant}`} disabled={disabled} onClick={() => onClick?.()}>
      {children}
    </button>
  );
}

function Badge({ tone = 'neutral', children }: Kids & { tone?: string }) {
  return <span className={`t-badge t-badge-${tone}`}>{children}</span>;
}

function Progress({ value, max = 100, label, tone = 'info' }: { value: number; max?: number; label?: string; tone?: string }) {
  const share = max > 0 && Number.isFinite(value) ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div className="t-progress">
      {label ? <span className="t-slider-label">{label}</span> : null}
      <div className="t-progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
        <div className={`t-progress-fill t-progress-${tone}`} style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

/**
 * Shows what the server found for the query. The URL comes from the resolver, never from the model, but the host
 * still only draws https images and raster or SVG data URLs (an SVG in <img> cannot run scripts).
 */
function Image({ query, alt, aspect = '4:3', resolved }: { query?: string; alt?: string; aspect?: string; resolved?: unknown }) {
  const found = imageResult.safeParse(resolved);
  const url = found.success && /^(https:|data:image\/(png|jpeg|gif|webp|svg\+xml)[;,])/.test(found.data.url) ? found.data.url : null;
  const ratio = aspect.replace(':', ' / ');
  return (
    <figure className="t-image" style={{ aspectRatio: ratio }} data-state={url ? 'resolved' : 'pending'}>
      {url ? <img src={url} alt={alt ?? query ?? ''} /> : <span className="t-image-pending">正在找图：{query}</span>}
    </figure>
  );
}

function CodeBlock({ language, children }: Kids & { language?: string }) {
  return (
    <figure className="t-codeblock">
      {language ? <figcaption>{language}</figcaption> : null}
      <pre>
        <code>{children}</code>
      </pre>
    </figure>
  );
}

function List({ ordered, children }: Kids & { ordered?: boolean }) {
  return ordered ? <ol className="t-list">{children}</ol> : <ul className="t-list">{children}</ul>;
}

export const components: TesseraComponents = {
  Title,
  Text: ({ children }: Kids) => <p className="t-text">{children}</p>,
  Bold: ({ children }: Kids) => <strong>{children}</strong>,
  Italic: ({ children }: Kids) => <em>{children}</em>,
  Code: ({ children }: Kids) => <code className="t-code">{children}</code>,
  CodeBlock,
  List,
  ListItem: ({ children }: Kids) => <li>{children}</li>,
  Box,
  Slider,
  Checkbox,
  Button,
  Caption: ({ children }: Kids) => <div className="t-caption">{children}</div>,
  Badge,
  Progress,
  Divider: () => <hr className="t-divider" />,
  Image,
  PullRequest: PullRequestCard,
};
