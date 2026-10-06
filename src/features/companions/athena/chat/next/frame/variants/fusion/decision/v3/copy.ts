/**
 * Fusion · decision v3 ("Command palette") - prototype copy, English only.
 *
 * TODO(prototype, 2026-10-07): extract to i18n when a winner is picked
 */

export const PALETTE_COPY = {
  athena: 'Athena',
  provenance: 'Where this comes from',
  prev: 'Previous',
  next: 'Next',
  move: 'Move',
  choose: 'Choose',
  takePick: 'Take her pick',
  recommended: 'Recommended',
  safer: 'Safe pick',
  newLine: 'New line',
  noteRides: 'Rides along with your answer',
  /** Key legends are glyphs, not copy (see notepad `DESK_KEY`). */
  keys: { up: '↑', down: '↓', left: '←', right: '→', enter: '↵', esc: 'Esc', space: 'Space', ask: '0', shiftEnter: '⇧↵' },
  range: (n: number) => (n <= 1 ? '1' : `1–${Math.min(9, n)}`),
} as const;
