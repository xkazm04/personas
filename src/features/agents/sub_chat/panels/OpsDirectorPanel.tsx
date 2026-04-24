import { useCallback, useEffect, useState } from 'react';
import { Compass, Loader2, AlertTriangle, XCircle, Info, Sparkles, CheckCircle2, X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { toastCatch, silentCatchNull } from '@/lib/silentCatch';
import {
  listDirectorVerdicts,
  runDirectorOnPersona,
  type DirectorVerdictRow,
} from '@/api/director';
import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

// Panel that shows the Director's coaching verdicts for one persona and lets
// the user trigger a fresh evaluation. Each verdict renders as a card with
// approve / dismiss actions that update the underlying manual review.
export default function OpsDirectorPanel({ personaId }: { personaId: string }) {
  const { t } = useTranslation();
  const [verdicts, setVerdicts] = useState<DirectorVerdictRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRunCount, setLastRunCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listDirectorVerdicts(personaId);
      setVerdicts(rows);
    } finally {
      setLoading(false);
    }
  }, [personaId]);

  useEffect(() => {
    refresh().catch(silentCatchNull('OpsDirectorPanel:initial'));
  }, [refresh]);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setLastRunCount(null);
    try {
      const emitted = await runDirectorOnPersona(personaId);
      setLastRunCount(emitted);
      await refresh();
    } catch (e) {
      toastCatch('OpsDirectorPanel:run')(e);
    } finally {
      setRunning(false);
    }
  }, [personaId, refresh]);

  const handleResolve = useCallback(
    async (reviewId: string, outcome: 'accepted' | 'rejected') => {
      try {
        await invoke('update_manual_review_status', {
          id: reviewId,
          status: outcome === 'accepted' ? 'resolved' : 'dismissed',
        });
        await refresh();
      } catch (e) {
        toastCatch('OpsDirectorPanel:resolve')(e);
      }
    },
    [refresh],
  );

  const pending = verdicts.filter((v) => v.status === 'pending');
  const resolved = verdicts.filter((v) => v.status !== 'pending');

  return (
    <div className="flex flex-col h-full p-4 gap-4">
      <header className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <Compass className="w-5 h-5 text-violet-400 flex-shrink-0 mt-0.5" />
          <div>
            <h2 className="typo-heading font-semibold text-foreground">
              {t.agents.ops.director_title}
            </h2>
            <p className="typo-caption text-foreground">
              {t.agents.ops.director_subtitle}
            </p>
          </div>
        </div>
        <button
          onClick={handleRun}
          disabled={running}
          data-testid="director-run-button"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-caption font-medium bg-violet-500/15 text-violet-400 border border-violet-500/30 hover:bg-violet-500/25 transition-colors disabled:opacity-50 cursor-pointer"
        >
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
          <span>{running ? t.agents.ops.director_running : t.agents.ops.director_run}</span>
        </button>
      </header>

      {lastRunCount !== null && (
        <div className="rounded-card border border-primary/15 bg-secondary/20 px-3 py-2 typo-caption text-foreground">
          {lastRunCount === 0
            ? t.agents.ops.director_last_run_empty
            : lastRunCount === 1
              ? t.agents.ops.director_last_run_one
              : t.agents.ops.director_last_run_many.replace('{count}', String(lastRunCount))}
        </div>
      )}

      {loading && verdicts.length === 0 ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-foreground" />
        </div>
      ) : (
        <>
          {pending.length === 0 && resolved.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <Compass className="w-10 h-10 text-foreground/30" />
              <p className="typo-body text-foreground">{t.agents.ops.director_empty_title}</p>
              <p className="typo-caption text-foreground">{t.agents.ops.director_empty_hint}</p>
            </div>
          )}

          {pending.length > 0 && (
            <section className="flex flex-col gap-3">
              <h3 className="typo-label font-semibold text-foreground uppercase tracking-wider">
                {t.agents.ops.director_pending}
              </h3>
              {pending.map((v) => (
                <VerdictCard key={v.reviewId} verdict={v} onResolve={handleResolve} />
              ))}
            </section>
          )}

          {resolved.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="typo-label font-semibold text-foreground uppercase tracking-wider">
                {t.agents.ops.director_resolved}
              </h3>
              {resolved.map((v) => (
                <ResolvedVerdictRow key={v.reviewId} verdict={v} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}

function severityIcon(severity: string) {
  switch (severity) {
    case 'error':
      return <XCircle className="w-4 h-4 text-red-400" />;
    case 'warning':
      return <AlertTriangle className="w-4 h-4 text-amber-400" />;
    default:
      return <Info className="w-4 h-4 text-sky-400" />;
  }
}

function severityBorder(severity: string): string {
  switch (severity) {
    case 'error':
      return 'border-red-500/30';
    case 'warning':
      return 'border-amber-500/30';
    default:
      return 'border-sky-500/25';
  }
}

function VerdictCard({
  verdict,
  onResolve,
}: {
  verdict: DirectorVerdictRow;
  onResolve: (id: string, outcome: 'accepted' | 'rejected') => void;
}) {
  const { t } = useTranslation();
  return (
    <article
      className={`rounded-card border ${severityBorder(verdict.severity)} bg-secondary/10 p-3 flex flex-col gap-2`}
      data-testid={`director-verdict-${verdict.reviewId}`}
    >
      <header className="flex items-start gap-2">
        <span className="flex-shrink-0 mt-0.5">{severityIcon(verdict.severity)}</span>
        <div className="flex-1 min-w-0">
          <p className="typo-body font-semibold text-foreground">{verdict.title}</p>
          <p className="typo-caption text-foreground uppercase tracking-wide">
            {verdict.category}
          </p>
        </div>
      </header>
      {verdict.description && (
        <p className="typo-body text-foreground leading-snug">{verdict.description}</p>
      )}
      {verdict.suggestedActions.length > 0 && (
        <ul className="list-disc pl-5 typo-caption text-foreground space-y-0.5">
          {verdict.suggestedActions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      )}
      {verdict.rationale && (
        <p className="typo-caption text-foreground italic">
          {t.agents.ops.director_rationale}: {verdict.rationale}
        </p>
      )}
      <div className="flex items-center gap-1.5 pt-1 border-t border-primary/10">
        <button
          onClick={() => onResolve(verdict.reviewId, 'accepted')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-card typo-caption font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 hover:bg-emerald-500/25 transition-colors cursor-pointer"
        >
          <CheckCircle2 className="w-3 h-3" />
          {t.agents.ops.director_accept}
        </button>
        <button
          onClick={() => onResolve(verdict.reviewId, 'rejected')}
          className="flex items-center gap-1 px-2.5 py-1 rounded-card typo-caption font-medium text-foreground hover:bg-secondary/40 transition-colors cursor-pointer"
        >
          <X className="w-3 h-3" />
          {t.agents.ops.director_dismiss}
        </button>
      </div>
    </article>
  );
}

function ResolvedVerdictRow({ verdict }: { verdict: DirectorVerdictRow }) {
  return (
    <div className="flex items-center gap-2 rounded-card bg-secondary/5 border border-primary/5 px-3 py-1.5">
      <span>{severityIcon(verdict.severity)}</span>
      <span className="typo-caption text-foreground flex-1 truncate">{verdict.title}</span>
      <span className="typo-caption text-foreground uppercase tracking-wide">{verdict.status}</span>
    </div>
  );
}
