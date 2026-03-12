import { useMemo } from 'react';
import type { PersonaTestResult } from '@/lib/bindings/PersonaTestResult';
import { compositeScore, statusBadge } from '../libs/testUtils';
import { ModelRankings, scoreColor, type ModelAggregate } from './ModelRankings';

interface Props {
  results: PersonaTestResult[];
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

    const aggs: ModelAggregate[] = models.map((mid) => {
      const rows = results.filter((r) => r.model_id === mid);
      const n = rows.length || 1;
      const avgTA = rows.reduce((s, r) => s + (r.tool_accuracy_score ?? 0), 0) / n;
      const avgOQ = rows.reduce((s, r) => s + (r.output_quality_score ?? 0), 0) / n;
      const avgPC = rows.reduce((s, r) => s + (r.protocol_compliance ?? 0), 0) / n;
      return {
        modelId: mid, provider: rows[0]?.provider ?? 'unknown',
        avgToolAccuracy: Math.round(avgTA), avgOutputQuality: Math.round(avgOQ),
        avgProtocolCompliance: Math.round(avgPC),
        compositeScore: compositeScore(avgTA, avgOQ, avgPC),
        totalCost: rows.reduce((s, r) => s + r.cost_usd, 0),
        avgDuration: Math.round(rows.reduce((s, r) => s + r.duration_ms, 0) / n),
        count: rows.length,
      };
    });
    aggs.sort((a, b) => b.compositeScore - a.compositeScore);
    return { models, scenarios, matrix: mtx, aggregates: aggs, bestModelId: aggs[0]?.modelId ?? null };
  }, [results]);

  if (results.length === 0) {
    return <div className="text-center py-8 text-muted-foreground/80 text-sm">No results to display</div>;
  }

  return (
    <div className="space-y-6">
      <ModelRankings aggregates={aggregates} bestModelId={bestModelId} />
      {/* Scenario Breakdown */}
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
                  <th key={mid} className={`text-center px-3 py-2.5 font-medium ${mid === bestModelId ? 'text-primary' : 'text-muted-foreground/80'}`}>
                    {mid}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => (
                <tr key={scenario} className="border-b border-primary/10 hover:bg-secondary/10 transition-colors">
                  <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                  {models.map((mid) => {
                    const r = matrix[scenario]?.[mid];
                    if (!r) return <td key={mid} className="px-3 py-2.5 text-center text-muted-foreground/80">{'\u2014'}</td>;
                    const comp = compositeScore(r.tool_accuracy_score ?? 0, r.output_quality_score ?? 0, r.protocol_compliance ?? 0);
                    return (
                      <td key={mid} className="px-3 py-2.5">
                        <div className="flex flex-col items-center gap-1">
                          <span className={statusBadge(r.status)}>{r.status}</span>
                          <span className={`text-sm font-bold ${scoreColor(comp)}`}>{comp}</span>
                          <div className="w-14 h-1 rounded-full bg-primary/10 overflow-hidden">
                            <div className={`h-full rounded-full ${comp >= 80 ? 'bg-emerald-400' : comp >= 50 ? 'bg-amber-400' : 'bg-red-400'}`} style={{ width: `${Math.max(0, Math.min(100, comp))}%` }} />
                          </div>
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
