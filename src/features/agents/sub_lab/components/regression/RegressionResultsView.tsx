import { useMemo } from 'react';
import { TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import { compositeScore } from '@/lib/eval/evalFramework';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { useTranslation } from '@/i18n/useTranslation';

interface Props {
  baselineResults: LabEvalResult[];
  currentResults: LabEvalResult[];
  baselineVersionNum: number;
  currentVersionNum: number;
  threshold: number;
}

interface ScenarioDelta {
  scenario: string;
  model: string;
  baselineComposite: number;
  currentComposite: number;
  delta: number;
  deltaToolAccuracy: number;
  deltaOutputQuality: number;
  deltaProtocol: number;
  verdict: 'pass' | 'fail' | 'improved';
}

function avg(vals: number[]): number {
  return vals.length === 0 ? 0 : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
}

export function RegressionResultsView({ baselineResults, currentResults, baselineVersionNum, currentVersionNum, threshold }: Props) {
  const { t } = useTranslation();
  const { deltas, overallVerdict, overallDelta, summaryScores } = useMemo(() => {
    const deltas: ScenarioDelta[] = [];

    for (const curr of currentResults) {
      if (curr.toolAccuracyScore == null || curr.outputQualityScore == null || curr.protocolCompliance == null) continue;

      const baseline = baselineResults.find(
        (b) => b.scenarioName === curr.scenarioName && b.modelId === curr.modelId,
      );
      if (!baseline || baseline.toolAccuracyScore == null || baseline.outputQualityScore == null || baseline.protocolCompliance == null) continue;

      const bComp = compositeScore(baseline.toolAccuracyScore, baseline.outputQualityScore, baseline.protocolCompliance);
      const cComp = compositeScore(curr.toolAccuracyScore, curr.outputQualityScore, curr.protocolCompliance);
      const delta = cComp - bComp;

      deltas.push({
        scenario: curr.scenarioName,
        model: curr.modelId,
        baselineComposite: bComp,
        currentComposite: cComp,
        delta,
        deltaToolAccuracy: (curr.toolAccuracyScore ?? 0) - (baseline.toolAccuracyScore ?? 0),
        deltaOutputQuality: (curr.outputQualityScore ?? 0) - (baseline.outputQualityScore ?? 0),
        deltaProtocol: (curr.protocolCompliance ?? 0) - (baseline.protocolCompliance ?? 0),
        verdict: delta > 0 ? 'improved' : delta < -threshold ? 'fail' : 'pass',
      });
    }

    const failures = deltas.filter((d) => d.verdict === 'fail');
    const improvements = deltas.filter((d) => d.verdict === 'improved');
    const overallVerdict: 'pass' | 'fail' | 'improved' =
      failures.length > 0 ? 'fail' : improvements.length > 0 ? 'improved' : 'pass';

    const overallDelta = deltas.length > 0 ? avg(deltas.map((d) => d.delta)) : 0;

    const summaryScores = {
      avgToolAccuracy: avg(deltas.map((d) => d.deltaToolAccuracy)),
      avgOutputQuality: avg(deltas.map((d) => d.deltaOutputQuality)),
      avgProtocol: avg(deltas.map((d) => d.deltaProtocol)),
    };

    return { deltas, overallVerdict, overallDelta, summaryScores };
  }, [baselineResults, currentResults, threshold]);

  const verdictConfig = {
    pass: { icon: CheckCircle2, text: t.agents.lab.no_regressions, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    improved: { icon: TrendingUp, text: t.agents.lab.improved_over_baseline, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    fail: { icon: XCircle, text: `${deltas.filter((d) => d.verdict === 'fail').length} Regression(s) Found`, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  };

  const vc = verdictConfig[overallVerdict];
  const VerdictIcon = vc.icon;

  if (deltas.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <AlertTriangle className="w-8 h-8 text-amber-400/40 mx-auto" />
        <p className="typo-body text-muted-foreground/60">{t.agents.lab.no_comparable_scenarios}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-slide-in">
      {/* Overall verdict banner */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${vc.bg} ${vc.border}`}>
        <VerdictIcon className={`w-5 h-5 ${vc.color}`} />
        <div className="flex-1">
          <p className={`typo-heading ${vc.color}`}>{vc.text}</p>
          <p className="typo-caption text-muted-foreground/50">
            v{baselineVersionNum} (baseline) → v{currentVersionNum} | Overall Δ: {overallDelta >= 0 ? '+' : ''}{overallDelta} pts | Threshold: -{threshold} pts
          </p>
        </div>
      </div>

      {/* Summary score deltas */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: t.agents.lab.tool_accuracy, delta: summaryScores.avgToolAccuracy },
          { label: t.agents.lab.output_quality, delta: summaryScores.avgOutputQuality },
          { label: t.agents.lab.protocol_compliance, delta: summaryScores.avgProtocol },
        ].map(({ label, delta }) => (
          <div key={label} className="rounded-xl border border-primary/10 bg-secondary/20 p-3 space-y-1">
            <p className="typo-caption text-muted-foreground/50">{label}</p>
            <div className="flex items-center gap-2">
              {delta > 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : delta < 0 ? (
                <TrendingDown className="w-4 h-4 text-red-400" />
              ) : (
                <Minus className="w-4 h-4 text-muted-foreground/40" />
              )}
              <span className={`typo-heading ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground/60'}`}>
                {delta >= 0 ? '+' : ''}{delta}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Per-scenario breakdown */}
      <div className="space-y-2">
        <p className="typo-caption text-muted-foreground/60">{t.agents.lab.per_scenario_results}</p>
        <div className="space-y-1">
          {deltas.map((d, i) => (
            <div
              key={`${d.scenario}-${d.model}-${i}`}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg transition-colors ${
                d.verdict === 'fail'
                  ? 'bg-red-500/5 border border-red-500/15'
                  : d.verdict === 'improved'
                    ? 'bg-emerald-500/5 border border-emerald-500/15'
                    : 'bg-secondary/10 border border-primary/5'
              }`}
            >
              {d.verdict === 'fail' ? (
                <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              ) : d.verdict === 'improved' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 text-muted-foreground/30 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <span className="typo-caption text-foreground/70">{d.scenario}</span>
                <span className="typo-caption text-muted-foreground/40 ml-2">{d.model}</span>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <span className="typo-caption text-muted-foreground/40">{d.baselineComposite}</span>
                <span className="typo-caption text-muted-foreground/30">→</span>
                <span className="typo-caption text-foreground/70">{d.currentComposite}</span>
                <span className={`typo-caption font-mono min-w-[3rem] text-right ${
                  d.delta > 0 ? 'text-emerald-400' : d.delta < -threshold ? 'text-red-400' : 'text-muted-foreground/50'
                }`}>
                  {d.delta >= 0 ? '+' : ''}{d.delta}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
