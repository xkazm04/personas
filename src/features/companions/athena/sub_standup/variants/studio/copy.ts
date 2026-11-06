/**
 * PROTOTYPE R2 (2026-11-06) copy for the "Studio" Standup variant. English only;
 * moves into en.json (athena.standup.studio.*) at consolidation. No em dash.
 */
import type { StandupEventKind } from '@/lib/bindings/StandupEventKind';
import type { RowState } from '../../model/types';

export const STUDIO_COPY = {
  col: {
    name: 'Project',
    today: 'Today',
    today_long: '12 days',
    decision: 'Decision',
    tonight: 'Tonight',
    now: 'now',
  },
  state: {
    proposed: 'Proposed',
    decided: 'Decided',
    running: 'Running',
    done: 'Done',
    skipped: 'Skipped',
    waits: 'Waits',
    blank: 'Unset',
    filler: 'Fill',
    refused: 'Held',
  } satisfies Record<RowState, string>,
  meter: {
    of: 'of {n}',
    caption: 'decided',
    hint: '{w} wait for you · {p} proposed · {d} decided · {r} running',
    empty: 'Nothing on the plan yet',
  },
  since_lead: 'Since {time}',
  since_body: '{moved} commits on {p} projects, {parked} asks parked for you',
  since_running: '{n} sessions still running',
  machine: {
    name: 'Machine',
    summary: '{lanes} lanes · {dead}% idle',
    summary_empty: 'No forecast yet',
    zoom: 'Click or press Z for {span}.',
    cpu_hint: 'Host CPU per bin. Green: an agent ran. Hatched: not recorded.',
    cpu_hint_long: 'Host CPU over 12 days. Hatched: not recorded.',
    lanes_hint: '{lanes} lanes, peak {units} units. Solid: your directions. Slate: fill. Amber track: a dead spot nothing fills ({dead}% of lane time).',
  },
  decision: {
    options: '{n} options',
    suggests: 'Athena suggests',
    proposed_plain: 'Pick one of {n} directions',
    agent: 'Accept to {verb} this agent',
    your_call: 'Your call: {options}',
    blank: 'No proposal yet. Type the direction',
    refused: 'Held by a headless master',
  },
  today: {
    moved_word: 'moved',
    moved_hint: 'Commits landed since the last standup: {n}',
  },
  history_hint: 'Armed in {n} of the last {of} standups',
  detail: {
    read: "Athena's read",
    pick: "Athena's pick",
    type: 'Type your own',
    edit: 'Edit',
    skip: 'Skip tonight',
    accept: 'Accept',
    talk: 'Talk it through',
    answer: 'Answer with Athena',
    dossier: 'Dossier',
    undo: 'Undo',
  },
  footer: {
    plan: '{d} directions · {r} runs tonight',
    plan_none: 'Nothing goes tonight yet',
    still: '{n} proposed stay off',
    resolved: 'Everything resolved',
    rules: 'Away rules',
    rules_hint: '{n} kinds always wait for you',
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
