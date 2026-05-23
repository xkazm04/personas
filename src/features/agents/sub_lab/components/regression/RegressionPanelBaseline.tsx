import { Shield, Star, Play, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import EmptyState from '@/features/shared/components/feedback/EmptyState';
import { ModelToggleGrid } from '../../shared';
import { RegressionResultsView } from './RegressionResultsView';
import { Slider } from '@/features/shared/components/forms/Slider';
import { useTranslation } from '@/i18n/useTranslation';
import { useRegressionPanelState, REG_DEFAULT_THRESHOLD } from './useRegressionPanelState';
import { DebtText } from '@/i18n/DebtText';


export function RegressionPanelBaseline() {
  const { t } = useTranslation();
  const s = useRegressionPanelState();

  if (!s.baselinePin) {
    return (
      <div className="py-12">
        <EmptyState
          icon={Star}
          title={t.agents.lab.no_baseline_title}
          subtitle={t.agents.lab.no_baseline_subtitle}
          iconColor="text-amber-400/80"
          iconContainerClassName="bg-amber-500/10 border-amber-500/20"
          action={{
            label: t.agents.lab.go_to_versions,
            onClick: () => s.setLabMode('versions'),
            icon: Shield,
          }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-5" data-testid="regression-panel">
      <div className="flex items-center gap-3 px-4 py-3 rounded-modal border border-amber-500/20 bg-amber-500/5">
        <Star className="w-5 h-5 text-amber-400 flex-shrink-0" />
        <div className="flex-1">
          <p className="typo-heading text-amber-400"><DebtText k="auto_baseline_v_5c0d5af6" />{s.baselinePin.versionNumber}</p>
          <p className="typo-caption text-foreground">
            Pinned {new Date(s.baselinePin.pinnedAt).toLocaleDateString()}
            {s.baselinePin.runId ? ` · Eval run: ${s.baselinePin.runId.slice(0, 8)}...` : ' · No eval run linked'}
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <p className="typo-caption text-foreground">{t.agents.lab.compare_against}</p>
        <div className="flex flex-wrap gap-2">
          {s.promptVersions
            .filter((v) => v.id !== s.baselinePin?.versionId && v.tag !== 'archived')
            .map((v) => (
              <button
                key={v.id}
                onClick={() => s.setSelectedVersionId(v.id)}
                className={`px-3 py-1.5 rounded-card typo-caption transition-colors border focus-ring ${
                  s.selectedVersionId === v.id
                    ? 'bg-primary/15 text-primary border-primary/30'
                    : 'bg-secondary/20 text-foreground border-primary/10 hover:border-primary/20'
                }`}
              >
                v{v.version_number}
                {v.tag === 'production' && <span className="ml-1 text-emerald-400/70">prod</span>}
              </button>
            ))}
        </div>
      </div>

      <div className="space-y-2">
        <p className="typo-caption text-foreground">{t.agents.lab.models_to_test}</p>
        <ModelToggleGrid selectedModels={s.selectedModels} toggleModel={s.toggleModel} />
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <p className="typo-caption text-foreground whitespace-nowrap">{t.agents.lab.regression_threshold}</p>
        <div className="flex items-center gap-2">
          <Slider
            value={s.threshold}
            onChange={(v) => s.setThreshold(Math.max(1, Math.min(50, v || REG_DEFAULT_THRESHOLD)))}
            min={1}
            max={50}
            step={1}
            ariaLabel={t.agents.lab.regression_threshold}
            className="w-40"
          />
          <span className="typo-caption text-foreground tabular-nums w-6 text-right">{s.threshold}</span>
        </div>
        <p className="typo-caption text-foreground">{t.agents.lab.threshold_hint}</p>
      </div>

      <button
        onClick={s.handleRunRegression}
        disabled={s.running || s.isLabRunning || !s.selectedVersionId || s.selectedModels.size === 0}
        className="flex items-center gap-2 px-5 py-2.5 rounded-modal bg-primary/15 text-primary border border-primary/25 hover:bg-primary/25 transition-colors disabled:opacity-40 focus-ring"
      >
        {s.running ? <LoadingSpinner size="sm" /> : <Play className="w-4 h-4" />}
        {s.running ? t.agents.lab.running_regression : t.agents.lab.run_regression}
      </button>

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
        <div className="flex items-center gap-3 px-4 py-3 rounded-modal border border-amber-500/15 bg-amber-500/5">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <p className="typo-caption text-amber-400/80">
            <DebtText k="auto_no_eval_results_for_baseline_run_run_an_ev_301f1ff0" />{s.baselinePin.versionNumber} <DebtText k="auto_first_then_pin_it_as_baseline_56c274cb" />
          </p>
        </div>
      )}
    </div>
  );
}
