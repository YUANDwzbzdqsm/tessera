import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { openConflicts, statusText, type ConflictFile, type PrStatus } from './pullRequest';

// Host side of <PullRequest>. The design is fixed here; the model only picks the status and the facts.
// Elements stay mounted across status changes, so colours, the merge line and the node animate with CSS.

type Tone = 'active' | 'warn' | 'ok' | 'merged' | 'closed';

const TONE: Record<PrStatus, Tone> = {
  opening: 'active',
  checking: 'active',
  conflicts: 'warn',
  resolving: 'warn',
  ready: 'ok',
  merging: 'ok',
  merged: 'merged',
  closed: 'closed',
};
const BUSY: ReadonlySet<PrStatus> = new Set(['opening', 'checking', 'resolving', 'merging']);
/** How long a clicked button shows its busy state when no new status arrives (say the click only sent a message). */
const PENDING_MS = 10_000;

interface Props {
  title?: string;
  number?: number;
  branch?: string;
  base?: string;
  commits?: number;
  additions?: number;
  deletions?: number;
  behind?: number;
  synced?: boolean;
  status?: PrStatus;
  conflicts?: readonly ConflictFile[];
  note?: string;
  onResolve?: () => void;
  onMerge?: () => void;
}

export function PullRequestCard({
  title = '',
  number,
  branch = '',
  base = 'main',
  commits = 0,
  additions,
  deletions,
  behind = 0,
  synced = false,
  status = 'checking',
  conflicts,
  note,
  onResolve,
  onMerge,
}: Props) {
  const tone = TONE[status];
  const left = openConflicts(conflicts);

  // A click shows the busy state right away; the real status replaces it when it arrives.
  const [pending, setPending] = useState<'resolve' | 'merge' | null>(null);
  useEffect(() => setPending(null), [status]);
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPending(null), PENDING_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  return (
    <article className="t-pr" data-status={status} data-tone={tone} aria-label={`合并请求：${title}，${statusText[status]}`}>
      <header className="t-pr-head">
        <span className="t-pr-icon">{status === 'merged' ? <MergeIcon /> : status === 'closed' ? <ClosedIcon /> : <PullIcon />}</span>
        <div className="t-pr-heading">
          <div className="t-pr-title">
            {title}
            {number !== undefined && <span className="t-pr-number"> #{number}</span>}
          </div>
          <div className="t-pr-meta">
            <code>{branch}</code>
            <span aria-label="合并到">→</span>
            <code>{base}</code>
            <span>{commits} 个提交</span>
            {(additions !== undefined || deletions !== undefined) && (
              <span>
                <span className="t-pr-add">+{additions ?? 0}</span> <span className="t-pr-del">−{deletions ?? 0}</span>
              </span>
            )}
          </div>
        </div>
        <StatePill status={status} />
      </header>

      <BranchGraph status={status} base={base} branch={branch} commits={commits} behind={behind} synced={synced} left={left} />

      <Footer
        status={status}
        base={base}
        left={left}
        conflicts={conflicts}
        note={note}
        pending={pending}
        onResolve={
          onResolve &&
          (() => {
            setPending('resolve');
            onResolve();
          })
        }
        onMerge={
          onMerge &&
          (() => {
            setPending('merge');
            onMerge();
          })
        }
      />
    </article>
  );
}

function StatePill({ status }: { status: PrStatus }) {
  if (status === 'opening') return null;
  const [label, icon] =
    status === 'merged' ? ['已合并', <MergeIcon />] : status === 'closed' ? ['已关闭', <ClosedIcon />] : ['开启', <PullIcon />];
  return (
    <span className="t-pr-state" key={label}>
      {icon}
      {label}
    </span>
  );
}

// ---- branch graph ----

const HEIGHT = 108;
const MAIN_Y = 40;
const BRANCH_Y = 76;

/** Evenly spaced fractions between from and to; one point sits in the middle. */
function spread(n: number, from: number, to: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [(from + to) / 2];
  return Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
}

/** An S-curve between two rows, flat at both ends like a git graph. */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const d = (x2 - x1) / 2;
  return `M${x1} ${y1} C${x1 + d} ${y1} ${x2 - d} ${y2} ${x2} ${y2}`;
}

