import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { shoeImage } from './assets';
import { AD_INDEX, VIDEOS, formatCount, type FeedVideo, type SceneKind } from './videos';

// A phone showing a vertical video feed. The sponsored video has a slot at the bottom left: the platform draws the
// card's frame and close button and decides when it appears (a moment after the video starts, like real feeds);
// what is inside the card is whatever `ad` is, here a Tessera view.

const CARD_DELAY_MS = 1200;
const SUBTITLE_MS = 2400;

export interface Toast {
  readonly id: number;
  readonly text: string;
}

export interface FeedProps {
  /** The card's content. Kept mounted while the card is hidden, so its state survives. */
  readonly ad: ReactNode;
  /** Bump to scroll to the sponsored video and open its card at once (e.g. when a new card starts generating). */
  readonly adNonce: number;
  readonly toast: Toast | null;
}

export function Feed({ ad, adNonce, toast }: FeedProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(AD_INDEX);
  const [cardOpen, setCardOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const openNow = useRef(false);

  const go = (index: number, smooth = true) => {
    const el = scroller.current;
    if (!el) return;
    const i = Math.max(0, Math.min(VIDEOS.length - 1, index));
    el.scrollTo({ top: i * el.clientHeight, behavior: smooth ? 'smooth' : 'auto' });
  };

  // Start on the sponsored video; scrolling up shows an ordinary one. Again on the next frame, in case the
  // feed had no height yet when the effect ran.
  useLayoutEffect(() => {
    go(AD_INDEX, false);
    const frame = requestAnimationFrame(() => go(AD_INDEX, false));
    return () => cancelAnimationFrame(frame);
  }, []);

  // The card shows up a moment after the sponsored video starts, and resets when you scroll away.
  useEffect(() => {
    if (active !== AD_INDEX) {
      setCardOpen(false);
      setClosed(false);
      return;
    }
    if (openNow.current) {
      openNow.current = false;
      setCardOpen(true);
      return;
    }
    const timer = setTimeout(() => setCardOpen(true), CARD_DELAY_MS);
    return () => clearTimeout(timer);
  }, [active]);

  useEffect(() => {
    if (!adNonce) return;
    setClosed(false);
    if (active === AD_INDEX) setCardOpen(true);
    else {
      openNow.current = true;
      go(AD_INDEX);
    }
    // Only a new nonce should do this, not a change of the active video.
  }, [adNonce]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) setActive(Math.round(el.scrollTop / el.clientHeight));
  };

  return (
    <div className="stage">
      <div className="phone">
        <div className="phone-screen">
          <div className="feed" ref={scroller} onScroll={onScroll} tabIndex={0} aria-label="视频信息流">
            {VIDEOS.map((video, i) => (
              <Video
                key={video.id}
                video={video}
                active={i === active}
                slot={
                  video.sponsored ? (
                    <AdSlot open={cardOpen && !closed} onClose={() => setClosed(true)} onReopen={() => (setClosed(false), setCardOpen(true))}>
                      {ad}
                    </AdSlot>
                  ) : null
                }
                cardOpen={video.sponsored ? cardOpen && !closed : false}
              />
            ))}
          </div>
          <TopBar />
          {toast ? (
            <div key={toast.id} className="phone-toast" role="status">
              {toast.text}
            </div>
          ) : null}
          <BottomNav />
        </div>
      </div>
      <div className="stage-nav">
        <button type="button" onClick={() => go(active - 1)} disabled={active === 0} aria-label="上一个视频">
          <Chevron up />
        </button>
        <button type="button" onClick={() => go(active + 1)} disabled={active === VIDEOS.length - 1} aria-label="下一个视频">
          <Chevron />
        </button>
      </div>
    </div>
  );
}

