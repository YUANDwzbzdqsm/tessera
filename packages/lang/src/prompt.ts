import type { Catalog } from '@tessera/catalog';
import { bindingNames } from './codegen';

export interface SystemPromptOptions {
  /** Appended after the generated guide, e.g. product-specific tone or rules. */
  readonly extra?: string;
  /** Tool results available to this answer by name; their names and fields are listed for the model. */
  readonly data?: Readonly<Record<string, unknown>>;
}

const GUIDE = `You can answer with an interactive interface written in Tessera markup.
Use it when a visual or interactive answer is clearly better than text; otherwise answer in plain Markdown.

Syntax
- Prose is plain Markdown: # / ## / ### headings, paragraphs, "- " and "1. " lists, **bold**, *italic*, \`code\`.
- Components come from the catalog below and are written like JSX: <Box gap={2}> … </Box>, <Slider min={1} max={50} value={seats} onChange={setSeats} />.
  Use only the listed components and props. Attribute values are "text", {expression}, or a bare name meaning true.
  No HTML elements (<div>, <input>, <span> …) and no style attributes: they are dropped.
  Components marked "no children" are always self-closing: <Divider />, <Slider … />, <Progress … />, <Image … />.
- {@state seats = 8} declares state named seats with the setter setSeats. Write it on its own line at the top level,
  before any component: never inside <Box>, {#if} or {#each}.
- {@let price = seats * 29} declares a derived value. Also on its own line at the top level, after what it uses.
- {expression} inserts a value into text. Expressions are JavaScript: arithmetic, comparisons, ternaries, template strings,
  array methods and arrow functions. No assignment, no new, no loops, no this.
- {#if cond} … {:else if other} … {:else} … {/if} renders conditionally.
- {#each items as item, i} … {/each} repeats content.
- ui.send("text") sends a new message from the user; ui.copy("text") copies text; ui.open("https://…") opens a link.
- Tool results are available by name (for example p1). Show their values with {p1.price} or pass them as props;
  never retype a value from a tool result, in components or in sentences: write "最便宜的是 {cheapest.title}，{cheapest.price}",
  not the name or price itself. Derive what you need with @let (sorting, filtering, picking the best). Names you were
  not given do not exist.
- Components marked as resolved by the server (such as <Image query="…">) take literal descriptions; never write URLs.
- Put directives, block tags and block-level components on their own lines. Write \\{ for a literal brace.

Components
`;

const EXAMPLE = `
Example
## Team plan estimate
Drag the slider to see the **monthly** price.
{@state seats = 8}
{@let price = seats * 29}
<Box border padding={3} gap={2}>
<Slider min={1} max={50} value={seats} onChange={setSeats} />
<Title size="xl">\${price}/month</Title>
<Button onClick={() => ui.send(\`Draft a yearly budget for \${seats} seats\`)}>Plan the budget</Button>
</Box>
`;

/** The system-prompt section that teaches a model the markup and the catalog. */
export function systemPrompt(catalog: Catalog, options: SystemPromptOptions = {}): string {
  const data = options.data ? describeData(options.data) : '';
  return GUIDE + catalog.describe() + '\n' + EXAMPLE + data + (options.extra ? '\n' + options.extra + '\n' : '');
}

/** "p1: { title, price, merchant }" per binding, so the model knows which names and fields exist. */
function describeData(data: Readonly<Record<string, unknown>>): string {
  const names = bindingNames(data);
  if (!names.length) return '';
  const shape = (v: unknown): string => {
    if (Array.isArray(v)) return `list of ${v.length}${v.length ? ` × ${shape(v[0])}` : ''}`;
    if (v && typeof v === 'object') return `{ ${Object.keys(v).join(', ')} }`;
    return typeof v;
  };
  return `\nTool data for this answer\n${names.map((n) => `- ${n}: ${shape(data[n])}`).join('\n')}\n`;
}
