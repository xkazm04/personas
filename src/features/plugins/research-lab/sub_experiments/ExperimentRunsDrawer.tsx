import { useEffect, useState } from 'react';
import { X, CheckCircle2, XCircle, Clock, Coins } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch } from '@/lib/silentCatch';
import { listExperimentRuns, type ResearchExperimentRun } from '@/api/researchLab/researchLab';
import type { ResearchExperiment } from '@/api/researchLab/researchLab';

interface Props {
  experiment: ResearchExperiment;
  onClose: () => void;
  /** Incremented by the parent after a run completes to trigger a refetch. */
  refreshToken?: number;
}

export default function ExperimentRunsDrawer({ experiment, onClose, refreshToken }: Props) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<ResearchExperimentRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listExperimentRuns(experiment.id)
      .then((rows) => {
        if (!cancelled) setRuns(rows);
      })
      .catch((err) => {
        if (!cancelled) toastCatch("ExperimentRunsDrawer:list")(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [experiment.id, refreshToken]);

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-md" onClick={onClose} />
      <aside className="w-full max-w-xl bg-background border-l border-border/40 shadow-elevation-4 flex flex-col animate-fade-slide-in">
        <header className="flex items-center justify-between px-6 py-4 border-b border-border/20">
          <div className="min-w-0">
            <h2 className="typo-section-title truncate">{t.research_lab.runs_history}</h2>
            <p className="typo-caption text-foreground truncate">{experiment.name}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded hover:bg-secondary/50 text-foreground" aria-label={t.common.cancel}>
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <p className="typo-body text-foreground">{t.common.loading}</p>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex items-center justify-center py-10">
              <p className="typo-body text-foreground">{t.research_lab.no_runs_yet}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {runs.map((r) => (
                <RunCard key={r.id} run={r} />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function RunCard({ run }: { run: ResearchExperimentRun }) {
  const { t } = useTranslation();
  const passed = run.passed === 1;
  const durationMs = run.durationMs ?? 0;
  const durationLabel = durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
  const costLabel = run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : '—';

  return (
    <div className="rounded-card bg-secondary/50 border border-border/30 p-4">
      <div className="flex items-center gap-2 mb-2">
        {passed
          ? <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          : <XCircle className="w-4 h-4 text-red-400" />}
        <span className="typo-card-label">{t.research_lab.run_number}{run.runNumber}</span>
        <span className={`ml-auto px-2 py-0.5 rounded-full text-[10px] ${passed ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'}`}>
          {passed ? t.research_lab.run_passed : t.research_lab.run_failed}
        </span>
      </div>
      <div className="flex items-center gap-4 typo-caption text-foreground">
        <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> {durationLabel}</span>
        <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> {costLabel}</span>
        <span className="ml-auto">{new Date(run.createdAt).toLocaleString()}</span>
      </div>
      {run.outputs && (
        <details className="mt-3">
          <summary className="typo-caption text-foreground cursor-pointer hover:text-foreground">Output</summary>
          <pre className="typo-code text-foreground mt-2 whitespace-pre-wrap break-words bg-background/60 rounded-card p-3 border border-border/20 max-h-64 overflow-y-auto">
            {run.outputs}
          </pre>
        </details>
      )}
    </div>
  );
}
