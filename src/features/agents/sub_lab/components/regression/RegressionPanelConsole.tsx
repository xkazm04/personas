/**
 * Variant — "Safety Console"
 *
 * Metaphor: a cockpit-style three-zone layout. Left column shows vital signs
 * (baseline pin, threshold gauge, model count). Centre is the head-to-head
 * specimen comparison: two version cards side by side with their identifying
 * facts. Right column is a status panel with three "warning lights" — one per
 * scoring dimension — that turn green / amber / red as results arrive.
 *
 * Why different from baseline: baseline is linear (form → run → results below).
 * This variant promotes side-by-side comparison and status feedback to the
 * primary axis. The Run CTA is centred under the comparison so the user's
 * eye flows: configure (left) → see what's compared (centre) → run → watch
 * lights (right).
 */
import { useMemo } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Star, Play, Shield, AlertTriangle, Gauge, Lightbulb, Target, FileText, ShieldCheck } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ModelToggleGrid } from '../../shared';
import { RegressionResultsView } from './RegressionResultsView';
import { useTranslation } from '@/i18n/useTranslation';
import { useRegressionPanelState, REG_DEFAULT_THRESHOLD } from './useRegressionPanelState';
import { compositeScore } from '@/lib/eval/evalFramework';
import { DebtText, debtText } from '@/i18n/DebtText';


function ThresholdGauge({ value }: { value: number }) {
  // Render a quarter-circle dial that maps 0..50 → 0..270deg
  const pct = Math.min(value, 50) / 50;
  const angle = pct * 270 - 135; // -135deg start, full sweep 270
  return (
    <div className="relative w-28 h-28 mx-auto">
      <svg viewBox="0 0 100 100" className="w-full h-full">
        <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="50" cy="50" r="42" fill="none"
          stroke="currentColor"
          strokeWidth="6"
          strokeLinecap="round"
          className="text-primary"
          strokeDasharray={`${pct * 264} 264`}
          transform="rotate(-225 50 50)"
        />
        <line
          x1="50" y1="50"
          x2="50" y2="14"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className="text-foreground"
          transform={`rotate(${angle} 50 50)`}
        />
        <circle cx="50" cy="50" r="3.5" fill="currentColor" className="text-foreground" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
        <div className="typo-data-lg text-foreground leading-none">{value}</div>
        <div className="typo-caption text-foreground"><DebtText k="auto_pts_drop_3f43c7c7" /></div>
      </div>
    </div>
  );
}

interface DimSummary {
  label: string;
  delta: number;
  icon: typeof Target;
}

function WarningLight({ dim, threshold }: { dim: DimSummary; threshold: number }) {
  const Icon = dim.icon;
  const status = dim.delta > 0 ? 'pass' : dim.delta >= -threshold ? 'watch' : 'fail';
  const tone = {
    pass:  { dot: 'bg-emerald-400 shadow-[0_0_12px] shadow-emerald-400/40', label: 'pass',  text: 'text-emerald-300' },
    watch: { dot: 'bg-foreground/50',                                         label: 'flat',  text: 'text-foreground' },
    fail:  { dot: 'bg-red-400 shadow-[0_0_12px] shadow-red-400/40',           label: 'fail',  text: 'text-red-300' },
  }[status];
  return (
    <div className="flex items-center gap-3 rounded-card border border-primary/12 bg-background/40 px-3 py-2.5">
      <div className={`w-2.5 h-2.5 rounded-full ${tone.dot}`} aria-hidden />
      <Icon className="w-3.5 h-3.5 text-foreground" />
      <span className="flex-1 typo-caption text-foreground">{dim.label}</span>
      <span className={`typo-data ${tone.text}`}>
        {dim.delta > 0 ? '+' : ''}{dim.delta}
      </span>
      <span className={`typo-label ${tone.text}`}>{tone.label}</span>
    </div>
  );
}

