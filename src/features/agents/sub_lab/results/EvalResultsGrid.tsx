import { useMemo, useEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Trophy, Target, FileText, Shield, DollarSign, Clock } from 'lucide-react';
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
} from 'recharts';
import { ChartErrorBoundary } from '@/features/overview/sub_usage/charts/ChartErrorBoundary';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { compositeScore, scoreColor } from '../shared/labUtils';

interface Props {
  results: LabEvalResult[];
}

interface CellAggregate {
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
}

interface VersionAggregate extends CellAggregate {
  versionId: string;
  versionNumber: number;
}

/**
 * Renders an N×M evaluation matrix grid:
 * - Rows: prompt versions
 * - Columns: models
 * Each cell shows the composite score for that version×model pair.
 */
export function EvalResultsGrid({ results }: Props) {
  const [celebrateWinnerId, setCelebrateWinnerId] = useState<string | null>(null);
  const { shouldAnimate } = useMotion();
  const radarPalette = useMemo(
    () => ['#60A5FA', '#A78BFA', '#34D399', '#F59E0B', '#FB7185', '#22D3EE'],
    [],
  );
  const { versionAggs, versions, models, grid, winnerId } = useMemo(() => {
    const versionMap = new Map<string, LabEvalResult[]>();
    const modelSet = new Set<string>();

    for (const r of results) {
      if (!versionMap.has(r.versionId)) versionMap.set(r.versionId, []);
      versionMap.get(r.versionId)!.push(r);
      modelSet.add(r.modelId);
    }

    // Aggregate per version (across all models)
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

    // Build grid: versionId → modelId → CellAggregate
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
    // Finalize averages
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
  }, [results]);

  useEffect(() => {
    if (!shouldAnimate) {
      setCelebrateWinnerId(null);
      return;
    }
    if (!winnerId) return;
    setCelebrateWinnerId(winnerId);
    const timer = window.setTimeout(() => {
      setCelebrateWinnerId((prev) => (prev === winnerId ? null : prev));
    }, 900);
    return () => window.clearTimeout(timer);
  }, [winnerId, shouldAnimate]);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm" data-testid="eval-results-empty">
        No results to display
      </div>
    );
  }

  const radarVersions = versionAggs.slice(0, 4);
  const radarData = [
    { metric: 'Tool Accuracy', key: 'avgToolAccuracy' },
    { metric: 'Output Quality', key: 'avgOutputQuality' },
    { metric: 'Protocol Compliance', key: 'avgProtocolCompliance' },
  ].map((row) => {
    const values: Record<string, number | string> = { metric: row.metric };
    for (const agg of radarVersions) {
      values[agg.versionId] = (agg[row.key as keyof VersionAggregate] as number) ?? 0;
    }
    return values;
  });

  return (
    <div className="space-y-6" data-testid="eval-results-grid">
      {/* Version summary cards */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <Trophy className="w-3.5 h-3.5" />
          Version Rankings
        </h4>
        <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${Math.min(versionAggs.length, 4)}, 1fr)` }}>
          {versionAggs.map((agg, idx) => {
            const isWinner = agg.versionId === winnerId;
            const colors = ['blue', 'violet', 'emerald', 'amber', 'rose', 'cyan'];
            const color = colors[idx % colors.length];
            return (
              <div
                key={agg.versionId}
                data-testid={`eval-version-card-${agg.versionNumber}`}
                className={`rounded-xl border p-4 space-y-3 ${
                  isWinner
                    ? `bg-primary/5 border-primary/20 ${celebrateWinnerId === agg.versionId ? 'ring-1 ring-primary/20 shadow-[0_0_14px_rgba(99,102,241,0.18)]' : ''}`
                    : 'bg-background/30 border-primary/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-sm font-mono font-bold bg-${color}-500/15 text-${color}-400`}>
                    v{agg.versionNumber}
                  </span>
                  {isWinner && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium bg-primary/15 text-primary border border-primary/20">
                      <Trophy className="w-3 h-3 animate-[pulse_3s_ease-in-out_infinite] motion-reduce:animate-none" /> Winner
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="flex items-center gap-1.5" title="Tool Accuracy">
                    <Target className="w-3.5 h-3.5 text-muted-foreground/80" />
                    <span className={scoreColor(agg.avgToolAccuracy)}>{agg.avgToolAccuracy}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Output Quality">
                    <FileText className="w-3.5 h-3.5 text-muted-foreground/80" />
                    <span className={scoreColor(agg.avgOutputQuality)}>{agg.avgOutputQuality}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Protocol Compliance">
                    <Shield className="w-3.5 h-3.5 text-muted-foreground/80" />
                    <span className={scoreColor(agg.avgProtocolCompliance)}>{agg.avgProtocolCompliance}</span>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <span className={`font-bold text-lg ${scoreColor(agg.compositeScore)}`}>
                    {agg.compositeScore}
                  </span>
                  <span className="text-muted-foreground/60">composite</span>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1 text-muted-foreground/90">
                    <DollarSign className="w-3 h-3" />
                    <span>${agg.totalCost.toFixed(4)}</span>
                  </div>
                  <div className="flex items-center gap-1 text-muted-foreground/90">
                    <Clock className="w-3 h-3" />
                    <span>{(agg.avgDuration / 1000).toFixed(1)}s</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Multi-dimension comparison radar */}
      {radarVersions.length >= 2 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
            <span className="w-6 h-[2px] bg-gradient-to-r from-primary/40 to-accent/40 rounded-full" />
            Model Performance Radar
          </h4>
          <div className="border border-primary/10 rounded-xl bg-background/20 p-3">
            <div className="h-[260px]" data-testid="eval-radar-chart">
              <ChartErrorBoundary>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="72%">
                  <PolarGrid stroke="rgba(148, 163, 184, 0.25)" />
                  <PolarAngleAxis dataKey="metric" tick={{ fill: 'rgba(226,232,240,0.85)', fontSize: 12 }} />
                  <PolarRadiusAxis domain={[0, 100]} tick={{ fill: 'rgba(148,163,184,0.75)', fontSize: 10 }} />
                  <Tooltip
                    formatter={(value) => [typeof value === 'number' || typeof value === 'string' ? value : 0, 'Score']}
                    contentStyle={{
                      background: 'rgba(10, 14, 24, 0.92)',
                      border: '1px solid rgba(99, 102, 241, 0.25)',
                      borderRadius: 10,
                      color: '#e2e8f0',
                    }}
                  />
                  {radarVersions.map((agg, idx) => (
                    <Radar
                      key={agg.versionId}
                      name={`v${agg.versionNumber}`}
                      dataKey={agg.versionId}
                      stroke={radarPalette[idx % radarPalette.length]}
                      fill={radarPalette[idx % radarPalette.length]}
                      fillOpacity={0.16}
                      strokeWidth={2}
                    />
                  ))}
                </RadarChart>
              </ResponsiveContainer>
              </ChartErrorBoundary>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {radarVersions.map((agg, idx) => (
                <span
                  key={agg.versionId}
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm border border-primary/10 bg-secondary/20 text-foreground/80"
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ backgroundColor: radarPalette[idx % radarPalette.length] }}
                  />
                  v{agg.versionNumber}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Version × Model matrix grid */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          Version × Model Matrix
        </h4>
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm" data-testid="eval-matrix-table">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Version</th>
                {models.map((m) => (
                  <th key={m} className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">
                    {m}
                  </th>
                ))}
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Avg</th>
              </tr>
            </thead>
            <tbody>
              {versions.map((vId) => {
                const agg = versionAggs.find((a) => a.versionId === vId);
                const isWinner = vId === winnerId;
                return (
                  <tr
                    key={vId}
                    className={`border-b border-primary/5 transition-colors ${isWinner ? 'bg-primary/5' : 'hover:bg-secondary/10'}`}
                  >
                    <td className="px-3 py-2.5 font-medium">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-foreground/80">v{agg?.versionNumber}</span>
                        {isWinner && <Trophy className="w-3 h-3 text-primary" />}
                      </div>
                    </td>
                    {models.map((mId) => {
                      const cell = grid[vId]?.[mId];
                      if (!cell || cell.count === 0) {
                        return <td key={mId} className="px-3 py-2.5 text-center text-muted-foreground/80">&mdash;</td>;
                      }
                      return (
                        <td key={mId} className="px-3 py-2.5 text-center">
                          <span className={`text-sm font-bold ${scoreColor(cell.compositeScore)}`}>
                            {cell.compositeScore}
                          </span>
                          <div className="text-sm text-muted-foreground/60 mt-0.5">
                            ${cell.totalCost.toFixed(4)}
                          </div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-sm font-bold ${scoreColor(agg?.compositeScore ?? 0)}`}>
                        {agg?.compositeScore ?? 0}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
