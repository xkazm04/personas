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

/**
 * Compute a diff between two sets of memories from different runs.
 * Matching is by memory ID — memories created in different runs have different IDs.
 */
export function computeMemoryDiff(memoriesA: TeamMemory[], memoriesB: TeamMemory[]): MemoryRunDiff {
  const idsA = new Set(memoriesA.map((m) => m.id));
  const idsB = new Set(memoriesB.map((m) => m.id));

  const added = memoriesB.filter((m) => !idsA.has(m.id));
  const removed = memoriesA.filter((m) => !idsB.has(m.id));

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
    const avgA = avgImportance(aList);
    const avgB = avgImportance(bList);
    if (aList.length > 0 || bList.length > 0) {
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
