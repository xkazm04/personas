// Ship-tab PROTOTYPE model — the milestone / convergence layer between the
// passport (scaffolding) and the KPI module (post-ship operation).
//
// Design intent (see the Ship-tab design discussion): every Factory mechanism
// today is a divergent generator (scans create more contexts / features /
// KPIs); nothing converges. A milestone is a CUT over the already-generated
// scope plus DERIVED exit criteria — progress is computed from signals the
// Factory already trusts, never typed in.
//
// This module is throwaway-prototype grade: one rich mock milestone that
// exercises every state (met / partial / unmet / unwired criterion, done /
// verify / building / todo features, post-cut scope creep). The real data
// layer (dev_milestones + milestone_id on use cases/goals) comes after a
// variant wins.
import { INK } from '../../passport/passportInk';

export type ScopeBucket = 'core' | 'later' | 'never';
export type FeatureState = 'done' | 'verify' | 'building' | 'todo';
export type CritKind = 'contexts' | 'passport' | 'kpi' | 'verify';
/** go = met · warn = partial · nogo = blocking · setup = sensor not wired. */
export type CritState = 'go' | 'warn' | 'nogo' | 'setup';

export interface ShipFeature {
  id: string;
  name: string;
  /** Context names the feature slices (derived from use case context_ids). */
  contexts: string[];
  bucket: ScopeBucket;
  state: FeatureState;
  /** The single strongest blocking signal, when one exists. */
  blocker?: string | null;
  /** Proposed AFTER the cut — scope creep awaiting triage. */
  sinceCut?: boolean;
}

export interface ExitCriterion {
  id: string;
  kind: CritKind;
  label: string;
  /** Derived evidence line — the "why", never hand-typed. */
  evidence: string;
  done: number;
  total: number;
  state: CritState;
  /** Fleet-dispatchable gap closer, when one applies. */
  dispatch?: string;
}

export type MilestoneStatus = 'shipped' | 'active' | 'planned';

export interface ShipMilestone {
  id: string;
  name: string;
  status: MilestoneStatus;
  /** The one-sentence core-value statement the cut converges on. */
  goal: string;
  cutAgeDays: number;
  /** Target date while open; ship date once shipped. */
  targetLabel: string | null;
  criteria: ExitCriterion[];
  features: ShipFeature[];
}

// -- ink ----------------------------------------------------------------------

export const CRIT_HUE: Record<CritState, string> = {
  go: INK.emerald,
  warn: INK.amber,
  nogo: INK.red,
  setup: INK.blue,
};

export const FEATURE_STATE_META: Record<FeatureState, { label: string; hue: string; weight: number }> = {
  done: { label: 'Done', hue: INK.emerald, weight: 1 },
  verify: { label: 'Verify', hue: INK.teal, weight: 0.75 },
  building: { label: 'Building', hue: INK.amber, weight: 0.4 },
  todo: { label: 'Not started', hue: 'rgba(148,163,184,.55)', weight: 0 },
};

export const BUCKET_META: Record<ScopeBucket, { label: string; hue: string }> = {
  core: { label: 'Core', hue: INK.teal },
  later: { label: 'Later', hue: 'rgba(148,163,184,.7)' },
  never: { label: 'Never', hue: 'rgba(148,163,184,.4)' },
};

// -- derivations (all pure — the "never typed in" rule) -----------------------

/** Weighted completion over the CORE cut (post-cut arrivals excluded). */
export function shipProgress(m: ShipMilestone): number {
  const core = m.features.filter((f) => f.bucket === 'core' && !f.sinceCut);
  if (core.length === 0) return 0;
  const sum = core.reduce((s, f) => s + FEATURE_STATE_META[f.state].weight, 0);
  return Math.round((sum / core.length) * 100);
}

export function creepItems(m: ShipMilestone): ShipFeature[] {
  return m.features.filter((f) => f.sinceCut);
}

