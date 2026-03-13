import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

export interface CellAggregate {
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
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
  outputQuality: number;
  protocolCompliance: number;
  totalCost: number;
  totalDuration: number;
  count: number;
}

/**
 * Single-pass aggregation: builds version aggregates AND per-cell grid
 * in one iteration over results, then finalizes averages.
 */
export function buildEvalGridData(results: LabEvalResult[]): EvalGridData {
  const versionAccums = new Map<string, VersionAccum>();
  const versionOrder: string[] = [];
  const modelSet = new Set<string>();
  const grid: Record<string, Record<string, CellAggregate>> = {};

  for (const r of results) {
    // Version-level accumulation
    if (!versionAccums.has(r.versionId)) {
      versionAccums.set(r.versionId, {
        versionNumber: r.versionNumber,
        toolAccuracy: 0, outputQuality: 0, protocolCompliance: 0,
        totalCost: 0, totalDuration: 0, count: 0,
      });
      versionOrder.push(r.versionId);
    }
    const va = versionAccums.get(r.versionId)!;
    const ta = r.toolAccuracyScore ?? 0;
    const oq = r.outputQualityScore ?? 0;
    const pc = r.protocolCompliance ?? 0;
    va.toolAccuracy += ta;
    va.outputQuality += oq;
    va.protocolCompliance += pc;
    va.totalCost += r.costUsd;
    va.totalDuration += r.durationMs;
    va.count++;

    // Grid cell accumulation
    modelSet.add(r.modelId);
    if (!grid[r.versionId]) grid[r.versionId] = {};
    if (!grid[r.versionId]![r.modelId]) {
      grid[r.versionId]![r.modelId] = {
        avgToolAccuracy: 0, avgOutputQuality: 0, avgProtocolCompliance: 0,
        compositeScore: 0, totalCost: 0, avgDuration: 0, count: 0,
      };
    }
    const cell = grid[r.versionId]![r.modelId]!;
    cell.count++;
    cell.avgToolAccuracy += ta;
    cell.avgOutputQuality += oq;
    cell.avgProtocolCompliance += pc;
    cell.totalCost += r.costUsd;
    cell.avgDuration += r.durationMs;
  }

  // Finalize version aggregates
  const aggs: VersionAggregate[] = versionOrder.map((vId) => {
    const a = versionAccums.get(vId)!;
    const n = a.count || 1;
    const avgTA = a.toolAccuracy / n;
    const avgOQ = a.outputQuality / n;
    const avgPC = a.protocolCompliance / n;
    return {
      versionId: vId,
      versionNumber: a.versionNumber,
      avgToolAccuracy: Math.round(avgTA),
      avgOutputQuality: Math.round(avgOQ),
      avgProtocolCompliance: Math.round(avgPC),
      compositeScore: compositeScore(avgTA, avgOQ, avgPC),
      totalCost: a.totalCost,
      avgDuration: Math.round(a.totalDuration / n),
      count: a.count,
    };
  });
  aggs.sort((a, b) => b.compositeScore - a.compositeScore);

  // Finalize grid cells
  for (const vId of Object.keys(grid)) {
    for (const mId of Object.keys(grid[vId]!)) {
      const c = grid[vId]![mId]!;
      if (c.count > 0) {
        c.avgToolAccuracy = Math.round(c.avgToolAccuracy / c.count);
        c.avgOutputQuality = Math.round(c.avgOutputQuality / c.count);
        c.avgProtocolCompliance = Math.round(c.avgProtocolCompliance / c.count);
        c.avgDuration = Math.round(c.avgDuration / c.count);
        c.compositeScore = compositeScore(c.avgToolAccuracy, c.avgOutputQuality, c.avgProtocolCompliance);
      }
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
