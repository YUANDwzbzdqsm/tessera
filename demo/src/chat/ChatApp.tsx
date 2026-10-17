import type { Diagnostic } from '@tessera/lang';
import { TesseraView, iframeSandbox, useTesseraStream } from '@tessera/react';
import type { Action, Program } from '@tessera/runtime';
import sandboxWorkerUrl from '@tessera/runtime/sandbox-worker.js?url';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { catalog } from '../catalog';
import { components } from '../components';

// A minimal chatbot on Tessera: each answer streams from /api/chat (DeepSeek behind the dev server) and renders in
// its own sandboxed view. Buttons that call ui.send() post a new message, like ChatGPT's follow-up actions.

const sandbox = iframeSandbox({ workerUrl: sandboxWorkerUrl });
const STORE_KEY = 'tessera-chat';
const MAX_TURNS = 60;

interface UserTurn {
  readonly id: string;
  readonly role: 'user';
  readonly text: string;
}
interface AssistantTurn {
  readonly id: string;
  readonly role: 'assistant';
  /** The Tessera source the model wrote: shown on demand and sent back as history. */
  readonly text: string;
  readonly program: Program;
  readonly diagnostics: readonly Diagnostic[];
  /** What the user left in the interface, so a reload restores it. */
  readonly state?: Readonly<Record<string, unknown>>;
  readonly error?: string;
  readonly stopped?: boolean;
}
type Turn = UserTurn | AssistantTurn;

const SUGGESTIONS = [
  '帮我算房贷：贷款金额、年利率、年限都能调，显示月供和总利息',
  '下周去露营两天，给我一个可以勾选的行李清单',
  '给我看看小熊猫长什么样，再讲三个有趣的事实',
  '出两道太阳系的选择题，点了告诉我对错',
  '用三句话说清楚 TCP 和 UDP 的区别',
];

const uid = () => Math.random().toString(36).slice(2, 10);

function load(): Turn[] {
  try {
    const turns = JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]') as Turn[];
    return Array.isArray(turns) ? turns : [];
  } catch {
    return [];
  }
}

function store(turns: readonly Turn[]) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(turns.slice(-MAX_TURNS)));
  } catch {
    // Storage full or blocked: the conversation just won't survive a reload.
  }
}

