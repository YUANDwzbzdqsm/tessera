import { z } from 'zod';

/**
 * What a component accepts between its tags.
 * - `none`: nothing (Slider, Divider)
 * - `inline`: a single run of text, expressions and inline components (Button, Title)
 * - `block`: Markdown blocks and other components (Box, the root)
 */
export type ChildrenKind = 'none' | 'inline' | 'block';

/**
 * Renders a component as Markdown for clients that cannot run programs. `children` is the already-rendered
 * Markdown of its children (blocks joined by blank lines, or one inline run).
 */
export type FallbackRenderer = (props: Readonly<Record<string, unknown>>, children: string) => string;

export interface ComponentSpec {
  /** PascalCase name the model writes, e.g. `Slider`. */
  readonly name: string;
  readonly description: string;
  readonly props: z.ZodObject<z.ZodRawShape>;
  /** Function-valued props, e.g. `onChange`. The host calls them with one argument. */
  readonly events: readonly string[];
  readonly children: ChildrenKind;
  /**
   * Names a server-side resolver, e.g. `image`. The model writes literal props (say a search query); the server
   * runs the resolver on them and the result reaches the component as its `resolved` prop. The model never
   * writes `resolved` itself.
   */
  readonly resolver?: string;
  readonly fallback?: FallbackRenderer;
}

export interface ComponentInput {
  name: string;
  description: string;
  props?: z.ZodObject<z.ZodRawShape>;
  events?: readonly string[];
  children?: ChildrenKind;
  resolver?: string;
  fallback?: FallbackRenderer;
}

/** The prop through which a resolver's result reaches a component. */
export const RESOLVED_PROP = 'resolved';

/** The serialisable part of a component spec, sent to the sandbox worker. */
export interface ComponentWire {
  readonly name: string;
  readonly tag: string;
  readonly props: readonly string[];
  readonly events: readonly { readonly prop: string; readonly event: string }[];
}

export type PropIssueCode = 'unknown_prop' | 'invalid_value';

export interface PropIssue {
  readonly code: PropIssueCode;
  readonly component: string;
  readonly prop: string;
  readonly message: string;
}

const NAME = /^[A-Z][A-Za-z0-9]*$/;
const EVENT = /^on[A-Z][A-Za-z0-9]*$/;

export function defineComponent(input: ComponentInput): ComponentSpec {
  if (!NAME.test(input.name)) throw new Error(`Component name must be PascalCase: ${input.name}`);
  const events = input.events ?? [];
  for (const e of events) {
    if (!EVENT.test(e)) throw new Error(`Event prop must look like onChange: ${input.name}.${e}`);
  }
  if (input.props && RESOLVED_PROP in input.props.shape) throw new Error(`${input.name}: the prop name "${RESOLVED_PROP}" is reserved`);
  return Object.freeze({
    name: input.name,
    description: input.description,
    props: input.props ?? z.object({}),
    events: Object.freeze([...events]),
    children: input.children ?? 'none',
    resolver: input.resolver,
    fallback: input.fallback,
  });
}

