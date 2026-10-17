import { compile, systemPrompt } from '@tessera/lang';
import { TesseraView, useTesseraStream, type TesseraIssue } from '@tessera/react';
import type { Action } from '@tessera/runtime';
import type { UpdateKind } from '@tessera/stream';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { catalog } from './catalog';
import { components } from './components';
import { samples } from './samples';

// Module-level so its identity is stable: a new function would restart the sandbox.
const createWorker = () => new Worker(new URL('./tessera.worker.ts', import.meta.url), { type: 'module', name: 'tessera-sandbox' });

type Tab = 'diagnostics' | 'code' | 'prompt';

interface LogEntry {
  readonly id: number;
  readonly kind: 'action' | 'issue';
  readonly text: string;
}

const SPEEDS = [
  { cps: 40, label: '慢（40 字/秒）' },
  { cps: 120, label: '正常（120 字/秒）' },
  { cps: 600, label: '快（600 字/秒）' },
] as const;

const STATUS_TEXT = { idle: '空闲', streaming: '生成中', done: '完成', stopped: '已停止', error: '出错' } as const;

const KIND_TEXT: Record<UpdateKind, string> = {
  structure: '结构变了：有组件、语句或代码块写完了，整段代码重发',
  constants: '只是文字变长：代码不变，只往常量表里追加文字',
  text: '写在半截里：模型正写到一个没完成的标签中间，界面不变',
  final: '流结束',
};

let nextLogId = 0;

