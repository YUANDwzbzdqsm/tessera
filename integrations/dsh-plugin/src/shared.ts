import { defineCatalog, starterComponents } from '@tessera/catalog';
import { pullRequest } from '../../../demo/src/pullRequest';

// Shared by both halves: the host registers the tool and compiles for feedback, the browser compiles to render.

/** The model-facing tool. The browser half recognises its calls by this name. */
export const TOOL_NAME = 'render_ui';

/** The chat row kind the browser half registers. */
export const NODE_KIND = 'tessera-ui';

/**
 * Key in a render_ui result's presentation metadata that holds the resolved tool data. The metadata is stored with
 * the result in the session log but never shown to the model, so the browser can rebuild the row after a reload.
 */
export const META_KEY = 'tesseraData';

/** The tool data a render_ui tool/result event carries, or undefined for one without any (or another tool's). */
export function resultData(eventData: any): Readonly<Record<string, unknown>> | undefined {
  const data = eventData?.meta?.[META_KEY];
  return data && typeof data === 'object' && !Array.isArray(data) ? data : undefined;
}

/**
 * The starter set without <Image> (it needs a server-side image search the harness does not have), plus the
 * PullRequest card, which suits a coding agent reporting on a branch.
 */
export const catalog = defineCatalog([...starterComponents.filter((c) => c.name !== 'Image'), pullRequest]);

const ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', '"': '"', '\\': '\\', '/': '/' };

/**
 * The `source` string of a render_ui call whose JSON arguments may still be arriving. Returns what is decoded so
 * far (an escape cut off at the end waits for the rest), or null while the key itself has not arrived.
 */
export function partialSource(json: string): string | null {
  const key = /"source"\s*:\s*"/.exec(json);
  if (!key) return null;
  let out = '';
  for (let i = key.index + key[0].length; i < json.length; i++) {
    const c = json[i]!;
    if (c === '"') return out;
    if (c !== '\\') {
      out += c;
      continue;
    }
    const next = json[i + 1];
    if (next === undefined) return out;
    if (next === 'u') {
      const hex = json.slice(i + 2, i + 6);
      if (hex.length < 4) return out;
      out += String.fromCharCode(Number.parseInt(hex, 16));
      i += 5;
      continue;
    }
    out += ESCAPES[next] ?? next;
    i++;
  }
  return out;
}

/** The source of a complete call, whether the event carries the arguments as JSON text or as an object. */
export function finalSource(args: unknown): string | null {
  if (typeof args === 'string') {
    try {
      return finalSource(JSON.parse(args));
    } catch {
      return partialSource(args);
    }
  }
  if (args && typeof args === 'object' && typeof (args as { source?: unknown }).source === 'string') {
    return (args as { source: string }).source;
  }
  return null;
}
