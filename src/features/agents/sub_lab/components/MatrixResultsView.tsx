import { useMemo } from 'react';
import { Check } from 'lucide-react';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import type { LabMatrixRun } from '@/lib/bindings/LabMatrixRun';
import { compositeScore, scoreColor } from '../libs/labUtils';
import { DraftDiffViewer } from './DraftDiffViewer';
import { MatrixScoreComparison } from './MatrixScoreComparison';
import { usePersonaStore } from '@/stores/personaStore';

interface Props {
  run: LabMatrixRun;
  results: LabMatrixResult[];
}

interface VariantAggregate {
  variant: string;
  avgToolAccuracy: number;
  avgOutputQuality: number;
  avgProtocolCompliance: number;
  compositeScore: number;
  totalCost: number;
  avgDuration: number;
  count: number;
}

export function MatrixResultsView({ run, results }: Props) {
  const acceptDraft = usePersonaStore((s) => s.acceptDraft);
  const selectedPersona = usePersonaStore((s) => s.selectedPersona);

  const { variantAggs, scenarios, matrix } = useMemo(() => {
    const variantMap = new Map<string, LabMatrixResult[]>();
    const scenarioSet = new Set<string>();

    for (const r of results) {
      if (!variantMap.has(r.variant)) variantMap.set(r.variant, []);
      variantMap.get(r.variant)!.push(r);
      scenarioSet.add(r.scenarioName);
    }

    const aggs: VariantAggregate[] = [];
    for (const [variant, rows] of variantMap) {
      const n = rows.length || 1;
      const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n;
      const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n;
      const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n;
      aggs.push({
        variant, avgToolAccuracy: Math.round(avgTA), avgOutputQuality: Math.round(avgOQ),
        avgProtocolCompliance: Math.round(avgPC), compositeScore: compositeScore(avgTA, avgOQ, avgPC),
        totalCost: rows.reduce((s, r) => s + r.costUsd, 0),
        avgDuration: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n), count: rows.length,
      });
    }
    aggs.sort((a, b) => (a.variant === 'current' ? -1 : b.variant === 'current' ? 1 : 0));

    const mtx: Record<string, Record<string, LabMatrixResult[]>> = {};
    for (const r of results) {
      if (!mtx[r.scenarioName]) mtx[r.scenarioName] = {};
      if (!mtx[r.scenarioName]![r.variant]) mtx[r.scenarioName]![r.variant] = [];
      mtx[r.scenarioName]![r.variant]!.push(r);
    }

    return { variantAggs: aggs, scenarios: [...scenarioSet], matrix: mtx };
  }, [results]);

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
              <tbody>
                {scenarios.map((scenario) => {
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
                  return (
                    <tr key={scenario} className="border-b border-primary/5 hover:bg-secondary/10 transition-colors">
                      <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                      <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(currentScore)}`}>{currentScore ?? '--'}</td>
                      <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(draftScore)}`}>{draftScore ?? '--'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
