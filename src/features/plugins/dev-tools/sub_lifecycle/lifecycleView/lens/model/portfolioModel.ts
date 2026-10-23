/**
 * The Lens portfolio: every project's practice as ten columns of cells, one
 * cell per project (contest lifecycle-portfolio-r2, winner A/3 "Lens";
 * docs/design/lifecycle-lens/migration-plan.md).
 *
 * Pure. Every figure is counted from the snapshots; absence stays `null`, and
 * an unmeasured step is never read as a low score (the honesty rules the
 * winner was built against).
 *
 * - A project's steps come from the same join the rest of Lifecycle uses
 *   (`buildLanes` + `joinHealth`), so a verdict here is the verdict its own
 *   screen shows.
 * - Columns are the union of every project's steps in practice order: a Team
 *   project's `link` step is a column the Solo projects have no cell in.
 * - Attention: a measured failure in a project you are changing comes first;
 *   then the quiet projects; last the ones with too few changes for a verdict.
 */
import type { DevProject } from '@/lib/bindings/DevProject';
import type { LifecycleHealth } from '@/lib/bindings/LifecycleHealth';
import type { LifecyclePhase } from '@/lib/bindings/LifecyclePhase';
import type { LifecycleSnapshot } from '@/lib/bindings/LifecycleSnapshot';

import { buildLanes } from '../../../journey/journeyModel';
import { HEALTH_ORDER, joinHealth, type HealthStep } from '../../layer1/healthModel';

/** Built-in steps in practice order; a custom step sorts after them, in first-seen order. */
const CANON = ['frame', 'recall', 'isolate', 'link', 'sync', 'gate', 'tests', 'docs', 'commit', 'land', 'record'];

/** Worst first, for the rows under a step: a failure, then the uncertain, then the healthy, then the instructed. */
export const ROW_RANK: Record<LifecycleHealth, number> = { red: 0, amber: 1, stale: 2, green: 3, unmeasured: 4, instructed: 5 };
/** Weakest-step order: a measured failure beats anything unknown; instructed is never weak. */
const WEAK_RANK: Record<LifecycleHealth, number> = { red: 0, amber: 1, stale: 2, unmeasured: 3, green: 4, instructed: 9 };

const DAY_MS = 86_400_000;

export type AttentionBand = 'act' | 'quiet' | 'blind';

export interface LensProject {
  id: string;
  name: string;
  /** What tells two projects of the same name apart (the repo, else the id); null when the name is unique. */
  qualifier: string | null;
  snapshot: LifecycleSnapshot;
  /** The project's own steps, in its practice order, joined with health. */
  steps: HealthStep[];
  band: AttentionBand;
  /** Index in the attention ranking, 0 = look here first. */
  rank: number;
  /** Newest evidence time, or null when no change was ever read. */
  lastChangeAt: string | null;
  /** Whole days since the newest change at `now`; null when none. */
  lastChangeDays: number | null;
  changes: number;
  failing: number;
  weakest: HealthStep | null;
}

export interface LensRow {
  project: LensProject;
  step: HealthStep;
}

export interface LensColumn {
  id: string;
  /** A custom step's own label; null for a built-in step (labelled from i18n by id). */
  label: string | null;
  phase: LifecyclePhase;
  rule: string;
  /** The projects that have this step, worst first, then by attention. */
  rows: LensRow[];
  counts: Record<LifecycleHealth, number>;
  /** Projects whose binding for this step is missing. */
  missing: number;
}

export interface Portfolio {
  /** In attention order. */
  projects: LensProject[];
  columns: LensColumn[];
  /** The column failing in the most projects; null when nothing fails. */
  faultStepId: string | null;
  /** Projects with at least one Measure-judged step (gate or tests measured). */
  measured: number;
}

function emptyCounts(): Record<LifecycleHealth, number> {
  return Object.fromEntries(HEALTH_ORDER.map((h) => [h, 0])) as Record<LifecycleHealth, number>;
}

function daysBetween(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now - at) / DAY_MS));
}

/** The weakest step a project has: worst verdict; among equals, a step with a missing binding, then practice order. */
export function weakestStep(steps: HealthStep[]): HealthStep | null {
  let best: HealthStep | null = null;
  let bestKey = Infinity;
  steps.forEach((s, i) => {
    if (s.health === 'instructed') return;
    const key = WEAK_RANK[s.health] * 1000 + (s.node.strongestState === 'missing' ? 0 : 500) + i;
    if (key < bestKey) { bestKey = key; best = s; }
  });
  return best;
}

function qualifierOf(p: DevProject, duplicated: boolean): string | null {
  if (!duplicated) return null;
  const repo = p.github_url?.replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '');
  return repo || p.id.slice(0, 8);
}

