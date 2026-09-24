// Pipeline Ledger — the shell's own copy, plain English on purpose.
//
// A prototype shell keeps its words here; they migrate to `t.plugins.contest`
// only if this shell wins the /prototype round. Voice: an operator console —
// terse, present tense, nouns before verbs.

export const LEDGER_COPY = {
  shellLabel: 'Pipeline ledger',
  modeLedger: 'Ledger',
  modeGains: 'Gains',
  modeSwitchLabel: 'Ledger view',
  newEntry: 'New contest',
  keysLabel: 'Keys',
  keysShow: 'Show keys',
  keysHide: 'Hide keys',

  colEntry: 'Entry',
  colProject: 'Project',
  colStage: 'Stage',
  colOutcome: 'Outcome',
  colUpdated: 'Updated',
  rowsCount: '{count} entries',
  seatsCount: '{count} seats',
  noEntriesTitle: 'The ledger is empty',
  noEntriesBody: 'Press n to open the first contest.',
  roundOf: 'Round {n} of {parent}',
  noWinner: 'Undecided',
  cursorHint: 'j / k to move, Enter to open',

  stages: {
    brief: 'Brief',
    seats: 'Seats',
    run: 'Run',
    collect: 'Collect',
    judge: 'Judge',
    review: 'Review',
    decide: 'Decide',
  },
  stageState: {
    done: 'done',
    current: 'now',
    todo: 'to do',
    failed: 'failed',
    skipped: 'skipped',
    passed: 'passed',
  },
  stageRailLabel: 'Stage: {stage} ({state})',

  detailLoading: 'Reading the arena…',
  detailSeats: 'Seats',
  detailChain: 'Autopilot',
  detailVariants: 'Variants',
  detailBrief: 'Brief',
  briefShow: 'Show brief',
  briefHide: 'Hide brief',
  openReview: 'Open review',
  openReviewKey: 'r',
  variantsCount: '{count} variants',
  noVariants: 'No variants collected yet.',
  wonBy: 'Won by {spec}',
  winnerFrom: '{key} from',
  seatWall: 'wall',
  seatCost: 'cost',
  seatTurns: '{n} turns',
  seatRerun: 'Rerun',
  seatMonitor: 'Monitor',
  launch: 'Launch seats',
  cancel: 'Cancel run',
  scoreboard: 'Judges’ scoreboard',
  scoreMean: 'mean',
  scoreSpread: 'spread',
  scoreBroken: 'broken',

  reviewBack: 'Back to ledger',
  reviewTitle: 'Review · {title}',
  reviewList: 'Variants',
  reviewKeys: 'j / k variant · 1 failure · 2 impractical · 3 shortlist · 4 winner · 0 clear · p pin · Esc back',
  reviewField: 'Whole field',
  reviewDecide: 'Decision',
  reviewPins: '{n} pins',
  reviewNoVariant: 'Pick a variant on the left.',

  gainsTitle: 'What each decision gained',
  gainsEmpty: 'No decided contests yet. Decide one to start the ledger of gains.',
  gainsSeat: 'Winning seat',
  gainsRound: 'Round',
  gainsRoundFirst: 'First round',
  gainsRate: 'Seat win rate',
  gainsRateOf: '{wins} of {entered}',

  setupTitle: 'New contest',
  setupHint: 'Fill the brief, click the seats, create. Esc closes.',

  keyNames: {
    move: 'j / k',
    open: 'Enter',
    back: 'Esc',
    review: 'r',
    create: 'n',
    gains: 'g',
    buckets: '1–4',
    clear: '0',
    pin: 'p',
  },
  keyMeanings: {
    move: 'move',
    open: 'open / close row',
    back: 'close layer',
    review: 'review the open row',
    create: 'new contest',
    gains: 'ledger / gains',
    buckets: 'sort variant',
    clear: 'unsort',
    pin: 'pin mode',
  },
} as const;

/** `{name}` placeholders, filled from `vars`. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}