export function coreFeatures(m: ShipMilestone): ShipFeature[] {
  return m.features.filter((f) => f.bucket === 'core' && !f.sinceCut);
}

/** Overall verdict: nogo > setup > warn > go. */
export function shipVerdict(m: ShipMilestone): CritState {
  const states = m.criteria.map((c) => c.state);
  if (states.includes('nogo')) return 'nogo';
  if (states.includes('setup')) return 'setup';
  if (states.includes('warn')) return 'warn';
  return 'go';
}

// -- the mock milestone -------------------------------------------------------

export const MOCK_MILESTONE: ShipMilestone = {
  id: 'm-v1',
  name: 'v1 — First Ship',
  status: 'active',
  goal: 'A visitor can adopt a template, bind one credential, and see their first persona run end-to-end.',
  cutAgeDays: 12,
  targetLabel: 'Aug 15',
  criteria: [
    {
      id: 'crit-verify',
      kind: 'verify',
      label: 'Core features verified',
      evidence: '9 of 12 core features pass their verify run; 2 building, 1 unverified',
      done: 9,
      total: 12,
      state: 'warn',
    },
    {
      id: 'crit-contexts',
      kind: 'contexts',
      label: 'Core contexts healthy',
      evidence: '1 critical (Auth & Session: 31 errors) · 8 healthy of 10 in-scope',
      done: 8,
      total: 10,
      state: 'nogo',
      dispatch: 'Open Auth & Session in Observability',
    },
    {
      id: 'crit-kpi',
      kind: 'kpi',
      label: 'KPI coverage on core scope',
      evidence: '6 of 9 core contexts carry an active, measured KPI',
      done: 6,
      total: 9,
      state: 'warn',
      dispatch: 'Scan KPIs scoped to core',
    },
    {
      id: 'crit-passport',
      kind: 'passport',
      label: 'Production readiness ≥ B',
      evidence: 'Monitoring dim unwired — passport band sits at C until a sensor reports',
      done: 4,
      total: 6,
      state: 'setup',
      dispatch: 'Wire monitoring connector',
    },
  ],
  features: [
    { id: 'f1', name: 'Template gallery & adoption flow', contexts: ['Template Catalog', 'Adoption'], bucket: 'core', state: 'done' },
    { id: 'f2', name: 'Credential vault bind (single connector)', contexts: ['Vault'], bucket: 'core', state: 'done' },
    { id: 'f3', name: 'Persona editor — prompt & model', contexts: ['Persona Editor'], bucket: 'core', state: 'done' },
    { id: 'f4', name: 'First-run execution & live log', contexts: ['Execution', 'Event Bus'], bucket: 'core', state: 'verify' },
    { id: 'f5', name: 'Run history with outcome badge', contexts: ['Execution', 'Overview'], bucket: 'core', state: 'verify' },
    { id: 'f6', name: 'Sign-in & workspace bootstrap', contexts: ['Auth & Session'], bucket: 'core', state: 'building', blocker: '31 Sentry errors this week — the critical context' },
    { id: 'f7', name: 'Schedule a recurring run', contexts: ['Scheduler'], bucket: 'core', state: 'building', blocker: 'No KPI on Scheduler yet' },
    { id: 'f8', name: 'Failure toast + retry path', contexts: ['Execution', 'Feedback'], bucket: 'core', state: 'todo', blocker: 'Unassigned — no owner session' },
    { id: 'f9', name: 'Onboarding tour (3 steps)', contexts: ['Onboarding'], bucket: 'core', state: 'done' },
    { id: 'f10', name: 'Persona duplication & versioning', contexts: ['Persona Editor'], bucket: 'later', state: 'todo' },
    { id: 'f11', name: 'Team sharing & roles', contexts: ['Teams'], bucket: 'later', state: 'todo' },
    { id: 'f12', name: 'Marketplace publishing', contexts: ['Template Catalog'], bucket: 'later', state: 'todo' },
    { id: 'f13', name: 'Self-hosted LLM gateway', contexts: ['Infra'], bucket: 'never', state: 'todo' },
    { id: 'f14', name: 'Multi-workspace switching', contexts: ['Teams', 'Auth & Session'], bucket: 'never', state: 'todo' },
    { id: 'f15', name: 'Run cost budget alerts', contexts: ['Observability'], bucket: 'later', state: 'todo', sinceCut: true },
    { id: 'f16', name: 'Prompt A/B compare view', contexts: ['Persona Editor'], bucket: 'later', state: 'todo', sinceCut: true },
    { id: 'f17', name: 'Webhook trigger for runs', contexts: ['Scheduler', 'Event Bus'], bucket: 'later', state: 'todo', sinceCut: true },
  ],
};

