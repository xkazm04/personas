import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `hsl(var(--token) / a)` only works when the token holds bare HSL components
 * ("222 47% 11%"). Every theme in globals.css defines the colour tokens as hex,
 * so the substituted value is invalid at computed-value time and the whole
 * declaration drops: the sidebar's L2 scroll shadows never painted. Chrome
 * must mix tokens with `color-mix()` (the doctrine's form) instead.
 */
const root = process.cwd();
const css = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8');

function tokenValues(name: string): string[] {
  const re = new RegExp(String.raw`--${name}\s*:\s*([^;]+);`, 'g');
  return [...css.matchAll(re)].map((m) => m[1]!.trim());
}

const HSL_TRIPLET = /^-?[\d.]+(deg)?\s+[\d.]+%\s+[\d.]+%$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' ? [] : walk(p);
    return /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('shared chrome colour tokens', () => {
  it('never wraps a hex token in hsl()', () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(root, 'src/features/shared/chrome'))) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/hsl\(var\(--([\w-]+)\)/g)) {
        const values = tokenValues(m[1]!);
        if (values.length === 0 || values.some((v) => !HSL_TRIPLET.test(v))) {
          offenders.push(`${file.slice(root.length + 1)}: --${m[1]} = ${values[0] ?? '(undefined)'}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads the token values it judges (the theme file still defines --secondary as hex)', () => {
    expect(tokenValues('secondary').length).toBeGreaterThan(0);
    expect(tokenValues('secondary').every((v) => v.startsWith('#'))).toBe(true);
  });
});
