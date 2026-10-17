import type { Catalog } from '@tessera/catalog';
import type { Action, Program } from '@tessera/runtime';
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { SandboxController, type ControllerIssue, type WatchdogOptions } from './controller';
import { RemoteChildren, type HostIssue, type TesseraComponents, type TreeContext } from './RemoteTree';
import type { SandboxFactory } from './sandbox';

export type TesseraIssue = HostIssue | ControllerIssue;

export interface TesseraViewProps {
  /** A compiled program from @tessera/lang. A new program re-renders in place; state keyed by name is kept. */
  readonly program: Program;
  readonly catalog: Catalog;
  readonly components: TesseraComponents;
  /**
   * Where programs run: `iframeSandbox({ workerUrl })` (recommended) or `workerSandbox(createWorker)`.
   * Create it once, outside render: a new factory restarts the sandbox.
   */
  readonly sandbox: SandboxFactory;
  /** Seeds the keyed state when the sandbox starts, e.g. what onStateChange saved before a reload. Read once. */
  readonly initialState?: Readonly<Record<string, unknown>>;
  /** The JSON-safe keyed state after each repaint that changed it. Use it to persist the view or show it to the model. */
  readonly onStateChange?: (state: Readonly<Record<string, unknown>>) => void;
  /** ui.send / ui.copy / ui.open from the program. Nothing leaves the sandbox unless you act on it here. */
  readonly onAction?: (action: Action) => void;
  readonly onIssue?: (issue: TesseraIssue) => void;
  readonly watchdog?: WatchdogOptions;
  /** Shown until the first program has rendered. */
  readonly fallback?: ReactNode;
}

export function TesseraView({ program, catalog, components, sandbox, fallback = null, ...rest }: TesseraViewProps): ReactNode {
  const latest = useRef(rest);
  latest.current = rest;

  const controller = useMemo(
    () =>
      new SandboxController({
        sandbox,
        catalog,
        initialState: latest.current.initialState,
        ...latest.current.watchdog,
        onAction: (action) => latest.current.onAction?.(action),
        onIssue: (issue) => latest.current.onIssue?.(issue),
        onStateChange: (state) => latest.current.onStateChange?.(state),
      }),
    [sandbox, catalog],
  );

  useEffect(() => {
    controller.start();
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    // Empty code means nothing has been compiled yet (e.g. the first moment of a stream).
    if (program.code) controller.render(program);
  }, [controller, program]);

  const receiver = useSyncExternalStore(controller.subscribe, controller.getReceiver, controller.getReceiver);
  const ctx = useMemo<TreeContext | null>(
    () => receiver && { receiver, catalog, components, report: (issue) => latest.current.onIssue?.(issue) },
    [receiver, catalog, components],
  );

  return ctx ? <RemoteChildren parent={ctx.receiver.root} ctx={ctx} /> : fallback;
}
