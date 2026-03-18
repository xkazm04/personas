import { useMemo, useEffect, useState } from 'react';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { Trophy } from 'lucide-react';
import { compositeScore, scoreColor, statusBadge } from '@/lib/eval/evalFramework';
import { buildEvalGridData } from '../../libs/evalAggregation';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { EvalVersionCards } from './EvalVersionCards';
import { EvalRadarChart } from './EvalRadarChart';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  results: LabEvalResult[];
  runId?: string;
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, key: string, rating: number, feedback?: string) => void;
}

export function EvalResultsGrid({ results, runId: _runId, userRatings, onRate }: Props) {
  const [celebrateWinnerId, setCelebrateWinnerId] = useState<string | null>(null);
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; versionId: string; modelId: string } | null>(null);
  const { shouldAnimate } = useMotion();

  const { versionAggs, versions, models, grid, winnerId } = useMemo(
    () => buildEvalGridData(results),
    [results],
  );

  // Build scenario-level lookup: scenario -> versionId -> modelId -> LabEvalResult
  const { scenarios, scenarioMatrix } = useMemo(() => {
    const scenarioSet = new Set<string>();
    const sm: Record<string, Record<string, Record<string, LabEvalResult>>> = {};
    for (const r of results) {
      scenarioSet.add(r.scenarioName);
      if (!sm[r.scenarioName]) sm[r.scenarioName] = {};
      if (!sm[r.scenarioName]![r.versionId]) sm[r.scenarioName]![r.versionId] = {};
      sm[r.scenarioName]![r.versionId]![r.modelId] = r;
    }
    return { scenarios: [...scenarioSet], scenarioMatrix: sm };
  }, [results]);

  const selectedResult = selectedCell
    ? scenarioMatrix[selectedCell.scenario]?.[selectedCell.versionId]?.[selectedCell.modelId]
    : null;

  useEffect(() => {
    if (!shouldAnimate) { setCelebrateWinnerId(null); return; }
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

  return (
    <div className="space-y-6" data-testid="eval-results-grid">
      <EvalVersionCards versionAggs={versionAggs} winnerId={winnerId} celebrateWinnerId={celebrateWinnerId} />
      <EvalRadarChart versionAggs={versionAggs} />

      {/* Version x Model matrix grid */}
      <div className="space-y-2">
        <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
          <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
          Version x Model Matrix
        </h4>
        <div className="overflow-x-auto border border-primary/10 rounded-xl">
          <table className="w-full text-sm" data-testid="eval-matrix-table">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Version</th>
                {models.map((m) => (
                  <th key={m} className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">{m}</th>
                ))}
                <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Avg</th>
              </tr>
            </thead>
            <VirtualizedTableBody
              items={versions}
              rowKey={(vId) => vId}
              renderRow={(vId) => {
                const agg = versionAggs.find((a) => a.versionId === vId);
                const isWinner = vId === winnerId;
                return (
                  <>
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
                          <span className={`text-sm font-bold ${scoreColor(cell.compositeScore)}`}>{cell.compositeScore}</span>
                          <div className="text-sm text-muted-foreground/60 mt-0.5">${cell.totalCost.toFixed(4)}</div>
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-center">
                      <span className={`text-sm font-bold ${scoreColor(agg?.compositeScore ?? 0)}`}>{agg?.compositeScore ?? 0}</span>
                    </td>
                  </>
                );
              }}
            />
          </table>
        </div>
      </div>

      {/* Per-scenario breakdown */}
      {scenarios.length > 0 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
            <span className="w-6 h-[2px] bg-gradient-to-r from-primary/50 to-accent/50 rounded-full" />
            Scenario Breakdown
            <span className="text-xs font-normal text-muted-foreground/50 ml-1">Click a cell for details</span>
          </h4>
          <div className="overflow-x-auto border border-primary/10 rounded-xl">
            <table className="w-full text-sm" data-testid="eval-scenario-table">
              <thead>
                <tr className="border-b border-primary/10 bg-secondary/30">
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Scenario</th>
                  {versions.map((vId) => {
                    const agg = versionAggs.find((a) => a.versionId === vId);
                    return models.map((mId) => (
                      <th key={`${vId}-${mId}`} className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">
                        <div className="text-xs">v{agg?.versionNumber}</div>
                        <div className="text-xs text-muted-foreground/50">{mId}</div>
                      </th>
                    ));
                  })}
                </tr>
              </thead>
              <VirtualizedTableBody
                items={scenarios}
                rowKey={(s) => s}
                renderRow={(scenario) => (
                  <>
                    <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                    {versions.map((vId) =>
                      models.map((mId) => {
                        const r = scenarioMatrix[scenario]?.[vId]?.[mId];
                        if (!r) return <td key={`${vId}-${mId}`} className="px-3 py-2.5 text-center text-muted-foreground/80">--</td>;
                        const comp = compositeScore(r.toolAccuracyScore ?? 0, r.outputQualityScore ?? 0, r.protocolCompliance ?? 0);
                        const isSelected = selectedCell?.scenario === scenario && selectedCell?.versionId === vId && selectedCell?.modelId === mId;
                        return (
                          <td key={`${vId}-${mId}`} className="px-3 py-2.5">
                            <button
                              onClick={() => setSelectedCell(isSelected ? null : { scenario, versionId: vId, modelId: mId })}
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
                      })
                    )}
                  </>
                )}
              />
            </table>
          </div>
        </div>
      )}

      {/* Scenario detail panel */}
      {selectedResult && selectedCell && (() => {
        const ratingKey = `${selectedCell.scenario}::${selectedCell.versionId}::${selectedCell.modelId}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: selectedCell.modelId,
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
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, `${selectedCell.versionId}::${selectedCell.modelId}`, rating, feedback) : undefined}
          />
        );
      })()}
    </div>
  );
}
