/**
 * Fusion · decision v1 ("Review desk") - prototype copy, English only.
 *
 * TODO(prototype, 2026-10-07): extract to i18n when a winner is picked
 */

export const DESK_COPY = {
  athena: 'Athena',
  aSession: 'A session',
  appWide: 'App-wide',
  review: (i: number, n: number) => `Review ${i} of ${n}`,
  position: (i: number, n: number) => `${i} of ${n}`,
  prev: 'Previous',
  next: 'Next',
  fold: 'Fold back to the app',
  askHer: 'Ask Athena',
  askHint: 'She weighs the options and marks the one she would take',
  composing: 'Athena is weighing it',
  composingSub: 'Her pick lands on its card',
  recommends: 'Athena recommends',
  takeIt: 'takes it',
  safe: 'Safe answer',
  aside: 'Set aside',
  asideHint: 'Leave it in the queue and look at the next one',
  details: 'What it will run',
  choose: 'Answers',
  yourAnswer: 'Your answer',
  newLine: 'Shift+Enter for a new line',
  sessionApproval: 'Session approval',
  risk: { low: 'Low risk', elevated: 'Elevated risk' },
  kind: {
    session_request: 'Session question',
    decision: 'Decision',
    approval: 'Approval',
    plan: 'Plan',
    failure: 'Failure',
    warning: 'Warning',
    nudge: 'Note',
    assignment: 'Assignment',
  } as Record<string, string>,
} as const;
