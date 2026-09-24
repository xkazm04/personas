/**
 * Halo · Spread — prototype copy (English). Moves to i18n only if this variant
 * wins the round.
 *
 * TODO(prototype, 2026-09-23): consolidate the Athena chat switcher.
 */

export const SPREAD_COPY = {
  label: 'Halo · Spread',
  binder: 'Collection binder',
  waiting: (n: number) => `${n} waiting`,
  openSpread: 'Open the spread',
  altW: 'Alt+W',
  noProcesses: 'Nothing running',
  running: (n: number) => (n === 1 ? '1 running' : `${n} running`),
  decisionsIn: (label: string, n: number) => (n === 1 ? `1 card waiting in ${label}` : `${n} cards waiting in ${label}`),
  processKindLetter: { fleet: 'F', liveop: 'O', rundesk: 'R', schedule: 'S' },
  deck: (n: number) => (n === 1 ? '1 card in the deck' : `${n} cards in the deck`),
  drawNext: 'Draw the next card',
  discard: (n: number) => (n === 1 ? '1 card played' : `${n} cards played`),
  setAside: 'Set aside',
  returnToDeck: 'Return the spread',
  cardOf: (i: number, n: number) => `Card ${i} of ${n}`,
  keysHint: 'Space next · 1-9 pick · Esc return',
  athenaOwn: 'Athena',
  emptyTitle: 'The deck is empty.',
  emptySub: 'When she needs a call, it is dealt here as a card.',
  close: 'Back to the conversation',
  roundCleared: 'Round cleared',

  // R4-X3: the card-native bodies (Oracle / Ledger / Runes).
  bodies: {
    oracle: 'Oracle',
    ledger: 'Ledger',
    runes: 'Runes',
  },
  tab: (name: string) => `Spread · ${name}`,
  eyebrowDecision: 'Athena asks',
  eyebrowApproval: (action: string) => `Proposed action · ${action}`,
  eyebrowGuidance: (session: string) => `Session ${session} asks`,
  eyebrowMcpApproval: (session: string) => `Session ${session} wants to`,
  context: 'Context',
  why: 'Why',
  verdict: 'Verdict',
  recommended: 'Athena recommends',
  askAthena: 'Ask Athena',
  riskRead: 'Blast radius',
  lowRisk: 'Low blast radius. Athena would approve this one.',
  elevatedRisk: 'Elevated blast radius. Read the parameters before approving.',
  showDetails: 'Turn over for the details',
  hideDetails: 'Turn back to the choices',
  details: 'Details',
  noteLabel: 'Note (optional)',
  answerLabel: 'Your answer',
  moreWaiting: (n: number) => (n === 1 ? '1 more waiting' : `${n} more waiting`),
  keysBody: 'Space next · 1-9 pick · Enter confirm · Esc return',
  keysBodyNoPick: 'Space next · Esc return',
  keyAsk: '0',
} as const;
