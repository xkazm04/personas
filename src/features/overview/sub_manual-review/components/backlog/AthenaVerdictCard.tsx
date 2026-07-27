// "Send to Athena" — the batch-verdict review card.
//
// One headless Athena turn judges up to 30 selected backlog items and persists
// its accept/reject verdicts as a PENDING approval. This card is the human half
// of that: read the column, flip anything you disagree with, apply.
//
// The card owns exactly one thing the backend doesn't: the override map. Athena's
// verdicts arrive immutable (they live in the approval row); an override is a
// local intent that only exists until Apply sends it. That separation is what
// makes "close without applying" safe — the approval stays pending and can still
// be confirmed later from the Approvals list.
//
//   requesting → review → applying → done
//        ↓          ↓         ↓
//      error ←──────┴─────────┘
//
// `error` is terminal-but-retryable: the most common one is an expired batch
// (the consent-freshness window), which needs a re-run rather than a retry of
// the apply.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Bot, Check, RotateCcw, SkipForward, X } from 'lucide-react';

import { BaseModal } from '@/lib/ui/BaseModal';
import * as devApi from '@/api/devTools/devTools';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { DecisionRow } from '@/features/shared/components/decisions/DecisionRow';
import { silentCatch } from '@/lib/silentCatch';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';
import type { AthenaTriageBatch } from '@/lib/bindings/AthenaTriageBatch';
import type { BacklogVerdict } from '@/lib/bindings/BacklogVerdict';

import { useCategoryLabel } from './backlogLabels';
import type { BacklogIdea } from './backlogModel';

type Phase = 'requesting' | 'review' | 'applying' | 'error';
type EffectiveVerdict = 'accept' | 'reject' | 'skip';

const CHIP: Record<EffectiveVerdict, string> = {
  accept: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
  reject: 'bg-red-500/15 text-red-300 border-red-500/30',
  skip: 'bg-primary/10 text-muted-foreground border-primary/20',
};

