// A render WINDOW over the ledger, not a backend page.
//
// `contest_list` (src-tauri/src/commands/contest/view.rs:140) walks every
// managed project's arena folders and returns EVERY contest in one call —
// there is no offset, no cursor, no total. So the whole set is already in
// memory by the time the ledger renders, and the only honest thing a page
// size can buy here is DOM weight: how many rows we hand the renderer.
//
// Because grouping, family nesting and sorting all happen in `ledgerGroups`
// over the complete set BEFORE this module sees it, the window never changes
// which rows exist or what order they are in — it only truncates the tail.
// Group counters keep their whole-set values so a header never lies about how
// much is filed under it.
import type { LedgerGroup } from './ledgerModel';
import { monthOf } from './ledgerModel';

/** Rows revealed per page. One page is also one entrance cascade. */
export const LEDGER_PAGE_SIZE = 20;

/** A group truncated to the window, carrying its whole-set facts. */
export interface LedgerPageGroup extends LedgerGroup {
  /** Distinct months across the group's FULL family list, so the settled
   *  group's month headers do not appear and disappear as pages load. */
  monthCount: number;
}

export interface LedgerWindow {
  groups: LedgerPageGroup[];
  /** Rows in the whole (already filtered and sorted) set. */
  total: number;
  /** Rows actually rendered. */
  shown: number;
  hasMore: boolean;
}

/** Rows across every group — families flattened, context rounds included. */
export function countLedgerRows(groups: readonly LedgerGroup[]): number {
  let n = 0;
  for (const g of groups) for (const f of g.families) n += f.items.length;
  return n;
}

/**
 * Truncate `groups` to the first `limit` rows in render order.
 *
 * Cutting inside a family is allowed — a family's later rounds are context,
 * and the next page restores them in place. A group that gets no rows is
 * dropped so no empty header is rendered.
 */
export function windowLedger(groups: readonly LedgerGroup[], limit: number): LedgerWindow {
  const total = countLedgerRows(groups);
  const budgetAll = Math.max(0, limit);
  let left = budgetAll;
  const out: LedgerPageGroup[] = [];

  for (const g of groups) {
    if (left <= 0) break;
    const monthCount = new Set(g.families.map((f) => monthOf(f.date))).size;
    const families: LedgerGroup['families'] = [];
    for (const f of g.families) {
      if (left <= 0) break;
      const items = f.items.length <= left ? f.items : f.items.slice(0, left);
      left -= items.length;
      if (items.length > 0) families.push({ ...f, items });
    }
    if (families.length > 0) out.push({ ...g, families, monthCount });
  }

  const shown = countLedgerRows(out);
  return { groups: out, total, shown, hasMore: shown < total };
}

/**
 * Position of a row inside its own page, so every page runs its entrance
 * ramp from 0 instead of inheriting the previous pages' offset.
 */
export function cascadeOrder(rowIndex: number): number {
  return rowIndex % LEDGER_PAGE_SIZE;
}
