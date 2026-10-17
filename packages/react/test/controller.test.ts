import { defineCatalog } from '@tessera/catalog';
import type { HostCallbacks, Program, RenderResult } from '@tessera/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SandboxController, type ControllerIssue } from '../src/controller';
import type { SandboxConnection, SandboxFactory } from '../src/sandbox';

/** One fake sandbox instance: records what it was asked to do and can be told to hang. */
interface Fake {
  host?: HostCallbacks;
  initialState?: Readonly<Record<string, unknown>>;
  renders: string[];
  terminated: boolean;
  /** When set, every render and ping from now on never answers. */
  hung: boolean;
}

const never = <T>() => new Promise<T>(() => {});

function fakeSandbox(hangsOn: (code: string) => boolean = () => false) {
  const instances: Fake[] = [];
  const factory: SandboxFactory = async () => {
    const fake: Fake = { renders: [], terminated: false, hung: false };
    instances.push(fake);
    const runtime = {
      async mount(_connection: unknown, _wire: unknown, host: HostCallbacks, initialState?: Readonly<Record<string, unknown>>) {
        fake.host = host;
        fake.initialState = initialState;
      },
      render(program: Program): Promise<RenderResult> {
        fake.renders.push(program.code);
        if (fake.hung || hangsOn(program.code)) {
          fake.hung = true;
          return never();
        }
        return Promise.resolve({ ok: true });
      },
      ping(): Promise<'pong'> {
        return fake.hung ? never() : Promise.resolve('pong');
      },
    };
    return {
      runtime: runtime as unknown as SandboxConnection['runtime'],
      terminate() {
        fake.terminated = true;
      },
    };
  };
  return { factory, instances };
}

const program = (code: string): Program => ({ code, constants: [] });

describe('SandboxController', () => {
  let issues: ControllerIssue[];
  const codes = () => issues.map((i) => i.code);

  beforeEach(() => {
    vi.useFakeTimers();
    issues = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(hangsOn?: (code: string) => boolean, initialState?: Record<string, unknown>) {
    const sandbox = fakeSandbox(hangsOn);
    const actions: unknown[] = [];
    const states: unknown[] = [];
    const controller = new SandboxController({
      sandbox: sandbox.factory,
      catalog: defineCatalog(),
      initialState,
      onIssue: (i) => issues.push(i),
      onAction: (a) => actions.push(a),
      onStateChange: (s) => states.push(s),
    });
    return { controller, ...sandbox, actions, states };
  }

  it('renders only the newest of several queued programs', async () => {
    const { controller, instances } = setup();
    controller.start();
    controller.render(program('a'));
    controller.render(program('b'));
    controller.render(program('c'));
    await vi.advanceTimersByTimeAsync(0);
    expect(instances).toHaveLength(1);
    expect(instances[0]!.renders).toEqual(['c']);
    expect(controller.getReceiver()).not.toBeNull();
    controller.dispose();
  });

  it('passes the initial state to the sandbox and mirrors state changes', async () => {
    const { controller, instances, states } = setup(undefined, { seats: 9 });
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(instances[0]!.initialState).toEqual({ seats: 9 });
    instances[0]!.host!.state({ seats: 12 });
    expect(states).toEqual([{ seats: 12 }]);
    expect(controller.state).toEqual({ seats: 12 });
    controller.dispose();
  });

  it('quarantines a program whose render hangs, replaces the sandbox and redraws the last good one', async () => {
    const { controller, instances } = setup((code) => code === 'hang');
    controller.start();
    controller.render(program('good'));
    await vi.advanceTimersByTimeAsync(0);
    const shown = controller.getReceiver();
    instances[0]!.host!.state({ n: 2 });

    controller.render(program('hang'));
    await vi.advanceTimersByTimeAsync(1999);
    expect(instances).toHaveLength(1);
    expect(controller.getReceiver()).toBe(shown); // last good frame stays visible meanwhile
    await vi.advanceTimersByTimeAsync(1);

    expect(instances[0]!.terminated).toBe(true);
    expect(instances).toHaveLength(2);
    expect(instances[1]!.initialState).toEqual({ n: 2 });
    expect(instances[1]!.renders).toEqual(['good']);
    expect(controller.getReceiver()).not.toBe(shown);
    expect(codes()).toEqual(['sandbox_restarted']);

    controller.render(program('hang'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(instances[1]!.renders).toEqual(['good']);
    expect(codes()).toContain('program_quarantined');
    controller.dispose();
  });

  it('replaces a sandbox that stops answering the heartbeat, outside any render', async () => {
    const { controller, instances } = setup();
    controller.start();
    controller.render(program('good'));
    await vi.advanceTimersByTimeAsync(0);
    instances[0]!.host!.state({ count: 2 });
    instances[0]!.hung = true; // e.g. an event handler that never returns

    await vi.advanceTimersByTimeAsync(2000 + 1500);
    expect(instances).toHaveLength(2);
    expect(instances[1]!.initialState).toEqual({ count: 2 });
    expect(instances[1]!.renders).toEqual(['good']);
    expect(codes()).toEqual(['sandbox_restarted']);
    controller.dispose();
  });

  it('ignores actions, issues and state from a replaced sandbox', async () => {
    const { controller, instances, actions, states } = setup();
    controller.start();
    controller.render(program('good'));
    await vi.advanceTimersByTimeAsync(0);
    const old = instances[0]!.host!;
    instances[0]!.hung = true;
    await vi.advanceTimersByTimeAsync(3500);
    expect(instances).toHaveLength(2);

    old.action({ type: 'send', text: 'late' });
    old.state({ stale: true });
    old.issue({ code: 'render_error', message: 'late' });
    expect(actions).toEqual([]);
    expect(states).toEqual([]);
    expect(codes()).toEqual(['sandbox_restarted']);
    controller.dispose();
  });

  it('gives up after too many restarts', async () => {
    const { controller, instances } = setup(() => true);
    controller.start();
    controller.render(program('always-hangs'));
    // The first render hangs and is quarantined (restart 1). There is no good program to redraw, so each
    // replacement is idle; make every instance hang so the heartbeat keeps replacing it.
    await vi.advanceTimersByTimeAsync(2000);
    for (let i = 0; i < 6; i++) {
      for (const fake of instances) fake.hung = true;
      await vi.advanceTimersByTimeAsync(3500);
    }
    expect(codes().filter((c) => c === 'sandbox_restarted')).toHaveLength(3);
    expect(codes().at(-1)).toBe('sandbox_failed');
    const count = instances.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(instances).toHaveLength(count);
    controller.dispose();
  });

  it('survives a dispose/start cycle (React StrictMode) and redraws the pending program', async () => {
    const { controller, instances } = setup();
    controller.start();
    controller.render(program('p'));
    controller.dispose();
    controller.start();
    await vi.advanceTimersByTimeAsync(0);
    const live = instances.filter((f) => !f.terminated);
    expect(live).toHaveLength(1);
    expect(live[0]!.renders).toEqual(['p']);
    controller.dispose();
    expect(instances.every((f) => f.terminated)).toBe(true);
  });
});
