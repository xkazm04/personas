import { useMemo } from 'react';
import { Trophy, DollarSign, Clock, Target, FileText, Shield } from 'lucide-react';
import type { PersonaTestResult } from '@/lib/bindings/PersonaTestResult';
import { statusBadge, compositeScore } from './testUtils';

interface Props {
  results: PersonaTestResult[];
}

interface ModelAggregate {
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

function scoreColor(score: number | null): string {
  if (score === null) return 'text-muted-foreground/80';
  if (score >= 80) return 'text-emerald-400';
  if (score >= 50) return 'text-amber-400';
  return 'text-red-400';
}

export function TestComparisonTable({ results }: Props) {
  const { models, scenarios, matrix, aggregates, bestModelId } = useMemo(() => {
    const modelSet = new Set<string>();
    const scenarioSet = new Set<string>();
    const mtx: Record<string, Record<string, PersonaTestResult>> = {};

    for (const r of results) {
      modelSet.add(r.model_id);
      scenarioSet.add(r.scenario_name);
      if (!mtx[r.scenario_name]) mtx[r.scenario_name] = {};
      mtx[r.scenario_name]![r.model_id] = r;
    }

    const models = [...modelSet];
    const scenarios = [...scenarioSet];

    // Aggregate per model
    const aggs: ModelAggregate[] = models.map((mid) => {
      const rows = results.filter((r) => r.model_id === mid);
      const n = rows.length || 1;
      const avgTA = rows.reduce((s, r) => s + (r.tool_accuracy_score ?? 0), 0) / n;
      const avgOQ = rows.reduce((s, r) => s + (r.output_quality_score ?? 0), 0) / n;
      const avgPC = rows.reduce((s, r) => s + (r.protocol_compliance ?? 0), 0) / n;
      return {
        modelId: mid,
        provider: rows[0]?.provider ?? 'unknown',
        avgToolAccuracy: Math.round(avgTA),
        avgOutputQuality: Math.round(avgOQ),
        avgProtocolCompliance: Math.round(avgPC),
        compositeScore: compositeScore(avgTA, avgOQ, avgPC),
        totalCost: rows.reduce((s, r) => s + r.cost_usd, 0),
        avgDuration: Math.round(rows.reduce((s, r) => s + r.duration_ms, 0) / n),
        count: rows.length,
      };
    });

    aggs.sort((a, b) => b.compositeScore - a.compositeScore);

    const bestModelId = aggs[0]?.modelId ?? null;

    return { models, scenarios, matrix: mtx, aggregates: aggs, bestModelId };
  }, [results]);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm">
        No results to display
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Model rankings */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <Trophy className="w-3.5 h-3.5" />
          Model Rankings
        </h4>
        <div className="grid gap-2">
          {aggregates.map((agg, idx) => (
            <div
              key={agg.modelId}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                agg.modelId === bestModelId
                  ? 'bg-primary/5 border-primary/20'
                  : 'bg-background/30 border-primary/10'
              }`}
            >
              <span className="text-lg font-bold text-muted-foreground/80 w-6 text-center">
                {idx + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{agg.modelId}</span>
                  <span className="text-sm text-muted-foreground/80">{agg.provider}</span>
                  {agg.modelId === bestModelId && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md text-sm font-medium bg-primary/15 text-primary border border-primary/20">
                      <Trophy className="w-3 h-3" /> Best
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-4 text-sm">
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
                <div className="w-px h-4 bg-primary/10" />
                <div className="flex items-center gap-1" title="Composite Score">
                  <span className={`text-sm font-bold ${scoreColor(agg.compositeScore)}`}>
                    {agg.compositeScore}
                  </span>
                </div>
                <div className="w-px h-4 bg-primary/10" />
                <div className="flex items-center gap-1 text-muted-foreground/90" title="Total Cost">
                  <DollarSign className="w-3 h-3" />
                  <span>${agg.totalCost.toFixed(4)}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground/90" title="Avg Duration">
                  <Clock className="w-3 h-3" />
                  <span>{(agg.avgDuration / 1000).toFixed(1)}s</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed comparison matrix */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          Scenario Breakdown
        </h4>
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Scenario</th>
                {models.map((mid) => (
                  <th
                    key={mid}
                    className={`text-center px-3 py-2.5 font-medium ${
                      mid === bestModelId ? 'text-primary' : 'text-muted-foreground/80'
                    }`}
                  >
                    {mid}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario} className="border-b border-primary/5 hover:bg-secondary/10 transition-colors">
                  <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">
                    {scenario}
                  </td>
                  {models.map((mid) => {
                    const r = matrix[scenario]?.[mid];
                    if (!r) return <td key={mid} className="px-3 py-2.5 text-center text-muted-foreground/80">—</td>;
                    const composite = compositeScore(
                      r.tool_accuracy_score ?? 0,
                      r.output_quality_score ?? 0,
                      r.protocol_compliance ?? 0,
                    );
                    return (
                      <td key={mid} className="px-3 py-2.5">
                        <div className="flex flex-col items-center gap-1">
                          <span className={statusBadge(r.status)}>{r.status}</span>
                          <span className={`text-sm font-bold ${scoreColor(composite)}`}>
                            {composite}
                          </span>
                          <div className="flex items-center gap-2 text-sm text-muted-foreground/80">
                            <span>${r.cost_usd.toFixed(4)}</span>
                            <span>{(r.duration_ms / 1000).toFixed(1)}s</span>
                          </div>
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
