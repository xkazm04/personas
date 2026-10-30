/**
 * backlogModel.ts — pure view model behind the unified Backlog tab.
 *
 * `DevIdea` is the storage shape: nullable everywhere, machine tokens, a JSON
 * blob for evidence. The table, the detail ledger and the focus deck all want
 * the same *decided* shape instead — defaults applied once, project name
 * resolved once, the group path computed once. That mapping lives here so it is
 * unit-testable and so no component re-derives it slightly differently.
 *
 * React-free and store-free on purpose.
 */
import type { DevIdea } from '@/lib/bindings/DevIdea';

/** Backlog row as every Backlog surface consumes it. */
export interface BacklogIdea {
  id: string;
  title: string;
  description: string;
  reasoning: string;
  category: string;
  /** Which sensor raised it. `null` = a classic Idea-Scanner idea. */
  origin: string | null;
  scanType: string;
  projectId: string | null;
  /** Resolved display name; '' when the idea is not project-scoped. */
  projectName: string;
  effort: number;
  impact: number;
  risk: number;
  /** Strategist triage rank (1 = do next); null = unranked. */
  priority: number | null;
  status: string;
  /** Raw evidence JSON string, as stored. */
  evidence: string | null;
  verifyState: string | null;
  createdAt: string;
  // --- scan-finding/1. Absent stays null: unscored is never 0. ---
  /** The producer's stored `scan-score/1`; null = unscored (ranks after every scored row). */
  score: number | null;
  /** The breakdown that ships with the score, parsed; null when absent or malformed. */
  scoreParts: Record<string, number | string> | null;
  confidence: string | null;
  impactWhy: string | null;
  /** The model's shadow verdict: accept | reject | defer. */
  predictedVerdict: string | null;
  predictedWhy: string | null;
  lens: string | null;
  /** `reserve` rows are found and scored but over the run's cap. */
  band: 'ranked' | 'reserve';
  mvp: boolean;
  sweepRunId: string | null;
  decidedBy: string | null;
  vetoUntil: string | null;
}

/** Effort/impact/risk default to the MIDPOINT of the 1-5 scale
 *  (`IDEA_SCALE_MAX` is 5) when a scanner left them unset, matching
 *  `triageRuleSuggestions`. It was 5 from the old ten-point scale, which is
 *  now the ceiling: unrated ideas ranked as heaviest and riskiest. */
const DEFAULT_LEVEL = 3;

/**
 * Map one stored idea to its view row. `projectName` is injected (the store
 * owns the project list) so this module stays free of app state.
 */
export function toBacklogIdea(
  idea: DevIdea,
  projectName: (projectId: string | null) => string,
): BacklogIdea {
  return {
    id: idea.id,
    title: idea.title,
    description: idea.description ?? '',
    reasoning: idea.reasoning ?? '',
    category: idea.category || 'technical',
    origin: idea.origin ?? null,
    scanType: idea.scan_type,
    projectId: idea.project_id,
    projectName: projectName(idea.project_id),
    effort: idea.effort ?? DEFAULT_LEVEL,
    impact: idea.impact ?? DEFAULT_LEVEL,
    risk: idea.risk ?? DEFAULT_LEVEL,
    priority: idea.priority,
    status: idea.status || 'pending',
    evidence: idea.evidence,
    verifyState: idea.verify_state,
    createdAt: idea.created_at,
    score: idea.score ?? null,
    scoreParts: parseScoreParts(idea.score_parts ?? null),
    confidence: idea.confidence ?? null,
    impactWhy: idea.impact_why ?? null,
    predictedVerdict: idea.predicted_verdict ?? null,
    predictedWhy: idea.predicted_why ?? null,
    lens: idea.lens ?? null,
    band: idea.band === 'reserve' ? 'reserve' : 'ranked',
    mvp: idea.mvp === true,
    sweepRunId: idea.sweep_run_id ?? null,
    decidedBy: idea.decided_by ?? null,
    vetoUntil: idea.veto_until ?? null,
  };
}

/**
 * Parse the stored `score_parts` JSON into a flat record of its scalar
 * members. Anything that is not an object of numbers/strings is dropped:
 * a breakdown that will not parse shows no breakdown, never a wrong one.
 */
export function parseScoreParts(json: string | null): Record<string, number | string> | null {
  if (!json || !json.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === 'number' || typeof v === 'string') out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : null;
  } catch {
    return null;
  }
}

