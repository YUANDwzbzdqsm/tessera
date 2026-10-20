import { MUTATION_TYPE_INSERT_CHILD, NODE_TYPE_ELEMENT, NODE_TYPE_TEXT, ROOT_ID } from '@remote-dom/core';
import { RemoteReceiver } from '@remote-dom/core/receivers';
import { defineCatalog, tagFor } from '@tessera/catalog';
import { createElement, type ReactNode } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { RemoteChildren, siteOf, useTesseraSite } from '../src/RemoteTree';

const catalog = defineCatalog();

/** Draws a receiver whose tree is a Box with a Badge inside, carrying the given sites. */
function draw(boxSite: unknown, badgeSite: unknown) {
  const receiver = new RemoteReceiver();
  receiver.connection.mutate([
    [
      MUTATION_TYPE_INSERT_CHILD,
      ROOT_ID,
      {
        id: '1',
        type: NODE_TYPE_ELEMENT,
        element: tagFor('Box'),
        properties: { props: { border: true }, site: boxSite },
        children: [
          {
            id: '2',
            type: NODE_TYPE_ELEMENT,
            element: tagFor('Badge'),
            properties: { props: { tone: 'info' }, site: badgeSite },
            children: [{ id: '3', type: NODE_TYPE_TEXT, data: 'new' }],
          },
        ],
      },
      0,
    ],
  ]);
  const seen: { component: string; site: string | null; props: Record<string, unknown> }[] = [];
  const recorder =
    (component: string) =>
    ({ children, ...props }: { children?: ReactNode }) => {
      seen.push({ component, site: useTesseraSite(), props });
      return createElement('div', null, children);
    };
  const components = { Box: recorder('Box'), Badge: recorder('Badge') };
  renderToString(createElement(RemoteChildren, { parent: receiver.root, ctx: { receiver, catalog, components, report() {} } }));
  return seen;
}

describe('useTesseraSite', () => {
  it('gives each host component the site of the element it draws, outside its props', () => {
    expect(draw('0', '1:2')).toEqual([
      { component: 'Box', site: '0', props: { border: true } },
      { component: 'Badge', site: '1:2', props: { tone: 'info' } },
    ]);
  });

  it('ignores a site that is missing or malformed', () => {
    expect(draw(undefined, '1; drop table').map((s) => s.site)).toEqual([null, null]);
  });

  it('is null outside a Tessera view', () => {
    let site: string | null | undefined;
    const Probe = () => {
      site = useTesseraSite();
      return null;
    };
    renderToString(createElement(Probe));
    expect(site).toBeNull();
  });
});

describe('siteOf', () => {
  it('accepts the compiler’s formats and nothing else', () => {
    for (const ok of ['0', '42', '4:0', '4:1.0', '4:12.3.7']) expect(siteOf(ok)).toBe(ok);
    for (const bad of ['', '-1', '4:', '4:1.', 'a', ' 4', '4:1:2', 4, null, {}]) expect(siteOf(bad)).toBeNull();
  });
});
