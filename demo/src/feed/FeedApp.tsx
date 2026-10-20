import { compile, toFallbackMarkdown, type Diagnostic } from '@tessera/lang';
import { TesseraView, iframeSandbox, useTesseraStream, type TesseraIssue } from '@tessera/react';
import type { Action, Program } from '@tessera/runtime';
import sandboxWorkerUrl from '@tessera/runtime/sandbox-worker.js?url';
import { useEffect, useMemo, useRef, useState } from 'react';
import { adCatalog, adSystemPrompt } from './adCatalog';
import { adComponents } from './AdComponents';
import { Feed, type Toast } from './Feed';
import { SCENARIOS, retypedValues, type AdScenario } from './scenarios';

// The feed demo's page: a phone with a vertical video feed on the left, and on the right the panel that fills the
// sponsored card. A card is a Tessera program: the model (or the replayed sample) writes markup from the ad catalog,
// the dev server compiles it as it streams, and the slot renders it in the sandbox with the ad data bound by name.

const sandbox = iframeSandbox({ workerUrl: sandboxWorkerUrl });
const STORE_KEY = 'tessera-feed-ads';
const MAX_VARIANTS = 12;
const REPLAY_CPS = 90;

type Mode = 'model' | 'replay';

interface Variant {
  readonly id: string;
  readonly scenarioId: string;
  readonly mode: Mode;
  readonly text: string;
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
  readonly fallback?: string;
  readonly data: Record<string, unknown>;
  /** Milliseconds from the request to the first paintable program, and to the end. */
  readonly firstPaint?: number;
  readonly total?: number;
}

