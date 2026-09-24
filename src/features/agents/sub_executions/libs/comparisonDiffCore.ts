/**
 * The two diff algorithms the comparison surface runs, and nothing else.
 *
 * WHY THIS FILE EXISTS — it is a bundle boundary, not a taxonomy.
 *
 * `diffLines` and `jsonDiff` used to live in `comparisonHelpers.ts` next to
 * `fmtCost`, which delegates to `@/lib/utils/formatters`, which imports the
 * zustand i18n store, `getActiveTranslations` and lucide icons. Importing ONE
 * pure function from that file therefore dragged the app's whole translation
 * layer in behind it — and `src/i18n/useTranslation.ts` discovers its catalogs
 * with an `import.meta.glob` over `section-locales`, 14 locales × 64 sections.
 * (Spelling that glob pattern out here is not possible: it contains the
 * sequence that ends a block comment, and oxc duly fails the parse.)
 *
 * In the app bundle that costs nothing: the glob is lazy and the locales are
 * separate chunks. In a **Web Worker** it is catastrophic. Vite builds workers
 * as IIFE by default, which forces `inlineDynamicImports`, so every lazily
 * globbed locale collapsed into the single worker file. Measured 2026-09-20 at
 * `bb8e2ecdf`: `dist/assets/comparisonDiff.worker-*.js` was **23,251,262 bytes
 * — 39.8% of all 58.4 MB of JS in dist**, shipped in every installer, for a
 * 60-line worker that formats nothing. Czech, Spanish, French and Japanese UI
 * strings were all verifiably inside it.
 *
 * Neither function below is locale-aware — `jsonDiff` compares
 * `JSON.stringify` output and `diffLines` compares raw strings — so the i18n
 * dependency was never behavioural, only graph-shaped. That is exactly why it
 * was invisible.
 *
 * **Rule for this file: it may import only from modules that are themselves
 * free of React, stores, i18n and icons.** `comparisonWorkerGraph.test.ts`
 * walks the worker's real static import graph and fails if anything re-enters
 * it, because the failure mode has no symptom a human would notice — the app
 * works perfectly, the installer is just 20 MB fatter.
 */

import { parseJsonOrDefault } from '@/lib/utils/parseJson';

export type LineDiffEntry = { type: 'same' | 'added' | 'removed'; text: string };
export type JsonDiffEntry = { path: string; left: string; right: string };

/**
 * Simple membership-based diff for terminal output lines.
 *
 * NOTE: this is a Set-membership diff, not a sequence (LCS) diff — it is
 * intentionally cheap for large terminal logs. Known limitations: a line
 * repeated a different number of times in A vs B still reads as fully
 * "same"; a line present in both but reordered is not flagged as moved;
 * and all "added" lines are appended after A's lines rather than shown
 * in their real position. Good enough for a quick "did anything change"
 * signal — do not rely on it for exact positional diffing.
 */
export function diffLines(linesA: string[], linesB: string[]): LineDiffEntry[] {
  const result: LineDiffEntry[] = [];
  const setA = new Set(linesA);
  const setB = new Set(linesB);

  for (const line of linesA) {
    if (setB.has(line)) {
      result.push({ type: 'same', text: line });
    } else {
      result.push({ type: 'removed', text: line });
    }
  }
  for (const line of linesB) {
    if (!setA.has(line)) {
      result.push({ type: 'added', text: line });
    }
  }
  return result;
}

/** Structural diff of two JSON strings. */
export function jsonDiff(a: string | null, b: string | null): JsonDiffEntry[] {
  const diffs: JsonDiffEntry[] = [];
  const objA = parseJsonOrDefault<Record<string, unknown>>(a, {});
  const objB = parseJsonOrDefault<Record<string, unknown>>(b, {});
  const keysA = typeof objA === 'object' && objA !== null ? Object.keys(objA) : [];
  const keysB = typeof objB === 'object' && objB !== null ? Object.keys(objB) : [];
  if (keysA.length === 0 && keysB.length === 0 && a !== b) {
    diffs.push({ path: '(root)', left: a ?? '(empty)', right: b ?? '(empty)' });
  } else {
    const allKeys = new Set([...keysA, ...keysB]);
    for (const key of allKeys) {
      const valA = JSON.stringify(objA[key] ?? null);
      const valB = JSON.stringify(objB[key] ?? null);
      if (valA !== valB) {
        diffs.push({ path: key, left: valA, right: valB });
      }
    }
  }
  return diffs;
}

/**
 * The messages the comparison worker understands, and the ones it answers with.
 *
 * Declared here rather than in the client so the worker can import its own
 * contract without importing the client module (which is main-thread code and
 * would put the whole graph back). Both sides then share ONE definition — the
 * worker previously `import type`d these from the client, which is erased at
 * build time and so happened to be safe, but only by accident of syntax.
 */
export type DiffWorkerRequest =
  | { id: number; kind: 'line'; left: string | null; right: string | null; chunkSize: number }
  | { id: number; kind: 'json'; left: string | null; right: string | null };

export type DiffWorkerResponse =
  | { id: number; kind: 'line-chunk'; chunk: LineDiffEntry[] }
  | { id: number; kind: 'line-complete'; result: LineDiffEntry[] }
  | { id: number; kind: 'json-complete'; result: JsonDiffEntry[] }
  | { id: number; kind: 'error'; error: string };
