import { useState } from 'react';
import { Flag } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { companionCreateShipMilestone, type ShipMilestoneRow } from '@/api/companion';
import { AthenaShipMilestoneRow } from './AthenaShipMilestoneRow';
import { resolveChatCard } from '../useChatCards';

/** Mirrors `SHIP_MILESTONE_GOAL_MAX` (approval_exec_ship.rs) and
 *  `OBJECTIVE_MAX` (ShipMilestoneMeta.tsx). One number, three places. */
const SHIP_OBJECTIVE_MAX = 72;

/** Parse the `ship_milestone` chat-card config the dispatcher validated. */
export function parseMilestoneRows(raw: unknown): ShipMilestoneRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      itemKind: r.item_kind === 'goal' ? ('goal' as const) : ('use_case' as const),
      itemId: typeof r.item_id === 'string' ? r.item_id : '',
      description: typeof r.description === 'string' ? r.description : null,
    }))
    .filter((r) => r.itemId.length > 0);
}

/**
 * The editable ship milestone, in CHAT.
 *
 * Athena proposes the whole cut with `show_ship_milestone` — name, goal, and
 * the use cases and goals that make it up. Every part is editable here and
 * every row is removable, and nothing is written until Confirm. That makes
 * this card the correction path for a proposal that is usually 80% right: the
 * scope member she picked up from a stale reading is one click gone, and the
 * reason line is the operator's words, not hers.
 */
export function AthenaShipMilestoneCard({
  config,
  title,
  cardId,
}: {
  config?: Record<string, unknown>;
  title?: string;
  /** Durable `companion_chat_card` row id — see `AthenaFleetPlanCard`. Lets
   *  this proposal survive a refresh and records its resolution. */
  cardId?: string;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const projectId = typeof config?.project_id === 'string' ? config.project_id : '';
  const [name, setName] = useState(() =>
    typeof config?.name === 'string' ? config.name : '',
  );
  const [goal, setGoal] = useState(() =>
    typeof config?.goal === 'string' ? config.goal : '',
  );
  const [description, setDescription] = useState(() =>
    typeof config?.description === 'string' ? config.description : '',
  );
  const [rows, setRows] = useState<ShipMilestoneRow[]>(() =>
    parseMilestoneRows(config?.rows),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (created !== null) {
    return (
      <div
        className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.06] p-3 typo-caption text-foreground"
        data-testid="athena-ship-card"
      >
        {created}
      </div>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await companionCreateShipMilestone(
        projectId,
        name.trim(),
        goal.trim() ? goal.trim() : null,
        description.trim() ? description.trim() : null,
        rows.map((r) => ({
          itemKind: r.itemKind,
          itemId: r.itemId,
          description: r.description?.trim() ? r.description.trim() : null,
        })),
      );
      const message = tx(c.ship_milestone_created, {
        name: result.name,
        count: result.itemsCreated,
      });
      setCreated(message);
      resolveChatCard(
        cardId,
        'dispatched',
        { created: true, resultMessage: message },
        JSON.stringify({ message }),
      );
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const canConfirm =
    rows.length > 0 &&
    name.trim().length > 0 &&
    rows.every((r) => r.itemId.trim().length > 0) &&
    !busy;

  return (
    <div
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
      data-testid="athena-ship-card"
    >
      <header className="flex items-baseline gap-2">
        <Flag className="w-3.5 h-3.5 text-primary shrink-0 translate-y-0.5" />
        <div className="min-w-0 flex-1">
          <p className="typo-body-strong text-foreground break-words">
            {title || c.ship_milestone_heading}
          </p>
          <p className="typo-caption text-foreground">
            {tx(
              rows.length === 1
                ? c.ship_milestone_item_count_one
                : c.ship_milestone_item_count_other,
              { count: rows.length },
            )}
          </p>
        </div>
      </header>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        disabled={busy}
        aria-label={c.ship_milestone_name_label}
        placeholder={c.ship_milestone_name_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body-strong text-foreground disabled:opacity-60"
        data-testid="athena-ship-name"
      />
      {/* An INPUT, capped — not the 2-row textarea this used to be. The control
          was shaped like a prose field and the op grammar asked for a
          paragraph, so a paragraph is what arrived and what rendered as the
          Ship tab's heading. The bound matches the backend's
          SHIP_MILESTONE_GOAL_MAX, so the card cannot submit what the door
          would refuse. */}
      <input
        type="text"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
        disabled={busy}
        maxLength={SHIP_OBJECTIVE_MAX}
        aria-label={c.ship_milestone_goal_label}
        placeholder={c.ship_milestone_goal_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body text-foreground disabled:opacity-60"
        data-testid="athena-ship-goal"
      />
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={busy}
        rows={3}
        aria-label={c.ship_milestone_prose_label}
        placeholder={c.ship_milestone_prose_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body text-foreground resize-y disabled:opacity-60"
        data-testid="athena-ship-prose"
      />

      {rows.length === 0 ? (
        <p className="typo-caption text-foreground">{c.ship_milestone_empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <AthenaShipMilestoneRow
              key={`${row.itemKind}-${row.itemId}`}
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
        <p className="typo-caption text-rose-400 break-words" data-testid="athena-ship-error">
          {resolveErrorTranslated(t, error).message}
        </p>
      )}

      <p className="typo-caption text-foreground">{c.ship_milestone_planned_note}</p>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDismissed(true);
            resolveChatCard(cardId, 'dismissed');
          }}
          disabled={busy}
          data-testid="athena-ship-cancel"
        >
          {c.ship_milestone_cancel}
        </Button>
        <AsyncButton
          variant="primary"
          size="sm"
          isLoading={busy}
          disabled={!canConfirm}
          onClick={confirm}
          data-testid="athena-ship-confirm"
        >
          {c.ship_milestone_confirm}
        </AsyncButton>
      </div>
    </div>
  );
}
