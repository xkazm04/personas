import { useEffect, useRef, useState } from 'react';
import { Infinity as InfinityIcon, Terminal } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { silentCatch } from '@/lib/silentCatch';
import { companionDispatchFleetPlan, type FleetPlanRow } from '@/api/companion';
import { useSystemStore } from '@/stores/systemStore';
import { useCompanionStore } from '../companionStore';
import { AthenaFleetPlanRow } from './AthenaFleetPlanRow';
import { AthenaFleetPlanResult } from './AthenaFleetPlanResult';
import { resolveChatCard } from '../useChatCards';

/** Parse the `fleet_plan` chat-card config the dispatcher validated. */
export function parsePlanRows(raw: unknown): FleetPlanRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      cwd: typeof r.cwd === 'string' ? r.cwd : '',
      objective: typeof r.objective === 'string' ? r.objective : '',
      skill: typeof r.skill === 'string' ? r.skill : null,
      // Presentation/routing fields the dispatcher validated. Carried through
      // the card untouched so Confirm dispatches what was proposed.
      label: typeof r.label === 'string' ? r.label : null,
      model: typeof r.model === 'string' ? r.model : null,
      effort: typeof r.effort === 'string' ? r.effort : null,
    }))
    .filter((r) => r.cwd.length > 0);
}

/**
 * The editable multi-session fleet plan, in CHAT (the full-information
 * dimension — the orb carries quick decisions, never this).
 *
 * Athena drafts it with `show_fleet_plan`; every row is editable and
 * removable here, and nothing spawns until Confirm. That makes this card the
 * correction path for conversational dispatch, including spoken requests,
 * which reach the same send path as typed ones.
 */
