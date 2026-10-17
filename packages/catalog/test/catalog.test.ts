import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { defineCatalog, defineComponent, eventNameFor, tagFor } from '../src/index';

describe('catalog', () => {
  const catalog = defineCatalog();

  it('always includes the Markdown components', () => {
    expect(catalog.names()).toEqual(expect.arrayContaining(['Title', 'Text', 'Bold', 'List', 'ListItem', 'Slider', 'Box']));
  });

  it('maps names to custom element tags and event names', () => {
    expect(tagFor('Slider')).toBe('tessera-slider');
    expect(tagFor('ListItem')).toBe('tessera-list-item');
    expect(eventNameFor('onValueChange')).toBe('valuechange');
    expect(catalog.byTag('tessera-list-item')?.name).toBe('ListItem');
  });

  it('checks prop values against the zod schema', () => {
    expect(catalog.checkProp('Slider', 'max', 50)).toBeNull();
    expect(catalog.checkProp('Slider', 'max', '50')?.code).toBe('invalid_value');
    expect(catalog.checkProp('Slider', 'fill', 'red')?.code).toBe('unknown_prop');
    expect(catalog.checkProp('Box', 'gap', 99)?.code).toBe('invalid_value');
    expect(catalog.checkProp('Slider', 'onChange', () => {})).toBeNull();
    expect(catalog.checkProp('Slider', 'onChange', 'setSeats')?.code).toBe('invalid_value');
    expect(catalog.checkProp('Slider', 'label', undefined)).toBeNull();
  });

  it('describes components for the system prompt', () => {
    const text = catalog.describe();
    expect(text).toContain('<Slider min: number, max: number, step?: number(0..), value: number, label?: string, onChange: (value) => void>');
    expect(text).toContain('<Box direction?: "column" | "row"');
  });

  it('wires only serialisable data to the worker', () => {
    const slider = catalog.wire().find((w) => w.name === 'Slider');
    expect(slider).toEqual({
      name: 'Slider',
      tag: 'tessera-slider',
      props: ['min', 'max', 'step', 'value', 'label'],
      events: [{ prop: 'onChange', event: 'change' }],
    });
    expect(() => structuredClone(catalog.wire())).not.toThrow();
  });

  it('rejects bad definitions', () => {
    expect(() => defineComponent({ name: 'slider', description: '' })).toThrow();
    expect(() => defineComponent({ name: 'X', description: '', events: ['change'] })).toThrow();
    expect(() => defineCatalog([defineComponent({ name: 'X', description: '', props: z.object({}) }), defineComponent({ name: 'X', description: '' })])).toThrow();
  });
});