function layout(width: number, commits: number, behind: number, synced: boolean) {
  const start = 22;
  const end = width - 26;
  const split = start + Math.min(64, (end - start) * 0.14);
  const at = (f: number) => split + (end - split) * f;
  const branchDots = spread(Math.min(Math.max(commits, 1), 5), 0.17, 0.5).map(at);
  const mainDots = spread(Math.min(behind, 4), 0.4, 0.62).map(at);
  const lastMain = mainDots.at(-1) ?? split;
  const lastBranch = branchDots.at(-1)!;
  const syncX = synced ? at(0.78) : null;
  return { start, end, split, branchDots, mainDots, lastMain, lastBranch, syncX, tip: syncX ?? lastBranch };
}

function BranchGraph({ status, base, branch, commits, behind, synced, left }: {
  status: PrStatus;
  base: string;
  branch: string;
  commits: number;
  behind: number;
  synced: boolean;
  left: number;
}) {
  // Drawn at the real pixel width, so dots stay round and labels stay readable at any card width.
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(520);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setWidth(Math.round(el.clientWidth) || 520);
    const observer = new ResizeObserver(([entry]) => entry && setWidth(Math.round(entry.contentRect.width) || 520));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const g = layout(width, commits, behind, synced);
  const merged = status === 'merged';
  const link = curve(g.tip, BRANCH_Y, g.end, MAIN_Y);
  const label = targetLabel(status, left);
  const branchMid = (g.branchDots[0]! + g.lastBranch) / 2;

  return (
    <div className="t-pr-graph" ref={box} style={{ height: HEIGHT }}>
      <svg width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} aria-hidden="true">
        <path className="t-pr-rail" d={`M${g.start} ${MAIN_Y} H${g.lastMain}`} />
        <path className="t-pr-future" d={`M${g.lastMain} ${MAIN_Y} H${g.end}`} />
        <path
          className="t-pr-branch"
          d={`${curve(g.split, MAIN_Y, g.branchDots[0]!, BRANCH_Y)} H${g.lastBranch}${g.syncX ? ` H${g.syncX}` : ''}`}
        />
        {g.syncX !== null && <path className="t-pr-sync" d={curve(g.lastMain, MAIN_Y, g.syncX, BRANCH_Y)} />}
        <path className="t-pr-link" d={link} />
        <path className="t-pr-link-done" d={link} pathLength={1} />

        {[g.start, g.split, ...g.mainDots].map((x, i) => (
          <circle key={`m${i}`} className="t-pr-dot" cx={x} cy={MAIN_Y} r={4} />
        ))}
        {g.branchDots.map((x, i) => (
          <circle key={`b${i}`} className="t-pr-commit" cx={x} cy={BRANCH_Y} r={4.5} />
        ))}
        {g.syncX !== null && <circle className="t-pr-synced" cx={g.syncX} cy={BRANCH_Y} r={5} />}

        <g className="t-pr-target" transform={`translate(${g.end} ${MAIN_Y})`}>
          <circle className="t-pr-node" r={7} />
          {BUSY.has(status) && status !== 'opening' && <circle className="t-pr-spin" r={11} pathLength={1} />}
          <TargetGlyph status={status} />
        </g>
      </svg>

      <code className="t-pr-label t-pr-label-base" style={{ left: g.start - 8 }}>
        {base}
      </code>
      <code className="t-pr-label t-pr-label-branch" style={{ left: branchMid, top: BRANCH_Y + 12 }}>
        {branch}
      </code>
      {label && (
        <span className="t-pr-label t-pr-label-target" key={label} style={{ right: width - g.end - 14 }}>
          {status === 'checking' && <Spinner />}
          {label}
        </span>
      )}
    </div>
  );
}

function targetLabel(status: PrStatus, left: number): string | null {
  switch (status) {
    case 'opening':
      return null;
    case 'checking':
      return '检查中';
    case 'conflicts':
    case 'resolving':
      return left > 0 ? `${left} 处冲突` : '已解决';
    case 'ready':
    case 'merging':
      return '可以合并';
    default:
      return statusText[status];
  }
}

function TargetGlyph({ status }: { status: PrStatus }) {
  if (status === 'conflicts' || status === 'resolving') {
    return <path key="warn" className="t-pr-glyph" d="M0 -3.2 V0.6 M0 3 V3.1" />;
  }
  if (status === 'ready' || status === 'merging') {
    return <path key="ok" className="t-pr-glyph" d="M-3 0.2 L-0.8 2.4 L3.2 -2" />;
  }
  return null;
}