// The roadmap (round-2 fusion): milestones are the navigation spine. A shipped
// milestone keeps its record; a planned one starts as an uncut pool — note how
// v1's "Later" bucket is exactly where v1.1's core candidates come from.
const ALPHA_MILESTONE: ShipMilestone = {
  id: 'm-alpha',
  name: 'v0.9 — Private Alpha',
  status: 'shipped',
  goal: 'One hardcoded persona runs end-to-end on a dev machine, watched by five friendly users.',
  cutAgeDays: 61,
  targetLabel: 'shipped Jun 30',
  criteria: [
    { id: 'ac-verify', kind: 'verify', label: 'Core features verified', evidence: 'All 4 alpha features passed their verify run', done: 4, total: 4, state: 'go' },
    { id: 'ac-demo', kind: 'contexts', label: 'Demo path stable', evidence: 'Zero crashes across the 5-user demo week', done: 1, total: 1, state: 'go' },
  ],
  features: [
    { id: 'a1', name: 'Prototype persona runner', contexts: ['Execution'], bucket: 'core', state: 'done' },
    { id: 'a2', name: 'Local SQLite bootstrap', contexts: ['Infra'], bucket: 'core', state: 'done' },
    { id: 'a3', name: 'Single hardcoded template', contexts: ['Template Catalog'], bucket: 'core', state: 'done' },
    { id: 'a4', name: 'CLI smoke harness', contexts: ['Infra'], bucket: 'core', state: 'done' },
  ],
};

const GROWTH_MILESTONE: ShipMilestone = {
  id: 'm-v11',
  name: 'v1.1 — Growth',
  status: 'planned',
  goal: 'Returning users share personas with a teammate and keep run costs visible.',
  cutAgeDays: 0,
  targetLabel: 'target Sep',
  criteria: [
    { id: 'gc-cut', kind: 'passport', label: 'Scope not cut yet', evidence: 'Certify v1 first — then triage this pool into a core cut', done: 0, total: 4, state: 'setup' },
  ],
  features: [
    { id: 'g1', name: 'Persona duplication & versioning', contexts: ['Persona Editor'], bucket: 'core', state: 'todo' },
    { id: 'g2', name: 'Team sharing & roles', contexts: ['Teams'], bucket: 'core', state: 'todo' },
    { id: 'g3', name: 'Run cost budget alerts', contexts: ['Observability'], bucket: 'core', state: 'todo' },
    { id: 'g4', name: 'Prompt A/B compare view', contexts: ['Persona Editor'], bucket: 'later', state: 'todo' },
    { id: 'g5', name: 'Webhook trigger for runs', contexts: ['Scheduler', 'Event Bus'], bucket: 'later', state: 'todo' },
    { id: 'g6', name: 'Marketplace publishing', contexts: ['Template Catalog'], bucket: 'later', state: 'todo' },
  ],
};

/** Oldest → newest; exactly one `active` milestone at a time. */
export const SHIP_ROADMAP: ShipMilestone[] = [ALPHA_MILESTONE, MOCK_MILESTONE, GROWTH_MILESTONE];
