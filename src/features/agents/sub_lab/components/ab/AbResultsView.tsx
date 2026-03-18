import { useState, useMemo } from 'react';
import { Trophy, Target, FileText, Shield, DollarSign, Clock } from 'lucide-react';
import type { LabAbResult } from '@/lib/bindings/LabAbResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { aggregateAbResults } from '../../libs/labAggregation';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabAbResult[];
  runId?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, versionId: string, rating: number, feedback?: string) => void;
}

export function AbResultsView({ results, runId: _runId, userRatings, onRate }: Props) {
  const { versionAggs, scenarios, matrix, winnerId } = useMemo(
    () => aggregateAbResults(results),
    [results],
  );
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; versionId: string } | null>(null);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm">
        No results to display
      </div>
    );
  }

  const selectedResults = selectedCell ? (matrix[selectedCell.scenario]?.[selectedCell.versionId] ?? []) : [];
  const selectedFirst = selectedResults[0] ?? null;
  const selectedVersion = selectedCell ? versionAggs.find((a) => a.versionId === selectedCell.versionId) : null;

  return (
    <div className="space-y-5">
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
              <div key={agg.versionId} className={`rounded-xl border p-4 space-y-3 ${isWinner ? 'bg-primary/5 border-primary/20' : 'bg-background/30 border-primary/10'}`}>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-sm font-mono font-bold bg-${color}-500/15 text-${color}-400`}>v{agg.versionNumber}</span>
                  {isWinner && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium bg-primary/15 text-primary border border-primary/20">
                      <Trophy className="w-3 h-3" /> Winner
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="flex items-center gap-1" title="Tool Accuracy"><Target className="w-3 h-3 text-muted-foreground/60" /><span className={scoreColor(agg.avgToolAccuracy)}>{agg.avgToolAccuracy}</span></div>
                  <div className="flex items-center gap-1" title="Output Quality"><FileText className="w-3 h-3 text-muted-foreground/60" /><span className={scoreColor(agg.avgOutputQuality)}>{agg.avgOutputQuality}</span></div>
                  <div className="flex items-center gap-1" title="Protocol"><Shield className="w-3 h-3 text-muted-foreground/60" /><span className={scoreColor(agg.avgProtocolCompliance)}>{agg.avgProtocolCompliance}</span></div>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <span className={`font-bold text-lg ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                  <span className="text-muted-foreground/50">composite</span>
                  <div className="flex-1" />
                  <span className="text-muted-foreground/60"><DollarSign className="w-3 h-3 inline" />{agg.totalCost.toFixed(4)}</span>
                  <span className="text-muted-foreground/60"><Clock className="w-3 h-3 inline" />{(agg.avgDuration / 1000).toFixed(1)}s</span>
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
          <span className="text-xs font-normal text-muted-foreground/50 ml-1">Click a cell for details</span>
        </h4>
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground/80">Scenario</th>
                {versionAggs.map((agg) => (
                  <th key={agg.versionId} className="text-center px-3 py-2 font-medium text-muted-foreground/80">v{agg.versionNumber}</th>
                ))}
              </tr>
            </thead>
            <VirtualizedTableBody
              items={scenarios}
              rowKey={(s) => s}
              renderRow={(scenario) => (
                <>
                  <td className="px-3 py-2 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                  {versionAggs.map((agg) => {
                    const rows = matrix[scenario]?.[agg.versionId] ?? [];
                    if (rows.length === 0) return <td key={agg.versionId} className="px-3 py-2 text-center text-muted-foreground/80">--</td>;
                    const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / rows.length;
                    const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / rows.length;
                    const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / rows.length;
                    const comp = compositeScore(avgTA, avgOQ, avgPC);
                    const isSelected = selectedCell?.scenario === scenario && selectedCell?.versionId === agg.versionId;
                    return (
                      <td key={agg.versionId} className="px-3 py-2 text-center">
                        <button
                          onClick={() => setSelectedCell(isSelected ? null : { scenario, versionId: agg.versionId })}
                          className={`rounded-lg px-2 py-1 transition-colors ${isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/30'}`}
                        >
                          <span className={`text-sm font-bold ${scoreColor(comp)}`}>{comp}</span>
                        </button>
                      </td>
                    );
                  })}
                </>
              )}
            />
          </table>
        </div>
      </div>

      {/* Detail panel */}
      {selectedFirst && selectedCell && (() => {
        const ratingKey = `${selectedCell.scenario}::${selectedCell.versionId}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: selectedVersion ? `v${selectedVersion.versionNumber}` : undefined,
              status: selectedFirst.status,
              toolAccuracyScore: selectedFirst.toolAccuracyScore,
              outputQualityScore: selectedFirst.outputQualityScore,
              protocolCompliance: selectedFirst.protocolCompliance,
              outputPreview: selectedFirst.outputPreview,
              toolCallsExpected: selectedFirst.toolCallsExpected,
              toolCallsActual: selectedFirst.toolCallsActual,
              costUsd: selectedFirst.costUsd,
              durationMs: selectedFirst.durationMs,
              errorMessage: selectedFirst.errorMessage,
              rationale: selectedFirst.rationale ?? null,
              suggestions: selectedFirst.suggestions ?? null,
            }}
            onClose={() => setSelectedCell(null)}
            rating={ratingEntry?.rating}
            ratingFeedback={ratingEntry?.feedback}
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, selectedCell.versionId, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
