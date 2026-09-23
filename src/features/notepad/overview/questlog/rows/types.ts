import type { ComponentType, MouseEvent as ReactMouseEvent } from 'react';

import type { DevNote } from '@/lib/bindings/DevNote';

import type { GoalSignals, RowDetail } from '../QuestRow';
import type { NoteRail } from '../questlogModel';

/**
 * The contract every row design answers to.
 *
 * IDENTICAL for all of them, the same rule the desk variants follow: the host
 * owns every piece of state, a design owns only how the goal looks. That is
 * what makes the comparison fair and the eventual deletion a one-file change.
 */
export interface RowViewProps {
  note: DevNote;
  signals: GoalSignals;
  /** Part of a run of one status — the design decides whether to repeat the
   *  glyph, wire it, or say nothing at all. */
  wired: boolean;
  rail: NoteRail;
  selected: boolean;
  query: string;
  matched: boolean;
  /** Present only when the operator opened this goal's second row (`x`). */
  detail?: RowDetail;
  onSelect: () => void;
  onOpen: () => void;
  onContextMenu: (e: ReactMouseEvent) => void;
}

export type RowView = ComponentType<RowViewProps>;

/** The designs on offer. Throwaway scaffolding — one wins and the rest go. */
export type RowDesign = 'current' | 'ledger' | 'circuit' | 'orbit';

export const ROW_DESIGNS: readonly { id: RowDesign; label: string }[] = [
  // Deliberately NOT translated: this strip is prototype scaffolding that will
  // be deleted with the losers, and putting it through 14 catalogs would make
  // the throwaway more expensive than the thing it is choosing between.
  { id: 'current', label: 'Current' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'circuit', label: 'Circuit' },
  { id: 'orbit', label: 'Orbit' },
];

export const ROW_DESIGN_KEY = 'personas.notepad.rowDesign';

/**
 * How many dots a count is worth before a numeral is cheaper to read.
 * Shared so the three designs agree about when a symbol stops being one.
 */
export const DOT_CAP = 3;

/** `[filled, remainder]` — three dots and a numeral for anything past the cap. */
export function dotsFor(count: number): { dots: number; overflow: number } {
  return count <= DOT_CAP ? { dots: count, overflow: 0 } : { dots: 0, overflow: count };
}
