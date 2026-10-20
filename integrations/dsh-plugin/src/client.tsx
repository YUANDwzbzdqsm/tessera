import { compile } from '@tessera/lang';
import type { Action } from '@tessera/runtime';
import { iframeSandbox, TesseraView, type SandboxFactory } from '@tessera/react';
import workerSource from '@tessera/runtime/sandbox-worker.js?raw';
import { useEffect, useMemo, useRef, useState } from 'react';
import { components } from '../../../demo/src/components';
import componentsCss from '../../../demo/src/components.css?inline';
import { catalog, finalSource, NODE_KIND, partialSource, resultData, TOOL_NAME } from './shared';
import { resultTelemetry } from './telemetry';
import themeCss from './theme.css?inline';
import { instrument, setEndpoint, ViewTracker } from './track';

// Browser half of dsh-plugin-tessera. A Conversation Definition follows each render_ui call from its first streamed
// argument chunk to the complete tool/call event and then its own tool/result, which carries the tool data the host
// resolved; a keyed Chat renderer draws the source with that data in TesseraView.
// Only the harness contracts this file touches are typed here; nothing from the harness is imported.

interface SessionEventLike {
  readonly type: string;
  readonly seq: number;
  readonly data: any;
}

interface Match {
  readonly event: SessionEventLike;
}

interface NodeContext<State> {
  readonly key: string;
  readonly id: string;
  readonly state: State | undefined;
  readonly start?: Match;
  readonly matches: readonly Match[];
  readonly current: ReadonlyMap<string, ChatNode | null | undefined>;
}

interface UiState {
  /** Raw JSON argument text streamed so far; empty once the complete call has arrived. */
  readonly args: string;
  readonly source: string | null;
  /** The complete tool/call has arrived; later deltas can no longer change the source. */
  readonly final: boolean;
  /** render_ui's own tool/result has arrived, so `data` is all the tool data this call will get. */
  readonly settled?: boolean;
  /** Tool results by name, from the result's metadata. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** The stats collector's URL, from the result's metadata while the host runs one. */
  readonly telemetry?: string;
}

export interface UiNodeData {
  readonly callId: string;
  readonly source: string;
  readonly final: boolean;
  readonly settled: boolean;
  readonly data?: Readonly<Record<string, unknown>>;
  readonly telemetry?: string;
}

interface ChatNode {
  readonly key: string;
  readonly kind: string;
  readonly id: string;
  readonly target: 'chat';
  readonly anchorSeq: number;
  readonly location: unknown;
  readonly visibility: 'visible' | 'hidden';
  readonly data: UiNodeData;
}

// Only the first delta of a call carries its name. Ids of render_ui calls seen while streaming let the unnamed
// deltas that follow join the same Context; live deltas always arrive in order, and history replays the complete
// tool/call instead of deltas, so this stays small and never needs to be rebuilt.
const streaming = new Set<string>();

// Ids of render_ui calls whose tool/call was matched, so their results join the same Context even when they carry no
// data. A result with data is recognised by its metadata alone: in a history window that starts between a call and
// its result, the result arrives first, and the assembler orders the call before it once a prepend loads it.
const calls = new Set<string>();

const EMPTY: UiState = { args: '', source: null, final: false };

function fold(state: UiState | undefined, event: SessionEventLike): UiState {
  if (event.type === 'tool/result') return { ...(state ?? EMPTY), settled: true, data: resultData(event.data), telemetry: resultTelemetry(event.data) };
  if (event.type === 'tool/call') return { ...state, args: '', source: finalSource(event.data.arguments), final: true };
  if (state?.final) return state;
  const args = (state?.args ?? '') + String(event.data.chunk.argumentsDelta ?? '');
  return { args, source: partialSource(args), final: false };
}

// The row sits at Session level: rows the Chat grouping does not know are folded into the Turn's collapsed
// "worked for …" process group, and an interface the user is meant to use must stay visible. A Session-level row
// anchored at the call still renders at that point of the Turn and splits the process group around it.
const SESSION_LOCATION = { kind: 'session' } as const;

export const definition = {
  kind: NODE_KIND,
  target: 'chat',
  match(event: SessionEventLike) {
    if (event.type === 'assistant/live-chunk') {
      const chunk = event.data?.chunk;
      if (chunk?.type !== 'tool-call-delta') return null;
      const id = String(chunk.id);
      if (chunk.name) {
        if (chunk.name !== TOOL_NAME) return null;
        streaming.add(id);
        return { id, role: 'start' as const };
      }
      return streaming.has(id) ? { id, role: 'update' as const } : null;
    }
    if (event.type === 'tool/call' && event.data?.name === TOOL_NAME) {
      const id = String(event.data.callId);
      streaming.delete(id);
      calls.add(id);
      return { id, role: 'start' as const };
    }
    if (event.type === 'tool/result') {
      const id = event.data?.message?.toolCallId;
      if (typeof id !== 'string' || (!calls.has(id) && resultData(event.data) === undefined)) return null;
      return { id, role: 'update' as const };
    }
    return null;
  },
  start: (_context: NodeContext<UiState>, match: Match) => fold(undefined, match.event),
  update: (context: NodeContext<UiState>, match: Match) => fold(context.state, match.event),
  publication: (match: Match) => (match.event.type === 'assistant/live-chunk' ? 'animation-frame' : 'immediate'),
  buildViewNode(context: NodeContext<UiState>): ChatNode | null {
    const current = context.current.get('chat') ?? null;
    const state = context.state;
    // Until the source key arrives there is nothing to draw; a row already shown is hidden, never withdrawn.
    if (state === undefined || state.source === null) {
      return current === null ? null : current.visibility === 'hidden' ? current : { ...current, visibility: 'hidden' };
    }
    const anchorSeq = context.start?.event.seq ?? context.matches[0]?.event.seq ?? 0;
    const settled = state.settled === true;
    if (current && current.visibility === 'visible' && current.anchorSeq === anchorSeq && current.data.source === state.source
      && current.data.final === state.final && current.data.settled === settled && current.data.data === state.data
      && current.data.telemetry === state.telemetry) return current;
    return {
      key: context.key,
      kind: NODE_KIND,
      id: context.id,
      target: 'chat',
      anchorSeq,
      location: SESSION_LOCATION,
      visibility: 'visible',
      data: {
        callId: context.id,
        source: state.source,
        final: state.final,
        settled,
        ...(state.data ? { data: state.data } : {}),
        ...(state.telemetry ? { telemetry: state.telemetry } : {}),
      },
    };
  },
};

