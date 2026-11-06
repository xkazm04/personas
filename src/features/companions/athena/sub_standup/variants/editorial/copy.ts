/**
 * PROTOTYPE R2-B (2026-11-06) copy for the "Editorial" Standup layout. English only;
 * moves into en.json (athena.standup.editorial.*) at consolidation. No em dash.
 */
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';

export const ED_COPY = {
  col: {
    name: 'Project',
    today: 'Today',
    today_long: '12 days',
    decision: 'Decision',
    tonight: 'Tonight',
  },
  meter: {
    progress: '{d} of {n} decided',
    of: 'of',
    decided: 'decided',
    hint: '{w} wait for you · {p} proposed · {d} decided · {r} running',
    empty: 'Nothing on the plan yet',
  },
  since_lead: 'Since',
  since_body: '{moved} commits moved on {p} projects, {parked} asks parked for you',
  since_running: '{n} sessions still running',
  machine: {
    name: 'Machine',
    now: 'now',
    summary: '{lanes} lanes · {dead}% idle tonight',
    summary_empty: 'No forecast yet',
    zoom: 'Click or press Z for {span}.',
    cpu_hint: 'Host CPU per bin. Green: an agent ran. Stippled: not recorded.',
    cpu_hint_long: 'Host CPU over 12 days. Stippled: not recorded.',
    lanes_hint: '{lanes} lanes, peak {units} units. Solid: your directions. Grey: fill. Warm stipple: a dead spot nothing fills ({dead}% of lane time).',
  },
  decision: {
    proposed: '{n} directions. Athena suggests: {pick}',
    proposed_plain: '{n} directions to choose from',
    proposed_lead: '{n} directions. Athena suggests:',
    agent: 'Accept to {verb} this agent',
    your_call: 'Your call: {options}',
    blank: 'No proposal yet. Type the direction',
    refused: 'Held by a headless master',
  },
  today: {
    moved_word: 'moved',
    moved_hint: 'Commits landed since the last standup: {n}',
  },
  tonight: {
    none: 'Nothing scheduled',
    blocks_hint: '{n} forecast runs tonight',
  },
  history_hint: 'Armed in {n} of the last {of} standups',
  detail: {
    read: "Athena's read",
    pick: "Athena's pick",
    directions: 'Directions',
    keys: 'Press 1 to {n}',
    chosen: 'Chosen',
    type: 'Type your own',
    edit: 'Edit the direction',
    skip: 'Skip tonight',
    accept: 'Accept',
    talk: 'Talk it through',
    answer: 'Answer it with Athena',
    dossier: 'Dossier',
    undo: 'Undo',
  },
  state: {
    waits: 'waits',
    blank: 'to type',
    refused: 'held',
  },
  footer: {
    plan: '{d} directions and {r} runs go tonight.',
    plan_none: 'Nothing goes tonight yet.',
    still: '{n} still proposed stay off.',
    resolved: 'Everything is resolved.',
    rules: 'Away rules · {n} locked',
    help: 'Legend and keys',
    help_keys: 'Press ? for every key',
  },
  kinds: {
    push: 'Pushes',
    dispatch: 'Dispatches',
    ask_parked: 'Asks parked',
    ask_delegated: 'Asks delegated',
    stop: 'Stops',
    drift: 'Drift',
    agent_created: 'Agents created',
    agent_retuned: 'Agents retuned',
    sweep: 'Sweeps',
    backfill: 'Backfills',
  } satisfies Record<StandupEventKind, string>,
} as const;

/** "{a} and {b}" interpolation without the i18n proxy (copy.ts strings are plain). */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
