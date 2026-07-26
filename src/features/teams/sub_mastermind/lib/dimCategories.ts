// Dimension categories — the far/mid level of detail for an island body.
//
// Both lattices sit at the ~15-cell comfort ceiling (see mastermind.md §5), and
// 15 same-sized dots is not a readable shape from orbit anyway. So the zoomed-out
// bands collapse the dimensions into their four registry `category` groups —
// runtime / delivery / agentic / product — and near/close explodes them back to
// the full lattice. The registry's `category` field existed but drove nothing
// until now; this module is what reads it.
//
// Pure (no React, no DOM) so the rollup rule is unit-testable on its own.
import { Compass, Cpu, PackageCheck, Sparkles, type LucideIcon } from 'lucide-react';

import { DIM_REGISTRY, type DimCategory } from './dimRegistry';
import type { DimNode, DimStatus } from './types';

/** Render order — runtime first (what the thing runs on), product last (what it
 *  is for). Also the lattice-slot order in both variants. */
export const CATEGORY_ORDER: DimCategory[] = ['runtime', 'delivery', 'agentic', 'product'];

export const CATEGORY_ICON: Record<DimCategory, LucideIcon> = {
  runtime: Cpu,
  delivery: PackageCheck,
  agentic: Sparkles,
  product: Compass,
};

/** A category as one zoomed-out cell. */
export interface CategoryNode {
  key: DimCategory;
  status: DimStatus;
  /** Dimensions in this category on this island. */
  total: number;
  /** How many of them are `solid` — the "x of y wired" reading at mid zoom. */
  solid: number;
  /** The member dimensions, registry order — feeds the tooltip. */
  nodes: DimNode[];
}

/** Worst-first ordering for a status list — the sort the category popover uses
 *  so a red cell opens with its red dimensions at the top. */
export const STATUS_RANK: Record<DimStatus, number> = {
  alert: 0, risk: 1, unknown: 2, partial: 3, absent: 4, solid: 5,
};

/** Roll a category's member statuses into the one status its cell paints.
 *
 *  The rule is deliberately pessimistic about problems and strict about green:
 *    • any `alert`   → alert   (an error anywhere in the group is the headline)
 *    • any `risk`    → risk
 *    • any `unknown` → unknown (a failed data family must not read as healthy)
 *    • all `absent`  → absent  (nothing in this area is set up at all)
 *    • all `solid`   → solid   (green means EVERY member is green)
 *    • otherwise     → partial (a mix of wired and not)
 *  An empty group has nothing to say — `absent`. */
export function rollupStatus(statuses: DimStatus[]): DimStatus {
  if (statuses.length === 0) return 'absent';
  if (statuses.includes('alert')) return 'alert';
  if (statuses.includes('risk')) return 'risk';
  if (statuses.includes('unknown')) return 'unknown';
  if (statuses.every((s) => s === 'absent')) return 'absent';
  if (statuses.every((s) => s === 'solid')) return 'solid';
  return 'partial';
}

/** Group an island's dimension nodes into the four category cells. Categories
 *  with no members on this island are dropped (never render an empty cell). */
export function categoryNodes(nodes: DimNode[]): CategoryNode[] {
  const byCategory = new Map<DimCategory, DimNode[]>();
  for (const n of nodes) {
    const category = DIM_REGISTRY[n.key]?.category;
    if (!category) continue;
    const list = byCategory.get(category);
    if (list) list.push(n);
    else byCategory.set(category, [n]);
  }
  return CATEGORY_ORDER.flatMap((key) => {
    const members = byCategory.get(key);
    if (!members || members.length === 0) return [];
    return [{
      key,
      status: rollupStatus(members.map((n) => n.status)),
      total: members.length,
      solid: members.filter((n) => n.status === 'solid').length,
      nodes: members,
    }];
  });
}
