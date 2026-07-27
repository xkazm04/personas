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
}

/** Effort/impact/risk default to the midpoint when a scanner left them unset —
 *  the same 5 the triage deck has always used, so scores stay comparable. */
const DEFAULT_LEVEL = 5;

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
  };
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

export type BacklogSortKey = 'category' | 'title' | 'project' | 'value' | 'created';
export type SortDir = 'asc' | 'desc';

/** Comparator for the table. `value` sorts by {@link triageValueScore}. */
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
    case 'created':
    default:
      return a.createdAt.localeCompare(b.createdAt) * s;
  }
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
