import { release, retain } from '@quilted/threads';
import { RemoteReceiver } from '@remote-dom/core/receivers';
import type { Catalog } from '@tessera/catalog';
import type { Action, HostCallbacks, Program, RuntimeIssue } from '@tessera/runtime';
import type { SandboxConnection, SandboxFactory } from './sandbox';

export type ControllerIssueCode = 'sandbox_restarted' | 'sandbox_failed' | 'program_quarantined';

export type ControllerIssue =
  | ({ readonly source: 'runtime' } & RuntimeIssue)
  | { readonly source: 'host'; readonly code: ControllerIssueCode; readonly message: string };

export interface WatchdogOptions {
  /** A render that takes longer is treated as a hang: its program is quarantined and the sandbox replaced. */
  readonly renderTimeout?: number;
  /** How often the sandbox is pinged. A ping catches hangs that happen outside a render, e.g. in an event handler. */
  readonly heartbeatInterval?: number;
  readonly heartbeatTimeout?: number;
  readonly mountTimeout?: number;
  /** After this many restarts within `restartWindow` ms the controller gives up and reports sandbox_failed. */
  readonly maxRestarts?: number;
  readonly restartWindow?: number;
}

export interface ControllerOptions extends WatchdogOptions {
  readonly sandbox: SandboxFactory;
  readonly catalog: Catalog;
  readonly initialState?: Readonly<Record<string, unknown>>;
  readonly onAction?: (action: Action) => void;
  readonly onIssue?: (issue: ControllerIssue) => void;
  readonly onStateChange?: (state: Readonly<Record<string, unknown>>) => void;
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`${what} did not answer within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

interface Live {
  readonly conn: SandboxConnection;
  readonly receiver: RemoteReceiver;
  readonly generation: number;
}

/**
 * Owns the sandbox for one view: starts it, renders programs one at a time (newest wins), and replaces it when it
 * stops answering. All operations run on one queue, so a restart never races a render.
 *
 * - A render that times out quarantines that program's code; the replacement sandbox redraws the last program that
 *   rendered fine, with the last state that rendered fine.
 * - The tree on screen is only swapped once the replacement has rendered, so the last good frame stays visible.
 * - Callbacks from a replaced sandbox (late actions, issues or state) are ignored.
 */
export class SandboxController {
  readonly #options: ControllerOptions & Required<WatchdogOptions>;
  readonly #subscribers = new Set<() => void>();
  readonly #quarantined = new Set<string>();
  #live: Live | null = null;
  #shown: RemoteReceiver | null = null;
  #generation = 0;
  #queue: Promise<void> = Promise.resolve();
  #pending: Program | null = null;
  #flushQueued = false;
  #lastGood: Program | null = null;
  #state: Readonly<Record<string, unknown>>;
  #restarts: number[] = [];
  #running = false;
  #failed = false;
  #heartbeat: ReturnType<typeof setInterval> | undefined;

  constructor(options: ControllerOptions) {
    this.#options = {
      renderTimeout: 2000,
      heartbeatInterval: 2000,
      heartbeatTimeout: 1500,
      mountTimeout: 10_000,
      maxRestarts: 3,
      restartWindow: 60_000,
      ...options,
    };
    this.#state = { ...(options.initialState ?? {}) };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#subscribers.add(listener);
    return () => this.#subscribers.delete(listener);
  };

  /** The receiver whose tree should be drawn; replaced only after a new sandbox has rendered. */
  readonly getReceiver = (): RemoteReceiver | null => this.#shown;

  get state(): Readonly<Record<string, unknown>> {
    return this.#state;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    this.#failed = false;
    this.#enqueue(async () => {
      await this.#ensure();
    });
    this.#heartbeat = setInterval(() => this.#enqueue(() => this.#check()), this.#options.heartbeatInterval);
    if (this.#pending) this.#scheduleFlush();
  }

  /** Stops and discards the sandbox. A later start() boots a fresh one and redraws the pending program. */
  dispose(): void {
    this.#running = false;
    clearInterval(this.#heartbeat);
    this.#generation++;
    this.#kill();
    if (!this.#pending && this.#lastGood) this.#pending = this.#lastGood;
  }

  /** Queues a program. If several arrive before the sandbox is free, only the newest is rendered. */
  render(program: Program): void {
    this.#pending = program;
    if (this.#running) this.#scheduleFlush();
  }

  #scheduleFlush(): void {
    if (this.#flushQueued) return;
    this.#flushQueued = true;
    this.#enqueue(async () => {
      this.#flushQueued = false;
      await this.#flush();
    });
  }

  #enqueue(op: () => Promise<void>): void {
    this.#queue = this.#queue.then(op).catch((error: unknown) => {
      this.#issue('sandbox_failed', error instanceof Error ? error.message : String(error));
    });
  }

  async #flush(): Promise<void> {
    const program = this.#pending;
    if (!program) return;
    this.#pending = null;
    if (this.#quarantined.has(program.code)) {
      this.#issue('program_quarantined', 'This program hung the sandbox before; it is not rendered again. The last good frame stays on screen.');
      return;
    }
    const live = await this.#ensure();
    if (!live) {
      this.#pending ??= program;
      return;
    }
    await this.#renderOn(live, program, true);
  }

  async #ensure(): Promise<Live | null> {
    if (this.#live) return this.#live;
    if (!this.#running || this.#failed) return null;
    const generation = ++this.#generation;
    const receiver = new RemoteReceiver({ retain, release });
    const conn = await this.#options.sandbox();
    if (generation !== this.#generation || !this.#running) {
      conn.terminate();
      return null;
    }
    const current = () => generation === this.#generation;
    const callbacks: HostCallbacks = {
      action: (action) => {
        if (current()) this.#options.onAction?.(action);
      },
      issue: (issue) => {
        if (current()) this.#options.onIssue?.({ source: 'runtime', ...issue });
      },
      state: (snapshot) => {
        if (!current()) return;
        this.#state = snapshot;
        this.#options.onStateChange?.(snapshot);
      },
    };
    try {
      await withTimeout(
        conn.runtime.mount(receiver.connection, this.#options.catalog.wire(), callbacks, this.#state),
        this.#options.mountTimeout,
        'Sandbox start',
      );
    } catch (error) {
      conn.terminate();
      throw error;
    }
    if (!current()) {
      conn.terminate();
      return null;
    }
    this.#live = { conn, receiver, generation };
    return this.#live;
  }

  async #renderOn(live: Live, program: Program, quarantineOnTimeout: boolean): Promise<void> {
    try {
      const result = await withTimeout(
        live.conn.runtime.render({ code: program.code, constants: [...program.constants] }),
        this.#options.renderTimeout,
        'Render',
      );
      if (live.generation !== this.#generation) return;
      if (result.ok) {
        this.#lastGood = program;
        this.#show(live.receiver);
      }
    } catch (error) {
      if (live.generation !== this.#generation) return;
      if (!(error instanceof TimeoutError)) throw error;
      if (quarantineOnTimeout) this.#quarantined.add(program.code);
      await this.#restart(`render did not finish within ${this.#options.renderTimeout} ms${quarantineOnTimeout ? '; that program is quarantined' : ''}`);
    }
  }

  async #check(): Promise<void> {
    const live = this.#live;
    if (!live) return;
    try {
      await withTimeout(live.conn.runtime.ping(), this.#options.heartbeatTimeout, 'Heartbeat');
    } catch {
      if (live === this.#live) await this.#restart('it stopped answering');
    }
  }

  async #restart(reason: string): Promise<void> {
    this.#generation++;
    this.#kill();
    const now = Date.now();
    this.#restarts = this.#restarts.filter((t) => now - t < this.#options.restartWindow);
    this.#restarts.push(now);
    if (this.#restarts.length > this.#options.maxRestarts) {
      this.#failed = true;
      this.#issue('sandbox_failed', `The sandbox was restarted ${this.#options.maxRestarts} times within ${this.#options.restartWindow} ms; giving up`);
      return;
    }
    this.#issue('sandbox_restarted', `The sandbox was replaced because ${reason}. The last good state is restored.`);
    const live = await this.#ensure();
    if (live && this.#lastGood) await this.#renderOn(live, this.#lastGood, false);
  }

  #kill(): void {
    this.#live?.conn.terminate();
    this.#live = null;
  }

  #show(receiver: RemoteReceiver): void {
    if (this.#shown === receiver) return;
    this.#shown = receiver;
    for (const listener of this.#subscribers) listener();
  }

  #issue(code: ControllerIssueCode, message: string): void {
    this.#options.onIssue?.({ source: 'host', code, message });
  }
}
