import { describe, expect, it } from 'vitest';
import { createPropsInterner } from '../src/props';

describe('createPropsInterner', () => {
  it('returns the same frozen object for structurally equal props', () => {
    const intern = createPropsInterner();
    const a = intern({ min: 1, max: 50, label: '席位' });
    const b = intern({ min: 1, max: 50, label: '席位' });
    expect(b).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('represents a removed prop as a missing key, not an empty string', () => {
    const intern = createPropsInterner();
    const before = intern({ gap: 2, padding: 3, border: true });
    const after = intern({ gap: 1 });
    expect(after).not.toBe(before);
    expect(after).toEqual({ gap: 1 });
    expect('padding' in after).toBe(false);
  });

  it('does not merge values plain JSON would confuse', () => {
    const intern = createPropsInterner();
    expect(intern({ v: NaN })).not.toBe(intern({ v: null }));
    expect(intern({ v: Infinity })).not.toBe(intern({ v: -Infinity }));
    expect(intern({ v: undefined })).not.toBe(intern({}));
  });

  it('still returns a usable object for unserialisable props', () => {
    const intern = createPropsInterner();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(intern({ v: cyclic }).v).toBe(cyclic);
  });

  it('bounds its cache', () => {
    const intern = createPropsInterner(2);
    const first = intern({ n: 1 });
    intern({ n: 2 });
    intern({ n: 3 });
    expect(intern({ n: 1 })).not.toBe(first);
  });
});
