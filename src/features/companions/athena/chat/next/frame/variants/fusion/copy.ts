/**
 * Fusion - prototype copy, English only.
 *
 * TODO(prototype, 2026-10-07): extract to i18n when a winner is picked.
 * Kept out of the locale files on purpose (the module's prototype exemption,
 * see `../../../nextCopy.ts`): a losing variant costs no translation work.
 */

export const FUSION_COPY = {
  island: 'Athena',
  // The capsule: one label, never a cut sentence.
  workingOn: (n: number) => `Working on ${n}`,
  thinking: 'Thinking',
  reviewing: 'Reviewing',
  using: (tool: string) => `Running ${tool}`,
  quiet: 'All quiet',
  openChat: 'Open the conversation',
  foldChat: 'Fold into the island',
  gate: (n: number) => (n === 1 ? '1 needs you' : `${n} need you`),
  keyChat: 'Alt C',
  keyWork: 'Alt W',
  keyEsc: 'Esc',
  stop: 'Stop',

  // The transcript.
  you: 'You',
  athena: 'Athena',
  earlier: (n: number) => (n === 1 ? '1 earlier message' : `${n} earlier messages`),
  machine: (n: number) => (n === 1 ? '1 thing she looked up or heard' : `${n} things she looked up or heard`),
  hideMachine: 'Hide what she looked up',

  // The rail.
  rail: 'What Athena manages',
  pendingNamed: (n: number) => (n === 1 ? '1 needs you' : `${n} need you`),
  noneWaiting: 'Nothing waits on you',
  openQueue: 'Open the decisions',
  more: (n: number) => `+${n}`,
  // The rail read out loud (hover / focus): each mark's words beside it.
  pendingLabel: (n: number) => `${n} waiting on you`,
  moreLabel: (n: number) => `${n} more waiting`,
  catQuiet: 'Nothing right now',
  stateShort: {
    working: 'working',
    waiting: 'waiting',
    stuck: 'stuck',
    idle: 'idle',
  } as Record<string, string>,
  categories: {
    fleet: 'Fleet',
    personas: 'Personas',
    runners: 'Run Desk',
    ops: 'Her own work',
    schedules: 'Check-ins',
  } as Record<string, string>,
  state: {
    working: 'working',
    waiting: 'waits on you',
    stuck: 'stuck',
    idle: 'idle',
  } as Record<string, string>,
  categoryNamed: (name: string, n: number, parts: string) => `${name}: ${n}${parts ? `, ${parts}` : ''}`,
  categoryEmpty: 'Nothing here right now.',
  open: 'Open',
  openPage: 'Open the page',
  fold: 'Fold',
  due: 'due',

  // Decisions.
  queue: 'Waiting on you',
  itemOf: (i: number, n: number) => `${i} of ${n}`,
  askHer: 'Ask Athena',
  composing: 'She is weighing it',
  details: 'What it will run',
  answer: 'Your answer',
  keys: {
    choose: 'Answers',
    aside: 'Set aside',
    fold: 'Fold back to the app',
  },
  nothingWaiting: 'Nothing waits on you.',
  nothingWaitingSub: 'When she needs a call, the rail lights.',
  aboutThis: (kind: string) => `Re: this ${kind}`,
  noun: {
    session_request: 'session question',
    decision: 'decision',
    approval: 'approval',
    plan: 'plan',
    failure: 'failure',
    warning: 'warning',
    nudge: 'note',
    assignment: 'assignment',
  } as Record<string, string>,
} as const;
