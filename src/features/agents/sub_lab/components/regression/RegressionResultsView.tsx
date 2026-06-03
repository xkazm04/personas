import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, CheckCircle2, XCircle, AlertTriangle } from 'lucide-react';
import type { LabEvalResult } from '@/lib/bindings/LabEvalResult';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText } from '@/i18n/DebtText';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { LabStaggerGroup, LabStaggerItem } from '@/features/agents/sub_lab/components/shared/LabStaggerGroup';
import { RegressionDeltaCounter } from './RegressionDeltaCounter';
import { computeRegressionDeltas } from './computeRegressionDeltas';


interface Props {
  baselineResults: LabEvalResult[];
  currentResults: LabEvalResult[];
  baselineVersionNum: number;
  currentVersionNum: number;
  threshold: number;
}

export function RegressionResultsView({ baselineResults, currentResults, baselineVersionNum, currentVersionNum, threshold }: Props) {
  const { t } = useTranslation();
  const { shouldAnimate, spring } = useMotion();
  const summary = useMemo(
    () => computeRegressionDeltas(baselineResults, currentResults, threshold),
    [baselineResults, currentResults, threshold],
  );
  const { deltas, overallVerdict, overallDelta, failureCount } = summary;

  const verdictConfig = {
    pass: { icon: CheckCircle2, text: t.agents.lab.no_regressions, color: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
    improved: { icon: TrendingUp, text: t.agents.lab.improved_over_baseline, color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
    fail: { icon: XCircle, text: `${failureCount} Regression(s) Found`, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  };

  const vc = verdictConfig[overallVerdict];
  const VerdictIcon = vc.icon;

  if (deltas.length === 0) {
    return (
      <div className="text-center py-12 space-y-2">
        <AlertTriangle className="w-8 h-8 text-amber-400/40 mx-auto" />
        <p className="typo-body text-foreground">{t.agents.lab.no_comparable_scenarios}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Overall verdict banner — icon springs in so the outcome lands with intent */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-modal border animate-fade-slide-in ${vc.bg} ${vc.border}`}>
        {shouldAnimate ? (
          <motion.span
            key={overallVerdict}
            className="flex-shrink-0"
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={spring}
          >
            <VerdictIcon className={`w-5 h-5 ${vc.color}`} />
          </motion.span>
        ) : (
          <VerdictIcon className={`w-5 h-5 flex-shrink-0 ${vc.color}`} />
        )}
        <div className="flex-1">
          <p className={`typo-heading ${vc.color}`}>{vc.text}</p>
          <p className="typo-caption text-foreground">
            v{baselineVersionNum} <DebtText k="auto_baseline_v_6cc61267" />{currentVersionNum} <DebtText k="auto_overall_55be8ca6" /> <RegressionDeltaCounter value={overallDelta} /> <DebtText k="auto_pts_threshold_93dd8ca9" />{threshold} pts
          </p>
        </div>
      </div>

      {/* Summary score deltas — cascade in, integers count up from 0 */}
      <LabStaggerGroup className="grid grid-cols-3 gap-3">
        {[
          { label: t.agents.lab.tool_accuracy, delta: summary.avgToolAccuracy },
          { label: t.agents.lab.output_quality, delta: summary.avgOutputQuality },
          { label: t.agents.lab.protocol_compliance, delta: summary.avgProtocol },
        ].map(({ label, delta }) => (
          <LabStaggerItem key={label} className="rounded-modal border border-primary/10 bg-secondary/20 p-3 space-y-1">
            <p className="typo-caption text-foreground">{label}</p>
            <div className="flex items-center gap-2">
              {delta > 0 ? (
                <TrendingUp className="w-4 h-4 text-emerald-400" />
              ) : delta < 0 ? (
                <TrendingDown className="w-4 h-4 text-red-400" />
              ) : (
                <Minus className="w-4 h-4 text-foreground" />
              )}
              <RegressionDeltaCounter
                value={delta}
                className={`typo-heading ${delta > 0 ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 'text-foreground'}`}
              />
            </div>
          </LabStaggerItem>
        ))}
      </LabStaggerGroup>

      {/* Per-scenario breakdown — each row cascades in */}
      <div className="space-y-2">
        <p className="typo-caption text-foreground">{t.agents.lab.per_scenario_results}</p>
        <LabStaggerGroup className="space-y-1">
          {deltas.map((d, i) => (
            <LabStaggerItem
              key={`${d.scenario}-${d.model}-${i}`}
              className={`flex items-center gap-3 px-3 py-2 rounded-card transition-colors ${
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
                <CheckCircle2 className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
              )}
              {/* Primary: scenario name. Secondary: model id as a dim mono badge. */}
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <span className="typo-body text-foreground truncate min-w-0">{d.scenario}</span>
                {/* eslint-disable-next-line custom/no-low-contrast-text-classes -- model id is a structural badge, intentionally muted below the scenario name (per request) */}
                <span className="typo-code text-foreground/55 px-1.5 py-0.5 rounded bg-secondary/30 flex-shrink-0">{d.model}</span>
              </div>
              {/* Verdict layer: dim the baseline + arrow so the eye lands on the current score and the semantic-colored delta. */}
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* eslint-disable-next-line custom/no-low-contrast-text-classes -- baseline is dimmed context, not primary content; current score + delta carry the signal (per request) */}
                <span className="typo-data text-foreground/45">{d.baselineComposite}</span>
                {/* eslint-disable-next-line custom/no-low-contrast-text-classes -- arrow is a structural separator glyph, intentionally faint (per request) */}
                <span className="typo-caption text-foreground/30">→</span>
                <span className="typo-data font-medium text-foreground">{d.currentComposite}</span>
                <span className={`typo-data font-mono min-w-[3rem] text-right ${
                  d.delta > 0 ? 'text-emerald-400' : d.delta < -threshold ? 'text-red-400' : 'text-foreground'
                }`}>
                  {d.delta >= 0 ? '+' : ''}{d.delta}
                </span>
              </div>
            </LabStaggerItem>
          ))}
        </LabStaggerGroup>
      </div>
    </div>
  );
}
