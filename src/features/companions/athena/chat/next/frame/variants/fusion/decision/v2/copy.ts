/**
 * Fusion · decision v2 ("Overview tiles") - prototype copy, English only.
 *
 * TODO(prototype, 2026-10-07): extract to i18n when a winner is picked
 */

export const V2_COPY = {
  waitingOnYou: 'Waiting on you',
  athena: 'Athena',
  asked: 'Asked',
  behind: (n: number) => (n === 1 ? '1 more behind it' : `${n} more behind it`),
  blastRadius: 'Blast radius',
  low: 'Low',
  elevated: 'Elevated',
  stakes: 'What is at stake',
  herPick: 'Athena recommends',
  enterSends: 'sends',
  shiftEnter: 'new line',
  shiftEnterKey: 'Shift+Enter',
  /** What a choice does, read from its verb (see `actionGlyph.ts`). */
  effect: {
    approve: 'Lets it run',
    reject: 'Stops it',
    hold: 'Waits',
    ship: 'Ships it',
    remove: 'Removes',
    again: 'Runs again',
    send: 'Sends',
    split: 'Splits it',
    fix: 'Fixes it',
    skip: 'Skips',
    ahead: 'Goes ahead',
    careful: 'Has a cost',
    leave: 'Leaves it',
  },
} as const;
