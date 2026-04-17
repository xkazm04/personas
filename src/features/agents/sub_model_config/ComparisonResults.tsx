import { useMemo } from 'react';
import { Trophy, FileText, Target, Shield } from 'lucide-react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScore, scoreColor } from '@/lib/eval/evalFramework';
import type { ModelOption, ModelMetrics } from './compareModels';
import { ALL_COMPARE_MODELS } from './compareModels';
import { MetricCard, CompareBar } from './CompareMetricCards';
import { OutputPreviews } from './CompareOutputPreviews';
import { useTranslation } from '@/i18n/useTranslation';

// ---------------------------------------------------------------------------
// Model dropdown
// ---------------------------------------------------------------------------

export function ModelDropdown({
  label,
  value,
  onChange,
  disabled,
  accentColor,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  accentColor: string;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, ModelOption[]>();
    for (const m of ALL_COMPARE_MODELS) {
      const arr = map.get(m.group) ?? [];
      arr.push(m);
      map.set(m.group, arr);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="space-y-1">
      <label className={`text-xs font-medium ${accentColor} uppercase tracking-wider`}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full px-2.5 py-2 text-sm rounded-modal bg-secondary/40 border border-primary/20
                   text-foreground/80 focus-visible:outline-none focus-visible:border-indigo-500/40
                   disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {groups.map(([group, models]) => (
          <optgroup key={group} label={group}>
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label} ({m.cost})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side-by-side results
// ---------------------------------------------------------------------------

export function ComparisonResults({
  modelA,
  modelB,
  metricsA,
  metricsB,
  results,
}: {
  modelA: ModelOption;
  modelB: ModelOption;
  metricsA: ModelMetrics;
  metricsB: ModelMetrics;
  results: LabArenaResult[];
}) {
  const { t } = useTranslation();
  const mc = t.agents.model_config;
  const winner = metricsA.composite > metricsB.composite ? 'A' : metricsA.composite < metricsB.composite ? 'B' : null;

  // Per-scenario side by side
  const scenarios = useMemo(() => {
    const set = new Set<string>();
    for (const r of results) set.add(r.scenarioName);
    return [...set];
  }, [results]);

  const scenarioMatrix = useMemo(() => {
    const mtx: Record<string, Record<string, LabArenaResult>> = {};
    for (const r of results) {
      if (!mtx[r.scenarioName]) mtx[r.scenarioName] = {};
      mtx[r.scenarioName]![r.modelId] = r;
    }
    return mtx;
  }, [results]);

  return (
    <div className="space-y-3">
      {/* Winner banner */}
      {winner && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-modal bg-primary/5 border border-primary/20">
          <Trophy className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground/90">
            {winner === 'A' ? modelA.label : modelB.label} {mc.wins}
          </span>
          <span className="text-sm text-muted-foreground/60">
            ({(winner === 'A' ? metricsA : metricsB).composite} vs {(winner === 'A' ? metricsB : metricsA).composite} {mc.composite})
          </span>
        </div>
      )}

      {/* Side-by-side metrics cards */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard model={modelA} metrics={metricsA} isWinner={winner === 'A'} accent="blue" />
        <MetricCard model={modelB} metrics={metricsB} isWinner={winner === 'B'} accent="amber" />
      </div>

      {/* Metric comparison bars */}
      <div className="space-y-2 px-1">
        <CompareBar label={mc.quality} labelIcon={FileText} valueA={metricsA.avgOutputQuality} valueB={metricsB.avgOutputQuality} />
        <CompareBar label={mc.tool_accuracy} labelIcon={Target} valueA={metricsA.avgToolAccuracy} valueB={metricsB.avgToolAccuracy} />
        <CompareBar label={mc.protocol} labelIcon={Shield} valueA={metricsA.avgProtocolCompliance} valueB={metricsB.avgProtocolCompliance} />
      </div>

      {/* Per-scenario breakdown */}
      {scenarios.length > 1 && (
        <div className="overflow-x-auto border border-primary/10 rounded-modal">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground/80 text-xs">{mc.scenario}</th>
                <th className="text-center px-3 py-2 font-medium text-blue-400/80 text-xs">{modelA.label}</th>
                <th className="text-center px-3 py-2 font-medium text-amber-400/80 text-xs">{modelB.label}</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => {
                const rA = scenarioMatrix[scenario]?.[modelA.id];
                const rB = scenarioMatrix[scenario]?.[modelB.id];
                const scoreA = rA ? compositeScore(rA.toolAccuracyScore ?? 0, rA.outputQualityScore ?? 0, rA.protocolCompliance ?? 0) : null;
                const scoreB = rB ? compositeScore(rB.toolAccuracyScore ?? 0, rB.outputQualityScore ?? 0, rB.protocolCompliance ?? 0) : null;
                const rowWinner = scoreA != null && scoreB != null ? (scoreA > scoreB ? 'A' : scoreA < scoreB ? 'B' : null) : null;
                return (
                  <tr key={scenario} className="border-b border-primary/10">
                    <td className="px-3 py-2 text-foreground/80 max-w-[180px] truncate">{scenario}</td>
                    <td className={`px-3 py-2 text-center font-mono ${rowWinner === 'A' ? 'font-bold' : ''}`}>
                      <span className={scoreColor(scoreA)}>{scoreA ?? '-'}</span>
                      {rA && <span className="text-muted-foreground/50 ml-1.5 text-xs">{(rA.durationMs / 1000).toFixed(1)}s</span>}
                    </td>
                    <td className={`px-3 py-2 text-center font-mono ${rowWinner === 'B' ? 'font-bold' : ''}`}>
                      <span className={scoreColor(scoreB)}>{scoreB ?? '-'}</span>
                      {rB && <span className="text-muted-foreground/50 ml-1.5 text-xs">{(rB.durationMs / 1000).toFixed(1)}s</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Output previews side by side */}
      {results.length > 0 && (
        <OutputPreviews modelA={modelA} modelB={modelB} results={results} />
      )}
    </div>
  );
}