function Video({ video, active, slot, cardOpen }: { video: FeedVideo; active: boolean; slot: ReactNode; cardOpen: boolean }) {
  const [line, setLine] = useState(0);
  const [liked, setLiked] = useState(false);
  const [saved, setSaved] = useState(false);
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    setLine(0);
    if (!active) return;
    const timer = setInterval(() => setLine((l) => (l + 1) % video.subtitles.length), SUBTITLE_MS);
    return () => clearInterval(timer);
  }, [active, video.subtitles.length]);

  const [top, mid, bottom] = video.colors;
  return (
    <section className={`video${active ? ' is-active' : ''}`} aria-label={`${video.author} 的视频`}>
      <div className="video-bg" style={{ background: `linear-gradient(170deg, ${top} 0%, ${mid} 55%, ${bottom} 100%)` }}>
        <Bokeh seed={video.id} />
        <Scene kind={video.scene} />
      </div>
      <Subtitle key={active ? line : -1} text={video.subtitles[line] ?? ''} />

      <aside className="rail">
        <div className="rail-avatar">
          <span>{video.initials}</span>
          <button type="button" className={following ? 'is-on' : ''} onClick={() => setFollowing((f) => !f)} aria-label="关注">
            {following ? '✓' : '+'}
          </button>
        </div>
        <RailButton label={formatCount(video.likes + (liked ? 1 : 0))} on={liked} onClick={() => setLiked((l) => !l)} name="点赞">
          <IconHeart />
        </RailButton>
        <RailButton label={formatCount(video.comments)} name="评论">
          <IconComment />
        </RailButton>
        <RailButton label={formatCount(video.saves + (saved ? 1 : 0))} on={saved} onClick={() => setSaved((s) => !s)} name="收藏">
          <IconBookmark />
        </RailButton>
        <RailButton label={video.shares ? formatCount(video.shares) : '分享'} name="分享">
          <IconShare />
        </RailButton>
        <div className="rail-disc" aria-hidden="true">
          <span>{video.initials}</span>
        </div>
      </aside>

      <div className={`video-bottom${cardOpen ? ' has-card' : ''}`}>
        <div className="caption">
          <div className="caption-author">
            @{video.author}
            {video.sponsored ? <span className="chip-sponsored">赞助</span> : null}
          </div>
          <p className="caption-desc">{video.desc}</p>
          <div className="caption-music">
            <IconMusic />
            <span className="marquee">
              <span>{video.music}</span>
            </span>
          </div>
        </div>
        {slot}
      </div>
      <div className="video-progress" aria-hidden="true">
        <span key={String(active)} style={{ animationDuration: `${video.subtitles.length * SUBTITLE_MS}ms` }} />
      </div>
    </section>
  );
}

function AdSlot({ open, onClose, onReopen, children }: { open: boolean; onClose: () => void; onReopen: () => void; children: ReactNode }) {
  return (
    <>
      <div className={`ad-slot${open ? ' is-open' : ''}`} aria-hidden={!open}>
        <div className="ad-slot-inner">
          <div className="ad-card">
            <button type="button" className="ad-close" onClick={onClose} aria-label="关闭广告卡片" tabIndex={open ? 0 : -1}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </button>
            <div className="ad-content">{children}</div>
          </div>
        </div>
      </div>
      {!open ? (
        <button type="button" className="ad-more" onClick={onReopen}>
          查看优惠
          <span aria-hidden="true">›</span>
        </button>
      ) : null}
    </>
  );
}

/** One burned-in subtitle; *text* is drawn in the highlight color. */
function Subtitle({ text }: { text: string }) {
  const parts = text.split(/(\*[^*]+\*)/).filter(Boolean);
  return (
    <div className="subtitle" aria-live="off">
      {parts.map((p, i) => (p.startsWith('*') ? <em key={i}>{p.slice(1, -1)}</em> : <span key={i}>{p}</span>))}
    </div>
  );
}

