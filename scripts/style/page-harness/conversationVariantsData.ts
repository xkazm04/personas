/**
 * The content every WP12 Conversations variant draws (harness-only fixture).
 * It mirrors `conversationVariantsTape.mjs` line for line, so the "before"
 * shot (today's tab on the tape) and the variants show the same project.
 *
 * Each field names the read that would fill it in Phase B, so a variant
 * cannot lean on data the app does not have:
 *   project.asks      pending manual reviews of the team's members (list_manual_reviews_page)
 *                     + held questions (usePendingInteractions), the rail's lamp count today
 *   project.unread    countUnread(channel) (channelSlice), the sidebar badge today
 *   project.presence  derivePresence(items) (useTeamChannel), the heartbeat dots today
 *   run.outcome       the newest settled step's outputSummary, or the held step's title
 *                     (list_team_assignment_steps); absent when neither exists
 *   delib.leaning     the newest turn of the deliberation, or `resolution.title` once it converged
 */

export interface ProjectFixture {
  id: string;
  name: string;
  color: string;
  asks: number;
  unread: number;
  /** working / waiting / idle members (the Bay share strip's three states). */
  presence: [number, number, number];
  live?: boolean;
  lastMin: number;
}

export const PROJECTS: ProjectFixture[] = [
  { id: 't-personas-desktop', name: 'Personas Desktop', color: '#f59e0b', asks: 4, unread: 0, presence: [3, 1, 8], live: true, lastMin: 1 },
  { id: 't-docs', name: 'Docs', color: '#3b82f6', asks: 1, unread: 3, presence: [1, 0, 2], lastMin: 12 },
  { id: 't-legal', name: 'Legal', color: '#ef4444', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 300 },
  { id: 't-research', name: 'Research', color: '#ec4899', asks: 0, unread: 2, presence: [1, 0, 1], live: true, lastMin: 25 },
  { id: 't-people', name: 'People', color: '#84cc16', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 1440 },
  { id: 't-growth', name: 'Growth', color: '#06b6d4', asks: 0, unread: 1, presence: [0, 0, 1], lastMin: 95 },
  { id: 't-support', name: 'Support', color: '#a855f7', asks: 2, unread: 0, presence: [0, 1, 0], lastMin: 40 },
  { id: 't-data', name: 'Data', color: '#10b981', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 600 },
  { id: 't-marketing', name: 'Marketing', color: '#f59e0b', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 2000 },
  { id: 't-finance', name: 'Finance', color: '#3b82f6', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 3000 },
  { id: 't-infra', name: 'Infra', color: '#ef4444', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 4000 },
  { id: 't-sales', name: 'Sales', color: '#ec4899', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 5000 },
  { id: 't-ops', name: 'Ops', color: '#84cc16', asks: 0, unread: 0, presence: [0, 0, 1], lastMin: 6000 },
];

/** The persona conversations (the sidebar's Personas group): persona id, unread, minutes. */
export const PERSONA_THREADS: Array<{ personaId: string; unread: number; lastMin: number }> = [
  { personaId: 'p-board-0', unread: 1, lastMin: 3 },
  { personaId: 'p-board-3', unread: 1, lastMin: 62 },
];

export const [RELEASE, REVIEWER, SCRIBE, DRAFTER] = ['p-board-0', 'p-board-1', 'p-board-2', 'p-board-3'];

export type Tier = 1 | 2 | 3;

/** One thing the project holds for the operator, in the deck's vocabulary. */
export interface AskFixture {
  id: string;
  kind: 'review' | 'question';
  personaId: string;
  title: string;
  body: string;
  /** 1 blocking (a run waits on it), 2 decide, 3 low. */
  tier: Tier;
  minutes: number;
  /** The yes and no verbs the verdict pair prints. */
  accept: string;
  reject: string;
  /** "If you approve" / "If you reject" effects (dc_deck_yes_review / dc_deck_no_review for a review). */
  yes: string;
  no: string;
  /** A held question's options: a digit picks one. */
  options?: string[];
  /** The run it holds, if any (the band shows "waiting on you"). */
  runId?: string;
  branch?: string;
}

const YES_REVIEW = 'The run resumes with this output.';
const NO_REVIEW = 'The output is rejected and the step does not resume with it.';

export const ASKS: AskFixture[] = [
  {
    id: 'rv-roof-1', kind: 'review', personaId: RELEASE, title: 'Publish the 1.1 release notes?',
    body: 'The notes call out a breaking change to the vault export format.', tier: 1, minutes: 5,
    accept: 'Approve', reject: 'Reject', yes: YES_REVIEW, no: NO_REVIEW, runId: 'asg-live',
  },
  {
    id: 'rv-wp12-2', kind: 'review', personaId: REVIEWER, title: 'Merge PR #482, the settings chunk split?',
    body: 'Green on CI. It changes vite.config chunking, so the next release build is the first real test.', tier: 2, minutes: 1,
    accept: 'Approve', reject: 'Reject', yes: 'PR #482 merges into master now.', no: NO_REVIEW, branch: 'Merge after one more CI run',
  },
  {
    id: 'q-wp12-1', kind: 'question', personaId: DRAFTER, title: 'Which readers is the 1.1 launch post for?',
    body: 'The outline changes with the audience.', tier: 2, minutes: 20,
    accept: 'Answer', reject: 'Skip', yes: 'Blog Drafter writes the post for that audience.', no: 'Blog Drafter waits.',
    options: ['Operators', 'Developers', 'Both, operators first'],
  },
  {
    id: 'rv-wp12-3', kind: 'review', personaId: SCRIBE, title: 'Close 11 Sentry issues as noise?',
    body: 'All 11 are the same ResizeObserver warning from a browser extension.', tier: 3, minutes: 130,
    accept: 'Approve', reject: 'Reject', yes: 'The 11 issues close as noise.', no: 'They stay open in Sentry.',
  },
];