export function AthenaFleetPlanCard({
  config,
  title,
  cardId,
}: {
  config?: Record<string, unknown>;
  title?: string;
  /** Durable `companion_chat_card` row id. It is what makes this proposal
   *  survive a refresh, what the dispatch path CLAIMS so a double-confirm
   *  cannot spawn two fleets, and the key the post-confirm outcome is written
   *  back under. Index keying was the old shape and it mis-targeted the
   *  moment hydration could reorder the array. */
  cardId?: string;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const intent = typeof config?.operation_intent === 'string' ? config.operation_intent : '';
  const [rows, setRows] = useState<FleetPlanRow[]>(() => parsePlanRows(config?.rows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Restore a prior dispatch outcome from the persisted card config, so a
  // panel close/reopen (which remounts this component) reflects "already
  // dispatched" instead of reverting to the pre-confirm editable plan.
  const [result, setResult] = useState<string | null>(() =>
    typeof config?.resultMessage === 'string' ? config.resultMessage : null,
  );
  const [dismissed, setDismissed] = useState(false);
  const [dispatchedRows, setDispatchedRows] = useState<FleetPlanRow[]>(() =>
    config?.dispatched === true ? parsePlanRows(config.dispatchedRows) : [],
  );

  const fleetRefresh = useSystemStore((s) => s.fleetRefresh);
  const autonomousMode = useSystemStore((s) => s.companionAutonomousMode);

  // Whenever this card is showing a dispatched outcome (freshly confirmed, or
  // restored from the persisted config after a close/reopen), pull a fresh
  // Fleet snapshot so AthenaFleetPlanResult's "still running" count is live
  // rather than whatever the store happened to hold last (possibly empty, if
  // the Fleet grid was never opened this app session).
  useEffect(() => {
    if (dispatchedRows.length > 0) {
      fleetRefresh().catch(silentCatch('athena_fleet_plan_card_refresh'));
    }
  }, [dispatchedRows, fleetRefresh]);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const confirmedRows = rows.map((r) => ({
        cwd: r.cwd,
        objective: r.objective.trim(),
        skill: r.skill?.trim() ? r.skill.trim() : null,
        label: r.label?.trim() ? r.label.trim() : null,
        model: r.model?.trim() ? r.model.trim() : null,
        effort: r.effort?.trim() ? r.effort.trim() : null,
      }));
      const message = await companionDispatchFleetPlan(intent, confirmedRows, cardId);
      setResult(message);
      setDispatchedRows(confirmedRows);
      // The backend already flipped the durable row to `dispatched` and stored
      // the outcome as part of the claim; this write-through only keeps the
      // in-memory card in step so a close/reopen renders the result without a
      // refetch.
      resolveChatCard(cardId, 'dispatched', {
        dispatched: true,
        resultMessage: message,
        dispatchedRows: confirmedRows,
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  // AUTONOMOUS MODE: the plan is Athena's own decision surface, and with
  // autonomy ON the operator has already delegated it - the card auto-approves
  // instead of waiting for a click. One-shot (ref-guarded), only for a still-
  // pending card with valid rows; the backend claim keeps a double-fire from
  // spawning two fleets, and the dispatch lands in the autonomous-actions
  // ledger so the delegation stays auditable in chat.
  const autoFired = useRef(false);
  useEffect(() => {
    if (!autonomousMode || autoFired.current) return;
    if (result !== null || dismissed || busy) return;
    if (rows.length === 0 || rows.some((r) => !r.objective.trim())) return;
    autoFired.current = true;
    void confirm().then(() => {
      useCompanionStore.getState().recordAthenaAction({
        id: `autoplan_${Date.now()}`,
        sessionId: cardId ?? 'fleet-plan',
        projectLabel: intent,
        text: rows
          .map((r) => `${r.skill ? `/${r.skill} ` : ''}${r.objective}`.trim())
          .join(' · '),
        createdAt: Date.now(),
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot on mount-with-autonomy; rows/confirm identities churn per keystroke
  }, [autonomousMode, result, dismissed, busy, rows.length]);

  if (dismissed) return null;

  if (result !== null) {
    return <AthenaFleetPlanResult result={result} dispatchedRows={dispatchedRows} />;
  }

  // While an autonomous auto-approve is in flight, the editable proposal has
  // no decision left to offer - render a slim provenance line, not the card.
  if (autonomousMode && (autoFired.current || busy)) {
    return (
      <div
        className="flex items-center gap-2 rounded-card border border-primary/20 bg-primary/[0.04] px-3 py-2"
        data-testid="athena-plan-card-auto"
      >
        <InfinityIcon className="w-3.5 h-3.5 text-primary" aria-hidden />
        <span className="typo-caption text-foreground">{c.fleet_plan_auto_approved}</span>
      </div>
    );
  }

  const canConfirm =
    rows.length > 0 && rows.every((r) => r.objective.trim().length > 0) && !busy;

  return (
    <div
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
      data-testid="athena-plan-card"
    >
      <header className="flex items-baseline gap-2">
        <Terminal className="w-3.5 h-3.5 text-primary shrink-0 translate-y-0.5" />
        <div className="min-w-0">
          <p className="typo-body-strong text-foreground break-words">{title || intent}</p>
          <p className="typo-caption text-foreground">
            {tx(
              rows.length === 1
                ? c.fleet_plan_session_count_one
                : c.fleet_plan_session_count_other,
              { count: rows.length },
            )}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="typo-caption text-foreground">{c.fleet_plan_empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <AthenaFleetPlanRow
              key={`${row.cwd}-${i}`}
              row={row}
              index={i}
              disabled={busy}
              onChange={(patch) =>
                setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
              }
              onRemove={() => setRows((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </ul>
      )}

      {error !== null && (
        <p
          className="typo-caption text-rose-400 break-words"
          data-testid="athena-plan-error"
        >
          {resolveErrorTranslated(t, error).message}
        </p>
      )}

      <p className="typo-caption text-foreground">{c.fleet_plan_containment_note}</p>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDismissed(true);
            // Cancel is a real decision, not a fold-away: record it so the
            // proposal does not come back on the next hydration.
            resolveChatCard(cardId, 'dismissed');
          }}
          disabled={busy}
          data-testid="athena-plan-cancel"
        >
          {c.fleet_plan_cancel}
        </Button>
        <AsyncButton
          variant="primary"
          size="sm"
          isLoading={busy}
          disabled={!canConfirm}
          onClick={confirm}
          data-testid="athena-plan-confirm"
        >
          {c.fleet_plan_confirm}
        </AsyncButton>
      </div>
    </div>
  );
}
