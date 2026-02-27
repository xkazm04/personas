import { useMemo } from 'react';
import { Check, Target, FileText, Shield, DollarSign, Clock, ArrowUp, ArrowDown } from 'lucide-react';
import type { LabMatrixResult } from '@/lib/bindings/LabMatrixResult';
import type { LabMatrixRun } from '@/lib/bindings/LabMatrixRun';
import { compositeScore, scoreColor } from './labUtils';
import { DraftDiffViewer } from './DraftDiffViewer';
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
    const modelSet = new Set<string>();

    for (const r of results) {
      if (!variantMap.has(r.variant)) variantMap.set(r.variant, []);
      variantMap.get(r.variant)!.push(r);
      scenarioSet.add(r.scenarioName);
      modelSet.add(r.modelId);
    }

    const aggs: VariantAggregate[] = [];
    for (const [variant, rows] of variantMap) {
      const n = rows.length || 1;
      const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n;
      const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n;
      const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n;
      aggs.push({
        variant,
        avgToolAccuracy: Math.round(avgTA),
        avgOutputQuality: Math.round(avgOQ),
        avgProtocolCompliance: Math.round(avgPC),
        compositeScore: compositeScore(avgTA, avgOQ, avgPC),
        totalCost: rows.reduce((s, r) => s + r.costUsd, 0),
        avgDuration: Math.round(rows.reduce((s, r) => s + r.durationMs, 0) / n),
        count: rows.length,
      });
    }

    // Ensure "current" first, "draft" second
    aggs.sort((a, b) => (a.variant === 'current' ? -1 : b.variant === 'current' ? 1 : 0));

    const mtx: Record<string, Record<string, LabMatrixResult[]>> = {};
    for (const r of results) {
      if (!mtx[r.scenarioName]) mtx[r.scenarioName] = {};
      if (!mtx[r.scenarioName]![r.variant]) mtx[r.scenarioName]![r.variant] = [];
      mtx[r.scenarioName]![r.variant]!.push(r);
    }

    return {
      variantAggs: aggs,
      scenarios: [...scenarioSet],
      models: [...modelSet],
      matrix: mtx,
    };
  }, [results]);

  const currentAgg = variantAggs.find((a) => a.variant === 'current');
  const draftAgg = variantAggs.find((a) => a.variant === 'draft');

  const handleAccept = async () => {
    await acceptDraft(run.id);
  };

  return (
    <div className="space-y-6">
      {/* Draft diff viewer */}
      {run.draftPromptJson && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
            <span className="w-6 h-[2px] bg-gradient-to-r from-violet-500 to-purple-500 rounded-full" />
            Draft Changes
          </h4>
          <DraftDiffViewer
            currentPromptJson={selectedPersona?.structured_prompt ?? null}
            draftPromptJson={run.draftPromptJson}
            changeSummary={run.draftChangeSummary}
          />
        </div>
      )}

      {/* Score comparison */}
      {variantAggs.length === 2 && (
        <div className="space-y-2">
          <h4 className="flex items-center gap-2.5 text-sm font-semibold text-foreground/90 tracking-wide">
            <span className="w-6 h-[2px] bg-gradient-to-r from-primary to-accent rounded-full" />
            Score Comparison
          </h4>
          <div className="overflow-x-auto border border-primary/10 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/10 bg-secondary/30">
                  <th className="text-left px-3 py-2.5 font-medium text-muted-foreground/80">Metric</th>
                  <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Current</th>
                  <th className="text-center px-3 py-2.5 font-medium text-violet-400">Draft</th>
                  <th className="text-center px-3 py-2.5 font-medium text-muted-foreground/80">Delta</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { label: 'Tool Accuracy', icon: Target, current: currentAgg?.avgToolAccuracy ?? 0, draft: draftAgg?.avgToolAccuracy ?? 0 },
                  { label: 'Output Quality', icon: FileText, current: currentAgg?.avgOutputQuality ?? 0, draft: draftAgg?.avgOutputQuality ?? 0 },
                  { label: 'Protocol', icon: Shield, current: currentAgg?.avgProtocolCompliance ?? 0, draft: draftAgg?.avgProtocolCompliance ?? 0 },
                  { label: 'Composite', icon: null, current: currentAgg?.compositeScore ?? 0, draft: draftAgg?.compositeScore ?? 0 },
                ].map((row) => {
                  const d = row.draft - row.current;
                  return (
                    <tr key={row.label} className="border-b border-primary/5">
                      <td className="px-3 py-2.5 text-foreground/80 font-medium flex items-center gap-1.5">
                        {row.icon && <row.icon className="w-3.5 h-3.5 text-muted-foreground/80" />}
                        {row.label}
                      </td>
                      <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(row.current)}`}>{row.current}</td>
                      <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(row.draft)}`}>{row.draft}</td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`inline-flex items-center gap-0.5 font-medium ${
                          d > 0 ? 'text-emerald-400' : d < 0 ? 'text-red-400' : 'text-muted-foreground/60'
                        }`}>
                          {d > 0 ? <ArrowUp className="w-3 h-3" /> : d < 0 ? <ArrowDown className="w-3 h-3" /> : null}
                          {d > 0 ? '+' : ''}{d}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Cost comparison */}
          <div className="flex items-center gap-6 text-sm text-muted-foreground/80 px-1">
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              Current: ${currentAgg?.totalCost.toFixed(4) ?? '—'}
            </span>
            <span className="flex items-center gap-1">
              <DollarSign className="w-3 h-3" />
              Draft: ${draftAgg?.totalCost.toFixed(4) ?? '—'}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Current: {currentAgg ? (currentAgg.avgDuration / 1000).toFixed(1) : '—'}s
            </span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              Draft: {draftAgg ? (draftAgg.avgDuration / 1000).toFixed(1) : '—'}s
            </span>
          </div>
        </div>
      )}

      {/* Scenario breakdown */}
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

                  const calcComposite = (rows: LabMatrixResult[]) => {
                    if (rows.length === 0) return null;
                    const n = rows.length;
                    const avgTA = rows.reduce((s, r) => s + (r.toolAccuracyScore ?? 0), 0) / n;
                    const avgOQ = rows.reduce((s, r) => s + (r.outputQualityScore ?? 0), 0) / n;
                    const avgPC = rows.reduce((s, r) => s + (r.protocolCompliance ?? 0), 0) / n;
                    return compositeScore(avgTA, avgOQ, avgPC);
                  };

                  const currentScore = calcComposite(currentRows);
                  const draftScore = calcComposite(draftRows);

                  return (
                    <tr key={scenario} className="border-b border-primary/5 hover:bg-secondary/10 transition-colors">
                      <td className="px-3 py-2.5 text-foreground/80 font-medium max-w-[200px] truncate">{scenario}</td>
                      <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(currentScore)}`}>
                        {currentScore ?? '—'}
                      </td>
                      <td className={`px-3 py-2.5 text-center font-bold ${scoreColor(draftScore)}`}>
                        {draftScore ?? '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Accept / Reject buttons */}
      {run.status === 'completed' && !run.draftAccepted && run.draftPromptJson && (
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => void handleAccept()}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium text-sm bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/25 transition-colors"
          >
            <Check className="w-4 h-4" />
            Accept Draft
          </button>
          <p className="text-xs text-muted-foreground/60">
            Accept applies the draft prompt to the persona, creating a new prompt version.
          </p>
        </div>
      )}
      {run.draftAccepted && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-sm text-emerald-400">
          <Check className="w-4 h-4" />
          Draft accepted and applied
        </div>
      )}
    </div>
  );
}
