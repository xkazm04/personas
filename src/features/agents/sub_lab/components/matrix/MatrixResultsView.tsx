import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import type { LabMatrixRun } from '@/lib/bindings/LabMatrixRun';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import { DraftDiffViewer } from '../shared/DraftDiffViewer';
import { VirtualizedTableBody } from '../shared/VirtualizedTableBody';
import { ScenarioDetailPanel } from '../shared/ScenarioDetailPanel';
import { MatrixScoreComparison } from './MatrixScoreComparison';
import { useAgentStore } from "@/stores/agentStore";
import { aggregateMatrixResults } from '../../libs/labAggregation';

interface UserRatingEntry {
  rating: number;
  feedback?: string;
}

interface Props {
  run: LabMatrixRun;
  results: LabMatrixResult[];
  userRatings?: Record<string, UserRatingEntry>;
  onRate?: (scenarioName: string, key: string, rating: number, feedback?: string) => void;
}

export function MatrixResultsView({ run, results, userRatings, onRate }: Props) {
  const acceptDraft = useAgentStore((s) => s.acceptDraft);
  const selectedPersona = useAgentStore((s) => s.selectedPersona);
  const [selectedCell, setSelectedCell] = useState<{ scenario: string; variant: string } | null>(null);

  const { variantAggs, scenarios, matrix } = useMemo(
    () => aggregateMatrixResults(results),
    [results],
  );

  const currentAgg = variantAggs.find((a) => a.variant === 'current');
  const draftAgg = variantAggs.find((a) => a.variant === 'draft');

  return (
    <div className="space-y-6">
      {run.draftPromptJson && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
            <span className="w-6 h-[2px] bg-gradient-to-r from-violet-500 to-purple-500 rounded-full" />
            Draft Changes
          </h4>
          <DraftDiffViewer currentPromptJson={selectedPersona?.structured_prompt ?? null}
            draftPromptJson={run.draftPromptJson} changeSummary={run.draftChangeSummary} />
        </div>
      )}

      {variantAggs.length === 2 && <MatrixScoreComparison currentAgg={currentAgg} draftAgg={draftAgg} />}

      {scenarios.length > 0 && (
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
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Scenario</th>
                  <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Current</th>
                  <th className="text-center px-3 py-2.5 font-medium text-violet-400">Draft</th>
                </tr>
              </thead>
              <VirtualizedTableBody
                items={scenarios}
                rowKey={(s) => s}
                renderRow={(scenario) => {
                  const currentRows = matrix[scenario]?.['current'] ?? [];
                  const draftRows = matrix[scenario]?.['draft'] ?? [];
                  const calc = (rows: LabMatrixResult[]) => {
                    if (rows.length === 0) return null;
                    const n = rows.length;
                    return compositeScore(
                      rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n,
                      rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n,
                      rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n,
                    );
                  };
                  const currentScore = calc(currentRows);
                  const draftScore = calc(draftRows);
                  const isCurrentSelected = selectedCell?.scenario === scenario && selectedCell?.variant === 'current';
                  const isDraftSelected = selectedCell?.scenario === scenario && selectedCell?.variant === 'draft';
                  return (
                    <>
                      <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                      <td className="px-3 py-2.5">
                        {currentRows.length > 0 ? (
                          <button
                            onClick={() => setSelectedCell(isCurrentSelected ? null : { scenario, variant: 'current' })}
                            className={`w-full flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors ${
                              isCurrentSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/30'
                            }`}
                          >
                            <span className={`text-sm font-bold ${scoreColor(currentScore)}`}>{currentScore ?? '--'}</span>
                          </button>
                        ) : (
                          <span className={`text-center block font-bold ${scoreColor(currentScore)}`}>{currentScore ?? '--'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        {draftRows.length > 0 ? (
                          <button
                            onClick={() => setSelectedCell(isDraftSelected ? null : { scenario, variant: 'draft' })}
                            className={`w-full flex flex-col items-center gap-0.5 rounded-lg px-2 py-1 transition-colors ${
                              isDraftSelected ? 'bg-primary/10 ring-1 ring-primary/30' : 'hover:bg-secondary/30'
                            }`}
                          >
                            <span className={`text-sm font-bold ${scoreColor(draftScore)}`}>{draftScore ?? '--'}</span>
                          </button>
                        ) : (
                          <span className={`text-center block font-bold ${scoreColor(draftScore)}`}>{draftScore ?? '--'}</span>
                        )}
                      </td>
                    </>
                  );
                }}
              />
            </table>
          </div>
        </div>
      )}

      {/* Scenario detail panel */}
      {selectedCell && (() => {
        const rows = matrix[selectedCell.scenario]?.[selectedCell.variant] ?? [];
        const r = rows[0];
        if (!r) return null;
        const ratingKey = `${selectedCell.scenario}::${selectedCell.variant}`;
        const ratingEntry = userRatings?.[ratingKey];
        return (
          <ScenarioDetailPanel
            result={{
              scenarioName: selectedCell.scenario,
              modelId: r.modelId,
              status: r.status,
              toolAccuracyScore: r.toolAccuracyScore,
              outputQualityScore: r.outputQualityScore,
              protocolCompliance: r.protocolCompliance,
              outputPreview: r.outputPreview,
              toolCallsExpected: r.toolCallsExpected,
              toolCallsActual: r.toolCallsActual,
              costUsd: r.costUsd,
              durationMs: r.durationMs,
              errorMessage: r.errorMessage,
              rationale: r.rationale ?? null,
              suggestions: r.suggestions ?? null,
            }}
            onClose={() => setSelectedCell(null)}
            rating={ratingEntry?.rating}
            ratingFeedback={ratingEntry?.feedback}
            onRate={onRate ? (rating, feedback) => onRate(selectedCell.scenario, selectedCell.variant, rating, feedback) : undefined}
          />
        );
      })()}

      {run.status === 'completed' && !run.draftAccepted && run.draftPromptJson && (
        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => void acceptDraft(run.id)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors">
            <Check className="w-4 h-4" />Accept Draft
          </button>
          <p className="text-sm text-muted-foreground/60">
            Accept applies the draft prompt to the persona, creating a new prompt version.
          </p>
        </div>
      )}
      {run.draftAccepted && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          <Check className="w-4 h-4" />Draft accepted and applied
        </div>
      )}
    </div>
  );
}
