import type { TeamMemory } from '@/lib/bindings/TeamMemory';

export interface CategoryDiff {
  category: string;
  countA: number;
  countB: number;
  delta: number;
}

export interface ImportanceShift {
  category: string;
  avgA: number;
  avgB: number;
  delta: number;
}

export interface MemoryRunDiff {
  /** Memories in run B that are not in run A (new learnings). */
  added: TeamMemory[];
  /** Memories in run A that are not in run B (no longer present). */
  removed: TeamMemory[];
  /** Per-category count changes. */
  categoryDiffs: CategoryDiff[];
  /** Per-category average importance shift. */
  importanceShifts: ImportanceShift[];
  /** Total counts. */
  totalA: number;
  totalB: number;
}

function groupByCategory(memories: TeamMemory[]): Map<string, TeamMemory[]> {
  const map = new Map<string, TeamMemory[]>();
  for (const m of memories) {
    const arr = map.get(m.category);
    if (arr) arr.push(m);
    else map.set(m.category, [m]);
  }
  return map;
}

function avgImportance(memories: TeamMemory[]): number {
  if (memories.length === 0) return 0;
  return memories.reduce((sum, m) => sum + m.importance, 0) / memories.length;
}

/** The one key a memory can be aligned on ACROSS runs. `id` cannot serve: a row
 *  carries exactly one `run_id` and a freshly minted uuid, so run A's ids and
 *  run B's ids are disjoint by construction and an id-set difference reports two
 *  substantively identical runs as everything-added plus everything-removed.
 *  `added`/`removed` are claims about CONTENT, so content is what they align on;
 *  importance is a property of the aligned memory, not part of its identity. */
function contentKey(m: TeamMemory): string {
  return JSON.stringify([m.category, m.title, m.content]);
}

/** Members of `source` with no counterpart left in `other`, as a MULTISET: two
 *  identical memories in A and one in B leaves exactly one unmatched, not zero. */
export function unmatchedByContent(source: TeamMemory[], other: TeamMemory[]): TeamMemory[] {
  const remaining = new Map<string, number>();
  for (const m of other) {
    const k = contentKey(m);
    remaining.set(k, (remaining.get(k) ?? 0) + 1);
  }
  return source.filter((m) => {
    const k = contentKey(m);
    const n = remaining.get(k) ?? 0;
    if (n === 0) return true;
    remaining.set(k, n - 1);
    return false;
  });
}

/**
 * Compute a diff between two sets of memories from different runs.
 * Matching is by CONTENT (see `contentKey`), because the panel's vocabulary --
 * "new learnings", "no longer present" -- is a claim about content, and an
 * alignment weaker than the vocabulary is a fabricated claim, not arithmetic.
 */
export function computeMemoryDiff(memoriesA: TeamMemory[], memoriesB: TeamMemory[]): MemoryRunDiff {
  const added = unmatchedByContent(memoriesB, memoriesA);
  const removed = unmatchedByContent(memoriesA, memoriesB);

  const catA = groupByCategory(memoriesA);
  const catB = groupByCategory(memoriesB);
  const allCategories = new Set([...catA.keys(), ...catB.keys()]);

  const categoryDiffs: CategoryDiff[] = [];
  const importanceShifts: ImportanceShift[] = [];

  for (const category of allCategories) {
    const aList = catA.get(category) ?? [];
    const bList = catB.get(category) ?? [];
    categoryDiffs.push({
      category,
      countA: aList.length,
      countB: bList.length,
      delta: bList.length - aList.length,
    });
    // An importance SHIFT only exists where both sides have something to
    // average. The previous `||` emitted a shift for a category present on one
    // side only, with `avgImportance([]) === 0` standing in for the missing
    // side — so a category that first appeared in run B rendered as
    // "0.0 -> 6.2, rising", a fabricated claim about a comparison that was
    // never made. Appearance and disappearance are already reported, honestly
    // and with counts, by `categoryDiffs`.
    if (aList.length > 0 && bList.length > 0) {
      const avgA = avgImportance(aList);
      const avgB = avgImportance(bList);
      importanceShifts.push({ category, avgA, avgB, delta: avgB - avgA });
    }
  }

  categoryDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  importanceShifts.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return {
    added,
    removed,
    categoryDiffs,
    importanceShifts,
    totalA: memoriesA.length,
    totalB: memoriesB.length,
  };
}
