// Ledger order: newest root contests first, each followed by its refine
// rounds (parent → child → grandchild), so a lineage reads as one block.
import type { ContestSummary } from '@/lib/bindings/ContestSummary';

export interface LedgerRow {
  summary: ContestSummary;
  /** 0 for a root contest, 1 for its refine round, … */
  depth: number;
  key: string;
}

export function rowKey(s: Pick<ContestSummary, 'projectId' | 'contestId'>): string {
  return `${s.projectId}/${s.contestId}`;
}

export function orderLedger(summaries: readonly ContestSummary[]): LedgerRow[] {
  const byKey = new Map(summaries.map((s) => [rowKey(s), s]));
  const children = new Map<string, ContestSummary[]>();
  const roots: ContestSummary[] = [];
  for (const s of summaries) {
    const parentKey = s.parentId ? `${s.projectId}/${s.parentId}` : null;
    if (parentKey && byKey.has(parentKey) && parentKey !== rowKey(s)) {
      const list = children.get(parentKey) ?? [];
      list.push(s);
      children.set(parentKey, list);
    } else {
      roots.push(s);
    }
  }
  const newestFirst = (a: ContestSummary, b: ContestSummary) =>
    b.updatedAtMs - a.updatedAtMs || a.contestId.localeCompare(b.contestId);
  const byRound = (a: ContestSummary, b: ContestSummary) =>
    (a.round ?? 0) - (b.round ?? 0) || a.contestId.localeCompare(b.contestId);

  const out: LedgerRow[] = [];
  const seen = new Set<string>();
  const walk = (s: ContestSummary, depth: number) => {
    const key = rowKey(s);
    if (seen.has(key)) return; // a cycle in parent links must not loop
    seen.add(key);
    out.push({ summary: s, depth, key });
    for (const c of [...(children.get(key) ?? [])].sort(byRound)) walk(c, depth + 1);
  };
  for (const r of [...roots].sort(newestFirst)) walk(r, 0);
  // Anything only reachable through a cycle still gets a row.
  for (const s of summaries) if (!seen.has(rowKey(s))) walk(s, 0);
  return out;
}