/** A machine (`machine:<skill>`) passed this row's current verdict. */
export function isMachineDecided(i: Pick<BacklogIdea, 'decidedBy'>): boolean {
  return i.decidedBy?.startsWith('machine:') === true;
}

/** True while a machine decision's veto window is still open at `now`. */
export function vetoOpen(i: Pick<BacklogIdea, 'decidedBy' | 'vetoUntil'>, now: number): boolean {
  if (!isMachineDecided(i) || !i.vetoUntil) return false;
  const until = Date.parse(i.vetoUntil);
  return Number.isFinite(until) && until > now;
}

/** Split a row set into the ranked list and its reserve, order preserved. */
export function splitReserve(rows: readonly BacklogIdea[]): { ranked: BacklogIdea[]; reserve: BacklogIdea[] } {
  const ranked: BacklogIdea[] = [];
  const reserve: BacklogIdea[] = [];
  for (const r of rows) (r.band === 'reserve' ? reserve : ranked).push(r);
  return { ranked, reserve };
}

/** Open = still owed a verdict or work: the two statuses an MVP can hold. */
const OPEN_STATUSES = new Set(['pending', 'accepted']);

/**
 * One MVP per lens: the open row flagged `mvp` from the lens's LATEST sweep run
 * (the run of its most recently created row), else the lens's open row with the
 * top score. A lens with no scored open row and no flagged one has no MVP.
 * Sorted by score, highest first.
 */
export function lensMvps(rows: readonly BacklogIdea[]): BacklogIdea[] {
  const byLens = new Map<string, BacklogIdea[]>();
  for (const r of rows) {
    if (!r.lens || !OPEN_STATUSES.has(r.status)) continue;
    const list = byLens.get(r.lens) ?? [];
    list.push(r);
    byLens.set(r.lens, list);
  }
  const out: BacklogIdea[] = [];
  for (const list of byLens.values()) {
    const newest = list.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
    const flagged = newest.sweepRunId
      ? list.find((r) => r.mvp && r.sweepRunId === newest.sweepRunId)
      : undefined;
    const top = list
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    const pick = flagged ?? top;
    if (pick) out.push(pick);
  }
  return out.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
}

/**
 * Value heuristic: reward impact, charge for effort + risk. Same scorer the
 * Idea Scanner's ValueBadge uses, restated here so the Backlog's sort and the
 * badge can never disagree about which ideas are worth doing first.
 */
export function triageValueScore(i: { impact: number; effort: number; risk: number }): number {
  return i.impact * 2 - i.effort - i.risk;
}

/**
 * Facet path for the group rail: `category/origin`, or just `category` for a
 * classic scanner idea (which has no origin). Scanner ideas therefore sit ON
 * the category node rather than under a synthetic "scanner" child.
 */
export function backlogGroupPath(i: BacklogIdea): string {
  return i.origin ? `${i.category}/${i.origin}` : i.category;
}

/** True when a rail path names an origin (depth 1) rather than a category. */
export function isOriginSegment(path: string): boolean {
  return path.includes('/');
}

/** Fields the table's search box matches against. */
export function backlogHaystack(i: BacklogIdea): string[] {
  return [i.title, i.description, i.reasoning];
}

export type BacklogSortKey = 'category' | 'title' | 'project' | 'value' | 'quick' | 'created' | 'score';
export type SortDir = 'asc' | 'desc';

/**
 * Comparator for the table AND the focus deck. `value` sorts by
 * {@link triageValueScore}; `quick` is the quick-wins order (cheapest first,
 * highest impact as the tiebreak) and has no column of its own — it is reached
 * only through the panel's sort pills.
 */
export function compareBacklog(
  a: BacklogIdea,
  b: BacklogIdea,
  key: BacklogSortKey,
  dir: SortDir,
): number {
  const s = dir === 'asc' ? 1 : -1;
  switch (key) {
    case 'category':
      return a.category.localeCompare(b.category) * s;
    case 'title':
      return a.title.localeCompare(b.title) * s;
    case 'project':
      return a.projectName.localeCompare(b.projectName) * s;
    case 'value':
      return (triageValueScore(a) - triageValueScore(b)) * s;
    case 'quick':
      return (a.effort - b.effort || b.impact - a.impact) * s;
    case 'score':
      // Unscored rows rank after every scored one in BOTH directions: an
      // unmeasured item is not a low score, it is not a score at all.
      if (a.score === null || b.score === null) {
        return a.score === b.score ? b.createdAt.localeCompare(a.createdAt) : a.score === null ? 1 : -1;
      }
      return (a.score - b.score) * s || b.createdAt.localeCompare(a.createdAt);
    case 'created':
    default:
      return a.createdAt.localeCompare(b.createdAt) * s;
  }
}

