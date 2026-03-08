import { compositeScore } from './labUtils';
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

export function buildEvalGridData(results: LabEvalResult[]): EvalGridData {
  const versionMap = new Map<string, LabEvalResult[]>();
  const modelSet = new Set<string>();

  for (const r of results) {
    if (!versionMap.has(r.versionId)) versionMap.set(r.versionId, []);
    versionMap.get(r.versionId)!.push(r);
    modelSet.add(r.modelId);
  }

  const aggs: VersionAggregate[] = [];
  for (const [vId, rows] of versionMap) {
    const n = rows.length || 1;
    const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n;
    const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n;
    const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n;
    aggs.push({
      versionId: vId,
      versionNumber: rows[0]?.versionNumber ?? 0,
      avgToolAccuracy: Math.round(avgTA),
      avgOutputQuality: Math.round(avgOQ),
      avgProtocolCompliance: Math.round(avgPC),
      compositeScore: compositeScore(avgTA, avgOQ, avgPC),
      totalCost: rows.reduce((s, r) => s + r.costUsd, 0),
      avgDuration: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n),
      count: rows.length,
    });
  }
  aggs.sort((a, b) => b.compositeScore - a.compositeScore);
  const winnerId = aggs[0]?.versionId ?? null;

  const grid: Record<string, Record<string, CellAggregate>> = {};
  for (const r of results) {
    if (!grid[r.versionId]) grid[r.versionId] = {};
    if (!grid[r.versionId]![r.modelId]) {
      grid[r.versionId]![r.modelId] = {
        avgToolAccuracy: 0, avgOutputQuality: 0, avgProtocolCompliance: 0,
        compositeScore: 0, totalCost: 0, avgDuration: 0, count: 0,
      };
    }
    const cell = grid[r.versionId]![r.modelId]!;
    cell.count++;
    cell.avgToolAccuracy += r.toolAccuracyScore ?? 0;
    cell.avgOutputQuality += r.outputQualityScore ?? 0;
    cell.avgProtocolCompliance += r.protocolCompliance ?? 0;
    cell.totalCost += r.costUsd;
    cell.avgDuration += r.durationMs;
  }
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
    winnerId,
  };
}
