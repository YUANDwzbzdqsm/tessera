import { NODE_TYPE_ELEMENT, NODE_TYPE_TEXT } from '@remote-dom/core';
import type {
  RemoteReceiver,
  RemoteReceiverElement,
  RemoteReceiverNode,
  RemoteReceiverParent,
  RemoteReceiverRoot,
  RemoteReceiverText,
} from '@remote-dom/core/receivers';
import { eventNameFor, type Catalog, type PropIssue } from '@tessera/catalog';
import { useCallback, useEffect, useSyncExternalStore, type ComponentType, type ReactNode } from 'react';

/** Your implementation of each catalog component, by catalog name. */
export type TesseraComponents = Readonly<Record<string, ComponentType<any>>>;

export type HostIssue =
  | { readonly source: 'host'; readonly code: 'missing_component' | 'unknown_element'; readonly message: string }
  | ({ readonly source: 'host' } & PropIssue);

interface TreeContext {
  readonly receiver: RemoteReceiver;
  readonly catalog: Catalog;
  readonly components: TesseraComponents;
  readonly report: (issue: HostIssue) => void;
}

/** Re-renders when this one node changes. remote-dom notifies per node, so each node subscribes for itself. */
function useRemoteNode<T extends RemoteReceiverNode | RemoteReceiverRoot>(receiver: RemoteReceiver, node: T): T {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const abort = new AbortController();
      receiver.subscribe({ id: node.id }, onChange, { signal: abort.signal });
      return () => abort.abort();
    },
    [receiver, node.id],
  );
  const version = () => receiver.get<T>({ id: node.id })?.version ?? -1;
  useSyncExternalStore(subscribe, version, version);
  return receiver.get<T>({ id: node.id }) ?? node;
}

export function RemoteChildren({ parent, ctx }: { parent: RemoteReceiverParent; ctx: TreeContext }): ReactNode {
  const current = useRemoteNode(ctx.receiver, parent);
  return current.children.map((child) => {
    if (child.type === NODE_TYPE_TEXT) return <RemoteText key={child.id} node={child} ctx={ctx} />;
    if (child.type === NODE_TYPE_ELEMENT) return <RemoteElement key={child.id} node={child} ctx={ctx} />;
    return null;
  });
}

function RemoteText({ node, ctx }: { node: RemoteReceiverText; ctx: TreeContext }): ReactNode {
  return useRemoteNode(ctx.receiver, node).data;
}

/**
 * Draws one remote element with the host's component. Props are checked against the catalog again here:
 * the worker is untrusted, so the host never relies on the compiler alone.
 */
function RemoteElement({ node, ctx }: { node: RemoteReceiverElement; ctx: TreeContext }): ReactNode {
  const current = useRemoteNode(ctx.receiver, node);
  const spec = ctx.catalog.byTag(current.element);
  const issues: HostIssue[] = [];
  let rendered: ReactNode = null;

  if (!spec) {
    issues.push({ source: 'host', code: 'unknown_element', message: `Element <${current.element}> is not in the catalog` });
  } else {
    // The runtime sends all declared props as one `props` object; a prop that was removed is a missing key.
    const raw = current.properties.props;
    const incoming = raw !== null && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const props: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(incoming)) {
      const issue = ctx.catalog.checkProp(spec.name, key, value);
      if (issue) issues.push({ source: 'host', ...issue });
      else if (value !== undefined) props[key] = value;
    }
    for (const prop of spec.events) {
      const listener = current.eventListeners[eventNameFor(prop)];
      // The call crosses into the sandbox. If the watchdog replaces a stuck sandbox, the pending call is
      // rejected; there is nothing to recover, so it must not surface as an unhandled rejection.
      if (listener) props[prop] = (value: unknown) => void Promise.resolve(listener(value)).catch(() => undefined);
    }
    const children = spec.children === 'none' ? undefined : <RemoteChildren parent={current} ctx={ctx} />;
    const Component = ctx.components[spec.name];
    if (Component) {
      rendered = <Component {...props}>{children}</Component>;
    } else {
      issues.push({ source: 'host', code: 'missing_component', message: `No host component registered for ${spec.name}` });
      rendered = children ?? null;
    }
  }

  const issueKey = issues.map((i) => i.code + i.message).join('|');
  useEffect(() => {
    for (const issue of issues) ctx.report(issue);
    // Report each distinct set of issues once, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issueKey]);

  return rendered;
}

export type { TreeContext };
