/**
 * R5 · B "Instrument" — prototype copy (English). Mirrors `../filament/copy.ts`:
 * a losing variant costs no translation work across 13 languages.
 *
 * TODO(prototype, 2026-10-07): extract to i18n when a winner is picked
 */

import type { WorkItemKind } from '../../../useWorkforce';

export const R5B_COPY = {
  tab: 'R5 · B',
  name: 'Athena instrument',
  athena: 'Athena',

  // Time spine
  spine: 'Run timeline, last hour',
  openBoard: 'Open the timeline',
  closeBoard: 'Fold the timeline',
  now: 'now',
  hour: '1h',
  ago: (m: number) => (m <= 0 ? 'now' : m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}`),
  scale: (m: number) => (m === 0 ? 'now' : m === 60 ? '−1h' : `−${m}m`),
  gates: (n: number) => (n === 1 ? '1 gate waits on you' : `${n} gates wait on you`),
  noGates: 'Nothing waits on you',
  gatesShort: (n: number) => (n === 1 ? '1 gate' : `${n} gates`),
  runs: (n: number) => (n === 1 ? '1 run live' : `${n} runs live`),
  moreLanes: (n: number) => `+${n}`,
  moreLanesLong: (n: number) => `${n} more runs on the Fleet page`,
  lanesOf: (project: string, runs: number, gates: number) =>
    `${project}: ${runs} run${runs === 1 ? '' : 's'}${gates ? `, ${gates} gate${gates === 1 ? '' : 's'}` : ''}`,
  nothingRunning: 'No runs in the last hour',
  waitsFor: 'waits for',
  since: 'for',
  openRun: (name: string) => `Open ${name}`,

  // What a gate waits for, as a label (never the whole question).
  gateKind: {
    session_request: 'Your answer',
    decision: 'Decision',
    approval: 'Approval',
    plan: 'Plan',
    failure: 'Failure',
    warning: 'Warning',
    nudge: 'Notice',
    assignment: 'Assignment',
    input: 'Your input',
  } satisfies Record<WorkItemKind | 'input', string>,
  laneState: {
    working: 'working',
    queued: 'queued',
    idle: 'idle',
    stale: 'stuck',
    gate: 'waits',
  },
  noOps: 'No live ops',
  ops: (n: number) => (n === 1 ? '1 op' : `${n} ops`),

  // Phase readout
  phase: {
    ready: 'Ready',
    working: 'Working',
    thinking: 'Thinking',
    tool: 'Tool',
    reviewing: 'Reviewing',
    responding: 'Writing',
  },
  replied: 'replied',
  openTranscript: 'Show the conversation',
  closeTranscript: 'Fold the conversation',
  stop: 'Stop',
  placeholder: 'Talk to Athena',
  about: 're',

  // Transcript
  you: 'You',
  earlier: (n: number) => `${n} earlier turns`,
  steps: (n: number) => (n === 1 ? '1 step' : `${n} steps`),
  hideSteps: 'Hide steps',
  noMessage: 'Say something to Athena.',
  noMessageSub: 'She answers here, and anything she needs from you lands on the timeline.',

  // Control surface
  queueOf: (i: number, n: number) => `${i} of ${n} waiting`,
  prev: 'Previous waiting item',
  next: 'Next waiting item',
  askKey: 'Ask Athena',
  askHint: 'Her pick lights up with the reason beside it',
  herPick: 'Her pick',
  confirm: 'confirms her pick',
  composing: 'Athena is weighing the options',
  fold: 'Back to the timeline',
  allClear: 'All clear.',
  allClearSub: 'Nothing on the timeline waits on you.',
  keys: { choose: 'choose', ask: 'ask Athena', confirm: 'confirm her pick', walk: 'walk the queue' },
} as const;
