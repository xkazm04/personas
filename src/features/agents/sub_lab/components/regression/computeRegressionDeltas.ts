/**
 * Single source of truth for regression delta math.
 *
 * RegressionResultsView (the breakdown), RegressionPanelGate (the verdict
 * bar), and RegressionPanelConsole (the warning lights + Δ header) all need
 * the same composite-score delta loop with the same triple null-guard on
 * toolAccuracyScore / outputQualityScore / protocolCompliance, then a verdict
 * derived from it. Three independent copies invited drift where the gate
 * verdict could disagree with the breakdown it sits above.
 *
 * This selector is the one place that math lives. Feed every surface the SAME
 * (baseline, current, threshold) inputs and the displayed numbers are provably
 * identical. The composite formula is delegated to `compositeScore` so the
 * weighting stays aligned with the Rust engine (see `evalFramework.ts`).
 */
import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

export type RegressionVerdict = 'pass' | 'fail' | 'improved';

/** Per-scenario comparison of one current result against its baseline. */
export interface RegressionScenarioDelta {
  scenario: string;
  model: string;
  baselineComposite: number;
  currentComposite: number;
  delta: number;
  deltaToolAccuracy: number;
  deltaOutputQuality: number;
  deltaProtocol: number;
  verdict: RegressionVerdict;
}

/** Full regression summary: per-scenario deltas, dimension averages, verdict. */
export interface RegressionDeltaSummary {
  /** One entry per comparable (scenario, model) pair, in current-result order. */
  deltas: RegressionScenarioDelta[];
  /** Mean per-dimension deltas across all comparable pairs (0 when none). */
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocol: number;
  /** Mean composite delta across all comparable pairs (0 when none). */
  overallDelta: number;
  /** Count of pairs whose composite dropped more than `threshold`. */
  failureCount: number;
  /** Count of pairs whose composite improved. */
  improvementCount: number;
  /**
   * Aggregate verdict: `fail` if any regression breached the threshold,
   * else `improved` if anything improved, else `pass`.
   */
  overallVerdict: RegressionVerdict;
}

function avg(vals: number[]): number {
  return vals.length === 0 ? 0 : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/**
 * Compute the regression deltas, per-dimension averages, and overall verdict
 * for a candidate run (`currentResults`) against its `baselineResults`.
 *
 * A current row contributes a delta only when it AND its matching baseline row
 * (same scenarioName + modelId) have all three metric scores present — this is
 * the triple null-guard the three surfaces used to each re-implement.
 *
 * @param threshold composite-point drop past which a scenario is a regression.
 */
export function computeRegressionDeltas(
  baselineResults: LabEvalResult[],
  currentResults: LabEvalResult[],
  threshold: number,
): RegressionDeltaSummary {
  const deltas: RegressionScenarioDelta[] = [];

  for (const curr of currentResults) {
    if (curr.toolAccuracyScore == null || curr.outputQualityScore == null || curr.protocolCompliance == null) continue;

    const baseline = baselineResults.find(
      (b) => b.scenarioName === curr.scenarioName && b.modelId === curr.modelId,
    );
    if (!baseline || baseline.toolAccuracyScore == null || baseline.outputQualityScore == null || baseline.protocolCompliance == null) continue;

    const bComp = compositeScore(baseline.toolAccuracyScore, baseline.outputQualityScore, baseline.protocolCompliance);
    const cComp = compositeScore(curr.toolAccuracyScore, curr.outputQualityScore, curr.protocolCompliance);
    const delta = cComp - bComp;

    deltas.push({
      scenario: curr.scenarioName,
      model: curr.modelId,
      baselineComposite: bComp,
      currentComposite: cComp,
      delta,
      deltaToolAccuracy: curr.toolAccuracyScore - baseline.toolAccuracyScore,
      deltaOutputQuality: curr.outputQualityScore - baseline.outputQualityScore,
      deltaProtocol: curr.protocolCompliance - baseline.protocolCompliance,
      verdict: delta > 0 ? 'improved' : delta < -threshold ? 'fail' : 'pass',
    });
  }

  const failureCount = deltas.filter((d) => d.verdict === 'fail').length;
  const improvementCount = deltas.filter((d) => d.verdict === 'improved').length;
  const overallVerdict: RegressionVerdict =
    failureCount > 0 ? 'fail' : improvementCount > 0 ? 'improved' : 'pass';

  return {
    deltas,
    avgToolAccuracy: avg(deltas.map((d) => d.deltaToolAccuracy)),
    avgOutputQuality: avg(deltas.map((d) => d.deltaOutputQuality)),
    avgProtocol: avg(deltas.map((d) => d.deltaProtocol)),
    overallDelta: avg(deltas.map((d) => d.delta)),
    failureCount,
    improvementCount,
    overallVerdict,
  };
}
