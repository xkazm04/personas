/**
 * PROTOTYPE R2-A "Console" (2026-11-06) copy for the Standup layout. English only;
 * moves into en.json (athena.standup.console.*) at consolidation. No em dash.
 */
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';

export const CONSOLE_COPY = {
  col: {
    name: 'Project',
    today: 'Today',
    today_long: '12 days',
    decision: 'Decision',
    tonight: 'Tonight',
  },
  meter: {
    decided: 'decided',
    waits: 'wait on you',
    hint: '{w} wait for you · {p} proposed · {d} decided · {r} running',
    empty: 'Nothing on the plan yet',
  },
  state_waits: 'your call',
  since_lead: 'since',
  since_body: '{moved} commits moved on {p} projects, {parked} asks parked for you',
  since_running: '{n} sessions still running',
  machine: {
    name: 'Machine',
    idle: 'idle tonight',
    lanes: '{lanes} lanes',
    summary_empty: 'No forecast yet',
    now: 'Clock',
    zoom: 'Click or press Z for {span}.',
    cpu_hint: 'Host CPU per bin. Green: an agent ran. Dotted: not recorded.',
    cpu_hint_long: 'Host CPU over 12 days. Dotted: not recorded.',
    lanes_hint: '{lanes} lanes, peak {units} units. Solid: your directions. Grey: fill. Dotted: a dead spot nothing fills ({dead}% of lane time).',
  },
  decision: {
    options: '{n} options',
    proposed_plain: 'Pick one of {n} directions',
    agent: 'Accept to {verb} this agent',
    your_call: '{options}',
    blank: 'No proposal yet. Type the direction',
    refused: 'Held by a headless master',
  },
  today: {
    moved_word: 'moved',
    moved_hint: 'Commits landed since the last standup: {n}',
  },
  history_hint: 'Armed in {n} of the last {of} standups',
  detail: {
    read: 'Read',
    pick: "Athena's pick",
    type: 'Type your own',
    edit: 'Edit the direction',
    skip: 'Skip tonight',
    accept: 'Accept',
    talk: 'Talk it through',
    answer: 'Answer it with Athena',
    dossier: 'Dossier',
    undo: 'Undo',
  },
  footer: {
    directions: 'directions',
    runs: 'runs go tonight',
    off: 'proposed stay off',
    resolved: 'all resolved',
    plan_none: 'Nothing goes tonight yet',
    rules: 'Away rules',
    locked: '{n} locked',
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
