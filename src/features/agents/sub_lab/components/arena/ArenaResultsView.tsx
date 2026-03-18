import { useState, useMemo } from 'react';
import { Trophy, DollarSign, Clock, Target, FileText, Shield } from 'lucide-react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { statusBadge, compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { aggregateArenaResults } from '../../libs/labAggregation';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabArenaResult[];
  runId?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, modelId: string, rating: number, feedback?: string) => void;
}

export function ArenaResultsView({ results, runId: _runId, userRatings, onRate }: Props) {
  const { models, scenarios, matrix, aggregates, bestModelId } = useMemo(
    () => aggregateArenaResults(results),
    [results],
  );
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; model: string } | null>(null);

  if (results.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground/80 text-sm">
        No results to display
      </div>
    );
  }

  const selectedResult = selectedCell ? matrix[selectedCell.scenario]?.[selectedCell.model] : null;

  return (
    <div className="space-y-5">
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
              className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-colors ${
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
                  {agg.modelId === bestModelId && (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-lg text-xs font-medium bg-primary/15 text-primary border border-primary/20">
                      <Trophy className="w-3 h-3" /> Best
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1" title="Tool Accuracy">
                  <Target className="w-3 h-3 text-muted-foreground/60" />
                  <span className={scoreColor(agg.avgToolAccuracy)}>{agg.avgToolAccuracy}</span>
                </div>
                <div className="flex items-center gap-1" title="Output Quality">
                  <FileText className="w-3 h-3 text-muted-foreground/60" />
                  <span className={scoreColor(agg.avgOutputQuality)}>{agg.avgOutputQuality}</span>
                </div>
                <div className="flex items-center gap-1" title="Protocol Compliance">
                  <Shield className="w-3 h-3 text-muted-foreground/60" />
                  <span className={scoreColor(agg.avgProtocolCompliance)}>{agg.avgProtocolCompliance}</span>
                </div>
                <div className="w-px h-4 bg-primary/10" />
                <span className={`font-bold ${scoreColor(agg.compositeScore)}`}>{agg.compositeScore}</span>
                <div className="w-px h-4 bg-primary/10" />
                <span className="text-muted-foreground/60"><DollarSign className="w-3 h-3 inline" />{agg.totalCost.toFixed(4)}</span>
                <span className="text-muted-foreground/60"><Clock className="w-3 h-3 inline" />{(agg.avgDuration / 1000).toFixed(1)}s</span>
              </div>
            </div>
          ))}
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
                {models.map((mid) => (
                  <th key={mid} className={`text-center px-3 py-2 font-medium ${mid === bestModelId ? 'text-primary' : 'text-muted-foreground/80'}`}>
                    {mid}
                  </th>
                ))}
              </tr>
            </thead>
            <VirtualizedTableBody
              items={scenarios}
              rowKey={(s) => s}
              renderRow={(scenario) => (
                <>
                  <td className="px-3 py-2 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                  {models.map((mid) => {
                    const r = matrix[scenario]?.[mid];
                    if (!r) return <td key={mid} className="px-3 py-2 text-center text-muted-foreground/80">--</td>;
                    const comp = compositeScore(r.toolAccuracyScore ?? 0, r.outputQualityScore ?? 0, r.protocolCompliance ?? 0);
                    const isSelected = selectedCell?.scenario === scenario && selectedCell?.model === mid;
                    return (
                      <td key={mid} className="px-3 py-2">
                        <button
                          onClick={() => setSelectedCell(isSelected ? null : { scenario, model: mid })}
                          className={`w-full flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors ${
                            isSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/30'
                          }`}
                        >
                          <span className={statusBadge(r.status)}>{r.status}</span>
                          <span className={`text-sm font-bold ${scoreColor(comp)}`}>{comp}</span>
                          <span className="text-xs text-muted-foreground/60">${r.costUsd.toFixed(4)}</span>
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

      {/* Scenario detail panel */}
      {selectedResult && selectedCell && (() => {
        const ratingKey = `${selectedCell.scenario}::${selectedCell.model}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: selectedCell.model,
              status: selectedResult.status,
              toolAccuracyScore: selectedResult.toolAccuracyScore,
              outputQualityScore: selectedResult.outputQualityScore,
              protocolCompliance: selectedResult.protocolCompliance,
              outputPreview: selectedResult.outputPreview,
              toolCallsExpected: selectedResult.toolCallsExpected,
              toolCallsActual: selectedResult.toolCallsActual,
              costUsd: selectedResult.costUsd,
              durationMs: selectedResult.durationMs,
              errorMessage: selectedResult.errorMessage,
              rationale: selectedResult.rationale ?? null,
              suggestions: selectedResult.suggestions ?? null,
            }}
            onClose={() => setSelectedCell(null)}
            rating={ratingEntry?.rating}
            ratingFeedback={ratingEntry?.feedback}
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, selectedCell.model, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
