/**
 * Folio (round 5 · C) - prototype copy, English only.
 *
 * TODO(prototype, 2026-10-07): extract to i18n when a winner is picked
 * (the module's established prototype exemption, see `../../../nextCopy.ts`).
 * Keys deliberately avoid the display-copy property names (`label`, `hint`...)
 * so a losing variant leaves no frozen-copy constants behind.
 */

export const FOLIO_COPY = {
  tab: 'R5 · C · Folio',
  her: 'Athena',
  you: 'you',
  sheOnHerOwn: 'on her own',
  sheReachedOut: 'she wrote',
  fleetSpoke: 'fleet',
  writing: 'writing',
  sayHello: 'Say something to Athena',
  sheAnswered: 'She answered',
  unread: 'New words from her',
  openPage: 'Open the conversation',
  foldPage: 'Fold the page',
  keyOpen: 'Alt A',
  keyFolio: 'Alt W',
  keyNotes: 'Alt M',
  keyFold: 'Esc',
  pageNamed: 'Conversation with Athena',
  stop: 'Stop her',
  cleanPage: 'A clean page.',
  cleanPageLine: 'Write to her below, or begin with one of these lines.',
  /** First lines for an empty conversation: [chip, what it writes]. */
  firstLines: [
    ['What runs now?', 'What is running across the fleet right now?'],
    ['Anything for me?', 'Is anything waiting on me?'],
    ['Today in brief', 'Give me a short summary of what happened today.'],
  ] as ReadonlyArray<readonly [string, string]>,

  // The margin.
  marginNamed: 'Margin: what runs and what waits on you',
  waitingCount: (n: number) => (n === 1 ? '1 waits on you' : `${n} wait on you`),
  noneWaiting: 'nothing waits',
  openNotes: 'Read the margin notes',
  foldNotes: 'Fold the margin notes',
  notesTitle: 'Margin notes',
  waitsOnYou: 'Waits on you',
  running: 'Running',
  herOwn: 'Athena',
  otherThreads: 'Other threads',
  unreadIn: (n: number) => (n === 1 ? '1 unread' : `${n} unread`),
  nothingRuns: 'Nothing is running.',
  state: {
    working: 'working',
    needs: 'needs you',
    stuck: 'stuck',
    queued: 'queued',
    idle: 'idle',
    later: 'later',
  },
  runsIn: (project: string, n: number) => `${project}: ${n === 1 ? '1 run' : `${n} runs`}`,

  // Glosses (a turn's machine rows and her asides).
  glosses: (n: number) => (n === 1 ? '1 gloss' : `${n} glosses`),
  memories: (n: number) => (n === 1 ? '1 memory' : `${n} memories`),
  setAside: 'set aside for you',
  earlier: (n: number) => (n === 1 ? 'one earlier exchange' : `${n} earlier exchanges`),

  // The folio.
  folioNamed: 'Folio: what waits on you',
  contents: 'Contents',
  indexOfWorks: 'Index of works',
  pageOf: (i: number, n: number) => `page ${i} of ${n}`,
  turnPage: 'turn the page',
  choose: 'choose a paragraph',
  askNote: 'ask for her note',
  takeNote: 'take her note',
  aside: 'set aside',
  close: 'close',
  move: 'move',
  herNote: 'Her note',
  askForNote: 'Ask for her note',
  composing: 'She is writing her note',
  nothingWaitsTitle: 'Nothing waits on you.',
  nothingWaitsLine: 'When she needs a call, it is written here first.',
  previous: 'Previous page',
  next: 'Next page',
  aboutThis: 'About this page',
  machineDetail: 'Machine detail',
} as const;

export type FolioCopy = typeof FOLIO_COPY;
