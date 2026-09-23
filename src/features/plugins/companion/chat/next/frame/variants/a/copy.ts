/**
 * English copy for the Halo · Hand prototype only.
 *
 * TODO(prototype, 2026-09-22): if Hand wins, every string here moves into
 * `plugins.companion` in en.json and through the translate pipeline.
 */

export const HAND_COPY = {
  label: 'Halo · Hand',
  board: 'The board: what she is running and what waits on you',
  waitingShort: 'waiting',
  deckOf: (n: number, project: string) => `${n} card${n === 1 ? '' : 's'} waiting in ${project}`,
  noDeck: 'Nothing waiting here',
  processesOf: (n: number) => `${n} running`,
  hand: 'Your hand',
  handCard: (i: number, kind: string, title: string) => `Card ${i}: ${kind}. ${title}`,
  play: 'Play this card',
  backToHand: 'Back to hand',
  returnHand: 'Return the hand',
  turnEnded: 'Turn ended',
  turnEndedSub: 'Every card is played.',
  roundOf: (i: number, n: number) => `Round ${i} of ${n}`,
  cardsLeft: (n: number) => `${n} in hand`,
  pickHint: 'Pick a card from your hand',
  keys: { pick: 'pick', play: 'play', back: 'return hand' },
  athenaCrest: 'Athena',
  projectless: 'No project',
} as const;
