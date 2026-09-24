/**
 * The comparison worker's bundle boundary, as a test.
 *
 * `dist/assets/comparisonDiff.worker-*.js` was **23,251,262 bytes — 39.8% of
 * all 58.4 MB of JS in dist** (measured 2026-09-20 at `bb8e2ecdf`), for a
 * 60-line worker that formats nothing. The worker imported `jsonDiff` from
 * `comparisonHelpers`, which imports `formatCost`, which imports the i18n
 * store and `getActiveTranslations`, whose `import.meta.glob` discovers 14
 * locales × 64 section catalogs. Vite builds workers as IIFE, which forces
 * `inlineDynamicImports`, so every one of those lazy catalogs collapsed into
 * the single worker file. Czech, Spanish, French and Japanese UI strings were
 * all verifiably inside the shipped chunk.
 *
 * **Nothing about the app looked wrong.** The worker worked, the UI worked, the
 * locales worked; the installer was just 20 MB fatter. A defect with no symptom
 * cannot be caught by testing behaviour, so this test asserts the *shape of the
 * module graph* instead — the only place the defect is visible.
 *
 * The walk is deliberately conservative (it counts anything that is not an
 * erased `import type`), and it proves itself: the last case walks the OLD
 * import and requires the same walker to report the i18n reach. A graph gate
 * that cannot see the bug it was written for is worse than no gate.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';

const SRC = resolve(__dirname, '..', '..', '..', '..', '..'); // -> src/
const WORKER = resolve(SRC, 'features/agents/sub_executions/workers/comparisonDiff.worker.ts');
const HELPERS = resolve(SRC, 'features/agents/sub_executions/libs/comparisonHelpers.ts');

/** Static, value-level (non-erased) specifiers of one module. */
function specifiersOf(file: string): string[] {
  const code = readFileSync(file, 'utf8');
  const out: string[] = [];
  // `import type …` / `export type …` are erased by the compiler and cost no
  // bytes. Everything else — including a side-effect-only `import 'x'` — does.
  const re = /(?:^|\n)\s*(import|export)\s+(?!type\s)([\s\S]*?)from\s*['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.push(m[3]);
  const bare = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  while ((m = bare.exec(code)) !== null) out.push(m[1]);
  return out;
}

function resolveSpecifier(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null; // a package — reported separately, never "resolved"
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && !candidate.endsWith('/') && /\.(ts|tsx|json)$/.test(candidate)) return candidate;
  }
  return existsSync(`${base}.json`) ? `${base}.json` : null;
}

/** Every in-`src` module, and every package, statically reachable from `entry`. */
function walkGraph(entry: string): { files: Set<string>; packages: Set<string>; unresolved: string[] } {
  const files = new Set<string>();
  const packages = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    if (!/\.(ts|tsx)$/.test(file)) continue;
    for (const spec of specifiersOf(file)) {
      if (!spec.startsWith('.') && !spec.startsWith('@/')) { packages.add(spec); continue; }
      const target = resolveSpecifier(file, spec);
      if (target) queue.push(target);
      else unresolved.push(`${relative(SRC, file)} -> ${spec}`);
    }
  }
  return { files, packages, unresolved };
}

const rel = (f: string) => relative(SRC, f).replace(/\\/g, '/');

describe('comparison worker module graph', () => {
  const graph = walkGraph(WORKER);
  const reached = [...graph.files].map(rel).sort();

  it('walks a real graph — a walker that sees nothing must not pass', () => {
    // The worker + comparisonDiffCore + parseJson. Fewer than three means the
    // specifier regex stopped matching, not that the graph got cleaner.
    expect(graph.files.size).toBeGreaterThanOrEqual(3);
    expect(reached).toContain('features/agents/sub_executions/libs/comparisonDiffCore.ts');
    expect(reached).toContain('lib/utils/parseJson.ts');
    expect(graph.unresolved).toEqual([]);
  });

  it('never reaches the i18n layer, the stores, or anything that globs locales', () => {
    const forbidden = reached.filter((f) => /^(i18n|stores)\//.test(f) || /useTranslation|i18nStore|formatters/.test(f));
    expect(forbidden, `worker graph re-entered the app layer via:\n${forbidden.join('\n')}`).toEqual([]);
  });

  it('pulls in no npm package at all', () => {
    // react / zustand / lucide-react were all inside the 23 MB chunk. A worker
    // has no React and no store; anything here is weight with no consumer.
    expect([...graph.packages].sort()).toEqual([]);
  });

  it('contains no import.meta.glob anywhere in its graph', () => {
    // Comments are stripped first: comparisonDiffCore's own header explains the
    // 23 MB defect by name, and a matcher that cannot tell a warning about a
    // glob from a glob would fail on the fix rather than on the bug.
    const stripped = (f: string) =>
      readFileSync(resolve(SRC, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\n)\s*\/\/[^\n]*/g, '$1');
    const globbers = reached.filter((f) => /\.tsx?$/.test(f) && stripped(f).includes('import.meta.glob'));
    expect(globbers).toEqual([]);
  });

  it('the SAME walker reports the leak on the pre-fix import — so the gate can fail', () => {
    // comparisonHelpers is what the worker used to import. If this stops
    // reporting i18n reach, the walker has gone blind and the four assertions
    // above are worthless.
    const old = walkGraph(HELPERS);
    const oldReached = [...old.files].map(rel);
    expect(oldReached).toContain('lib/utils/formatters.ts');
    expect(oldReached).toContain('i18n/useTranslation.ts');
    expect([...old.packages]).toContain('lucide-react');
  });
});