/** `Slider` -> `tessera-slider`, `ListItem` -> `tessera-list-item`. Custom element names must contain a hyphen. */
export function tagFor(name: string): string {
  return 'tessera-' + name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** `onChange` -> `change`, `onValueChange` -> `valuechange`. */
export function eventNameFor(prop: string): string {
  return prop.slice(2).toLowerCase();
}

export class Catalog {
  readonly #byName = new Map<string, ComponentSpec>();
  readonly #byTag = new Map<string, ComponentSpec>();

  constructor(specs: readonly ComponentSpec[]) {
    for (const spec of specs) {
      if (this.#byName.has(spec.name)) throw new Error(`Duplicate component: ${spec.name}`);
      this.#byName.set(spec.name, spec);
      this.#byTag.set(tagFor(spec.name), spec);
    }
  }

  get(name: string): ComponentSpec | undefined {
    return this.#byName.get(name);
  }

  byTag(tag: string): ComponentSpec | undefined {
    return this.#byTag.get(tag);
  }

  names(): string[] {
    return [...this.#byName.keys()];
  }

  specs(): ComponentSpec[] {
    return [...this.#byName.values()];
  }

  /** Checks one prop value. Returns null when the value is acceptable. `undefined` is always acceptable. */
  checkProp(component: string, prop: string, value: unknown): PropIssue | null {
    const spec = this.#byName.get(component);
    if (!spec) return { code: 'unknown_prop', component, prop, message: `Unknown component ${component}` };
    if (value === undefined) return null;
    // Resolver results come from the server, in whatever shape the resolver returns; the component validates them.
    if (prop === RESOLVED_PROP && spec.resolver) return null;
    if (spec.events.includes(prop)) {
      return typeof value === 'function'
        ? null
        : { code: 'invalid_value', component, prop, message: `${component}.${prop} must be a function` };
    }
    const schema = spec.props.shape[prop];
    if (!schema) return { code: 'unknown_prop', component, prop, message: `${component} has no prop ${prop}` };
    const result = (schema as z.ZodType).safeParse(value);
    return result.success
      ? null
      : { code: 'invalid_value', component, prop, message: `${component}.${prop}: ${result.error.issues[0]?.message ?? 'invalid'}` };
  }

  wire(): ComponentWire[] {
    return this.specs().map((spec) => ({
      name: spec.name,
      tag: tagFor(spec.name),
      props: spec.resolver ? [...Object.keys(spec.props.shape), RESOLVED_PROP] : Object.keys(spec.props.shape),
      events: spec.events.map((prop) => ({ prop, event: eventNameFor(prop) })),
    }));
  }

  /** One line per component, for the system prompt. */
  describe(): string {
    return this.specs().map(describeComponent).join('\n');
  }
}

/** Markdown in the source compiles to these components, so every catalog includes them. */
export const markdownComponents: readonly ComponentSpec[] = [
  defineComponent({
    name: 'Title',
    description: 'Heading text. Markdown # / ## / ### compile to xl / lg / md.',
    props: z.object({ size: z.enum(['xl', 'lg', 'md', 'sm']).optional() }),
    children: 'inline',
  }),
  defineComponent({ name: 'Text', description: 'A paragraph. Plain Markdown lines compile to Text.', children: 'inline' }),
  defineComponent({ name: 'Bold', description: 'Bold run, from **text**.', children: 'inline' }),
  defineComponent({ name: 'Italic', description: 'Italic run, from *text*.', children: 'inline' }),
  defineComponent({ name: 'Code', description: 'Inline code, from `text`.', children: 'inline' }),
  defineComponent({
    name: 'CodeBlock',
    description: 'A block of code, from a ``` fence (```python … ```). Write the fence, not this tag; the code is shown exactly as written.',
    props: z.object({ language: z.string().optional() }),
    children: 'inline',
  }),
  defineComponent({
    name: 'List',
    description: 'A list. Markdown "- item" and "1. item" lines compile to List + ListItem.',
    props: z.object({ ordered: z.boolean().optional() }),
    children: 'block',
  }),
  defineComponent({ name: 'ListItem', description: 'One list item.', children: 'inline' }),
];

const space = z.number().int().min(0).max(8);
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** What the `image` resolver returns. Hosts should still check the URL before drawing it. */
export const imageResult = z.object({
  url: z.string(),
  title: z.string().optional(),
  source: z.string().optional(),
});
export type ImageResult = z.infer<typeof imageResult>;

/** A small starter set. Hosts can replace or extend it. */
export const starterComponents: readonly ComponentSpec[] = [
  defineComponent({
    name: 'Box',
    description: 'Layout container. Stacks its children vertically, or in a row with direction="row".',
    props: z.object({
      direction: z.enum(['column', 'row']).optional(),
      gap: space.optional(),
      padding: space.optional(),
      border: z.boolean().optional(),
      align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
    }),
    children: 'block',
  }),
  defineComponent({
    name: 'Slider',
    description: 'Numeric slider. Bind value to a @state and pass its setter to onChange.',
    props: z.object({
      min: z.number(),
      max: z.number(),
      step: z.number().positive().optional(),
      value: z.number(),
      label: z.string().optional(),
    }),
    events: ['onChange'],
    fallback: (p) => `${text(p.label) || 'Value'}: ${text(p.value)} (${text(p.min)}–${text(p.max)})`,
  }),
  defineComponent({
    name: 'Checkbox',
    description: 'A checkbox with a label. onChange receives true or false.',
    props: z.object({ checked: z.boolean(), label: z.string() }),
    events: ['onChange'],
    fallback: (p) => `- [${p.checked ? 'x' : ' '}] ${text(p.label)}`,
  }),
  defineComponent({
    name: 'Button',
    description: 'A button. Put the label between the tags.',
    props: z.object({ variant: z.enum(['solid', 'outline', 'ghost']).optional(), disabled: z.boolean().optional() }),
    events: ['onClick'],
    children: 'inline',
    fallback: (_, children) => `[${children}]`,
  }),
  defineComponent({ name: 'Caption', description: 'Small secondary text.', children: 'inline' }),
  defineComponent({
    name: 'Badge',
    description: 'A short status label.',
    props: z.object({ tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).optional() }),
    children: 'inline',
    fallback: (_, children) => `\`${children}\``,
  }),
  defineComponent({
    name: 'Progress',
    description: 'A read-only bar filled to value out of max (default 100): completion rates, shares, bars to compare.',
    props: z.object({
      value: z.number(),
      max: z.number().positive().optional(),
      label: z.string().optional(),
      tone: z.enum(['neutral', 'info', 'success', 'warning', 'danger']).optional(),
    }),
    fallback: (p) => `${text(p.label) || 'Progress'}: ${text(p.value)} / ${text(p.max ?? 100)}`,
  }),
  defineComponent({ name: 'Divider', description: 'A horizontal rule.', fallback: () => '---' }),
  defineComponent({
    name: 'Image',
    description: 'An image the server finds for a description. Describe what it should show in query; never write image URLs.',
    props: z.object({
      query: z.string().min(1),
      alt: z.string().optional(),
      aspect: z.enum(['1:1', '4:3', '16:9']).optional(),
    }),
    resolver: 'image',
    fallback: (p) => {
      const found = imageResult.safeParse(p.resolved);
      const label = text(p.alt) || text(p.query);
      return found.success ? `![${label}](${found.data.url})` : `*[image: ${label}]*`;
    },
  }),
];

/** Builds a catalog. Markdown components are always included; pass your own specs to replace the starter set. */
export function defineCatalog(specs: readonly ComponentSpec[] = starterComponents): Catalog {
  const own = new Set(specs.map((s) => s.name));
  return new Catalog([...markdownComponents.filter((s) => !own.has(s.name)), ...specs]);
}

function describeComponent(spec: ComponentSpec): string {
  const props = Object.entries(spec.props.shape).map(([name, schema]) => {
    const optional = (schema as z.ZodType).safeParse(undefined).success;
    return `${name}${optional ? '?' : ''}: ${describeType(schema as z.ZodType)}`;
  });
  const events = spec.events.map((e) => `${e}: (value) => void`);
  const all = [...props, ...events];
  const children = spec.children === 'none' ? 'no children' : spec.children === 'inline' ? 'inline children' : 'block children';
  return `- <${spec.name}${all.length ? ' ' + all.join(', ') : ''}> (${children}) ${spec.description}`;
}

function describeType(schema: z.ZodType): string {
  const json = z.toJSONSchema(schema, { unrepresentable: 'any' }) as Record<string, unknown>;
  return describeJson(json);
}

function describeJson(json: Record<string, unknown>): string {
  if (Array.isArray(json.enum)) return json.enum.map((v) => JSON.stringify(v)).join(' | ');
  if (Array.isArray(json.anyOf)) return (json.anyOf as Record<string, unknown>[]).map(describeJson).join(' | ');
  const type = json.type;
  if (type === 'number' || type === 'integer') {
    const lo = json.minimum ?? json.exclusiveMinimum;
    const hi = json.maximum ?? json.exclusiveMaximum;
    return lo !== undefined || hi !== undefined ? `number(${lo ?? ''}..${hi ?? ''})` : 'number';
  }
  if (typeof type === 'string') return type;
  return 'any';
}