interface Live {
  readonly id: string;
  readonly scenarioId: string;
  readonly mode: Mode;
  readonly data: Record<string, unknown>;
  readonly started: number;
  firstPaint?: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

function loadVariants(): Variant[] {
  try {
    const list = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Variant[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function parseData(text: string): { data?: Record<string, unknown>; error?: string } {
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? { data: value as Record<string, unknown> } : { error: '要是一个 JSON 对象' };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

const dataText = (s: AdScenario) => JSON.stringify(s.data(), null, 2);

export function FeedApp() {
  const [scenario, setScenario] = useState<AdScenario>(SCENARIOS[0]!);
  const [brief, setBrief] = useState(scenario.brief);
  const [rawData, setRawData] = useState(() => dataText(scenario));
  const [variants, setVariants] = useState<Variant[]>(loadVariants);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [live, setLive] = useState<Live | null>(null);
  const [tab, setTab] = useState<'source' | 'diagnostics' | 'fallback' | 'prompt'>('source');
  const [issues, setIssues] = useState<string[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [adNonce, setAdNonce] = useState(0);
  const lastGood = useRef<Record<string, unknown>>({});
  const stream = useTesseraStream();

  const parsed = useMemo(() => parseData(rawData), [rawData]);
  if (parsed.data) lastGood.current = parsed.data;
  const data = parsed.data ?? lastGood.current;

  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(variants.slice(0, MAX_VARIANTS)));
    } catch {
      // Storage full or blocked: the variants just won't survive a reload.
    }
  }, [variants]);

  // The scenario's hand-written sample, compiled here in the page, is what the slot shows before anything is generated.
  const sample = useMemo(() => {
    const compiled = compile(scenario.sample, { catalog: adCatalog, data });
    return {
      text: scenario.sample,
      program: { code: compiled.code, constants: compiled.constants, data: compiled.data } as Program,
      diagnostics: compiled.diagnostics,
      fallback: toFallbackMarkdown(scenario.sample, { catalog: adCatalog, data }),
    };
  }, [scenario, data]);

  const liveProgram = useMemo<Program>(
    () => ({ code: stream.doc.code, constants: stream.doc.constants, data: stream.doc.data }),
    [stream.doc.code, stream.doc.constants, stream.doc.data],
  );

  useEffect(() => {
    if (live && live.firstPaint === undefined && stream.doc.code) live.firstPaint = performance.now() - live.started;
  }, [live, stream.doc.code]);

  // A finished stream becomes a variant; a failed one only reports its error.
  useEffect(() => {
    if (!live || stream.status === 'streaming' || stream.status === 'idle') return;
    const doc = stream.doc;
    if (doc.code) {
      const variant: Variant = {
        id: live.id,
        scenarioId: live.scenarioId,
        mode: live.mode,
        text: doc.text,
        program: { code: doc.code, constants: doc.constants, data: doc.data },
        diagnostics: doc.diagnostics,
        fallback: doc.fallback,
        data: live.data,
        firstPaint: live.firstPaint,
        total: performance.now() - live.started,
      };
      setVariants((vs) => [variant, ...vs].slice(0, MAX_VARIANTS));
      setSelectedId(variant.id);
    }
    setLive(null);
  }, [live, stream.status, stream.doc]);

  const selected = variants.find((v) => v.id === selectedId) ?? null;
  const shown = live
    ? { key: live.id, text: stream.doc.text, program: liveProgram, diagnostics: stream.doc.diagnostics, fallback: stream.doc.fallback, data: live.data }
    : selected
      ? { key: selected.id, ...selected }
      : { key: `sample-${scenario.id}`, ...sample, data };
  const retyped = useMemo(() => retypedValues(shown.text, shown.data), [shown.text, shown.data]);
  const prompt = useMemo(() => adSystemPrompt(data), [data]);

  useEffect(() => setIssues([]), [shown.key]);

  const pickScenario = (s: AdScenario) => {
    setScenario(s);
    setBrief(s.brief);
    setRawData(dataText(s));
    setSelectedId(null);
  };

  const generate = (mode: Mode) => {
    if (!parsed.data || live) return;
    const id = uid();
    setLive({ id, scenarioId: scenario.id, mode, data: parsed.data, started: performance.now() });
    setSelectedId(null);
    setAdNonce((n) => n + 1);
    const body = mode === 'model' ? { mode, brief, data: parsed.data } : { mode, source: scenario.sample, data: parsed.data, cps: REPLAY_CPS };
    void stream.start((signal) =>
      fetch('/api/ad', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal }),
    );
  };

  const show = (text: string) => setToast({ id: Date.now(), text });
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const onAction = (action: Action) => {
    if (action.type === 'copy') {
      void navigator.clipboard?.writeText(action.text).catch(() => undefined);
      show(/^[A-Za-z0-9-]{3,24}$/.test(action.text) ? '代码已复制，请在结账时使用' : '已复制');
    } else if (action.type === 'open') {
      show(/^https:\/\//.test(action.url) ? `演示：将打开落地页 ${new URL(action.url).host}` : '落地页地址无效，已拦截');
    } else {
      show('广告卡片不能代替用户发消息');
    }
  };

  const onIssue = (issue: TesseraIssue) => setIssues((list) => [...list, `${issue.code}：${issue.message}`].slice(-8));

  const errors = shown.diagnostics.filter((d) => d.severity === 'error').length;
  const status = live
    ? `${live.mode === 'model' ? '模型生成中' : '回放中'}… ${stream.stats.updates} 次更新 · ${(stream.stats.bytes / 1024).toFixed(1)} KB`
    : stream.status === 'error'
      ? `出错了：${stream.error ?? '请求失败'}`
      : selected
        ? `${selected.mode === 'model' ? '模型生成' : '示例回放'}${selected.firstPaint !== undefined ? ` · 首屏 ${(selected.firstPaint / 1000).toFixed(1)} 秒` : ''}${selected.total !== undefined ? ` · 总耗时 ${(selected.total / 1000).toFixed(1)} 秒` : ''}`
        : '手写示例，在页面里直接编译';

  return (
    <div className="feed-page">
      <Feed
        adNonce={adNonce}
        toast={toast}
        ad={
          <TesseraView
            key={shown.key}
            program={shown.program}
            catalog={adCatalog}
            components={adComponents}
            sandbox={sandbox}
            onAction={onAction}
            onIssue={onIssue}
            fallback={<div className="ad-skeleton" aria-label="正在生成广告" />}
          />
        }
      />

      <main className="panel">
        <header className="panel-head">
          <h1>短视频广告位 · Tessera</h1>
          <p>
            左边第二条是赞助视频。卡片的外框、关闭按钮和出现时机归平台；卡片里的内容是一段 Tessera 程序，只能用广告目录里的组件，
            促销码、价格、截止时间这些事实都按名字绑定广告数据。
          </p>
          <nav className="panel-links">
            <a href="./">编辑器演示</a>
            <a href="./chat.html">聊天演示</a>
          </nav>
        </header>

        <section className="panel-section">
          <h2>场景</h2>
          <div className="segmented" role="tablist">
            {SCENARIOS.map((s) => (
              <button key={s.id} type="button" role="tab" aria-selected={s.id === scenario.id} onClick={() => pickScenario(s)} disabled={!!live}>
                {s.name}
              </button>
            ))}
          </div>
          <label className="field">
            <span>需求（发给模型的 brief）</span>
            <textarea value={brief} rows={3} onChange={(e) => setBrief(e.target.value)} />
          </label>
          <label className="field">
            <span>广告数据（data 表，模型只看到名字和字段，写的时候按名字引用）</span>
            <textarea className={parsed.error ? 'mono is-invalid' : 'mono'} value={rawData} rows={7} spellCheck={false} onChange={(e) => setRawData(e.target.value)} />
            {parsed.error ? <em className="field-error">JSON 有误：{parsed.error}</em> : null}
          </label>
          <div className="actions">
            {live ? (
              <button type="button" className="secondary" onClick={stream.stop}>
                停止
              </button>
            ) : (
              <>
                <button type="button" className="primary" onClick={() => generate('model')} disabled={!parsed.data || !brief.trim()}>
                  用模型生成
                </button>
                <button type="button" className="secondary" onClick={() => generate('replay')} disabled={!parsed.data}>
                  回放手写示例
                </button>
              </>
            )}
            <button type="button" className="ghost" onClick={() => setAdNonce((n) => n + 1)}>
              定位到广告
            </button>
          </div>
          <p className={stream.status === 'error' && !live ? 'gen-status is-error' : 'gen-status'}>{status}</p>
        </section>

        {variants.length > 0 && (
          <section className="panel-section">
            <h2>生成记录</h2>
            <div className="variants">
              <button type="button" className={!selected && !live ? 'is-current' : ''} onClick={() => setSelectedId(null)} disabled={!!live}>
                手写示例
              </button>
              {variants.map((v, i) => (
                <button key={v.id} type="button" className={v.id === shown.key ? 'is-current' : ''} onClick={() => setSelectedId(v.id)} disabled={!!live}>
                  {SCENARIOS.find((s) => s.id === v.scenarioId)?.name ?? v.scenarioId} #{variants.length - i}
                  <small>{v.mode === 'model' ? '模型' : '回放'}</small>
                </button>
              ))}
              <button type="button" className="ghost" onClick={() => (setVariants([]), setSelectedId(null))} disabled={!!live}>
                清空
              </button>
            </div>
          </section>
        )}

        <section className="panel-section panel-output">
          <div className="checks">
            <span className={errors ? 'check is-bad' : 'check is-ok'}>{errors ? `${errors} 条错误` : '编译通过'}</span>
            <span className={shown.diagnostics.length - errors ? 'check is-warn' : 'check is-ok'}>{shown.diagnostics.length - errors} 条警告</span>
            <span className={retyped.length ? 'check is-bad' : 'check is-ok'} title={retyped.join('、')}>
              {retyped.length ? `重抄了数据值：${retyped.join('、')}` : '没有重抄数据值'}
            </span>
            <span className={issues.length ? 'check is-bad' : 'check is-ok'}>{issues.length ? `${issues.length} 个运行时问题` : '运行正常'}</span>
          </div>
          <div className="tabs" role="tablist">
            {(
              [
                ['source', '源码'],
                ['diagnostics', '诊断'],
                ['fallback', '降级版'],
                ['prompt', '系统提示词'],
              ] as const
            ).map(([id, label]) => (
              <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
          {tab === 'source' && <pre className="output">{shown.text || '（还没有内容）'}</pre>}
          {tab === 'diagnostics' &&
            (shown.diagnostics.length || issues.length ? (
              <ul className="output diag-list">
                {shown.diagnostics.map((d, i) => (
                  <li key={i} className={d.severity === 'error' ? 'diag-error' : 'diag-warn'}>
                    {d.code}：{d.message}
                  </li>
                ))}
                {issues.map((m, i) => (
                  <li key={`r${i}`} className="diag-error">
                    {m}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="output muted">没有诊断。</p>
            ))}
          {tab === 'fallback' && <pre className="output">{shown.fallback || '（流结束后才有降级版）'}</pre>}
          {tab === 'prompt' && <pre className="output">{prompt}</pre>}
        </section>
      </main>
    </div>
  );
}
