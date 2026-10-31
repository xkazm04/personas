// @vitest-environment node
// A wire type that ts-rs already generates must be imported from
// src/lib/bindings/, never re-declared in an IPC wrapper. A hand copy compiles
// forever and drifts silently: `DryRunResult` here lost the backend's
// `chain_targets` and typed nullable fields as non-null (and the reverse) while
// the binding next door stayed right. Ground truth is the bindings directory
// itself, not a list in this file. Lives under __tests__/, which tsc skips.
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WRAPPERS = [
  'triggers', 'scheduler', 'workflows', 'teamChannel',
  'teamDeliberations', 'teamMemories', 'teams', 'assignments',
];

const bindingNames = new Set(
  readdirSync(resolve(process.cwd(), 'src/lib/bindings'))
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((f) => f.slice(0, -3)),
);

describe('src/api/pipeline wrappers import their wire types', () => {
  it('re-declares no type that has a generated binding', () => {
    const copies: string[] = [];
    for (const w of WRAPPERS) {
      const src = readFileSync(resolve(process.cwd(), `src/api/pipeline/${w}.ts`), 'utf8');
      for (const m of src.matchAll(/^\s*export\s+(?:interface|type)\s+([A-Za-z0-9_]+)\b(?!\s*\})/gm)) {
        if (bindingNames.has(m[1]!)) copies.push(`${w}.ts: ${m[1]}`);
      }
    }
    expect(bindingNames.size).toBeGreaterThan(500);
    expect(copies).toEqual([]);
  });
});
