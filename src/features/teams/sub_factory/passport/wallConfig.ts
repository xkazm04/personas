// Shared vocabulary of the Passport Wall's split modules (host + overview grid
// + compare table + cell renderers): the row-behaviour sets, display copy, the
// sort/view tab specs, and the cover's shared layout-morph motion props.
import type { MotionProps } from 'framer-motion';

// Improvable cells. Tier-0 standards-config rows (CI / Self-verify) + every
// code-requiring or connector-bindable row: context/CLAUDE.md/docs/memory/
// observability (Claude deploy or scan), the monitoring tooling rows
// (errors/logs/metrics/tracing → connector wire), hosting (deploy), the
// env-split monitoring row (connector wire), app cost (agent-created cost
// file), aiflow + skills. Each opens the cell popover with its ladder + actions.
export const IMPROVABLE_ROWS = new Set([
  'ci', 'selfverify', 'context', 'instructions', 'docs', 'memory',
  'observability', 'aiflow', 'skills',
  'errors', 'logs', 'metrics', 'tracing', 'hosting', 'llmtracking',
  'monitoring', 'appcost', 'datalinks', 'support',
]);

// R19 — the UNIFIED setup rows: always-available setup icon (any level, not
// just red), full setup modal with three directions, Fleet as the LLM engine,
// state-tinted terminal icon + terminal modal while a run is live.
export const UNIFIED_ROWS = new Set(['evals', 'security', 'tests', 'migrations']);

export const COPY = {
  blockersTitle: 'Why it’s not ready',
  clear: 'Ready — no blockers',
  compare: 'Passport',
  scrollHint: 'scroll to compare →',
  automation: 'Automation',
  production: 'Production',
  sort: 'Sort',
  view: 'View',
  viewOverview: 'Overview',
  viewCompare: 'Compare',
  setUp: 'set up →',
  add: 'add →',
};

export const MAX_CHIPS = 5;

export type WallSort = 'name' | 'automation' | 'production' | 'gap';
export const SORT_TABS: Array<{ id: WallSort; label: string }> = [
  { id: 'name', label: 'Name' },
  { id: 'automation', label: 'Automation' },
  { id: 'production', label: 'Production' },
  { id: 'gap', label: 'Readiness gap' },
];

export type WallView = 'overview' | 'compare';
export const VIEW_TABS: Array<{ id: WallView; label: string }> = [
  { id: 'overview', label: COPY.viewOverview },
  { id: 'compare', label: COPY.viewCompare },
];

/** Covers carry framer-motion layoutIds so switching views RECOMPOSES the
 *  wall — each cover morphs between its grid tile and its table column. */
export function coverMotion(slug: string, reduce: boolean | null): MotionProps {
  return reduce
    ? {}
    : { layoutId: `passport-cover-${slug}`, layout: true, transition: { duration: 0.35, ease: [0.32, 0.72, 0.24, 1] } };
}