function bandOf(failing: number, changes: number, minSamples: number): AttentionBand {
  if (failing > 0) return 'act';
  return changes < minSamples ? 'blind' : 'quiet';
}

/** How hard a project pulls: the size of its failures, weighted by how recently it changed. */
function pull(p: LensProject): number {
  const d = p.lastChangeDays;
  const activity = d === null ? 0.1 : d <= 7 ? 1 : d <= 30 ? 0.5 : 0.15;
  const size = p.steps.reduce((n, s) => n + (s.health === 'red' ? Math.max(1, failureSize(s)) : 0), 0);
  return size * activity;
}

const BAND_ORDER: Record<AttentionBand, number> = { act: 0, quiet: 1, blind: 2 };

function byAttention(a: LensProject, b: LensProject): number {
  return BAND_ORDER[a.band] - BAND_ORDER[b.band]
    || pull(b) - pull(a)
    || (a.lastChangeDays ?? Infinity) - (b.lastChangeDays ?? Infinity)
    || a.name.localeCompare(b.name)
    || a.id.localeCompare(b.id);
}

function lensProject(p: DevProject, s: LifecycleSnapshot, duplicated: boolean, now: number): LensProject {
  const lanes = buildLanes(s);
  const steps = joinHealth([...lanes.before, ...lanes.after], s.health);
  const lastChangeAt = s.evidence[0]?.occurredAt ?? null;
  const failing = steps.filter((x) => x.health === 'red').length;
  return {
    id: p.id,
    name: p.name,
    qualifier: qualifierOf(p, duplicated),
    snapshot: s,
    steps,
    band: bandOf(failing, s.evidence.length, s.rules.minSamples),
    rank: 0,
    lastChangeAt,
    lastChangeDays: daysBetween(lastChangeAt, now),
    changes: s.evidence.length,
    failing,
    weakest: weakestStep(steps),
  };
}

function columnOrder(projects: LensProject[]): string[] {
  const seen = new Set<string>();
  const custom: string[] = [];
  for (const p of projects) for (const s of p.steps) {
    if (seen.has(s.node.id)) continue;
    seen.add(s.node.id);
    if (!CANON.includes(s.node.id)) custom.push(s.node.id);
  }
  return [...CANON.filter((id) => seen.has(id)), ...custom];
}

/**
 * How big a step's failure is, in the samples it was judged on: a docs scan that found 266 of
 * 285 docs unclean is a bigger failure than one doc of one. A rate's misses; 0 without a rate.
 */
export function failureSize(step: HealthStep): number {
  const f = step.figure;
  if (!f || f.value === null || f.ratio === null) return 0;
  return Math.round(f.samples * (1 - f.ratio));
}

/**
 * Build the portfolio from the projects that have a snapshot. A project with no
 * snapshot (still loading, or its read failed) is left out, never guessed.
 */
export function buildPortfolio(
  projects: DevProject[],
  snapshots: ReadonlyMap<string, LifecycleSnapshot>,
  now: number,
): Portfolio {
  const named = new Map<string, number>();
  for (const p of projects) named.set(p.name, (named.get(p.name) ?? 0) + 1);
  const read = projects
    .filter((p) => snapshots.has(p.id))
    .map((p) => lensProject(p, snapshots.get(p.id)!, (named.get(p.name) ?? 0) > 1, now))
    .sort(byAttention);
  read.forEach((p, i) => { p.rank = i; });

  const columns: LensColumn[] = columnOrder(read).map((id) => {
    const rows: LensRow[] = [];
    for (const project of read) {
      const step = project.steps.find((s) => s.node.id === id);
      if (step) rows.push({ project, step });
    }
    rows.sort((a, b) => ROW_RANK[a.step.health] - ROW_RANK[b.step.health]
      || failureSize(b.step) - failureSize(a.step)
      || a.project.rank - b.project.rank);
    const counts = emptyCounts();
    let missing = 0;
    for (const r of rows) {
      counts[r.step.health] += 1;
      if (r.step.node.strongestState === 'missing') missing += 1;
    }
    const first = rows[0]!.step.node;
    return { id, label: first.label, phase: first.phase, rule: first.rule, rows, counts, missing };
  });

  let faultStepId: string | null = null;
  let most = 0;
  for (const c of columns) if (c.counts.red > most) { most = c.counts.red; faultStepId = c.id; }

  const measured = read.filter((p) => p.steps.some((s) => (s.node.id === 'gate' || s.node.id === 'tests') && s.measuredAt)).length;
  return { projects: read, columns, faultStepId, measured };
}

/** The verdict a column is summed up by: the worst one any project holds there. */
export function worstHealth(counts: Record<LifecycleHealth, number>): LifecycleHealth {
  for (const h of ['red', 'amber', 'stale', 'green', 'unmeasured', 'instructed'] as const) if (counts[h] > 0) return h;
  return 'unmeasured';
}
