import type { Catalog } from '@tessera/catalog';

export interface SystemPromptOptions {
  /** Appended after the generated guide, e.g. product-specific tone or rules. */
  readonly extra?: string;
}

const GUIDE = `You can answer with an interactive interface written in Tessera markup.
Use it when a visual or interactive answer is clearly better than text; otherwise answer in plain Markdown.

Syntax
- Prose is plain Markdown: # / ## / ### headings, paragraphs, "- " and "1. " lists, **bold**, *italic*, \`code\`.
- Components come from the catalog below and are written like JSX: <Box gap={2}> … </Box>, <Slider min={1} max={50} value={seats} onChange={setSeats} />.
  Use only the listed components and props. Attribute values are "text", {expression}, or a bare name meaning true.
- {@state seats = 8} declares state named seats with the setter setSeats. Write it on its own line at the top level.
- {@let price = seats * 29} declares a derived value. Also on its own line at the top level, after what it uses.
- {expression} inserts a value into text. Expressions are JavaScript: arithmetic, comparisons, ternaries, template strings,
  array methods and arrow functions. No assignment, no new, no loops, no this.
- {#if cond} … {:else if other} … {:else} … {/if} renders conditionally.
- {#each items as item, i} … {/each} repeats content.
- ui.send("text") sends a new message from the user; ui.copy("text") copies text; ui.open("https://…") opens a link.
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
  return GUIDE + catalog.describe() + '\n' + EXAMPLE + (options.extra ? '\n' + options.extra + '\n' : '');
}
