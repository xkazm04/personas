// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// `terminalEvents.ts` is a hand-written mirror of the Rust
// `StructuredExecutionEvent` enum (src-tauri/core/src/types.rs). Serde writes
// every `Option<T>` field there as `null` (no `skip_serializing_if`), so the TS
// field must admit `null`: typing it `?: number` told callers the value is a
// number or absent, and a `!== undefined` check would then let `null` through.
// On 2026-10-19, 12 such fields across 4 events were typed without `| null`.

const root = resolve(__dirname, '../../../..');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const toSnake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();

/** variant tag -> { field -> isOption } */
function rustVariants(): Map<string, Map<string, boolean>> {
  const src = stripComments(readFileSync(resolve(root, 'src-tauri/core/src/types.rs'), 'utf8'));
  const start = src.indexOf('pub enum StructuredExecutionEvent');
  if (start < 0) throw new Error('enum not found');
  // Brace-match the enum body; its struct variants nest exactly one level.
  const open = src.indexOf('{', start);
  let depth = 0;
  let close = open;
  for (; close < src.length; close++) {
    if (src[close] === '{') depth++;
    else if (src[close] === '}' && --depth === 0) break;
  }
  const body = src.slice(open + 1, close);
  const out = new Map<string, Map<string, boolean>>();
  const re = /(?:#\[serde\(rename\s*=\s*"([a-z_]+)"\)\]\s*)?(\w+)\s*\{([^}]*)\}/g;
  for (const m of body.matchAll(re)) {
    const tag = m[1] ?? toSnake(m[2]!);
    const fields = new Map<string, boolean>();
    for (const f of m[3]!.matchAll(/(\w+)\s*:\s*([^,]+),?/g)) fields.set(f[1]!, /^\s*Option</.test(f[2]!));
    out.set(tag, fields);
  }
  return out;
}

/** type tag -> { field -> declared type text } */
function tsInterfaces(): Map<string, Map<string, string>> {
  const src = stripComments(readFileSync(resolve(root, 'src/lib/types/terminalEvents.ts'), 'utf8'));
  const out = new Map<string, Map<string, string>>();
  for (const m of src.matchAll(/export interface \w+ \{([^}]*)\}/g)) {
    const tag = m[1]!.match(/type:\s*'([a-z_]+)'/)?.[1];
    if (!tag) continue;
    const fields = new Map<string, string>();
    for (const f of m[1]!.matchAll(/(\w+)\??:\s*([^;]+);/g)) fields.set(f[1]!, f[2]!.trim());
    out.set(tag, fields);
  }
  return out;
}

describe('terminalEvents mirrors StructuredExecutionEvent', () => {
  const rust = rustVariants();
  const ts = tsInterfaces();

  it('parses every variant on both sides', () => {
    expect(rust.size).toBeGreaterThanOrEqual(11);
    expect([...ts.keys()].sort()).toEqual([...rust.keys()].sort());
  });

  it('declares every Rust field, and admits null for every Option field', () => {
    const problems: string[] = [];
    for (const [tag, fields] of rust) {
      const tsFields = ts.get(tag)!;
      for (const [name, isOption] of fields) {
        const decl = tsFields.get(name);
        if (decl === undefined) problems.push(`${tag}.${name} missing`);
        else if (isOption && !/\|\s*null\b/.test(decl)) problems.push(`${tag}.${name} is Option but typed ${decl}`);
      }
    }
    expect(problems).toEqual([]);
  });
});