// ---- footer: what is going on, and the next step ----

function Footer({ status, base, left, conflicts, note, pending, onResolve, onMerge }: {
  status: PrStatus;
  base: string;
  left: number;
  conflicts?: readonly ConflictFile[];
  note?: string;
  pending: 'resolve' | 'merge' | null;
  onResolve?: () => void;
  onMerge?: () => void;
}) {
  let icon: ReactNode;
  let heading: string;
  let action: ReactNode = null;
  let files: readonly ConflictFile[] = [];

  switch (status) {
    case 'conflicts':
    case 'resolving':
      icon = <WarnIcon />;
      heading = left > 0 ? `与 ${base} 有 ${left} 处冲突` : '冲突已解决';
      files = conflicts ?? [];
      action =
        status === 'resolving' || pending === 'resolve' ? (
          <Busy>解决中</Busy>
        ) : onResolve ? (
          <button type="button" className="t-pr-action" onClick={onResolve}>
            解决冲突
          </button>
        ) : null;
      break;
    case 'ready':
    case 'merging':
      icon = <CheckIcon />;
      heading = '可以合并';
      note ??= '没有冲突';
      action =
        status === 'merging' || pending === 'merge' ? (
          <Busy>合并中</Busy>
        ) : onMerge ? (
          <button type="button" className="t-pr-action" onClick={onMerge}>
            <MergeIcon />
            合并
          </button>
        ) : null;
      break;
    case 'merged':
      icon = <MergeIcon />;
      heading = `已合并到 ${base}`;
      break;
    case 'closed':
      icon = <ClosedIcon />;
      heading = '已关闭，没有合并';
      break;
    default:
      // opening / checking: the graph already says it; only show a row when there is something to add.
      if (!note) return null;
      icon = <Spinner />;
      heading = statusText[status];
  }

  return (
    <div className="t-pr-foot" key={status}>
      <span className="t-pr-foot-icon">{icon}</span>
      <div className="t-pr-foot-text">
        <div className="t-pr-foot-title">{heading}</div>
        {note && <div className="t-pr-foot-note">{note}</div>}
        {files.length > 0 && (
          <ul className="t-pr-files">
            {files.map((f) => (
              <li key={f.file} data-done={f.count === 0 || undefined}>
                <span className="t-pr-ext">{extension(f.file)}</span>
                {f.file}
                <span className="t-pr-count">{f.count === 0 ? '✓' : f.count}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {action && <div className="t-pr-foot-action">{action}</div>}
    </div>
  );
}

function extension(file: string): string {
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(dot + 1, dot + 4).toUpperCase() : '·';
}

function Busy({ children }: { children: ReactNode }) {
  return (
    <span className="t-pr-busy" role="status">
      <Spinner />
      {children}
    </span>
  );
}

// ---- icons (16px, stroked with the current colour) ----

function Spinner() {
  return <span className="t-pr-spinner" aria-hidden="true" />;
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg className="t-pr-svg-icon" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  );
}

function PullIcon() {
  return (
    <Icon>
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="12.5" r="1.8" />
      <path d="M4.5 5.3v5.4M11.5 10.7V6.5a2 2 0 0 0-2-2H7.5M9 3l-1.5 1.5L9 6" />
    </Icon>
  );
}

function MergeIcon() {
  return (
    <Icon>
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="8" r="1.8" />
      <path d="M4.5 5.3v5.4M4.5 5.3c0 1.6 1.3 2.7 3 2.7h2.2" />
    </Icon>
  );
}

function ClosedIcon() {
  return (
    <Icon>
      <circle cx="4.5" cy="3.5" r="1.8" />
      <circle cx="4.5" cy="12.5" r="1.8" />
      <circle cx="11.5" cy="12.5" r="1.8" />
      <path d="M4.5 5.3v5.4M11.5 10.7V8M9.8 2.3l3.4 3.4M13.2 2.3 9.8 5.7" />
    </Icon>
  );
}

function WarnIcon() {
  return (
    <Icon>
      <path d="M8 2.2 14.2 13H1.8Z" />
      <path d="M8 6.5v2.8M8 11.2v.1" />
    </Icon>
  );
}

function CheckIcon() {
  return (
    <Icon>
      <path d="m3 8.5 3.2 3L13 4.8" />
    </Icon>
  );
}