function Bokeh({ seed }: { seed: string }) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const rand = () => ((h = (h * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  return (
    <div className="bokeh" aria-hidden="true">
      {Array.from({ length: 7 }, (_, i) => {
        const size = 40 + rand() * 120;
        return (
          <span
            key={i}
            style={{
              width: size,
              height: size,
              left: `${rand() * 90}%`,
              top: `${rand() * 85}%`,
              animationDelay: `${-rand() * 8}s`,
              animationDuration: `${7 + rand() * 6}s`,
              opacity: 0.12 + rand() * 0.2,
            }}
          />
        );
      })}
    </div>
  );
}

function Scene({ kind }: { kind: SceneKind }) {
  switch (kind) {
    case 'shoe':
      return (
        <div className="scene scene-shoe" aria-hidden="true">
          <div className="scene-shoe-glow" />
          <div className="scene-shoe-lines">
            <span />
            <span />
            <span />
          </div>
          <img src={shoeImage} alt="" />
          <div className="scene-shoe-title">
            CLOUD<b>3</b>
          </div>
        </div>
      );
    case 'kitchen':
      return (
        <svg className="scene scene-kitchen" viewBox="0 0 300 260" aria-hidden="true">
          <g className="steam" fill="none" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".5">
            <path d="M115 95c-12-18 12-28 0-46" />
            <path d="M150 90c-12-18 12-28 0-46" />
            <path d="M185 95c-12-18 12-28 0-46" />
          </g>
          <ellipse cx="150" cy="150" rx="112" ry="26" fill="#f7e2c4" />
          <ellipse cx="150" cy="150" rx="100" ry="19" fill="#d98a2e" />
          <g stroke="#ffd58a" strokeWidth="4" fill="none" strokeLinecap="round">
            <path d="M80 150c20-10 40 8 60-2s40 8 60-2" />
            <path d="M92 158c20-8 40 6 60-2s30 6 50 0" />
          </g>
          <g fill="#3fa34d">
            <rect x="120" y="140" width="10" height="5" rx="2" transform="rotate(-20 125 142)" />
            <rect x="170" y="146" width="10" height="5" rx="2" transform="rotate(15 175 148)" />
            <rect x="146" y="136" width="9" height="5" rx="2" />
          </g>
          <path d="M38 150c0 55 50 88 112 88s112-33 112-88z" fill="#fff" />
          <path d="M60 176h180" stroke="#3a63b8" strokeWidth="6" />
        </svg>
      );
    case 'mountain':
      return (
        <svg className="scene scene-mountain" viewBox="0 0 300 260" aria-hidden="true">
          <circle className="sun" cx="150" cy="120" r="38" fill="#ffd08a" />
          <polygon points="0,260 70,130 125,200 175,110 240,190 300,140 300,260" fill="#3d2a5c" />
          <polygon points="0,260 50,190 110,230 170,170 240,230 300,200 300,260" fill="#26193d" />
          <g className="clouds" fill="#fff" opacity=".85">
            <ellipse cx="60" cy="200" rx="50" ry="12" />
            <ellipse cx="230" cy="214" rx="64" ry="13" />
            <ellipse cx="150" cy="232" rx="80" ry="12" />
          </g>
        </svg>
      );
    case 'cat':
      return (
        <svg className="scene scene-cat" viewBox="0 0 300 260" aria-hidden="true">
          <g className="cat">
            <path d="M70 260V150l20-60 40 40h40l40-40 20 60v110z" fill="#f2a65a" />
            <path d="M92 104l12 30M208 104l-12 30" stroke="#f7c995" strokeWidth="10" strokeLinecap="round" />
            <g className="cat-eyes" fill="#1d2a24">
              <ellipse cx="125" cy="180" rx="9" ry="12" />
              <ellipse cx="175" cy="180" rx="9" ry="12" />
            </g>
            <path d="M145 200l5 5 5-5" fill="#e0607e" />
            <path d="M150 205v6m0 0c-4 5-10 5-13 1m13-1c4 5 10 5 13 1" stroke="#7a3f1d" strokeWidth="3" fill="none" strokeLinecap="round" />
            <path d="M98 196l-28-4M98 204l-26 6M202 196l28-4M202 204l26 6" stroke="#fff" strokeWidth="2" opacity=".7" />
          </g>
        </svg>
      );
  }
}

function TopBar() {
  const [time, setTime] = useState(clock);
  useEffect(() => {
    const timer = setInterval(() => setTime(clock()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="phone-top">
      <div className="status-bar">
        <span>{time}</span>
        <span className="status-icons" aria-hidden="true">
          <svg viewBox="0 0 18 12" width="18" height="12">
            {[0, 1, 2, 3].map((i) => (
              <rect key={i} x={i * 4.5} y={9 - i * 3} width="3" height={3 + i * 3} rx="0.8" fill="#fff" />
            ))}
          </svg>
          <svg viewBox="0 0 16 12" width="16" height="12" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round">
            <path d="M1.2 4.6a10 10 0 0113.6 0M3.8 7.4a6.2 6.2 0 018.4 0" />
            <circle cx="8" cy="10" r="1.3" fill="#fff" stroke="none" />
          </svg>
          <span className="battery">
            <span />
          </span>
        </span>
      </div>
      <nav className="top-tabs">
        <span>关注</span>
        <span>朋友</span>
        <span className="is-active">推荐</span>
        <svg className="top-search" viewBox="0 0 24 24" width="22" height="22" aria-label="搜索">
          <circle cx="10.5" cy="10.5" r="6.5" stroke="#fff" strokeWidth="2.2" fill="none" />
          <path d="M15.5 15.5L21 21" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      </nav>
    </div>
  );
}

function clock() {
  const d = new Date();
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function BottomNav() {
  return (
    <nav className="phone-nav">
      <span className="is-active">首页</span>
      <span>朋友</span>
      <span className="nav-plus" aria-label="发布">
        +
      </span>
      <span>消息</span>
      <span>我</span>
    </nav>
  );
}

function RailButton({ label, name, on, onClick, children }: { label: string; name: string; on?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`rail-button${on ? ' is-on' : ''}`} onClick={onClick} aria-label={name} aria-pressed={on}>
      {children}
      <span>{label}</span>
    </button>
  );
}

const IconHeart = () => (
  <svg viewBox="0 0 24 24" width="34" height="34">
    <path d="M12 21s-7.5-4.6-9.6-9.3C.9 8.3 3 4.5 6.7 4.5c2.2 0 3.6 1.2 5.3 3.1 1.7-1.9 3.1-3.1 5.3-3.1 3.7 0 5.8 3.8 4.3 7.2C19.5 16.4 12 21 12 21z" fill="currentColor" />
  </svg>
);
const IconComment = () => (
  <svg viewBox="0 0 24 24" width="32" height="32">
    <path d="M12 3.5c5 0 9 3.4 9 7.7s-4 7.7-9 7.7c-1 0-2-.1-2.9-.4L4.6 20.5l1.1-3.7C4 15.4 3 13.4 3 11.2 3 6.9 7 3.5 12 3.5z" fill="currentColor" />
    <g fill="#222">
      <circle cx="8" cy="11.3" r="1.3" />
      <circle cx="12" cy="11.3" r="1.3" />
      <circle cx="16" cy="11.3" r="1.3" />
    </g>
  </svg>
);
const IconBookmark = () => (
  <svg viewBox="0 0 24 24" width="30" height="30">
    <path d="M6 3h12a1 1 0 011 1v17l-7-4.6L5 21V4a1 1 0 011-1z" fill="currentColor" />
  </svg>
);
const IconShare = () => (
  <svg viewBox="0 0 24 24" width="32" height="32">
    <path d="M13.5 4.5l8 7.3-8 7.4v-4.4C8.3 14.8 5 16.6 2.5 20c.8-5.6 4-10.4 11-11.2z" fill="currentColor" />
  </svg>
);
const IconMusic = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
    <path d="M9 17.5a2.8 2.8 0 11-2-2.7V5l12-2.5v12a2.8 2.8 0 11-2-2.7V6.2L9 7.8z" fill="#fff" />
  </svg>
);
const Chevron = ({ up }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
    <path d={up ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