// ---- rendering ----

let sandboxFactory: SandboxFactory | null = null;

/** One factory for every row: each TesseraView still starts its own iframe and worker from it. */
function sandbox(): SandboxFactory {
  sandboxFactory ??= iframeSandbox({
    workerUrl: URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' })),
  });
  return sandboxFactory;
}

interface InputSnapshot {
  readonly draft: string;
  readonly attachmentIds: readonly unknown[];
  readonly phase: string;
}

interface NodeViewProps {
  readonly node: { readonly data: UiNodeData };
  readonly sessionId?: string;
  readonly inputActions?: { setDraft(text: string): void; submit(): void };
  readonly useInput?: <S>(select: (input: InputSnapshot) => S) => S;
}

const STATE_PREFIX = 'dsh-plugin-tessera:';

function readState(key: string): Record<string, unknown> | undefined {
  try {
    const raw = localStorage.getItem(STATE_PREFIX + key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function writeState(key: string, state: Readonly<Record<string, unknown>>): void {
  try {
    localStorage.setItem(STATE_PREFIX + key, JSON.stringify(state));
  } catch {
    // Storage may be full or blocked; the interface still works, it just starts fresh next time.
  }
}

const composerIsEmpty = (input: InputSnapshot | undefined) =>
  !input || (input.draft.trim() === '' && input.attachmentIds.length === 0 && input.phase === 'plain');

export function TesseraNodeView({ node, sessionId = '', inputActions, useInput }: NodeViewProps) {
  const { callId, source, final, settled, data, telemetry } = node.data;
  // Names bound to tool data render once the result brings the data; until then they are only missing values.
  const program = useMemo(() => compile(source, { catalog, data }), [source, data]);
  const errors = settled ? program.diagnostics.filter((d) => d.severity === 'error').length : 0;
  const stateKey = `${sessionId}:${callId}`;
  const initialState = useMemo(() => readState(stateKey), [stateKey]);

  // Telemetry: what this interface is made of, what of it was on screen, and what the user did with it.
  const tracker = useMemo(() => new ViewTracker(sessionId, callId, initialState), [sessionId, callId, initialState]);
  const tracked = useMemo(() => instrument(components, tracker), [tracker]);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tracker.start();
    const unobserve = root.current ? tracker.observe(root.current, null, null) : undefined;
    return () => {
      unobserve?.();
      tracker.stop();
    };
  }, [tracker]);
  useEffect(() => setEndpoint(telemetry), [telemetry]);
  useEffect(() => {
    if (settled) tracker.generated(program, source.length);
  }, [tracker, settled, program, source]);

  // ui.send types into the user's composer and submits, so it must never send what the user is typing.
  const empty = useInput ? useInput((input) => composerIsEmpty(input)) : true;
  const emptyRef = useRef(empty);
  emptyRef.current = empty;
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (empty) setNotice(null);
  }, [empty]);

  const onAction = (action: Action) => {
    tracker.action(action);
    if (action.type === 'send') {
      if (!inputActions) return;
      if (!emptyRef.current) {
        setNotice('输入框里还有没发出的内容。先发送或清空它，再点一次。');
        return;
      }
      setNotice(null);
      inputActions.setDraft(action.text);
      inputActions.submit();
    } else if (action.type === 'copy') {
      void navigator.clipboard?.writeText(action.text).catch(() => undefined);
    } else if (/^https?:\/\//i.test(action.url)) {
      window.open(action.url, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="tessera-ui" data-streaming={final ? undefined : ''} ref={root}>
      <TesseraView
        program={program}
        catalog={catalog}
        components={tracked}
        sandbox={sandbox()}
        initialState={initialState}
        onStateChange={(state) => {
          writeState(stateKey, state);
          tracker.state(state);
        }}
        onAction={onAction}
        onIssue={(issue) => tracker.issue(issue.code)}
        fallback={<div className="tessera-ui-wait">正在准备界面…</div>}
      />
      {notice && (
        <div className="tessera-ui-notice" role="status">
          {notice}
        </div>
      )}
      {errors > 0 && <div className="tessera-ui-issues">界面里有 {errors} 处写法有误，已略过。</div>}
    </div>
  );
}

// ---- plugin ----

interface ClientContext {
  effect(setup: () => () => void): void;
  uiConversation: { events: { register(definition: unknown): unknown } };
  slots: {
    inject(name: string, register: () => unknown): void;
    register(entry: { name: string; key: string }, component: unknown): unknown;
  };
}

export const name = 'tessera-ui';
export const inject = ['uiConversation', 'slots'];

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style');
    style.dataset.dshPluginTessera = '';
    style.textContent = themeCss + '\n' + componentsCss;
    document.head.append(style);
    return () => style.remove();
  });
  ctx.uiConversation.events.register(definition);
  ctx.slots.inject('conversation.chat.node', () =>
    ctx.slots.register({ name: 'conversation.chat.node', key: NODE_KIND }, TesseraNodeView),
  );
}
