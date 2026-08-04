import { useState } from 'react';
import { Terminal } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { companionDispatchFleetPlan, type FleetPlanRow } from '@/api/companion';
import { AthenaFleetPlanRow } from './AthenaFleetPlanRow';

/** Parse the `fleet_plan` chat-card config the dispatcher validated. */
export function parsePlanRows(raw: unknown): FleetPlanRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      cwd: typeof r.cwd === 'string' ? r.cwd : '',
      objective: typeof r.objective === 'string' ? r.objective : '',
      skill: typeof r.skill === 'string' ? r.skill : null,
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
}: {
  config?: Record<string, unknown>;
  title?: string;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const intent = typeof config?.operation_intent === 'string' ? config.operation_intent : '';
  const [rows, setRows] = useState<FleetPlanRow[]>(() => parsePlanRows(config?.rows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (result !== null) {
    return (
      <div
        className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.06] p-3 typo-caption text-foreground"
        data-testid="athena-plan-card"
      >
        {result}
      </div>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await companionDispatchFleetPlan(
        intent,
        rows.map((r) => ({
          cwd: r.cwd,
          objective: r.objective.trim(),
          skill: r.skill?.trim() ? r.skill.trim() : null,
        })),
      );
      setResult(message);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

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
          onClick={() => setDismissed(true)}
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