export function RegressionPanelConsole() {
  const { t } = useTranslation();
  const s = useRegressionPanelState();

  const dimDeltas: DimSummary[] = useMemo(() => {
    if (s.currentResults.length === 0 || s.baselineResults.length === 0) return [];
    let totalTA = 0, totalOQ = 0, totalPC = 0, n = 0;
    for (const curr of s.currentResults) {
      if (curr.toolAccuracyScore == null || curr.outputQualityScore == null || curr.protocolCompliance == null) continue;
      const baseline = s.baselineResults.find((b) => b.scenarioName === curr.scenarioName && b.modelId === curr.modelId);
      if (!baseline || baseline.toolAccuracyScore == null || baseline.outputQualityScore == null || baseline.protocolCompliance == null) continue;
      totalTA += (curr.toolAccuracyScore - baseline.toolAccuracyScore);
      totalOQ += (curr.outputQualityScore - baseline.outputQualityScore);
      totalPC += (curr.protocolCompliance - baseline.protocolCompliance);
      n += 1;
    }
    if (n === 0) return [];
    return [
      { label: 'Tool accuracy', delta: Math.round(totalTA / n), icon: Target },
      { label: 'Output quality', delta: Math.round(totalOQ / n), icon: FileText },
      { label: 'Protocol compliance', delta: Math.round(totalPC / n), icon: ShieldCheck },
    ];
  }, [s.currentResults, s.baselineResults]);

  const overallDelta = useMemo(() => {
    if (s.currentResults.length === 0 || s.baselineResults.length === 0) return null;
    let total = 0, n = 0;
    for (const curr of s.currentResults) {
      if (curr.toolAccuracyScore == null || curr.outputQualityScore == null || curr.protocolCompliance == null) continue;
      const baseline = s.baselineResults.find((b) => b.scenarioName === curr.scenarioName && b.modelId === curr.modelId);
      if (!baseline || baseline.toolAccuracyScore == null || baseline.outputQualityScore == null || baseline.protocolCompliance == null) continue;
      total += compositeScore(curr.toolAccuracyScore, curr.outputQualityScore, curr.protocolCompliance) -
               compositeScore(baseline.toolAccuracyScore, baseline.outputQualityScore, baseline.protocolCompliance);
      n += 1;
    }
    return n === 0 ? null : Math.round(total / n);
  }, [s.currentResults, s.baselineResults]);

  if (!s.baselinePin) {
    return (
      <div className="py-12">
        <EmptyState
          icon={Star}
          title={t.agents.lab.no_baseline_title}
          subtitle={t.agents.lab.no_baseline_subtitle}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
          action={{ label: t.agents.lab.go_to_versions, onClick: () => s.setLabMode('versions'), icon: Shield }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="regression-panel-console">
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr_280px] gap-3 items-stretch">
        {/* Left: vital signs */}
        <div className="rounded-card border border-primary/12 bg-secondary/15 p-3 space-y-3">
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-foreground" />
            <h3 className="typo-heading text-foreground"><DebtText k="auto_vital_signs_d773f8bb" /></h3>
          </div>
          <div className="rounded-card border border-amber-500/25 bg-amber-500/5 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Star className="w-4 h-4 text-amber-400" />
              <span className="typo-label text-amber-300">baseline</span>
            </div>
            <div className="typo-data-lg text-amber-300 mt-0.5">v{s.baselinePin.versionNumber}</div>
            <div className="typo-caption text-foreground">
              pinned {<AbsoluteTime timestamp={s.baselinePin.pinnedAt} variant="date" />}
            </div>
          </div>
          <div className="rounded-card border border-primary/12 bg-background/30 px-3 py-3">
            <p className="typo-label text-foreground mb-2 text-center">threshold</p>
            <ThresholdGauge value={s.threshold} />
            <input
              type="range" min={1} max={50}
              value={s.threshold}
              onChange={(e) => s.setThreshold(Number(e.target.value) || REG_DEFAULT_THRESHOLD)}
              className="w-full mt-2 h-1 accent-primary"
              aria-label={debtText("auto_regression_threshold_d8b35da0")}
            />
          </div>
          <div className="rounded-card border border-primary/12 bg-background/30 px-3 py-2.5">
            <p className="typo-label text-foreground">models</p>
            <p className="typo-data-lg text-foreground">{s.selectedModels.size}</p>
            <p className="typo-caption text-foreground">selected</p>
          </div>
        </div>

        {/* Centre: specimen comparison */}
        <div className="rounded-card border border-primary/12 bg-secondary/15 p-4 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="typo-heading text-foreground"><DebtText k="auto_specimen_comparison_607579f4" /></h3>
            {overallDelta != null && (
              <span className={`typo-data ${overallDelta >= 0 ? 'text-emerald-300' : 'text-red-300'}`}>
                Δ {overallDelta >= 0 ? '+' : ''}{overallDelta} pts
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3 flex-1">
            {/* Baseline specimen */}
            <div className="rounded-card border border-amber-500/25 bg-amber-500/[0.04] p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-3.5 h-3.5 text-amber-400" />
                <span className="typo-label text-amber-300">baseline</span>
              </div>
              <div className="typo-hero text-amber-300 leading-none">v{s.baselinePin.versionNumber}</div>
              <div className="typo-caption text-foreground mt-1">
                {s.baselineResults.length} <DebtText k="auto_eval_result_c54ed304" />{s.baselineResults.length !== 1 ? 's' : ''} <DebtText k="auto_on_file_8b983a13" />
              </div>
              <div className="mt-auto pt-2 typo-caption text-foreground">
                {s.baselinePin.runId
                  ? `run ${s.baselinePin.runId.slice(0, 8)}…`
                  : 'no eval run linked'}
              </div>
            </div>

            {/* Target specimen */}
            <div className="rounded-card border border-primary/20 bg-primary/[0.04] p-4 flex flex-col">
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="w-3.5 h-3.5 text-primary" />
                <span className="typo-label text-primary">candidate</span>
              </div>
              {s.selectedVersion ? (
                <>
                  <div className="typo-hero text-primary leading-none">v{s.selectedVersion.version_number}</div>
                  <div className="typo-caption text-foreground mt-1">
                    {s.selectedVersion.tag}
                    {s.currentResults.length > 0 ? ` · ${s.currentResults.length} runs` : ''}
                  </div>
                </>
              ) : (
                <div className="typo-body text-foreground"><DebtText k="auto_no_version_selected_4180bfe5" /></div>
              )}
              <div className="mt-auto pt-2 flex flex-wrap gap-1.5">
                {s.promptVersions
                  .filter((v) => v.id !== s.baselinePin?.versionId && v.tag !== 'archived')
                  .slice(0, 6)
                  .map((v) => (
                    <button
                      key={v.id}
                      onClick={() => s.setSelectedVersionId(v.id)}
                      className={`px-2 py-0.5 rounded-interactive typo-caption transition-colors border focus-ring ${
                        s.selectedVersionId === v.id
                          ? 'bg-primary/20 text-primary border-primary/40'
                          : 'bg-background/30 text-foreground border-primary/10 hover:border-primary/25'
                      }`}
                    >
                      v{v.version_number}
                    </button>
                  ))}
              </div>
            </div>
          </div>

          {/* Model row */}
          <div className="mt-3 pt-3 border-t border-primary/10">
            <ModelToggleGrid selectedModels={s.selectedModels} toggleModel={s.toggleModel} />
          </div>

          {/* Run button — centered */}
          <div className="mt-3 flex justify-center">
            <button
              onClick={s.handleRunRegression}
              disabled={s.running || s.isLabRunning || !s.selectedVersionId || s.selectedModels.size === 0}
              className="flex items-center gap-2 px-6 py-2.5 rounded-modal bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors disabled:opacity-40 focus-ring"
            >
              {s.running ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
              <span className="typo-body font-medium">
                {s.running ? t.agents.lab.running_regression : t.agents.lab.run_regression}
              </span>
            </button>
          </div>
        </div>

        {/* Right: warning lights */}
        <div className="rounded-card border border-primary/12 bg-secondary/15 p-3 space-y-2">
          <div className="flex items-center gap-2 mb-1">
            <ShieldCheck className="w-4 h-4 text-foreground" />
            <h3 className="typo-heading text-foreground"><DebtText k="auto_status_panel_139bdebc" /></h3>
          </div>
          {dimDeltas.length === 0 ? (
            <div className="rounded-card border border-primary/10 bg-background/20 px-3 py-6 text-center">
              <p className="typo-caption text-foreground">
                <DebtText k="auto_awaiting_telemetry_run_the_gate_to_populat_bae1f9a6" />
              </p>
            </div>
          ) : (
            dimDeltas.map((d) => (
              <WarningLight key={d.label} dim={d} threshold={s.threshold} />
            ))
          )}
          {s.baselineResults.length === 0 && s.baselinePin.runId && (
            <div className="flex items-start gap-2 px-3 py-2.5 rounded-card border border-amber-500/15 bg-amber-500/5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />
              <p className="typo-caption text-amber-300/80 leading-relaxed">
                <DebtText k="auto_no_baseline_eval_results_on_file_run_an_ev_bb014e23" />{s.baselinePin.versionNumber} <DebtText k="auto_first_49ec0838" />
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Detailed results below */}
      {s.currentResults.length > 0 && s.baselineResults.length > 0 && s.selectedVersion && (
        <RegressionResultsView
          baselineResults={s.baselineResults}
          currentResults={s.currentResults.filter((r) => r.versionId === s.selectedVersionId)}
          baselineVersionNum={s.baselinePin.versionNumber}
          currentVersionNum={s.selectedVersion.version_number}
          threshold={s.threshold}
        />
      )}
    </div>
  );
}