export interface StepFixture { id: string; title: string; status: 'done' | 'awaiting_review' | 'running'; personaId: string; summary?: string }

export type ThreadRow =
  | { kind: 'day'; label: string }
  | { kind: 'run'; id: string; goal: string; state: 'done' | 'review' | 'running'; outcome: string; minutes: number; steps: StepFixture[]; askId?: string }
  | { kind: 'delib'; id: string; topic: string; leaning: string; round: number; spent: number; budget: number; minutes: number; voices: string[]; turns: Array<{ personaId: string; body: string }> }
  | { kind: 'talk'; id: string; who: 'persona' | 'athena' | 'operator'; personaId?: string; body: string; minutes: number }
  | { kind: 'proposal'; id: string; goal: string; steps: Array<{ title: string; personaId: string | null }> };

export const THREAD: ThreadRow[] = [
  { kind: 'day', label: 'Today' },
  {
    kind: 'run', id: 'asg-done', goal: 'Triage the Sentry backlog', state: 'done', minutes: 140,
    outcome: '14 issues triaged: 3 filed as bugs, 11 are one extension warning.',
    steps: [{ id: 'st-9', title: 'Triage the Sentry backlog', status: 'done', personaId: SCRIBE, summary: '3 bugs filed (#511, #512, #514). 11 issues share one ResizeObserver warning from a browser extension.' }],
  },
  { kind: 'talk', id: 'rc-3', who: 'athena', body: 'Yesterday\'s PR review backlog is clear: 6 reviewed, 1 sent back.', minutes: 95 },
  {
    kind: 'delib', id: 'dl-1', topic: 'One settings chunk or two?', leaning: 'Keep one chunk and lazy-load the editor only.',
    round: 3, spent: 1.8, budget: 5, minutes: 48, voices: [REVIEWER, SCRIBE],
    turns: [
      { personaId: SCRIBE, body: 'Cold start is the path the operator sees most. I would keep one chunk and lazy-load the editor only.' },
      { personaId: REVIEWER, body: 'Splitting the settings chunk saves 180 kB but adds a second request on cold start.' },
    ],
  },
  { kind: 'talk', id: 'rc-6', who: 'operator', body: 'Ship the 1.1 notes today, keep the vault change at the top.', minutes: 30 },
  { kind: 'talk', id: 'rc-q', who: 'persona', personaId: DRAFTER, body: 'Before I outline the 1.1 launch post: which readers is it for?', minutes: 20 },
  {
    kind: 'run', id: 'asg-live', goal: 'Ship the 1.1 release notes', state: 'review', minutes: 9, askId: 'rv-roof-1',
    outcome: 'Notes drafted. Publishing waits on your review.',
    steps: [
      { id: 'st-1', title: 'Draft the notes', status: 'done', personaId: RELEASE, summary: 'Draft in docs/releases/1.1.md, vault export change first.' },
      { id: 'st-2', title: 'Publish to the changelog', status: 'awaiting_review', personaId: RELEASE },
    ],
  },
  { kind: 'talk', id: 'rc-9', who: 'persona', personaId: RELEASE, body: 'Release notes for 1.1 are drafted. The **breaking change** to the vault export needs your eyes before I publish.', minutes: 4 },
  { kind: 'talk', id: 'rc-11', who: 'operator', body: 'Looks right. Link the migration guide from the vault line before it goes out.', minutes: 2 },
  { kind: 'talk', id: 'rc-12', who: 'persona', personaId: REVIEWER, body: 'Settings split PR #482 is green. Merging needs your sign-off because it touches the build config.', minutes: 1 },
  {
    kind: 'proposal', id: 'pr-1', goal: 'Write the 1.1 upgrade guide',
    steps: [{ title: 'Outline the vault export migration', personaId: RELEASE }, { title: 'Draft and link it from the notes', personaId: DRAFTER }],
  },
];

/** Words the variants need that the catalog does not have yet: proposed `monitor.cv_*` keys for Phase B. */
export const COPY = {
  needsYou: 'Needs you',
  colNew: 'New',
  colYou: 'You',
  happened: 'What happened',
  thread: 'Thread',
  runDone: 'Run done',
  runWaiting: 'Waiting on you',
  runRunning: 'Running',
  deliberation: 'Deliberation',
  converging: 'Converging',
  leaning: 'Leaning',
  roundOf: 'round {round}',
  persona: 'Personas',
  later: 'Later',
  ofTotal: '{n} of {total}',
  question: 'Question',
  review: 'Review',
  gates: 'Gates',
  blocking: 'Blocking a run',
  from: 'from {name}',
  composer: 'Message {team}, or describe work to route it',
  steps: 'Steps',
  turns: '{count} turns',
  walk: 'walk',
  pick: 'pick',
  close: 'Close',
  prev: 'Previous',
  next: 'Next',
  open: 'Open the thread',
  allClear: 'Nothing else is waiting on you here.',
  route: 'Route',
  proposal: 'Routed, confirm to run',
  run: 'Run it',
  drop: 'Drop',
  inRun: 'in {run}',
} as const;

export const fill = (s: string, vars: Record<string, string | number>): string =>
  s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
