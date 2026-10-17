import type { ComponentSpec } from '@tessera/catalog';
import type { RawAttr } from './tokenize';

/** A request for the server to resolve one component, e.g. find an image for a query. */
export interface Resolution {
  /** Where the result goes in the program's data table. Stable for the same component and literal props. */
  readonly key: string;
  readonly resolver: string;
  readonly component: string;
  /** The component's literal props. */
  readonly input: Readonly<Record<string, unknown>>;
}

export type Resolver = (input: Readonly<Record<string, unknown>>, resolution: Resolution) => Promise<unknown>;

/**
 * The resolution for an element of a resolver component, or a reason it cannot be resolved: a resolver needs its
 * input at compile time, so every prop must be a literal.
 */
export function resolutionFor(spec: ComponentSpec, attrs: readonly RawAttr[], literal: (source: string) => { value: unknown } | undefined): Resolution | { readonly dynamic: string } | null {
  if (!spec.resolver) return null;
  const input: Record<string, unknown> = {};
  for (const attr of attrs) {
    if (!(attr.name in spec.props.shape)) continue;
    if (attr.value.kind === 'string') input[attr.name] = attr.value.value;
    else if (attr.value.kind === 'bool') input[attr.name] = true;
    else {
      const lit = literal(attr.value.source);
      if (!lit) return { dynamic: attr.name };
      input[attr.name] = lit.value;
    }
  }
  const ordered = Object.fromEntries(Object.keys(input).sort().map((k) => [k, input[k]]));
  return { key: `resolve:${spec.resolver}:${hash(JSON.stringify([spec.name, ordered]))}`, resolver: spec.resolver, component: spec.name, input: ordered };
}

/** FNV-1a, 32 bit, as hex. Only needs to be stable and spread keys; it is not a security boundary. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export interface ResolveAllOptions {
  /** Per resolution, in milliseconds. A resolver that takes longer is abandoned. */
  readonly timeout?: number;
  readonly onError?: (resolution: Resolution, error: unknown) => void;
}

/**
 * Runs resolvers for the given resolutions in parallel and returns the results by key, ready to merge into a
 * program's data. Unknown resolvers, failures and timeouts are left out (the component shows its unresolved state).
 */
export async function resolveAll(
  resolutions: readonly Resolution[],
  resolvers: Readonly<Record<string, Resolver>>,
  { timeout = 5000, onError }: ResolveAllOptions = {},
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  await Promise.all(
    resolutions.map(async (r) => {
      const resolver = resolvers[r.resolver];
      if (!resolver) return;
      try {
        out[r.key] = await withTimeout(resolver(r.input, r), timeout);
      } catch (error) {
        onError?.(r, error);
      }
    }),
  );
  return out;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Resolver did not finish within ${ms} ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
