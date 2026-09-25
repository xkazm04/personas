import type { MouseEvent as ReactMouseEvent } from 'react';

import type { DevNote } from '@/lib/bindings/DevNote';

import type { GoalSignals, RowDetail } from './goalSignals';
import type { NoteRail } from './questlogModel';

/**
 * The contract every row design answers to.
 *
 * IDENTICAL for all of them, the same rule the desk variants follow: the host
 * owns every piece of state, a design owns only how the goal looks. That is
 * what makes the comparison fair and the eventual deletion a one-file change.
 */
export interface GoalRowProps {
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

/**
 * How many dots a count is worth before a numeral is cheaper to read.
 */
export const DOT_CAP = 3;

/** Three dots, or a numeral for anything past the cap. */
export function dotsFor(count: number): { dots: number; overflow: number } {
  return count <= DOT_CAP ? { dots: count, overflow: 0 } : { dots: 0, overflow: count };
}
