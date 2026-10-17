/**
 * An element's props cross to the host as one object property. A prop the program stops passing is then simply
 * a missing key; sent as separate DOM properties, Preact "removes" it by assigning '' instead, and it also turns
 * names such as `width` or `href` into string attributes.
 *
 * Interning returns the same frozen object for structurally equal props, so a re-render that changes nothing
 * (every streaming recompile re-renders the whole tree) gives Preact an identical value and sends no update.
 */
export function createPropsInterner(limit = 1000): (props: Record<string, unknown>) => Readonly<Record<string, unknown>> {
  const cache = new Map<string, Readonly<Record<string, unknown>>>();
  return (props) => {
    let key: string;
    try {
      key = JSON.stringify(props, keyReplacer);
    } catch {
      // Cyclic or otherwise unserialisable: no reuse, still a valid object.
      return Object.freeze({ ...props });
    }
    const hit = cache.get(key);
    if (hit) return hit;
    if (cache.size >= limit) cache.clear();
    const frozen = Object.freeze({ ...props });
    cache.set(key, frozen);
    return frozen;
  };
}

/** Keeps the key faithful where plain JSON would merge distinct values (NaN vs null, undefined vs missing). */
function keyReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) return `\u0000num:${value}`;
  if (typeof value === 'bigint') return `\u0000big:${value}`;
  if (value === undefined) return '\u0000undefined';
  if (typeof value === 'function') return '\u0000function';
  return value;
}
