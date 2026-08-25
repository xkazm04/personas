// Ship-layer view model — types, ink, and pure derivations. The LIVE adapter
// (useShipData) maps real dev_tools rows (dev_milestones + members joined
// against use cases / goals / contexts / KPIs / runtime signals) into these
// shapes; the Ship surfaces consume them unchanged. Mirrors the factoryModel /
// factoryData adapter split. Nothing here is typed in by the user: progress,
// footprint, and exit criteria all derive from signals the Factory already
// trusts.
//
// Note on vocabulary: the UI says "feature"; the schema/identifiers say
// `use_case` (the db contract). Only the labels were renamed.
import type { Translations } from '@/i18n/generated/types';
import type { DevMilestone } from '@/lib/bindings/DevMilestone';

import { INK } from '../../passport/passportInk';
import type { DualitySummary } from './shipDuality';

export type ScopeBucket = 'core' | 'later' | 'never';
/** go = met · warn = partial · nogo = blocking · setup = sensor/scope not wired. */
export type CritState = 'go' | 'warn' | 'nogo' | 'setup';
export type ContextTone = 'ok' | 'warn' | 'crit' | 'setup';
export type MilestoneStatus = 'planned' | 'active' | 'shipped';

/** A context seen through the Ship lens: health + KPI coverage. */
export interface ShipContext {
  id: string;
  name: string;
  tone: ContextTone;
  /** Owning context group (null = ungrouped). */
  groupId: string | null;
  /** Parsed file paths — the drawer's coverage record. */
  files: string[];
  /** Active KPIs measuring this context — 0 is a coverage gap. */
  kpis: number;
  /** Sentry errors this week; null when monitoring isn't wired. */
  errors: number | null;
}

export interface ShipGroup {
  id: string;
  name: string;
  color: string;
}

/** A feature (use case) seen through the Ship lens, with derived readiness. */
export interface ShipFeature {
  id: string;
  name: string;
  /** Context NAMES the feature slices (display-ready). */
  contexts: string[];
  /**
   * Context IDs the feature slices, positionally aligned with `contexts`.
   * The footprint joins on THESE: display names collide (the generated map
   * emits "area [1/3]" / "[2/3]") and every rescan can rename a context, so a
   * name join silently shrinks the scope the exit criteria are computed on.
   */
  contextIds: string[];
  kpiCount: number;
  /** ready = measurable (≥1 KPI) and no critical context in the slice. */
  ready: boolean;
  stateLabel: string;
  stateHue: string;
  /** The single strongest blocking signal, when one exists. */
  blocker?: string | null;
}

export interface ShipGoal {
  id: string;
  name: string;
  description: string | null;
  status: string;
  /** Context NAMES the goal hangs off (display-ready). */
  contexts: string[];
  /**
   * Context IDs, positionally aligned with `contexts`. Same reason as
   * `ShipFeature.contextIds`: display names collide, so every "which contexts
   * does this belong to" join resolves on THESE.
   */
  contextIds: string[];
}

/** A milestone scope member (feature kind). */
export interface ShipMember {
  feature: ShipFeature;
  bucket: ScopeBucket;
  /** Joined after the cut — scope creep awaiting triage. */
  afterCut: boolean;
  /** Operator's note on why this member sits in this bucket. */
  description: string | null;
  /**
   * Operator's own 1..5 read on the member. `null` is UNRATED — a state of its
   * own, never a zero and never equivalent to a 1. Nothing derived from this
   * touches the ship verdict or progress; it is a second opinion, not a gate.
   */
  rating: number | null;
}

export interface ExitCriterion {
  id: string;
  label: string;
  /** Derived evidence line — the "why", never hand-typed. */
  evidence: string;
  done: number;
  total: number;
  state: CritState;
}

export interface ShipMilestoneVM {
  row: DevMilestone;
  id: string;
  name: string;
  /** The objective, as a SHORT TITLE — the Ship tab's heading. */
  goal: string | null;
  /** What shipping this means, in prose. Never rendered as the heading. */
  description: string | null;
  status: MilestoneStatus;
  targetLabel: string | null;
  members: ShipMember[];
  boundGoals: ShipGoal[];
  /** Derived from CORE members' slices — never hand-picked. */
  footprint: ShipContext[];
  criteria: ExitCriterion[];
  /**
   * Done core members / total core members, 0-100 (100 once shipped). BOTH
   * kinds count: a core feature is done when the automation calls it ready, a
   * core goal when its status does. See `deriveProgress`.
   */
  progress: number;
  /**
   * How the operator's ratings line up against the automation's readiness on
   * the CORE cut. Reporting only — see shipDuality.ts.
   */
  duality: DualitySummary;
}

// -- ink ----------------------------------------------------------------------

export const CRIT_HUE: Record<CritState, string> = {
  go: INK.emerald,
  warn: INK.amber,
  nogo: INK.red,
  setup: INK.blue,
};

export const TONE_HUE_MAP: Record<ContextTone, string> = {
  ok: INK.emerald,
  warn: INK.amber,
  crit: INK.red,
  setup: INK.blue,
};

export const BUCKET_HUE: Record<ScopeBucket, string> = {
  core: INK.teal,
  later: 'rgba(148,163,184,.7)',
  never: 'rgba(148,163,184,.4)',
};

export function bucketLabel(t: Translations, b: ScopeBucket): string {
  return b === 'core' ? t.ship.bucket_core : b === 'later' ? t.ship.bucket_later : t.ship.bucket_never;
}

// -- derivations --------------------------------------------------------------

/** Overall verdict: nogo > setup > warn > go. */
export function shipVerdict(criteria: ExitCriterion[]): CritState {
  const states = criteria.map((c) => c.state);
  if (states.includes('nogo')) return 'nogo';
  if (states.includes('setup')) return 'setup';
  if (states.includes('warn')) return 'warn';
  return 'go';
}

/** Feature readiness label from derived signals (the row's right-edge ink). */
export function featureState(t: Translations, kpiCount: number, critContext: string | null): {
  ready: boolean;
  stateLabel: string;
  stateHue: string;
} {
  if (critContext) return { ready: false, stateLabel: t.ship.state_blocked, stateHue: INK.red };
  if (kpiCount === 0) return { ready: false, stateLabel: t.ship.state_no_kpi, stateHue: INK.blue };
  return { ready: true, stateLabel: t.ship.state_ready, stateHue: INK.emerald };
}
