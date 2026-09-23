/**
 * English copy for Halo · Rows (prototype only).
 *
 * TODO(prototype, 2026-09-22): moves into `plugins.companion` in en.json and
 * the translate pipeline only if this variant wins.
 */

export const ROWS_COPY = {
  tabLabel: 'Halo · Rows',
  panelLabel: 'What she is running, row by row',
  waiting: (n: number) => `${n} waiting on you`,
  strength: (n: number) => `${n} running`,
  leader: (n: number) => (n === 1 ? '1 card waiting. Open it.' : `${n} cards waiting. Open the first.`),
  noLeader: 'Nothing waiting in this row',
  more: (n: number) => `${n} more running`,
  idleRow: 'Nothing running',
  round: (i: number, n: number) => `Round ${i} of ${n}`,
  roundWon: 'Round won',
  roundWonSub: 'Every card is played. Back to the conversation.',
  setAside: 'Set aside',
  setAsideHint: 'Sends this card back to its side. It stays waiting.',
  retreat: 'Back to the conversation',
  emptyBoard: 'Nothing is waiting on you.',
  emptyBoardSub: 'When she needs a call, it is dealt here as a card.',
  keys: 'Left / Right choose · Enter raise · 1-9 jump · Esc return',
  keysShort: '← → · Enter · Esc',
  raise: (title: string) => `Raise card: ${title}`,
  boardLabel: 'Decision round',
  altW: 'Alt+W',
} as const;
