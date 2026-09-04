import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

export interface CellAggregate {
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  /** Prompt + completion tokens summed across the cell's samples. Cost is
   *  price-weighted and so hides which variant is actually token-hungry;
   *  a cheap model can still be the heaviest reader. */
  totalTokens: number;
  avgDuration: number;
  count: number;
  /** Samples that produced at least one score - the denominator the three
   *  averages above actually used. `totalCost`/`totalTokens`/`avgDuration`
   *  are over `count`, so without this the row mixes two denominators. */
  scoredCount: number;
  /** Samples that never ran to completion. In neither view: they are not
   *  failures of the variant, they are absent measurements. */
  incompleteCount: number;
  /** Cost, tokens and duration over the scored samples only. A variant that
   *  crashes early looks cheap in the unconditioned totals; comparing the two
   *  says whether a saving is efficiency or an unfinished trajectory. */
  scoredCost: number;
  scoredTokens: number;
  avgScoredDuration: number;
}

export interface VersionAggregate extends CellAggregate {
  versionId: string;
  versionNumber: number;
}

export interface EvalGridData {
  versionAggs: VersionAggregate[];
  versions: string[];
  models: string[];
  grid: Record<string, Record<string, CellAggregate>>;
  winnerId: string | null;
}

interface VersionAccum {
  versionNumber: number;
  toolAccuracy: number;
  toolAccuracyCount: number;
  outputQuality: number;
  outputQualityCount: number;
  protocolCompliance: number;
  protocolComplianceCount: number;
  totalCost: number;
  totalTokens: number;
  totalDuration: number;
  count: number;
  scoredCount: number;
  incompleteCount: number;
  scoredCost: number;
  scoredTokens: number;
  scoredDuration: number;
}

/** Accumulator for grid cells that tracks scored counts per metric. */
interface CellAccum {
  toolAccuracy: number;
  toolAccuracyCount: number;
  outputQuality: number;
  outputQualityCount: number;
  protocolCompliance: number;
  protocolComplianceCount: number;
  totalCost: number;
  totalTokens: number;
  totalDuration: number;
  count: number;
  scoredCount: number;
  incompleteCount: number;
  scoredCost: number;
  scoredTokens: number;
  scoredDuration: number;
}

/**
 * Single-pass aggregation: builds version aggregates AND per-cell grid
 * in one iteration over results, then finalizes averages.
 * Null scores (unscored / failed executions) are excluded from averages.
 */
