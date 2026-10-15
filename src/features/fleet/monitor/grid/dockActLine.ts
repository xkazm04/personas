// The dock's act ticker, as data (mandate-lanes WP7): every
// `charter-act-recorded` folds into ONE line, "App Master · personas filed 3
// reports as evidence". Acts of one mandate, by the same hand (the steward's
// grant, router included, or you) and with the same verb, coalesce while they
// land within `TICK_WINDOW_MS` of the line's last act; anything else starts a
// new line. The verbs come from `actWords`, the same words the act log uses.

import type { Translations } from '@/i18n/generated/types';
import type { CharterAct } from '@/lib/bindings/CharterAct';

import { verbOf, type ActVerb } from './prototype/entry-e/mandate/actWords';

type M = Translations['monitor'];
type Tx = (template: string, vars: Record<string, string | number>) => string;

/** Acts this close to the line's last one join it. */
export const TICK_WINDOW_MS = 2 * 60_000;

export interface TickLine {
  charterId: string;
  /** `you` for the operator's own acts; `steward` for the steward and its router. */
  hand: 'you' | 'steward';
  verb: ActVerb;
  /** Distinct act ids folded into the line (an event delivered twice counts once). */
  actIds: readonly string[];
  /** The newest act: what a press opens the act log at. */
  latestActId: string;
  lastAt: number;
}

function verbOfAct(act: CharterAct): ActVerb {
  return act.itemKind === 'act.revert' ? 'reverted' : verbOf(act.verdict);
}

export function coalesceAct(prev: TickLine | null, act: CharterAct): TickLine {
  const hand = act.actor === 'operator' ? 'you' : 'steward';
  const verb = verbOfAct(act);
  const parsed = Date.parse(act.createdAt);
  const at = Number.isFinite(parsed) ? parsed : prev?.lastAt ?? 0;
  const same = prev !== null && prev.charterId === act.charterId && prev.hand === hand && prev.verb === verb
    && Math.abs(at - prev.lastAt) <= TICK_WINDOW_MS;
  if (!same) return { charterId: act.charterId, hand, verb, actIds: [act.id], latestActId: act.id, lastAt: at };
  if (prev.actIds.includes(act.id)) return prev;
  const newer = at >= prev.lastAt;
  return {
    ...prev,
    actIds: [...prev.actIds, act.id],
    latestActId: newer ? act.id : prev.latestActId,
    lastAt: Math.max(at, prev.lastAt),
  };
}

/** What the line says was done, counted where a count means something. */
export function tickWhat(m: M, tx: Tx, verb: ActVerb, count: number): string {
  const n = (one: string, other: string) => tx(count === 1 ? one : other, { count });
  switch (verb) {
    case 'filed': return n(m.ml_tick_filed_one, m.ml_tick_filed_other);
    case 'approved': return n(m.ml_tick_approved_one, m.ml_tick_approved_other);
    case 'acknowledged': return n(m.ml_tick_acknowledged_one, m.ml_tick_acknowledged_other);
    case 'accepted': return n(m.ml_tick_accepted_one, m.ml_tick_accepted_other);
    case 'rejected': return n(m.ml_tick_rejected_one, m.ml_tick_rejected_other);
    case 'reverted': return n(m.ml_tick_reverted_one, m.ml_tick_reverted_other);
    case 'decided': return n(m.ml_tick_decided_one, m.ml_tick_decided_other);
    case 'signed': return m.ml_tick_signed;
    case 'widened': return m.ml_tick_widened;
    case 'narrowed': return m.ml_tick_narrowed;
    case 'merge_set': return m.ml_tick_merge_set;
    case 'budget_set': return m.ml_tick_budget_set;
    case 'suspended': return m.ml_tick_suspended;
    case 'resumed': return m.ml_tick_resumed;
    case 'dropped': return m.ml_tick_dropped;
    case 'kept': return m.ml_tick_kept;
    case 'drafted': return m.ml_tick_drafted;
    case 'adopted': return m.ml_tick_adopted;
  }
}

export interface TickNames {
  steward: string | null;
  project: string | null;
}

/**
 * The steward's name without a trailing "· <project>": App Master personas are
 * often named for their project, and the line names the project right after.
 */
export function stewardWord(steward: string, project: string | null): string {
  const s = steward.trimEnd();
  if (!project || !s.toLowerCase().endsWith(project.toLowerCase())) return steward;
  const rest = s.slice(0, s.length - project.length);
  const head = rest.replace(/\s*[·|:-]\s*$/, '');
  // Only a separated suffix is the project; "Personas" alone stays whole.
  return head !== rest && head.trim() !== '' ? head : steward;
}

export function tickText(m: M, tx: Tx, line: TickLine, names: TickNames | undefined): string {
  const project = names?.project ?? null;
  return tx(m.ml_tick_line, {
    who: line.hand === 'you' ? m.ml_tick_you : names?.steward ? stewardWord(names.steward, project) : m.ml_steward_unknown,
    project: project ?? m.ml_project_unknown,
    what: tickWhat(m, tx, line.verb, line.actIds.length),
  });
}
