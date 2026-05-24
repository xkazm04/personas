/**
 * Variant — "Quality Gate"
 *
 * Metaphor: a sequenced 3-stage checkpoint flow. The verdict bar at top is
 * the gate itself (closed / verifying / cleared / held). Each stage is
 * numbered, tells the user what it owns, and visually declares completion as
 * soon as its inputs are valid. Results render in-place, replacing the run
 * button with a verdict band when the gate has been tested.
 *
 * Why different from baseline: baseline is a flat form (chip → version pills →
 * model grid → threshold → run → results). This variant treats regression as
 * a deliberate, sequenced QA step, surfacing the user's progress through it.
 */
import { useMemo, useState } from 'react';
import { AbsoluteTime } from '@/features/shared/components/display/AbsoluteTime';
import { Shield, Star, Play, ShieldCheck, ShieldAlert, AlertTriangle, Loader2, Lock, ChevronRight } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ModelToggleGrid } from '../../shared';
import { RegressionResultsView } from './RegressionResultsView';
import { useTranslation } from '@/i18n/useTranslation';
import { useRegressionPanelState, REG_DEFAULT_THRESHOLD } from './useRegressionPanelState';
import { compositeScore } from '@/lib/eval/evalFramework';
import { DebtText } from '@/i18n/DebtText';


type GateState = 'open' | 'verifying' | 'cleared' | 'held';

