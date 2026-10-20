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

  it('spells out array elements and object fields in the description', () => {
    const files = defineComponent({
      name: 'Files',
      description: 'Changed files.',
      props: z.object({
        files: z.array(z.object({ path: z.string(), count: z.number().int().min(0).optional() })),
        tags: z.array(z.enum(['a', 'b'])).optional(),
      }),
    });
    const text = defineCatalog([files]).describe();
    expect(text).toContain('<Files files: { path: string, count?: number(0..) }[], tags?: ("a" | "b")[]>');
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

  it('lets resolver components receive a server result the model never writes', () => {
    const image = catalog.get('Image')!;
    expect(image.resolver).toBe('image');
    expect(catalog.wire().find((w) => w.name === 'Image')!.props).toEqual(['query', 'alt', 'aspect', 'resolved']);
    expect(catalog.checkProp('Image', 'resolved', { url: 'data:image/svg+xml,…' })).toBeNull();
    expect(catalog.checkProp('Slider', 'resolved', 1)?.code).toBe('unknown_prop');
    expect(catalog.describe()).not.toContain('resolved');
    expect(() => defineComponent({ name: 'X', description: '', props: z.object({ resolved: z.string() }) })).toThrow(/reserved/);
  });

  it('renders starter components as Markdown fallbacks', () => {
    expect(catalog.get('Slider')!.fallback!({ label: '席位', value: 8, min: 1, max: 50 }, '')).toBe('席位: 8 (1–50)');
    expect(catalog.get('Checkbox')!.fallback!({ label: '帐篷', checked: true }, '')).toBe('- [x] 帐篷');
    expect(catalog.get('Image')!.fallback!({ query: 'a cat', resolved: { url: 'https://x/cat.png' } }, '')).toBe('![a cat](https://x/cat.png)');
    expect(catalog.get('Image')!.fallback!({ query: 'a cat' }, '')).toBe('*[image: a cat]*');
  });

  it('rejects bad definitions', () => {
    expect(() => defineComponent({ name: 'slider', description: '' })).toThrow();
    expect(() => defineComponent({ name: 'X', description: '', events: ['change'] })).toThrow();
    expect(() => defineCatalog([defineComponent({ name: 'X', description: '', props: z.object({}) }), defineComponent({ name: 'X', description: '' })])).toThrow();
  });
});