/**
 * The panel-level ordering, ported from Idea Triage's sort pills. It sits ABOVE
 * the table's per-column sort: whichever mode is picked feeds the deck's card
 * order and the table's initial sort in the same breath, so Table ⇄ Focus never
 * reshuffles the queue under the user.
 */
export type BacklogSortMode = 'default' | 'value' | 'quick' | 'newest';

/** Each pill's equivalent table sort. `quick` has no column (see compareBacklog). */
export const SORT_MODE_COLUMN: Record<BacklogSortMode, { key: BacklogSortKey; dir: SortDir }> = {
  // The producer's stored score leads (scan-finding/1); unscored rows follow.
  default: { key: 'score', dir: 'desc' },
  value: { key: 'value', dir: 'desc' },
  quick: { key: 'quick', dir: 'asc' },
  newest: { key: 'created', dir: 'desc' },
};

/** Order a row set by a sort mode. Returns a copy; never mutates the input. */
export function applyBacklogSort(rows: BacklogIdea[], mode: BacklogSortMode): BacklogIdea[] {
  const { key, dir } = SORT_MODE_COLUMN[mode];
  return [...rows].sort((a, b) => compareBacklog(a, b, key, dir));
}

/** Inclusive effort/risk band, as the EffortRiskFilter presets express it. */
export type LevelRange = [number, number];
/** The whole stored 1-5 scale (`IDEA_SCALE_MAX`). It was still [1, 10] after
 *  the scale moved to 1-5, so the "no filter" band was wider than the data. */
export const LEVEL_SCALE_MAX = 5;
export const FULL_LEVEL_RANGE: LevelRange = [1, LEVEL_SCALE_MAX];

/** True when a row falls inside both bands. */
export function withinLevelRanges(i: BacklogIdea, effort: LevelRange, risk: LevelRange): boolean {
  return i.effort >= effort[0] && i.effort <= effort[1]
    && i.risk >= risk[0] && i.risk <= risk[1];
}

/** True when either band is narrower than the full 1-5 range (drives the badge). */
export function hasLevelFilter(effort: LevelRange, risk: LevelRange): boolean {
  return effort[0] !== 1 || effort[1] !== LEVEL_SCALE_MAX
    || risk[0] !== 1 || risk[1] !== LEVEL_SCALE_MAX;
}

/**
 * Pretty-print the evidence blob for the detail ledger. Malformed or absent
 * JSON returns null — a finding whose evidence won't parse should show no
 * evidence block, not a stack trace.
 */
export function prettyEvidence(evidence: string | null): string | null {
  if (!evidence || !evidence.trim()) return null;
  try {
    return JSON.stringify(JSON.parse(evidence) as unknown, null, 2);
  } catch {
    return null;
  }
}

/**
 * Step a review queue by ±1, skipping ids whose row has since disappeared
 * (deleted from another surface) instead of landing on an empty modal.
 *
 * Returns `null` when the step falls off either end — the caller closes rather
 * than clamping, because a reviewer who adjudicates the last item wants the
 * queue to end, not to sit on a row they just decided.
 */
export function nextQueueIndex(
  queue: readonly string[],
  index: number,
  delta: -1 | 1,
  exists: (id: string) => boolean,
): number | null {
  let next = index + delta;
  while (next >= 0 && next < queue.length && !exists(queue[next]!)) next += delta;
  return next >= 0 && next < queue.length ? next : null;
}

/**
 * The selection after the header select-all is toggled over `rows`, the rows the
 * reviewer can actually see (after the rail, search, project filter and pager
 * scope). Select-all is exactly that set; toggling it when all of it is already
 * selected clears. A bulk verdict must never reach an idea nobody looked at.
 */
export function selectionAfterSelectAll(prev: ReadonlySet<string>, rows: readonly { id: string }[]): Set<string> {
  if (rows.length === 0) return new Set(prev);
  return rows.every((r) => prev.has(r.id)) ? new Set() : new Set(rows.map((r) => r.id));
}
