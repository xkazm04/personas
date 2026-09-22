/**
 * What a Director batch actually did, derived from the report the backend
 * already returns.
 *
 * `run_director_batch` counts three disjoint populations (engine/director.rs
 * ~1540-1623): personas it evaluated with the LLM, personas skipped because
 * they have no execution to anchor a review onto, and personas skipped by the
 * freshness dedup because nothing has run since their last review. Only the
 * first spends budget. Until the UI separated them, a cycle that evaluated
 * nobody looked exactly like a cycle that coached everybody: a long spinner
 * followed by a silent return, which is what made operators re-run a no-op.
 *
 * This module is pure so the classification can be gated without a render.
 */
import type { DirectorReport } from '@/api/director';

export interface BatchOutcome {
  /**
   * `reviewed` when at least one persona was evaluated; `nothing-to-review`
   * when the cycle spent nothing, whatever the reason.
   */
  kind: 'reviewed' | 'nothing-to-review';
  evaluated: number;
  verdicts: number;
  /** Skipped by the freshness dedup (already reviewed at their newest run). */
  skippedUnchanged: number;
  /** Names of the freshness-skipped personas, in report order. */
  skippedUnchangedNames: string[];
  /** Skipped for having no execution to anchor a review onto. */
  skippedNoRuns: number;
}

export function describeBatchOutcome(report: DirectorReport): BatchOutcome {
  const evaluated = Math.max(0, report.evaluatedPersonas);
  return {
    kind: evaluated > 0 ? 'reviewed' : 'nothing-to-review',
    evaluated,
    verdicts: Math.max(0, report.verdictsEmitted),
    skippedUnchanged: Math.max(0, report.personasSkippedUnchanged),
    skippedUnchangedNames: report.skippedUnchangedPersonas ?? [],
    skippedNoRuns: Math.max(0, report.personasSkippedNoExecutions),
  };
}

/**
 * The freshness-skipped names, capped so one line cannot become a paragraph.
 * Returns the names to show and how many were elided.
 */
export function cappedSkippedNames(
  names: string[],
  cap = 3,
): { shown: string[]; more: number } {
  return { shown: names.slice(0, cap), more: Math.max(0, names.length - cap) };
}