export function buildEvalGridData(results: LabEvalResult[]): EvalGridData {
  const versionAccums = new Map<string, VersionAccum>();
  const versionOrder: string[] = [];
  const modelSet = new Set<string>();
  const cellAccums: Record<string, Record<string, CellAccum>> = {};

  for (const r of results) {
    // Version-level accumulation
    if (!versionAccums.has(r.versionId)) {
      versionAccums.set(r.versionId, {
        versionNumber: r.versionNumber,
        toolAccuracy: 0, toolAccuracyCount: 0,
        outputQuality: 0, outputQualityCount: 0,
        protocolCompliance: 0, protocolComplianceCount: 0,
        totalCost: 0, totalTokens: 0, totalDuration: 0, count: 0,
        scoredCount: 0, incompleteCount: 0,
        scoredCost: 0, scoredTokens: 0, scoredDuration: 0,
      });
      versionOrder.push(r.versionId);
    }
    // Three states, not two: a sample that never completed is an absent
    // measurement, a completed sample with no score is a failure that still
    // spent, and a scored sample is the only one whose cost is comparable.
    const incomplete = r.status !== 'completed';
    const scored =
      !incomplete &&
      (r.toolAccuracyScore != null ||
        r.outputQualityScore != null ||
        r.protocolCompliance != null);
    const tokens = r.inputTokens + r.outputTokens;

    const va = versionAccums.get(r.versionId)!;
    if (r.toolAccuracyScore != null) { va.toolAccuracy += r.toolAccuracyScore; va.toolAccuracyCount++; }
    if (r.outputQualityScore != null) { va.outputQuality += r.outputQualityScore; va.outputQualityCount++; }
    if (r.protocolCompliance != null) { va.protocolCompliance += r.protocolCompliance; va.protocolComplianceCount++; }
    va.totalCost += r.costUsd;
    va.totalTokens += r.inputTokens + r.outputTokens;
    va.totalDuration += r.durationMs;
    va.count++;
    if (incomplete) va.incompleteCount++;
    if (scored) {
      va.scoredCount++;
      va.scoredCost += r.costUsd;
      va.scoredTokens += tokens;
      va.scoredDuration += r.durationMs;
    }

    // Grid cell accumulation
    modelSet.add(r.modelId);
    if (!cellAccums[r.versionId]) cellAccums[r.versionId] = {};
    if (!cellAccums[r.versionId]![r.modelId]) {
      cellAccums[r.versionId]![r.modelId] = {
        toolAccuracy: 0, toolAccuracyCount: 0,
        outputQuality: 0, outputQualityCount: 0,
        protocolCompliance: 0, protocolComplianceCount: 0,
        totalCost: 0, totalTokens: 0, totalDuration: 0, count: 0,
        scoredCount: 0, incompleteCount: 0,
        scoredCost: 0, scoredTokens: 0, scoredDuration: 0,
      };
    }
    const cell = cellAccums[r.versionId]![r.modelId]!;
    cell.count++;
    if (r.toolAccuracyScore != null) { cell.toolAccuracy += r.toolAccuracyScore; cell.toolAccuracyCount++; }
    if (r.outputQualityScore != null) { cell.outputQuality += r.outputQualityScore; cell.outputQualityCount++; }
    if (r.protocolCompliance != null) { cell.protocolCompliance += r.protocolCompliance; cell.protocolComplianceCount++; }
    cell.totalCost += r.costUsd;
    cell.totalTokens += r.inputTokens + r.outputTokens;
    cell.totalDuration += r.durationMs;
    if (incomplete) cell.incompleteCount++;
    if (scored) {
      cell.scoredCount++;
      cell.scoredCost += r.costUsd;
      cell.scoredTokens += tokens;
      cell.scoredDuration += r.durationMs;
    }
  }

  // Finalize version aggregates
  const aggs: VersionAggregate[] = versionOrder.map((vId) => {
    const a = versionAccums.get(vId)!;
    const n = a.count || 1;
    const avgTA = a.toolAccuracyCount > 0 ? a.toolAccuracy / a.toolAccuracyCount : 0;
    const avgOQ = a.outputQualityCount > 0 ? a.outputQuality / a.outputQualityCount : 0;
    const avgPC = a.protocolComplianceCount > 0 ? a.protocolCompliance / a.protocolComplianceCount : 0;
    return {
      versionId: vId,
      versionNumber: a.versionNumber,
      avgToolAccuracy: Math.round(avgTA),
      avgOutputQuality: Math.round(avgOQ),
      avgProtocolCompliance: Math.round(avgPC),
      // composite = round(avgTA * 0.4 + avgOQ * 0.4 + avgPC * 0.2). Sorts the
      // version leaderboard below — see `compositeScore` JSDoc for the canonical
      // formula and the golden test that pins it.
      compositeScore: compositeScore(avgTA, avgOQ, avgPC),
      totalCost: a.totalCost,
      totalTokens: a.totalTokens,
      avgDuration: Math.round(a.totalDuration / n),
      count: a.count,
      scoredCount: a.scoredCount,
      incompleteCount: a.incompleteCount,
      scoredCost: a.scoredCost,
      scoredTokens: a.scoredTokens,
      avgScoredDuration:
        a.scoredCount > 0 ? Math.round(a.scoredDuration / a.scoredCount) : 0,
    };
  });
  aggs.sort((a, b) => b.compositeScore - a.compositeScore);

  // Finalize grid cells
  const grid: Record<string, Record<string, CellAggregate>> = {};
  for (const vId of Object.keys(cellAccums)) {
    grid[vId] = {};
    for (const mId of Object.keys(cellAccums[vId]!)) {
      const c = cellAccums[vId]![mId]!;
      const avgTA = c.toolAccuracyCount > 0 ? Math.round(c.toolAccuracy / c.toolAccuracyCount) : 0;
      const avgOQ = c.outputQualityCount > 0 ? Math.round(c.outputQuality / c.outputQualityCount) : 0;
      const avgPC = c.protocolComplianceCount > 0 ? Math.round(c.protocolCompliance / c.protocolComplianceCount) : 0;
      const n = c.count || 1;
      grid[vId]![mId] = {
        avgToolAccuracy: avgTA,
        avgOutputQuality: avgOQ,
        avgProtocolCompliance: avgPC,
        compositeScore: compositeScore(avgTA, avgOQ, avgPC),
        totalCost: c.totalCost,
        totalTokens: c.totalTokens,
        avgDuration: Math.round(c.totalDuration / n),
        count: c.count,
        scoredCount: c.scoredCount,
        incompleteCount: c.incompleteCount,
        scoredCost: c.scoredCost,
        scoredTokens: c.scoredTokens,
        avgScoredDuration:
          c.scoredCount > 0 ? Math.round(c.scoredDuration / c.scoredCount) : 0,
      };
    }
  }

  return {
    versionAggs: aggs,
    versions: aggs.map((a) => a.versionId),
    models: [...modelSet],
    grid,
    winnerId: aggs[0]?.versionId ?? null,
  };
}
