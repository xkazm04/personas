// The verdict engine (docs/plans/dev-findings-loop.md §7, Phase 3A) — "did shipping
// this actually move the number that raised it?"
//
// THE KEY INSIGHT: we do not need a probe engine. An emitter only emits when a
// signal is OVER its threshold, and the sweep already re-runs every emitter. So a
// fresh emit IS the probe:
//
//   • the finding's dedup_key is ABSENT from the fresh drafts
//        → the signal fell below threshold → CLEARED
//   • the key is STILL THERE
//        → compare the primary metric against the `evidence` we stored when we
//          raised it → MOVED (materially better) / REGRESSED (worse) / UNCHANGED
//
// The five emitters are the five probes. That's the whole design.
//
// HONESTY RULES (these matter more than the happy path):
//   1. We never invent a `cleared`. If we can't compare (no evidence, no metric,
//      unparseable), the verdict is `unchanged` — the conservative answer — not a
//      silent success.
//   2. `unchanged` and `regressed` are first-class outcomes surfaced as loudly as
//      `cleared`. The entire point of this phase is destroying the assumption that
//      merged == fixed.
//   3. A finding is only judged once the work actually shipped (see `isVerifiable`).
import type { DevIdea } from '@/lib/bindings/DevIdea';
import type { DevTask } from '@/lib/bindings/DevTask';
import type { VerifyState } from '@/api/devTools/devTools';

import type { FindingDraft } from './types';

/** A metric got this much better (fractionally) before we'll call it `moved`.
 *  Below this it's noise, and claiming a win on noise is how a loop starts lying. */
export const MATERIAL_IMPROVEMENT = 0.1; // 10%

/**
 * The number each sensor is actually about. Verification compares THIS across the
 * original evidence and the fresh reading — everything else in the blob is context.
 *
 * `null` = this origin has no continuous metric (standards / passport are
 * presence-shaped: the rule is either still open, or it isn't). For those, absence
 * from the fresh drafts is the entire verdict.
 */
export function primaryMetric(origin: string, evidence: Record<string, unknown>): number | null {
  const num = (k: string): number | null => {
    const v = evidence[k];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  switch (origin) {
    case 'llm_cost':
      // Either the expensive-use-case finding (costUsd) or the unnamed-share one.
      return num('costUsd') ?? num('share');
    case 'sentry_spike':
      return num('count');
    case 'kpi_offtrack':
      return num('current');
    default:
      return null; // standards_finding, passport_gap — presence-shaped
  }
}

/** For a KPI, "better" depends on which side of the target it sits. Everything else
 *  (cost, error count, unnamed share) is unambiguously better when it goes DOWN. */
function improved(origin: string, before: number, after: number, evidence: Record<string, unknown>): boolean {
  if (origin === 'kpi_offtrack') {
    const target = typeof evidence.target === 'number' ? evidence.target : null;
    if (target === null) return false;
    // Moving toward the target is improvement, whichever direction that is.
    return Math.abs(after - target) < Math.abs(before - target);
  }
  return after < before;
}

function relativeChange(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : 1;
  return Math.abs(after - before) / Math.abs(before);
}

export interface Verdict {
  state: VerifyState;
  /** The re-measured reading we judged on — stored so the verdict is auditable. */
  evidence: Record<string, unknown>;
}

/**
 * Judge one finding against the sweep's fresh drafts.
 *
 * `fresh` is the draft carrying the SAME dedup_key, or `undefined` when the sensor
 * no longer emits it at all.
 */
export function verdictFor(
  finding: Pick<DevIdea, 'origin' | 'evidence' | 'dedup_key'>,
  fresh: FindingDraft | undefined,
): Verdict {
  const origin = finding.origin ?? '';

  // The signal is gone. This is the one unambiguous win.
  if (!fresh) {
    return { state: 'cleared', evidence: { signal: 'absent', checkedAgainst: finding.dedup_key } };
  }

  // Still emitting. Can we compare?
  let before: Record<string, unknown> = {};
  if (finding.evidence) {
    try {
      const parsed: unknown = JSON.parse(finding.evidence);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        before = parsed as Record<string, unknown>;
      }
    } catch {
      // Unparseable evidence — fall through to `unchanged`. Never a false cleared.
      before = {};
    }
  }

  const beforeMetric = primaryMetric(origin, before);
  const afterMetric = primaryMetric(origin, fresh.evidence);

  // Presence-shaped origin, or nothing comparable: the signal is still open, so the
  // honest answer is "nothing moved" — NOT a success.
  if (beforeMetric === null || afterMetric === null) {
    return { state: 'unchanged', evidence: fresh.evidence };
  }

  const change = relativeChange(beforeMetric, afterMetric);
  if (change < MATERIAL_IMPROVEMENT) {
    return { state: 'unchanged', evidence: fresh.evidence };
  }

  return {
    state: improved(origin, beforeMetric, afterMetric, before) ? 'moved' : 'regressed',
    evidence: fresh.evidence,
  };
}

/**
 * Is this finding ready to be judged? Only if the work actually SHIPPED — an
 * accepted finding whose task completed. We refuse to claim a verdict on work that
 * was never done; that would be the loop lying to itself in the most damaging way.
 */
export function isVerifiable(idea: DevIdea, tasks: DevTask[]): boolean {
  if (!idea.origin || !idea.dedup_key) return false;
  if (idea.status !== 'accepted') return false;
  return tasks.some((t) => t.source_idea_id === idea.id && t.status === 'completed');
}

/** Every finding on the project that the sweep should judge this pass. */
export function verifiableFindings(ideas: DevIdea[], tasks: DevTask[]): DevIdea[] {
  return ideas.filter((i) => isVerifiable(i, tasks));
}
