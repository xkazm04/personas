import { useMemo } from 'react';
import { Trophy, Target, FileText, Shield, AlertCircle } from 'lucide-react';
import type { LabArenaResult } from '@/lib/bindings/LabArenaResult';
import { compositeScoreFromRow, scoreColor } from '@/lib/eval/evalFramework';
import { rowFailure, type ModelOption, type ModelMetrics } from '../../libs/compareHelpers';
import { MetricCard, CompareBar } from './CompareMetrics';
import { OutputPreviews } from './CompareOutputPreviews';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { Tooltip } from '@/features/shared/components/display/Tooltip';

/**
 * One model's cell for one scenario. A row that never ran says so — before
 * this, an errored cell rendered a score dash and a 0.0s duration, which is
 * exactly what an ungraded-but-successful cell renders.
 */
function ScenarioCell({ row, score }: { row: LabArenaResult | undefined; score: number | null }) {
  const { t } = useTranslation();
  const failure = rowFailure(row);

  if (failure) {
    return (
      <Tooltip content={failure.message ?? t.common.unknown_error}>
        <span tabIndex={0} className="inline-flex items-center gap-1 text-red-300/90">
          <AlertCircle className="w-3 h-3 text-red-400 flex-shrink-0" />
          <span className="typo-caption font-sans">{tokenLabel(t, 'execution', failure.status)}</span>
        </span>
      </Tooltip>
    );
  }

  return (
    <>
      <span className={scoreColor(score)}>{score ?? '-'}</span>
      {row && (
        <span className="text-foreground ml-1.5 typo-caption">
          <Numeric value={row.durationMs / 1000} precision={1} />s
        </span>
      )}
    </>
  );
}

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
  // No winner unless BOTH models have a composite. A model whose rows were
  // never graded has `null` here, and crowning the other one would announce a
  // verdict on evidence that does not exist.
  const winner =
    metricsA.composite == null || metricsB.composite == null
      ? null
      : metricsA.composite > metricsB.composite
        ? 'A'
        : metricsA.composite < metricsB.composite
          ? 'B'
          : null;

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
          <span className="typo-body font-medium text-foreground/90">
            {winner === 'A' ? modelA.label : modelB.label} {mc.wins}
          </span>
          <span className="typo-body text-foreground">
            ({(winner === 'A' ? metricsA : metricsB).composite ?? '—'} vs {(winner === 'A' ? metricsB : metricsA).composite ?? '—'} {mc.composite})
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
          <table className="w-full typo-body">
            <thead>
              <tr className="border-b border-primary/10 bg-secondary/30">
                <th className="text-left px-3 py-2 font-medium text-foreground typo-caption">{mc.scenario}</th>
                <th className="text-center px-3 py-2 font-medium text-blue-400/80 typo-caption">{modelA.label}</th>
                <th className="text-center px-3 py-2 font-medium text-amber-400/80 typo-caption">{modelB.label}</th>
              </tr>
            </thead>
            <tbody>
              {scenarios.map((scenario) => {
                const rA = scenarioMatrix[scenario]?.[modelA.id];
                const rB = scenarioMatrix[scenario]?.[modelB.id];
                const scoreA = rA ? compositeScoreFromRow(rA.toolAccuracyScore, rA.outputQualityScore, rA.protocolCompliance) : null;
                const scoreB = rB ? compositeScoreFromRow(rB.toolAccuracyScore, rB.outputQualityScore, rB.protocolCompliance) : null;
                const rowWinner = scoreA != null && scoreB != null ? (scoreA > scoreB ? 'A' : scoreA < scoreB ? 'B' : null) : null;
                return (
                  <tr key={scenario} className="border-b border-primary/10">
                    <td className="px-3 py-2 text-foreground max-w-[180px] truncate">{scenario}</td>
                    <td className={`px-3 py-2 text-center font-mono ${rowWinner === 'A' ? 'font-bold' : ''}`}>
                      <ScenarioCell row={rA} score={scoreA} />
                    </td>
                    <td className={`px-3 py-2 text-center font-mono ${rowWinner === 'B' ? 'font-bold' : ''}`}>
                      <ScenarioCell row={rB} score={scoreB} />
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
