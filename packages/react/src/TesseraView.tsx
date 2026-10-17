import { ThreadWebWorker, release, retain } from '@quilted/threads';
import { RemoteReceiver } from '@remote-dom/core/receivers';
import type { Catalog } from '@tessera/catalog';
import type { Action, Program, RuntimeApi, RuntimeIssue } from '@tessera/runtime';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { RemoteChildren, type HostIssue, type TesseraComponents, type TreeContext } from './RemoteTree';

export type TesseraIssue = HostIssue | ({ readonly source: 'runtime' } & RuntimeIssue);

export interface TesseraViewProps {
  /** A compiled program from @tessera/lang. A new program re-renders in place; state keyed by name is kept. */
  readonly program: Program;
  readonly catalog: Catalog;
  readonly components: TesseraComponents;
  /**
   * Creates the sandbox worker, e.g. `() => new Worker(new URL('./tessera.worker.ts', import.meta.url), { type: 'module' })`
   * where that file contains `import '@tessera/runtime/worker'`. Keep the function stable: a new one restarts the sandbox.
   */
  readonly createWorker: () => Worker;
  /** ui.send / ui.copy / ui.open from the program. Nothing leaves the sandbox unless you act on it here. */
  readonly onAction?: (action: Action) => void;
  readonly onIssue?: (issue: TesseraIssue) => void;
  /** Shown until the sandbox is ready. */
  readonly fallback?: ReactNode;
}

interface Session {
  readonly receiver: RemoteReceiver;
  readonly runtime: ReturnType<typeof ThreadWebWorker.import<RuntimeApi>>;
}

export function TesseraView({ program, catalog, components, createWorker, onAction, onIssue, fallback = null }: TesseraViewProps): ReactNode {
  const callbacks = useRef({ onAction, onIssue });
  callbacks.current = { onAction, onIssue };
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    const receiver = new RemoteReceiver({ retain, release });
    const worker = createWorker();
    const abort = new AbortController();
    const runtime = ThreadWebWorker.import<RuntimeApi>(worker, { signal: abort.signal });
    let alive = true;
    runtime
      .mount(receiver.connection, catalog.wire(), {
        action: (action) => callbacks.current.onAction?.(action),
        issue: (issue) => callbacks.current.onIssue?.({ source: 'runtime', ...issue }),
      })
      .then(
        () => {
          if (alive) setSession({ receiver, runtime });
        },
        (error: unknown) => {
          // A remount (e.g. React StrictMode) closes the first sandbox before it answers; that is expected.
          if (alive) callbacks.current.onIssue?.({ source: 'runtime', code: 'program_error', message: `Sandbox failed to start: ${String(error)}` });
        },
      );
    return () => {
      alive = false;
      setSession(null);
      abort.abort();
      worker.terminate();
    };
  }, [catalog, createWorker]);

  // While streaming, programs can arrive faster than the sandbox renders them. Render one at a time and,
  // when several are waiting, skip straight to the newest.
  const queue = useMemo(() => ({ pending: null as Program | null, busy: false }), [session]);
  useEffect(() => {
    // Empty code means nothing has been compiled yet (e.g. the first moment of a stream).
    if (!session || !program.code) return;
    queue.pending = program;
    if (queue.busy) return;
    queue.busy = true;
    void (async () => {
      while (queue.pending) {
        const next = queue.pending;
        queue.pending = null;
        await session.runtime.render({ code: next.code, constants: [...next.constants] }).catch(() => undefined);
      }
      queue.busy = false;
    })();
  }, [session, program, queue]);

  const ctx = useMemo<TreeContext | null>(
    () =>
      session && {
        receiver: session.receiver,
        catalog,
        components,
        report: (issue) => callbacks.current.onIssue?.(issue),
      },
    [session, catalog, components],
  );

  return ctx ? <RemoteChildren parent={ctx.receiver.root} ctx={ctx} /> : fallback;
}
