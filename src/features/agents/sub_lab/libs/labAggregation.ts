/**
 * Single-pass result aggregation for all lab modes.
 * Replaces the 3-pass pattern (build maps → aggregate → build matrix) with
 * a single iteration that accumulates running totals, then finalizes averages.
 *
 * Null scores (unscored / failed executions) are excluded from averages
 * instead of being treated as 0.
 */
import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';

// -- Shared accumulator helpers --

interface Accum {
  toolAccuracy: number;
  toolAccuracyCount: number;
  outputQuality: number;
  outputQualityCount: number;
  protocolCompliance: number;
  protocolComplianceCount: number;
  totalCost: number;
  totalDuration: number;
  count: number;
}

function newAccum(): Accum {
  return {
    toolAccuracy: 0, toolAccuracyCount: 0,
    outputQuality: 0, outputQualityCount: 0,
    protocolCompliance: 0, protocolComplianceCount: 0,
    totalCost: 0, totalDuration: 0, count: 0,
  };
}

function addToAccum(a: Accum, ta: number | null, oq: number | null, pc: number | null, cost: number, dur: number) {
  if (ta != null) { a.toolAccuracy += ta; a.toolAccuracyCount++; }
  if (oq != null) { a.outputQuality += oq; a.outputQualityCount++; }
  if (pc != null) { a.protocolCompliance += pc; a.protocolComplianceCount++; }
  a.totalCost += cost;
  a.totalDuration += dur;
  a.count++;
}

function finalizeAccum(a: Accum) {
  const avgTA = a.toolAccuracyCount > 0 ? a.toolAccuracy / a.toolAccuracyCount : 0;
  const avgOQ = a.outputQualityCount > 0 ? a.outputQuality / a.outputQualityCount : 0;
  const avgPC = a.protocolComplianceCount > 0 ? a.protocolCompliance / a.protocolComplianceCount : 0;
  const n = a.count || 1;
  return {
    avgToolAccuracy: Math.round(avgTA),
    avgOutputQuality: Math.round(avgOQ),
    avgProtocolCompliance: Math.round(avgPC),
    compositeScore: compositeScore(avgTA, avgOQ, avgPC),
    totalCost: a.totalCost,
    avgDuration: Math.round(a.totalDuration / n),
    count: a.count,
  };
}

// -- Arena aggregation --

export interface ArenaModelAggregate {
  modelId: string;
  provider: string;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
}

export interface ArenaAggregation {
  models: string[];
  scenarios: string[];
  matrix: Record<string, Record<string, LabArenaResult>>;
  aggregates: ArenaModelAggregate[];
  bestModelId: string | null;
}

export function aggregateArenaResults(results: LabArenaResult[]): ArenaAggregation {
  const modelAccums = new Map<string, Accum & { provider: string }>();
  const scenarioSet = new Set<string>();
  const modelOrder: string[] = [];
  const matrix: Record<string, Record<string, LabArenaResult>> = {};

  for (const r of results) {
    // Track models
    if (!modelAccums.has(r.modelId)) {
      modelAccums.set(r.modelId, { ...newAccum(), provider: r.provider });
      modelOrder.push(r.modelId);
    }
    const acc = modelAccums.get(r.modelId)!;
    addToAccum(acc, r.toolAccuracyScore, r.outputQualityScore, r.protocolCompliance, r.costUsd, r.durationMs);

    // Track scenarios + matrix
    scenarioSet.add(r.scenarioName);
    if (!matrix[r.scenarioName]) matrix[r.scenarioName] = {};
    matrix[r.scenarioName]![r.modelId] = r;
  }

  const aggregates: ArenaModelAggregate[] = modelOrder.map((mid) => {
    const acc = modelAccums.get(mid)!;
    return { modelId: mid, provider: acc.provider, ...finalizeAccum(acc) };
  });
  aggregates.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    models: modelOrder,
    scenarios: [...scenarioSet],
    matrix,
    aggregates,
    bestModelId: aggregates[0]?.modelId ?? null,
  };
}

// -- A/B aggregation --

export interface AbVersionAggregate {
  versionId: string;
  versionNumber: number;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
}

export interface AbAggregation {
  versionAggs: AbVersionAggregate[];
  scenarios: string[];
  matrix: Record<string, Record<string, LabAbResult[]>>;
  winnerId: string | null;
}

export function aggregateAbResults(results: LabAbResult[]): AbAggregation {
  const versionAccums = new Map<string, Accum & { versionNumber: number }>();
  const versionOrder: string[] = [];
  const scenarioSet = new Set<string>();
  const matrix: Record<string, Record<string, LabAbResult[]>> = {};

  for (const r of results) {
    if (!versionAccums.has(r.versionId)) {
      versionAccums.set(r.versionId, { ...newAccum(), versionNumber: r.versionNumber });
      versionOrder.push(r.versionId);
    }
    const acc = versionAccums.get(r.versionId)!;
    addToAccum(acc, r.toolAccuracyScore, r.outputQualityScore, r.protocolCompliance, r.costUsd, r.durationMs);

    scenarioSet.add(r.scenarioName);
    if (!matrix[r.scenarioName]) matrix[r.scenarioName] = {};
    if (!matrix[r.scenarioName]![r.versionId]) matrix[r.scenarioName]![r.versionId] = [];
    matrix[r.scenarioName]![r.versionId]!.push(r);
  }

  const versionAggs: AbVersionAggregate[] = versionOrder.map((vId) => {
    const acc = versionAccums.get(vId)!;
    return { versionId: vId, versionNumber: acc.versionNumber, ...finalizeAccum(acc) };
  });
  versionAggs.sort((a, b) => b.compositeScore - a.compositeScore);

  return {
    versionAggs,
    scenarios: [...scenarioSet],
    matrix,
    winnerId: versionAggs[0]?.versionId ?? null,
  };
}

// -- Matrix aggregation --

export interface MatrixVariantAggregate {
  variant: string;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
}

export interface MatrixAggregation {
  variantAggs: MatrixVariantAggregate[];
  scenarios: string[];
  matrix: Record<string, Record<string, LabMatrixResult[]>>;
}

export function aggregateMatrixResults(results: LabMatrixResult[]): MatrixAggregation {
  const variantAccums = new Map<string, Accum>();
  const variantOrder: string[] = [];
  const scenarioSet = new Set<string>();
  const matrix: Record<string, Record<string, LabMatrixResult[]>> = {};

  for (const r of results) {
    if (!variantAccums.has(r.variant)) {
      variantAccums.set(r.variant, newAccum());
      variantOrder.push(r.variant);
    }
    const acc = variantAccums.get(r.variant)!;
    addToAccum(acc, r.toolAccuracyScore, r.outputQualityScore, r.protocolCompliance, r.costUsd, r.durationMs);

    scenarioSet.add(r.scenarioName);
    if (!matrix[r.scenarioName]) matrix[r.scenarioName] = {};
    if (!matrix[r.scenarioName]![r.variant]) matrix[r.scenarioName]![r.variant] = [];
    matrix[r.scenarioName]![r.variant]!.push(r);
  }

  const variantAggs: MatrixVariantAggregate[] = variantOrder.map((v) => {
    const acc = variantAccums.get(v)!;
    return { variant: v, ...finalizeAccum(acc) };
  });
  variantAggs.sort((a, b) => (a.variant === 'current' ? -1 : b.variant === 'current' ? 1 : 0));

  return { variantAggs, scenarios: [...scenarioSet], matrix };
}