export function App() {
  const [sampleId, setSampleId] = useState(samples[0]!.id);
  const [source, setSource] = useState(samples[0]!.source);
  const deferred = useDeferredValue(source);
  const local = useMemo(() => compile(deferred, { catalog }), [deferred]);
  const [tab, setTab] = useState<Tab>('diagnostics');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [sends, setSends] = useState(0);

  const stream = useTesseraStream();
  const streaming = stream.status === 'streaming';
  // 'stream' shows the streamed document (live, or what was left when it stopped); 'local' compiles the editor text.
  const [view, setView] = useState<'local' | 'stream'>('local');
  const [cps, setCps] = useState<number>(SPEEDS[0].cps);
  const [viewKey, setViewKey] = useState(0);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const shown =
    view === 'stream'
      ? { text: stream.doc.text, code: stream.doc.code, constants: stream.doc.constants, diagnostics: stream.doc.diagnostics }
      : { text: source, code: local.code, constants: local.constants, diagnostics: local.diagnostics };
  const program = useMemo(() => ({ code: shown.code, constants: shown.constants }), [shown.code, shown.constants]);

  // A completed stream hands its text to the editor (it compiles to the same program, so nothing flickers).
  // A stopped or failed one stays on screen as it was, without touching the editor's source.
  useEffect(() => {
    if (view === 'stream' && stream.status === 'done') {
      setSource(stream.doc.text);
      setView('local');
    }
  }, [view, stream.status, stream.doc.text]);

  useEffect(() => {
    if (streaming && textarea.current) textarea.current.scrollTop = textarea.current.scrollHeight;
  }, [streaming, shown.text]);

  const startStream = () => {
    const body = JSON.stringify({ source, cps });
    setViewKey((k) => k + 1); // fresh sandbox, fresh state
    setView('stream');
    void stream.start((signal) => fetch('/api/stream', { method: 'POST', headers: { 'content-type': 'application/json' }, body, signal }));
  };
  const backToEditing = () => {
    stream.reset();
    setView('local');
  };

  const push = (kind: LogEntry['kind'], text: string) => setLog((l) => [{ id: nextLogId++, kind, text }, ...l].slice(0, 30));
  const onAction = (a: Action) => {
    if (a.type === 'send') setSends((n) => n + 1);
    push('action', a.type === 'open' ? `ui.open → ${a.url}` : `ui.${a.type} → ${a.text}`);
  };
  const onIssue = (i: TesseraIssue) => {
    push('issue', `[${i.source}] ${i.code}: ${i.message}`);
    if ('stack' in i && i.stack) console.debug(i.stack);
  };

  const { stats } = stream;
  const kb = (n: number) => (n / 1024).toFixed(1);

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Tessera</h1>
          <p>M2：模型流式输出 → 服务端反复编译 → SSE 补丁 → 沙箱 Worker → React</p>
        </div>
        <nav className="samples" aria-label="示例">
          {samples.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={s.id === sampleId}
              disabled={streaming}
              onClick={() => {
                setSampleId(s.id);
                setSource(s.source);
                setView('local');
              }}
            >
              {s.label}
            </button>
          ))}
        </nav>
      </header>

      <section className="pane stream-bar" aria-label="流式">
        <div className="stream-controls">
          {streaming ? (
            <button type="button" className="primary" data-testid="stream-stop" onClick={stream.stop}>
              停止
            </button>
          ) : (
            <button type="button" className="primary" data-testid="stream-start" onClick={startStream}>
              流式播放
            </button>
          )}
          {view === 'stream' && !streaming && (
            <button type="button" className="secondary" data-testid="stream-dismiss" onClick={backToEditing}>
              恢复编辑
            </button>
          )}
          <select data-testid="stream-speed" aria-label="模型速度" value={cps} disabled={streaming} onChange={(e) => setCps(Number(e.currentTarget.value))}>
            {SPEEDS.map((s) => (
              <option key={s.cps} value={s.cps}>
                {s.label}
              </option>
            ))}
          </select>
          <span className={`status status-${stream.status}`} data-testid="stream-status">
            {STATUS_TEXT[stream.status]}
            {stream.error ? `：${stream.error}` : ''}
          </span>
        </div>
        <div className="stream-stats" data-testid="stream-stats">
          <span>
            更新 <b data-testid="stat-updates">{stats.updates}</b> 次
          </span>
          <span>
            结构 <b data-testid="stat-structure">{stats.byKind.structure}</b>
          </span>
          <span>
            常量 <b data-testid="stat-constants">{stats.byKind.constants}</b>
          </span>
          <span>
            纯文本 <b data-testid="stat-text">{stats.byKind.text}</b>
          </span>
          <span>
            共 <b>{kb(stats.bytes)}</b> KB，其中重发代码 <b>{stats.bytes ? Math.round((stats.codeBytes / stats.bytes) * 100) : 0}%</b>
          </span>
        </div>
        <p className="muted" data-testid="stream-last">
          {stats.lastKind ? `最近一次：${KIND_TEXT[stats.lastKind]}` : '点“流式播放”：服务端用一个假模型逐个 token 吐出左边的源码，每 100 毫秒重编译一次，通过 SSE 推送补丁。'}
        </p>
      </section>

      <main className="grid">
        <section className="pane">
          <label className="pane-title" htmlFor="source">
            {streaming ? '模型正在输出…' : view === 'stream' ? '流已停止：这是停止前的输出（点“恢复编辑”回到原文）' : '模型输出（可以直接改）'}
          </label>
          <textarea
            id="source"
            ref={textarea}
            data-testid="source"
            spellCheck={false}
            readOnly={view === 'stream'}
            value={shown.text}
            onChange={(e) => setSource(e.currentTarget.value)}
          />
          <div className="tabs" role="tablist">
            {(['diagnostics', 'code', 'prompt'] as const).map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>
                {t === 'diagnostics' ? `诊断 ${shown.diagnostics.length}` : t === 'code' ? '编译结果' : '系统提示词'}
              </button>
            ))}
          </div>
          {tab === 'diagnostics' && (
            <ul className="diagnostics" data-testid="diagnostics">
              {shown.diagnostics.length === 0 && <li className="ok">没有诊断，源码是完整的。</li>}
              {shown.diagnostics.map((d, i) => (
                <li key={i} className={d.severity}>
                  <code>{d.code}</code> {d.message}
                </li>
              ))}
            </ul>
          )}
          {tab === 'code' && (
            <pre className="code" data-testid="compiled">
              {shown.code}
              {'\n\n// constants\n'}
              {JSON.stringify(shown.constants, null, 2)}
            </pre>
          )}
          {tab === 'prompt' && <pre className="code">{systemPrompt(catalog)}</pre>}
        </section>

        <section className="pane">
          <div className="pane-title">沙箱渲染结果</div>
          <div className="preview" data-testid="preview">
            <TesseraView
              key={viewKey}
              program={program}
              catalog={catalog}
              components={components}
              createWorker={createWorker}
              onAction={onAction}
              onIssue={onIssue}
              fallback={<p className="muted">正在启动沙箱…</p>}
            />
          </div>
          <div className="counters">
            <span>
              模型调用 <b data-testid="model-calls">{sends}</b> 次
            </span>
            <span className="muted">拖动、勾选都在沙箱里完成；只有 ui.send 会产生一次新的模型调用。</span>
          </div>
          <ol className="log" data-testid="log">
            {log.length === 0 && <li className="muted">（还没有动作或运行时问题）</li>}
            {log.map((e) => (
              <li key={e.id} className={e.kind}>
                {e.text}
              </li>
            ))}
          </ol>
        </section>
      </main>
    </div>
  );
}
