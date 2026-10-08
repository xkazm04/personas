// The rows of a rail card, by NAME. A card is five fixed rows in every state
// (measured, not measured, stale, instructed), each one line of its own type
// role tall, so every card in a lane has the same height without measuring
// anything, and the meter row - the line the pipe runs along - sits at the
// same height in all of them. The ghost (`Layer1Ghost`) draws these rows too.
import { LT } from '../../system/lcType';

export const CARD_ROW = {
  /** The key cap (`KEY.sm`) and the step's name. */
  head: 'flex h-7 min-w-0 items-center gap-2',
  /** The figure on the left; on the right, the change and the sample count stacked. */
  figure: 'flex min-w-0 items-center justify-between gap-2',
  /** The meter: the track and its marks, and the pipe that enters the card. */
  meter: 'relative flex h-3.5 items-center',
  /** The figure's name, then the step's other numbers as one chip line (clipped, never wrapped). */
  label: `flex min-w-0 items-center justify-between gap-2 ${LT.label}`,
  /** The verdict's glyph and words, and what it was when it changed. */
  verdict: `flex min-w-0 items-center gap-1.5 ${LT.label}`,
} as const;

/** The space between rows: one value for every card, so the rows land at the same height everywhere. */
export const CARD_ROW_GAP = 'gap-1';

/** A one-line slot that keeps its line height when empty: `role` is a type role, so `1lh` is that role's line. */
export function lineSlot(role: keyof typeof LT): string {
  return `block h-[1lh] truncate ${LT[role]}`;
}
