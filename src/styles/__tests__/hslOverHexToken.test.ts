import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * `hsl(var(--token) / a)` only works when the token holds bare HSL components.
 * The colour tokens in globals.css are HEX, so the substituted value is invalid
 * at computed-value time and the WHOLE declaration drops (progress pulses, flow
 * diagram strokes, scrims, json line numbers painted nothing). Mix tokens with
 * `color-mix(in srgb, var(--token) N%, transparent)` instead. Sibling of
 * shared/chrome/__tests__/chromeColourTokens.test.ts, over all of src/.
 */
const root = process.cwd();
const css = readFileSync(resolve(root, 'src/styles/globals.css'), 'utf8');
const HEX = /^#[0-9a-f]{3,8}$/i;

function isHexToken(name: string): boolean {
  const re = new RegExp(String.raw`--${name}\s*:\s*([^;]+);`, 'g');
  const values = [...css.matchAll(re)].map((m) => m[1]!.trim());
  return values.some((v) => HEX.test(v));
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return f === '__tests__' || f === 'node_modules' ? [] : walk(p);
    return /\.(tsx?|css)$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });
}

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('colour tokens', () => {
  it('no source wraps a hex token in hsl(var(--token))', () => {
    const offenders: string[] = [];
    for (const file of walk(resolve(root, 'src'))) {
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(/hsl\(var\(--([\w-]+)\)/g)) {
        if (isHexToken(m[1]!)) offenders.push(`${file.slice(root.length + 1)}: --${m[1]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
