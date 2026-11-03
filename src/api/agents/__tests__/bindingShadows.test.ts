// @vitest-environment node
// An IPC result type that ts-rs already generates into src/lib/bindings must be
// re-exported from there, not hand-mirrored: a hand copy keeps compiling after
// the Rust struct changes and drifts silently (executions.ts and buildSession.ts
// record two such drifts). This test reads the wrapper sources and fails while
// they DECLARE a type whose name has a generated binding. Lives under
// __tests__/, which tsc skips (node:fs).
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const WRAPPERS = ['src/api/agents/personas.ts', 'src/api/agents/useCases.ts'];

/**
 * Deliberate hand types, each with its reason. Two-sided: an entry that stops
 * being a shadow fails too, so the list cannot go stale.
 * - UseCaseGenerationSettings: the binding types every policy as a free
 *   `string | null` and every key as required; the hand type keeps the literal
 *   unions (`'on' | 'off' | 'trust_llm'`) the editor relies on, and optional keys.
 */
const ALLOWED: Record<string, string[]> = {
  'src/api/agents/useCases.ts': ['UseCaseGenerationSettings'],
};

function shadowedBindings(rel: string): string[] {
  const src = readFileSync(resolve(process.cwd(), rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const declared = [...src.matchAll(/^export\s+(?:interface|type)\s+([A-Z]\w*)\s*(?:=|\{|<)/gm)].map((m) => m[1]!);
  return declared.filter((name) => existsSync(resolve(process.cwd(), 'src/lib/bindings', `${name}.ts`)));
}

describe('api wrappers re-export generated bindings instead of mirroring them', () => {
  it('the matcher sees the declarations it is meant to judge', () => {
    // PersonaOperation is declared in personas.ts and has no binding: proves the
    // regex reads declarations at all, so a clean result is not a blind one.
    const src = readFileSync(resolve(process.cwd(), 'src/api/agents/personas.ts'), 'utf8');
    expect(src).toMatch(/^export type PersonaOperation =/m);
  });

  it.each(WRAPPERS)('%s declares no type that src/lib/bindings already generates', (rel) => {
    const allowed = ALLOWED[rel] ?? [];
    const shadows = shadowedBindings(rel);
    expect(shadows.filter((n) => !allowed.includes(n))).toEqual([]);
    expect(allowed.filter((n) => !shadows.includes(n)), 'stale allowlist entry').toEqual([]);
  });
});