export function ChatApp() {
  const [turns, setTurns] = useState<Turn[]>(load);
  const [draft, setDraft] = useState('');
  const [liveId, setLiveId] = useState<string | null>(null);
  const stream = useTesseraStream();
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  const liveProgram = useMemo<Program>(
    () => ({ code: stream.doc.code, constants: stream.doc.constants, data: stream.doc.data }),
    [stream.doc.code, stream.doc.constants, stream.doc.data],
  );

  useEffect(() => store(turns), [turns]);

  // When the stream ends (done, stopped or failed), its last document becomes the turn's permanent program.
  useEffect(() => {
    if (!liveId || stream.status === 'streaming' || stream.status === 'idle') return;
    const doc = stream.doc;
    setTurns((ts) =>
      ts.map((t) =>
        t.id === liveId && t.role === 'assistant'
          ? {
              ...t,
              text: doc.text,
              program: { code: doc.code, constants: doc.constants, data: doc.data },
              diagnostics: doc.diagnostics,
              error: stream.status === 'error' ? stream.error ?? '请求失败' : undefined,
              stopped: stream.status === 'stopped',
            }
          : t,
      ),
    );
    setLiveId(null);
  }, [liveId, stream.status, stream.doc, stream.error]);

  // Follow the answer while it grows.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [turns.length, stream.doc.text.length]);

  const send = (text: string) => {
    const content = text.trim();
    if (!content || liveId) return;
    const user: UserTurn = { id: uid(), role: 'user', text: content };
    const assistant: AssistantTurn = { id: uid(), role: 'assistant', text: '', program: { code: '', constants: [] }, diagnostics: [] };
    const history = [...turns, user].filter((t) => t.text.trim()).map((t) => ({ role: t.role, content: t.text }));
    setTurns((ts) => [...ts, user, assistant]);
    setLiveId(assistant.id);
    setDraft('');
    void stream.start((signal) =>
      fetch('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ messages: history }), signal }),
    );
  };

  const onAction = (action: Action) => {
    if (action.type === 'send') send(action.text);
    else if (action.type === 'copy') void navigator.clipboard?.writeText(action.text).catch(() => undefined);
    else if (/^https:\/\//.test(action.url)) window.open(action.url, '_blank', 'noopener,noreferrer');
  };

  const saveState = (id: string, state: Readonly<Record<string, unknown>>) =>
    setTurns((ts) => ts.map((t) => (t.id === id && t.role === 'assistant' ? { ...t, state } : t)));

  const reset = () => {
    stream.reset();
    setLiveId(null);
    setTurns([]);
    input.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send(draft);
    }
  };

  return (
    <div className="chat">
      <header className="chat-top">
        <div>
          <h1>Tessera × DeepSeek</h1>
          <p>模型写 Tessera 标记，边写边编译，在沙箱里渲染成可交互的界面。</p>
        </div>
        <div className="chat-top-actions">
          <a href="./">编辑器演示</a>
          <button type="button" onClick={reset} disabled={!turns.length}>
            新对话
          </button>
        </div>
      </header>

      <main className="chat-log" aria-live="polite">
        {!turns.length && (
          <div className="chat-empty">
            <p>试试这些：</p>
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t) =>
          t.role === 'user' ? (
            <div key={t.id} className="msg msg-user">
              {t.text}
            </div>
          ) : (
            <AssistantMessage
              key={t.id}
              turn={t}
              live={t.id === liveId}
              program={t.id === liveId ? liveProgram : t.program}
              text={t.id === liveId ? stream.doc.text : t.text}
              diagnostics={t.id === liveId ? stream.doc.diagnostics : t.diagnostics}
              onAction={onAction}
              onStateChange={(state) => saveState(t.id, state)}
            />
          ),
        )}
        <div ref={bottom} />
      </main>

      <footer className="chat-compose">
        <textarea
          ref={input}
          value={draft}
          rows={2}
          placeholder="问点什么，Enter 发送，Shift+Enter 换行"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          autoFocus
        />
        {liveId ? (
          <button type="button" className="secondary" onClick={stream.stop}>
            停止
          </button>
        ) : (
          <button type="button" className="primary" onClick={() => send(draft)} disabled={!draft.trim()}>
            发送
          </button>
        )}
      </footer>
    </div>
  );
}

function AssistantMessage({
  turn,
  live,
  program,
  text,
  diagnostics,
  onAction,
  onStateChange,
}: {
  turn: AssistantTurn;
  live: boolean;
  program: Program;
  text: string;
  diagnostics: readonly Diagnostic[];
  onAction: (a: Action) => void;
  onStateChange: (state: Readonly<Record<string, unknown>>) => void;
}) {
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  return (
    <div className="msg msg-assistant">
      {program.code ? (
        <TesseraView
          program={program}
          catalog={catalog}
          components={components}
          sandbox={sandbox}
          initialState={turn.state}
          onStateChange={onStateChange}
          onAction={onAction}
          fallback={<p className="muted">正在启动沙箱…</p>}
        />
      ) : live ? (
        <p className="typing" aria-label="正在思考">
          <span />
          <span />
          <span />
        </p>
      ) : null}
      {turn.error && !live && <p className="msg-error">出错了：{turn.error}</p>}
      {turn.stopped && !live && <p className="muted">（已停止）</p>}
      {text && !live && (
        <details className="msg-source">
          <summary>
            源码 · {text.length} 字{diagnostics.length ? ` · ${diagnostics.length} 条诊断${errors ? `（${errors} 条丢弃了内容）` : ''}` : ''}
          </summary>
          {diagnostics.length > 0 && (
            <ul>
              {diagnostics.map((d, i) => (
                <li key={i} className={d.severity === 'error' ? 'diag-error' : 'diag-warn'}>
                  {d.code}：{d.message}
                </li>
              ))}
            </ul>
          )}
          <pre>{text}</pre>
        </details>
      )}
    </div>
  );
}