export function AthenaVerdictCard({
  ideaIds,
  rowsById,
  onClose,
  onApplied,
}: {
  /** The selection the user sent. Snapshotted by the caller — this never re-runs. */
  ideaIds: string[];
  /** Loaded rows, for the facts rail. An id missing here still renders (Athena
   *  echoes the title into the verdict), just without effort/impact/risk. */
  rowsById: Map<string, BacklogIdea>;
  onClose: () => void;
  /** Fired after a successful apply, before the card closes — the caller reloads. */
  onApplied: () => void;
}) {
  const { t, tx } = useTranslation();
  const r = t.overview.review;
  const categoryLabel = useCategoryLabel();
  const addToast = useToastStore((s) => s.addToast);

  const [phase, setPhase] = useState<Phase>('requesting');
  const [batch, setBatch] = useState<AthenaTriageBatch | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, EffectiveVerdict>>({});

  // The triage costs a real LLM turn — StrictMode's double-mount would spend it
  // twice. One request per mounted card, enforced by a ref rather than a
  // dependency list.
  const requested = useRef(false);
  useEffect(() => {
    if (requested.current) return;
    requested.current = true;
    void (async () => {
      try {
        const result = await devApi.athenaTriageBatch(ideaIds);
        setBatch(result);
        setPhase('review');
      } catch (err) {
        silentCatch('AthenaVerdictCard:triage')(err);
        setError(err instanceof Error ? err.message : String(err));
        setPhase('error');
      }
    })();
  }, [ideaIds]);

  const effective = useCallback(
    (item: BacklogVerdict): EffectiveVerdict =>
      overrides[item.ideaId] ?? (item.verdict === 'accept' ? 'accept' : 'reject'),
    [overrides],
  );

  const setVerdict = useCallback((ideaId: string, verdict: EffectiveVerdict) => {
    setOverrides((prev) => ({ ...prev, [ideaId]: verdict }));
  }, []);

  const items = batch?.items ?? [];
  const accepts = items.filter((i) => effective(i) === 'accept').length;
  const rejects = items.filter((i) => effective(i) === 'reject').length;

  const apply = useCallback(async () => {
    if (!batch) return;
    setPhase('applying');
    try {
      const applied = await devApi.applyTriageVerdicts(
        batch.approvalId,
        batch.items.map((i) => ({ ideaId: i.ideaId, verdict: effective(i), reason: i.reason })),
      );
      addToast(
        tx(r.backlog_athena_applied, {
          accepted: applied.accepted,
          rejected: applied.rejected,
        }),
        'success',
      );
      onApplied();
      onClose();
    } catch (err) {
      silentCatch('AthenaVerdictCard:apply')(err);
      const msg = err instanceof Error ? err.message : String(err);
      // The lifecycle loader refuses a stale approval by design. That is not a
      // retryable failure — the ideas may have moved on, so the batch has to be
      // judged again.
      setExpired(/expired/i.test(msg));
      setError(msg);
      setPhase('error');
    }
  }, [batch, effective, addToast, tx, r.backlog_athena_applied, onApplied, onClose]);

  return (
    <BaseModal isOpen onClose={onClose} titleId="athena-verdict" size="xl" staggerChildren={false}>
      <div className="flex flex-col min-h-0 max-h-[80vh]">
        <header className="flex items-start gap-3 px-5 py-4 border-b border-primary/10">
          <span className="mt-0.5 shrink-0 rounded-full border border-primary/25 bg-primary/10 p-1.5">
            <Bot className="w-4 h-4 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="athena-verdict" className="typo-heading text-foreground">
              {r.backlog_athena_title}
            </h2>
            <p className="typo-caption text-muted-foreground mt-0.5">
              {phase === 'requesting'
                ? tx(r.backlog_athena_requesting, { count: ideaIds.length })
                : batch?.summary || tx(r.backlog_athena_requesting, { count: ideaIds.length })}
            </p>
          </div>
        </header>

        {/* Spinners are disabled app-wide (see LoadingSpinner) — the wait is a
            real LLM turn, so it gets calm staggered ghost rows shaped like the
            verdict list that's coming, not a frozen panel. */}
        {phase === 'requesting' && (
          <div className="px-5 py-6" aria-busy="true">
            <p role="status" className="typo-caption text-muted-foreground mb-3">
              {tx(r.backlog_athena_requesting, { count: ideaIds.length })}
            </p>
            <ul aria-hidden="true">
              {Array.from({ length: Math.min(ideaIds.length, 6) }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 py-3 border-b border-primary/[0.06] animate-fade-in"
                  style={{ animationDelay: `${120 + i * 45}ms` }}
                >
                  <span className="h-3 w-56 max-w-full rounded bg-primary/[0.06]" />
                  <span className="ml-auto h-3 w-16 rounded-full bg-primary/[0.06]" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {phase === 'error' && (
          <div className="px-5 py-10 text-center">
            <p className="typo-body text-foreground">
              {expired ? r.backlog_athena_expired : r.backlog_athena_failed}
            </p>
            {error && !expired && (
              <p className="typo-caption text-muted-foreground mt-2 break-words">{error}</p>
            )}
          </div>
        )}

        {(phase === 'review' || phase === 'applying') && (
          <>
            <ul className="flex-1 min-h-0 overflow-y-auto divide-y divide-primary/[0.06]">
              {items.map((item) => {
                const row = rowsById.get(item.ideaId);
                const verdict = effective(item);
                return (
                  <DecisionRow
                    key={item.ideaId}
                    record={{
                      id: item.ideaId,
                      title: row?.title || item.title,
                      summary: item.reason,
                      category: row ? categoryLabel(row.category) : null,
                      source: row?.projectName || null,
                      facts: row
                        ? [
                            { label: 'E', value: row.effort, title: r.backlog_effort_title },
                            { label: 'I', value: row.impact, title: r.backlog_impact_title },
                            { label: 'R', value: row.risk, title: r.backlog_risk_title },
                          ]
                        : undefined,
                    }}
                    meta={
                      <span
                        className={`typo-label rounded-full px-2 py-0.5 border ${CHIP[verdict]}`}
                      >
                        {verdict === 'accept'
                          ? r.backlog_athena_verdict_accept
                          : verdict === 'reject'
                            ? r.backlog_athena_verdict_reject
                            : r.backlog_athena_verdict_skip}
                      </span>
                    }
                    actions={[
                      {
                        id: 'override',
                        // ONE control, not two: the verdict is binary, so a
                        // toggle says "I disagree" in a single click. `skip` is
                        // the separate escape hatch for "don't decide this now".
                        label: r.backlog_athena_override,
                        title: r.backlog_athena_override,
                        tone: verdict === 'accept' ? 'reject' : 'accept',
                        icon:
                          verdict === 'accept' ? (
                            <X className="w-3.5 h-3.5" aria-hidden />
                          ) : (
                            <Check className="w-3.5 h-3.5" aria-hidden />
                          ),
                        disabled: phase === 'applying',
                        onClick: () =>
                          setVerdict(item.ideaId, verdict === 'accept' ? 'reject' : 'accept'),
                      },
                      {
                        id: 'skip',
                        label: r.backlog_athena_verdict_skip,
                        title: r.backlog_athena_skip_hint,
                        tone: 'neutral',
                        icon:
                          verdict === 'skip' ? (
                            <RotateCcw className="w-3.5 h-3.5" aria-hidden />
                          ) : (
                            <SkipForward className="w-3.5 h-3.5" aria-hidden />
                          ),
                        disabled: phase === 'applying',
                        onClick: () =>
                          setVerdict(
                            item.ideaId,
                            verdict === 'skip'
                              ? item.verdict === 'accept'
                                ? 'accept'
                                : 'reject'
                              : 'skip',
                          ),
                      },
                    ]}
                  />
                );
              })}
            </ul>

            {batch && batch.skipped.length > 0 && (
              <p className="px-5 py-2 typo-caption text-muted-foreground border-t border-primary/[0.06]">
                {tx(r.backlog_athena_not_judged, { count: batch.skipped.length })}
              </p>
            )}
          </>
        )}

        <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-primary/10">
          <button
            type="button"
            onClick={onClose}
            className="typo-label rounded-interactive border border-primary/15 px-3 py-1.5 text-muted-foreground hover:bg-primary/5 transition-colors"
          >
            {phase === 'error' ? t.common.close : t.common.cancel}
          </button>
          {(phase === 'review' || phase === 'applying') && (
            <AsyncButton
              variant="primary"
              size="sm"
              isLoading={phase === 'applying'}
              disabled={items.length === 0}
              onClick={apply}
            >
              {tx(r.backlog_athena_apply, { accepts, rejects })}
            </AsyncButton>
          )}
        </footer>
      </div>
    </BaseModal>
  );
}
