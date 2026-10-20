/**
 * One component the program can render. Codegen records it from the same tree it compiles, so the manifest
 * always matches the program.
 */
export interface SiteInfo {
  /**
   * The component's id within its answer: its index in source order (pre-order). The program passes it to the host
   * as the element's `site`. Streaming only appends to the source, so a component keeps its site across recompiles.
   * Inside `{#each}` the host sees one instance per item: `"4:0"`, `"4:1"`, nested `"4:1.0"`.
   */
  readonly site: number;
  readonly component: string;
  /** Site of the enclosing component; null at the top level. */
  readonly parent: number | null;
  /** `tag` when the model wrote `<Name>`; `markdown` for a heading, paragraph, list item, inline style or code. */
  readonly origin: 'tag' | 'markdown';
  /** Source offset of the tag; -1 for Markdown components, which have no tag of their own. */
  readonly pos: number;
  /** Props set to literal values that passed validation (dropped props are not here), e.g. `{ tone: 'warning' }`. */
  readonly literalProps: Readonly<Record<string, unknown>>;
  /** Props bound to expressions: their values are only known at run time. */
  readonly dynamicProps: readonly string[];
  /** Event props the program handles, e.g. `onChange`. */
  readonly events: readonly string[];
  /** Number of `{#each}` blocks around it; above 0 it renders once per item. */
  readonly loopDepth: number;
  /** Inside an `{#if}` branch, so it may not render. */
  readonly conditional: boolean;
}

/** What an answer is made of, for analytics: its components, its coarse layout and its declarations. */
export interface Manifest {
  readonly sites: readonly SiteInfo[];
  /**
   * Top-level components with their direct children, e.g. `Title Text Box(Slider Title Button)`. Repeated siblings
   * collapse to `Text×3`; a component inside `{#each}` is marked `Card[]`.
   */
  readonly skeleton: string;
  /** Names declared with `{@state}`, which are also the keys of the state the host receives. */
  readonly state: readonly string[];
  /** Names declared with `{@let}`. */
  readonly lets: readonly string[];
}

const SKELETON_DEPTH = 2;

export function skeletonOf(sites: readonly SiteInfo[]): string {
  const children = new Map<number | null, SiteInfo[]>();
  for (const s of sites) {
    const list = children.get(s.parent);
    if (list) list.push(s);
    else children.set(s.parent, [s]);
  }
  const level = (parent: number | null, depth: number): string => {
    const parts: string[] = [];
    for (const s of children.get(parent) ?? []) {
      // Marked where the repetition starts, not on every component inside the repeated part.
      const repeats = s.loopDepth > (s.parent === null ? 0 : sites[s.parent]!.loopDepth);
      const inner = depth < SKELETON_DEPTH && children.has(s.site) ? `(${level(s.site, depth + 1)})` : '';
      parts.push(s.component + (repeats ? '[]' : '') + inner);
    }
    return collapse(parts).join(' ');
  };
  return level(null, 1);
}

/** `['Text', 'Text', 'Box']` -> `['Text×2', 'Box']`. */
function collapse(parts: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < parts.length) {
    let j = i + 1;
    while (j < parts.length && parts[j] === parts[i]) j++;
    out.push(j - i > 1 ? `${parts[i]}×${j - i}` : parts[i]!);
    i = j;
  }
  return out;
}
