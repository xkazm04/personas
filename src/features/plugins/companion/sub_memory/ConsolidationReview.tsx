import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Edit3,
  Loader2,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { silentCatch } from '@/lib/silentCatch';
import {
  companionApplyConsolidationItem,
  companionGetConsolidationItems,
  companionListConsolidationRuns,
  companionRejectConsolidationItem,
  companionRunConsolidation,
  type ConsolidationItem,
  type ConsolidationRun,
} from '@/api/companion';

/**
 * Diff-review surface for memory consolidation. Two modes:
 *   - **Runs index** — list of past consolidation passes (status,
 *     counts). Click one to drill in.
 *   - **Review** — for one run, show every proposal with Approve /
 *     Edit / Reject controls. Inline edits are applied as overrides
 *     during apply.
 *
 * Designed for the plugin sub-page (Memory tab). The chat panel can
 * deep-link here later, but for v1 the user runs consolidations from
 * the dedicated page where there's room to think.
 */
export function ConsolidationReview({
  onClose,
}: {
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const [runs, setRuns] = useState<ConsolidationRun[] | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRuns = useCallback(() => {
    setRuns(null);
    companionListConsolidationRuns(20)
      .then(setRuns)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setRuns([]);
        silentCatch('companion_list_consolidation_runs')(err);
      });
  }, []);

  useEffect(() => {
    loadRuns();
  }, [loadRuns]);

  const startRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const id = await companionRunConsolidation();
      setActiveRunId(id);
      loadRuns();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      silentCatch('companion_run_consolidation')(err);
    } finally {
      setRunning(false);
    }
  }, [loadRuns]);

  if (activeRunId) {
    return (
      <RunDetail
        runId={activeRunId}
        onBack={() => {
          setActiveRunId(null);
          loadRuns();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 px-5 py-3 border-b border-foreground/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/5 focus-ring"
              aria-label={t.common.close}
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
          )}
          <span className="typo-body font-medium">
            {t.plugins.companion.consolidation_runs_title}
          </span>
        </div>
        <button
          onClick={startRun}
          disabled={running}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 focus-ring"
        >
          {running ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {t.plugins.companion.memory_run_consolidation}
        </button>
      </header>

      {running && (
        <div className="flex items-start gap-3 m-5 p-4 rounded-card border border-primary/30 bg-primary/5">
          <LoadingSpinner size="sm" />
          <div className="flex-1 min-w-0">
            <div className="typo-body font-medium">
              {t.plugins.companion.consolidation_running}
            </div>
            <div className="typo-caption text-foreground/70 mt-1">
              {t.plugins.companion.consolidation_running_long}
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="m-5 rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {runs === null ? (
          <div className="flex items-center gap-3 p-5 typo-body text-foreground/70">
            <LoadingSpinner size="sm" />
            <span>{t.plugins.companion.brain_loading}</span>
          </div>
        ) : runs.length === 0 ? (
          <p className="p-5 typo-body text-foreground/50">
            {t.plugins.companion.brain_empty}
          </p>
        ) : (
          <ul className="divide-y divide-foreground/5">
            {runs.map((run) => (
              <li key={run.id}>
                <button
                  onClick={() => setActiveRunId(run.id)}
                  className="w-full text-left px-5 py-3 hover:bg-foreground/[0.04] focus-ring"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="typo-caption font-medium text-foreground/80">
                      {run.summary
                        ? run.summary
                        : `${run.episodesCount} episodes reviewed`}
                    </span>
                    <RunStatusBadge run={run} />
                  </div>
                  <div className="typo-caption text-foreground/50">
                    {run.itemsTotal} proposals · {run.itemsPending} pending ·{' '}
                    {run.itemsApplied} applied · {run.itemsRejected} rejected ·{' '}
                    {formatRelativeTime(run.triggeredAt)}
                  </div>
                  {run.errorText && (
                    <div className="typo-caption text-rose-400 mt-1 truncate">
                      {run.errorText}
                    </div>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RunStatusBadge({ run }: { run: ConsolidationRun }) {
  const { t } = useTranslation();
  const cfg = useMemo(() => {
    switch (run.status) {
      case 'review':
        return {
          label: t.plugins.companion.consolidation_run_status_review,
          tone: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
        };
      case 'applied':
        return {
          label: t.plugins.companion.consolidation_run_status_applied,
          tone: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
        };
      case 'failed':
        return {
          label: t.plugins.companion.consolidation_run_status_failed,
          tone: 'bg-rose-500/15 text-rose-400 border-rose-500/30',
        };
      default:
        return {
          label: t.plugins.companion.consolidation_run_status_running,
          tone: 'bg-primary/15 text-primary border-primary/30',
        };
    }
  }, [run.status, t]);
  return (
    <span
      className={`inline-flex shrink-0 items-center px-2 py-0.5 rounded typo-caption font-medium border ${cfg.tone}`}
    >
      {cfg.label}
    </span>
  );
}

function RunDetail({
  runId,
  onBack,
}: {
  runId: string;
  onBack: () => void;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<ConsolidationItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setError(null);
    companionGetConsolidationItems(runId)
      .then(setItems)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
        setItems([]);
        silentCatch('companion_get_consolidation_items')(err);
      });
  }, [runId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col h-full">
      <header className="flex items-center justify-between gap-2 px-5 py-3 border-b border-foreground/10 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onBack}
            className="p-1 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/5 focus-ring"
            aria-label={t.plugins.companion.consolidation_back_to_runs}
            title={t.plugins.companion.consolidation_back_to_runs}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="typo-body font-medium">
            {t.plugins.companion.consolidation_review_title}
          </span>
        </div>
        <button
          onClick={refresh}
          className="p-1.5 rounded-interactive text-foreground/60 hover:text-foreground hover:bg-foreground/5 focus-ring"
          aria-label="Refresh"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <p className="px-5 pt-3 typo-caption text-foreground/60">
        {t.plugins.companion.consolidation_review_subtitle}
      </p>

      {error && (
        <div className="m-5 rounded-card border border-rose-500/30 bg-rose-500/10 px-3 py-2 typo-caption text-rose-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
        {items === null ? (
          <div className="flex items-center gap-3 p-2 typo-body text-foreground/70">
            <LoadingSpinner size="sm" />
            <span>{t.plugins.companion.brain_loading}</span>
          </div>
        ) : items.length === 0 ? (
          <p className="p-2 typo-body text-foreground/50">
            {t.plugins.companion.consolidation_no_proposals}
          </p>
        ) : (
          items.map((item) => (
            <ItemCard key={item.id} item={item} onResolved={refresh} />
          ))
        )}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  onResolved,
}: {
  item: ConsolidationItem;
  onResolved: () => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draftValue, setDraftValue] = useState(item.proposedValue);
  const [draftKey, setDraftKey] = useState(item.factKey);
  const [draftImportance, setDraftImportance] = useState(item.importance);
  const [busy, setBusy] = useState<'apply' | 'reject' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isResolved = item.status !== 'pending';

  const apply = useCallback(async () => {
    setBusy('apply');
    setError(null);
    try {
      const edits = editing
        ? {
            value: draftValue !== item.proposedValue ? draftValue : undefined,
            key: draftKey !== item.factKey ? draftKey : undefined,
            importance:
              draftImportance !== item.importance ? draftImportance : undefined,
          }
        : undefined;
      await companionApplyConsolidationItem(item.id, edits);
      onResolved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      silentCatch('companion_apply_consolidation_item')(err);
    } finally {
      setBusy(null);
    }
  }, [
    editing,
    draftValue,
    draftKey,
    draftImportance,
    item.id,
    item.proposedValue,
    item.factKey,
    item.importance,
    onResolved,
  ]);

  const reject = useCallback(async () => {
    setBusy('reject');
    setError(null);
    try {
      await companionRejectConsolidationItem(item.id);
      onResolved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      silentCatch('companion_reject_consolidation_item')(err);
    } finally {
      setBusy(null);
    }
  }, [item.id, onResolved]);

  const kindLabel =
    item.kind === 'add'
      ? t.plugins.companion.consolidation_kind_add
      : item.kind === 'update'
        ? t.plugins.companion.consolidation_kind_update
        : t.plugins.companion.consolidation_kind_contradict;
  const kindTone =
    item.kind === 'add'
      ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      : item.kind === 'update'
        ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
        : 'bg-rose-500/15 text-rose-400 border-rose-500/30';

  return (
    <div
      className={`rounded-card border p-3.5 space-y-2 ${
        isResolved
          ? 'border-foreground/5 bg-foreground/[0.02] opacity-70'
          : 'border-foreground/10 bg-foreground/[0.03]'
      }`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`inline-flex items-center px-2 py-0.5 rounded typo-caption font-medium border ${kindTone}`}
        >
          {kindLabel}
        </span>
        <code className="typo-caption text-foreground/70 px-1.5 py-0.5 rounded bg-foreground/5">
          {item.scope}/{item.factKey}
        </code>
        <span className="typo-caption text-foreground/50">
          imp {item.importance} · conf {Math.round(item.confidence * 100)}% ·{' '}
          {item.sources.length} source{item.sources.length === 1 ? '' : 's'}
        </span>
        {isResolved && (
          <span className="ml-auto typo-caption text-foreground/50">
            {item.status === 'applied'
              ? t.plugins.companion.consolidation_applied
              : t.plugins.companion.consolidation_rejected}
          </span>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <label className="block">
            <span className="typo-caption text-foreground/60">key</span>
            <input
              type="text"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              className="mt-0.5 w-full bg-foreground/5 rounded px-2 py-1 typo-caption focus-ring"
            />
          </label>
          <label className="block">
            <span className="typo-caption text-foreground/60">value</span>
            <textarea
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              rows={4}
              className="mt-0.5 w-full bg-foreground/5 rounded px-2 py-1 typo-body focus-ring resize-y"
            />
          </label>
          <label className="block">
            <span className="typo-caption text-foreground/60">
              importance (1-5)
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={draftImportance}
              onChange={(e) =>
                setDraftImportance(Math.max(1, Math.min(5, Number(e.target.value))))
              }
              className="mt-0.5 w-20 bg-foreground/5 rounded px-2 py-1 typo-caption focus-ring"
            />
          </label>
        </div>
      ) : (
        <p className="typo-body text-foreground/85 whitespace-pre-wrap leading-relaxed">
          {item.proposedValue}
        </p>
      )}

      {item.rationale && (
        <details className="text-foreground/70">
          <summary className="cursor-pointer typo-caption hover:text-foreground">
            {t.plugins.companion.consolidation_rationale}
          </summary>
          <p className="mt-1 typo-caption text-foreground/65 leading-relaxed">
            {item.rationale}
          </p>
        </details>
      )}

      {item.supersedesId && (
        <div className="typo-caption text-foreground/60">
          {t.plugins.companion.consolidation_supersedes}:{' '}
          <code className="px-1 py-0.5 rounded bg-foreground/5">
            {item.supersedesId}
          </code>
        </div>
      )}

      {item.sources.length > 0 && (
        <div className="typo-caption text-foreground/60">
          {t.plugins.companion.facts_sources_label}:{' '}
          {item.sources.map((s, i) => (
            <code key={s} className="ml-1 px-1 py-0.5 rounded bg-foreground/5">
              {s}
              {i < item.sources.length - 1 ? '' : ''}
            </code>
          ))}
        </div>
      )}

      {error && (
        <div className="rounded-card border border-rose-500/30 bg-rose-500/10 px-2 py-1 typo-caption text-rose-400">
          {error}
        </div>
      )}

      {!isResolved && (
        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={apply}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-primary text-primary-foreground typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 focus-ring"
          >
            {busy === 'apply' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Check className="w-3.5 h-3.5" />
            )}
            {editing
              ? t.plugins.companion.consolidation_apply_edits
              : t.plugins.companion.consolidation_apply}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 hover:bg-foreground/10 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
          >
            <Edit3 className="w-3.5 h-3.5" />
            {t.plugins.companion.consolidation_edit}
          </button>
          <button
            onClick={reject}
            disabled={busy !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-interactive bg-foreground/5 text-foreground/80 hover:bg-foreground/10 typo-caption font-medium disabled:opacity-50 disabled:cursor-not-allowed focus-ring"
          >
            {busy === 'reject' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <X className="w-3.5 h-3.5" />
            )}
            {t.plugins.companion.consolidation_reject}
          </button>
        </div>
      )}
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const diffSec = (Date.now() - t) / 1000;
  if (diffSec < 60) return 'just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 7 * 86400) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(t).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}