function StageHeader({ index, label, complete }: { index: number; label: string; complete: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-6 h-6 rounded-full flex items-center justify-center typo-caption font-bold ${
        complete ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-primary/10 text-foreground border border-primary/20'
      }`}>
        {complete ? '✓' : index}
      </span>
      <h3 className="typo-heading text-foreground">{label}</h3>
    </div>
  );
}

export function RegressionPanelGate() {
  const { t } = useTranslation();
  const s = useRegressionPanelState();
  const [hasRun, setHasRun] = useState(false);

  const gateState: GateState = useMemo(() => {
    if (s.running) return 'verifying';
    if (!hasRun) return 'open';
    if (s.currentResults.length === 0 || s.baselineResults.length === 0) return 'open';
    // Calculate verdict from results
    let failures = 0;
    for (const curr of s.currentResults) {
      if (curr.toolAccuracyScore == null || curr.outputQualityScore == null || curr.protocolCompliance == null) continue;
      const baseline = s.baselineResults.find((b) => b.scenarioName === curr.scenarioName && b.modelId === curr.modelId);
      if (!baseline || baseline.toolAccuracyScore == null || baseline.outputQualityScore == null || baseline.protocolCompliance == null) continue;
      const cComp = compositeScore(curr.toolAccuracyScore, curr.outputQualityScore, curr.protocolCompliance);
      const bComp = compositeScore(baseline.toolAccuracyScore, baseline.outputQualityScore, baseline.protocolCompliance);
      if (cComp - bComp < -s.threshold) failures += 1;
    }
    return failures > 0 ? 'held' : 'cleared';
  }, [s.running, s.currentResults, s.baselineResults, s.threshold, hasRun]);

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

  const stage1Done = !!s.selectedVersionId;
  const stage2Done = stage1Done && s.selectedModels.size > 0;
  const stage3Active = stage2Done && !s.running;

  // Verdict bar config
  const verdict = {
    open:      { icon: Lock,         label: 'Gate open',          sub: 'Run regression to verify the comparison version against baseline.', tone: 'text-foreground', bg: 'bg-primary/5',     border: 'border-primary/15' },
    verifying: { icon: Loader2,      label: 'Verifying…',         sub: 'Running scenarios against baseline.',                              tone: 'text-blue-300',     bg: 'bg-blue-500/10',   border: 'border-blue-500/30', spin: true },
    cleared:   { icon: ShieldCheck,  label: 'Gate cleared',       sub: 'No regressions detected above threshold.',                         tone: 'text-emerald-300',  bg: 'bg-emerald-500/10',border: 'border-emerald-500/30' },
    held:      { icon: ShieldAlert,  label: 'Gate held',          sub: 'Regressions detected. Review breakdown below.',                    tone: 'text-red-300',      bg: 'bg-red-500/10',    border: 'border-red-500/30' },
  }[gateState];
  const VIcon = verdict.icon;

  return (
    <div className="space-y-4" data-testid="regression-panel-gate">
      {/* Verdict bar */}
      <div className={`flex items-center gap-4 px-4 py-3 rounded-modal border ${verdict.bg} ${verdict.border}`}>
        <div className={`w-10 h-10 rounded-card border ${verdict.border} bg-background/40 flex items-center justify-center`}>
          <VIcon className={`w-5 h-5 ${verdict.tone} ${verdict.spin ? 'animate-spin' : ''}`} />
        </div>
        <div className="flex-1">
          <p className={`typo-heading ${verdict.tone}`}>{verdict.label}</p>
          <p className="typo-caption text-foreground">{verdict.sub}</p>
        </div>
        <span className="typo-label text-foreground">
          <DebtText k="auto_baseline_v_1daeceb5" />{s.baselinePin.versionNumber}
        </span>
      </div>

      {/* Stage 1 — Configure */}
      <div className="rounded-card border border-primary/12 bg-secondary/15 p-4 space-y-3">
        <StageHeader index={1} label="Configure — pick the comparison" complete={stage1Done} />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-stretch gap-3">
          <div className="rounded-card border border-amber-500/25 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
            <Star className="w-5 h-5 text-amber-400" />
            <div>
              <p className="typo-caption text-amber-300/80">Baseline</p>
              <p className="typo-heading text-amber-300">v{s.baselinePin.versionNumber}</p>
              <p className="typo-caption text-foreground">
                pinned {<AbsoluteTime timestamp={s.baselinePin.pinnedAt} variant="date" />}
              </p>
            </div>
          </div>
          <div className="flex items-center justify-center text-foreground">
            <ChevronRight className="w-5 h-5" />
          </div>
          <div className="rounded-card border border-primary/15 bg-primary/5 px-4 py-3">
            <p className="typo-caption text-foreground mb-2"><DebtText k="auto_comparison_version_6c07d6d8" /></p>
            <div className="flex flex-wrap gap-2">
              {s.promptVersions
                .filter((v) => v.id !== s.baselinePin?.versionId && v.tag !== 'archived')
                .map((v) => (
                  <button
                    key={v.id}
                    onClick={() => s.setSelectedVersionId(v.id)}
                    className={`px-2.5 py-1 rounded-card typo-caption transition-colors border focus-ring ${
                      s.selectedVersionId === v.id
                        ? 'bg-primary/20 text-primary border-primary/40'
                        : 'bg-background/30 text-foreground border-primary/10 hover:border-primary/25'
                    }`}
                  >
                    v{v.version_number}
                    {v.tag === 'production' && <span className="ml-1 text-emerald-400/70">prod</span>}
                  </button>
                ))}
            </div>
          </div>
        </div>
      </div>

      {/* Stage 2 — Calibrate */}
      <div className={`rounded-card border p-4 space-y-3 transition-opacity ${stage1Done ? 'border-primary/12 bg-secondary/15 opacity-100' : 'border-primary/8 bg-secondary/8 opacity-60'}`}>
        <StageHeader index={2} label="Calibrate — sensitivity + scope" complete={stage2Done} />
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-end">
          <div>
            <p className="typo-caption text-foreground mb-2">{t.agents.lab.models_to_test}</p>
            <ModelToggleGrid selectedModels={s.selectedModels} toggleModel={s.toggleModel} />
          </div>
          <div className="rounded-card bg-background/40 border border-primary/12 px-4 py-3">
            <p className="typo-caption text-foreground"><DebtText k="auto_regression_threshold_d8b35da0" /></p>
            <div className="flex items-baseline gap-2 mt-1">
              <input
                type="number"
                value={s.threshold}
                onChange={(e) => s.setThreshold(Math.max(1, Math.min(50, Number(e.target.value) || REG_DEFAULT_THRESHOLD)))}
                className="w-20 px-2 py-1 rounded-input bg-background/60 border border-primary/15 text-foreground typo-data-lg text-center focus-ring"
                min={1}
                max={50}
              />
              <span className="typo-caption text-foreground"><DebtText k="auto_pts_drop_3f43c7c7" /></span>
            </div>
            <p className="typo-caption text-foreground mt-1">{t.agents.lab.threshold_hint}</p>
          </div>
        </div>
      </div>

      {/* Stage 3 — Verify */}
      <div className={`rounded-card border p-4 space-y-3 ${stage3Active ? 'border-primary/15 bg-secondary/15' : 'border-primary/8 bg-secondary/8 opacity-60'}`}>
        <StageHeader index={3} label="Verify — run the gate" complete={hasRun && gateState !== 'verifying'} />
        {gateState === 'cleared' || gateState === 'held' ? null : (
          <button
            onClick={async () => { await s.handleRunRegression(); setHasRun(true); }}
            disabled={!stage3Active || s.running || s.isLabRunning}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 rounded-modal bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors disabled:opacity-40 focus-ring"
          >
            {s.running ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
            <span className="typo-body font-medium">
              {s.running ? t.agents.lab.running_regression : t.agents.lab.run_regression}
            </span>
          </button>
        )}

        {/* Inline results once we have them */}
        {s.currentResults.length > 0 && s.baselineResults.length > 0 && s.selectedVersion && (
          <RegressionResultsView
            baselineResults={s.baselineResults}
            currentResults={s.currentResults.filter((r) => r.versionId === s.selectedVersionId)}
            baselineVersionNum={s.baselinePin.versionNumber}
            currentVersionNum={s.selectedVersion.version_number}
            threshold={s.threshold}
          />
        )}

        {s.baselineResults.length === 0 && s.baselinePin.runId && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-card border border-amber-500/15 bg-amber-500/5">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            <p className="typo-caption text-amber-400/80">
              <DebtText k="auto_no_eval_results_for_baseline_run_run_an_ev_301f1ff0" />{s.baselinePin.versionNumber} <DebtText k="auto_first_then_pin_it_as_baseline_56c274cb" />
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

