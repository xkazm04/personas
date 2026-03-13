import { useMemo } from 'react';
import { Trophy, Target, FileText, Shield, DollarSign, Clock } from 'lucide-react';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { aggregateAbResults } from '../../libs/labAggregation';

interface Props {
  results: LabAbResult[];
}

export function AbResultsView({ results }: Props) {
  const { versionAggs, scenarios, matrix, winnerId } = useMemo(
    () => aggregateAbResults(results),
    [results],
  );

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm">
        No results to display
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Version comparison */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
          <Trophy className="w-3.5 h-3.5" />
          Version Comparison
        </h4>
        <div className="grid grid-cols-2 gap-3">
          {versionAggs.map((agg, idx) => {
            const isWinner = agg.versionId === winnerId;
            const color = idx === 0 ? 'blue' : 'violet';
            return (
              <div
                key={agg.versionId}
                className={`rounded-xl border p-4 space-y-3 ${
                  isWinner ? 'bg-primary/5 border-primary/20' : 'bg-background/30 border-primary/10'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-sm font-mono font-bold bg-${color}-500/15 text-${color}-400`}>
                    v{agg.versionNumber}
                  </span>
                  {isWinner && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-sm font-medium bg-primary/15 text-primary border border-primary/20">
                      <Trophy className="w-3 h-3" /> Winner
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

      {/* Scenario breakdown */}
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
                {versionAggs.map((agg) => (
                  <th key={agg.versionId} className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">
                    v{agg.versionNumber}
                  </th>
                ))}
              </tr>
            </thead>
            <VirtualizedTableBody
              items={scenarios}
              rowKey={(s) => s}
              renderRow={(scenario) => (
                <>
                  <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">
                    {scenario}
                  </td>
                  {versionAggs.map((agg) => {
                    const rows = matrix[scenario]?.[agg.versionId] ?? [];
                    if (rows.length === 0) {
                      return <td key={agg.versionId} className="px-3 py-2.5 text-center text-muted-foreground/80">--</td>;
                    }
                    const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / rows.length;
                    const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / rows.length;
                    const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / rows.length;
                    const composite = compositeScore(avgTA, avgOQ, avgPC);
                    return (
                      <td key={agg.versionId} className="px-3 py-2.5 text-center">
                        <span className={`text-sm font-bold ${scoreColor(composite)}`}>{composite}</span>
                      </td>
                    );
                  })}
                </>
              )}
            />
          </table>
        </div>
      </div>
    </div>
  );
}
