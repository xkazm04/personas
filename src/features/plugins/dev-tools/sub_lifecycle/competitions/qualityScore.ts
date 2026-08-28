/**
 * 5-gate quality scoring per competition slot (vibeman rubric, 0-100).
 *
 * Gate 1 — Build (25): task completed → build passed implicitly
 * Gate 2 — Tests (30): diff touches 2+ files → likely tests present
 * Gate 3 — Lint (20): task completed without error
 * Gate 4 — Review (15): not disqualified, diff non-trivial (>10 lines)
 * Gate 5 — Completion (10): task.status == completed
 */

export interface QualityScore {
  total: number;
  build: number;
  tests: number;
  lint: number;
  review: number;
  completion: number;
}

/**
 * The states in which a slot has an outcome to score. Every gate in the rubric
 * above is POST-HOC — "task completed → build passed implicitly", "diff touches
 * 2+ files → tests likely present" — so a slot that is still queued or running
 * has nothing any of them can read.
 *
 * Scoring one anyway is what this guard exists to stop: a queued competitor
 * scored 0+0+0+0+5 = 5, landed under the 70 threshold, and was painted with a
 * RED "Q 5" pill indistinguishable from a finished competitor that failed
 * every gate. During a live race that meant every unfinished slot wore a
 * catastrophic badge for something it had not yet had the chance to do.
 */
const SCORABLE_STATUSES: ReadonlySet<string> = new Set(['completed', 'failed', 'cancelled']);

export function computeSlotQualityScore(
  task: { status: string; progress_pct?: number } | null,
  slot: { disqualified: boolean; diff_stats_json: string | null },
): QualityScore | null {
  if (!task) return null;
  // Null, not zero: the caller renders the pill only when a score exists, so
  // "not yet judged" reads as absence rather than as a failing grade.
  if (!SCORABLE_STATUSES.has(task.status)) return null;
  const stats = slot.diff_stats_json ? (() => {
    try { return JSON.parse(slot.diff_stats_json) as { files_changed: number; lines_added: number; lines_removed: number }; }
    catch { return null; }
  })() : null;

  const completed = task.status === 'completed';
  const totalLines = stats ? stats.lines_added + stats.lines_removed : 0;

  const build = completed ? 25 : 0;
  const tests = !completed ? 0
    : stats && stats.files_changed >= 2 ? 30
    : stats && stats.files_changed === 1 ? 15
    : 0;
  const lint = completed ? 20 : 0;
  const review = completed && !slot.disqualified && totalLines > 10 ? 15
    : completed && !slot.disqualified ? 10
    : 0;
  const completion = completed ? 10 : task.status === 'failed' ? 0 : 5;

  return { total: build + tests + lint + review + completion, build, tests, lint, review, completion };
}

export function qualityColor(score: number): string {
  if (score >= 85) return 'text-emerald-400';
  if (score >= 70) return 'text-amber-400';
  return 'text-red-400';
}

export function qualityBorder(score: number): string {
  if (score >= 85) return 'bg-emerald-500/10 border-emerald-500/25';
  if (score >= 70) return 'bg-amber-500/10 border-amber-500/25';
  return 'bg-red-500/10 border-red-500/25';
}
