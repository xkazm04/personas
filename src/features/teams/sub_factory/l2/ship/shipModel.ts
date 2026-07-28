// Ship-layer view model — types, ink, and pure derivations. The LIVE adapter
// (useShipData) maps real dev_tools rows (dev_milestones + members joined
// against use cases / goals / contexts / KPIs / runtime signals) into these
// shapes; the Ship surfaces consume them unchanged. Mirrors the factoryModel /
// factoryData adapter split. Nothing here is typed in by the user: progress,
// footprint, and exit criteria all derive from signals the Factory already
// trusts.
import type { DevMilestone } from '@/lib/bindings/DevMilestone';

import { INK } from '../../passport/passportInk';

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
  /** Active KPIs measuring this context — 0 is a coverage gap. */
  kpis: number;
  /** Sentry errors this week; null when monitoring isn't wired. */
  errors: number | null;
}

/** A use case seen through the Ship lens, with derived readiness. */
export interface ShipFeature {
  id: string;
  name: string;
  /** Context NAMES the feature slices (display-ready). */
  contexts: string[];
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
  contexts: string[];
}

/** A milestone scope member (use-case kind). */
export interface ShipMember {
  feature: ShipFeature;
  bucket: ScopeBucket;
  /** Joined after the cut — scope creep awaiting triage. */
  afterCut: boolean;
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
  goal: string | null;
  status: MilestoneStatus;
  targetLabel: string | null;
  members: ShipMember[];
  boundGoals: ShipGoal[];
  /** Derived from CORE members' slices — never hand-picked. */
  footprint: ShipContext[];
  criteria: ExitCriterion[];
  /** Ready core members / total core members (100 once shipped). */
  progress: number;
}

// -- ink ----------------------------------------------------------------------

export const CRIT_HUE: Record<CritState, string> = {
  go: INK.emerald,
  warn: INK.amber,
  nogo: INK.red,
  setup: INK.blue,
};

export const BUCKET_META: Record<ScopeBucket, { label: string; hue: string }> = {
  core: { label: 'Core', hue: INK.teal },
  later: { label: 'Later', hue: 'rgba(148,163,184,.7)' },
  never: { label: 'Never', hue: 'rgba(148,163,184,.4)' },
};

export const TONE_HUE_MAP: Record<ContextTone, string> = {
  ok: INK.emerald,
  warn: INK.amber,
  crit: INK.red,
  setup: INK.blue,
};

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
export function featureState(kpiCount: number, critContext: string | null): {
  ready: boolean;
  stateLabel: string;
  stateHue: string;
} {
  if (critContext) return { ready: false, stateLabel: 'Blocked', stateHue: INK.red };
  if (kpiCount === 0) return { ready: false, stateLabel: 'No KPI yet', stateHue: INK.blue };
  return { ready: true, stateLabel: 'Ready', stateHue: INK.emerald };
}
