import { useState } from 'react';
import { ListChecks } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import AsyncButton from '@/features/shared/components/buttons/AsyncButton';
import { useTranslation } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { companionCreateShipGoals, type ShipGoalProposal } from '@/api/companion';
import { AthenaShipGoalsRow } from './AthenaShipGoalsRow';
import { resolveChatCard } from '../useChatCards';

/** Parse the `ship_goals` chat-card config the dispatcher validated. */
export function parseGoalRows(raw: unknown): ShipGoalProposal[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is Record<string, unknown> => typeof r === 'object' && r !== null)
    .map((r) => ({
      title: typeof r.title === 'string' ? r.title : '',
      description: typeof r.description === 'string' ? r.description : null,
      contextId: typeof r.context_id === 'string' ? r.context_id : null,
      existingId: typeof r.existing_id === 'string' ? r.existing_id : null,
    }))
    .filter((r) => r.title.trim().length > 0);
}

/**
 * The editable goal decomposition, in CHAT.
 *
 * A milestone's description is the operator's brief — free markdown that names
 * the deliverables. Athena reads it with `describe_ship_milestone` and turns it
 * into goals with `show_ship_goals`; this card is where he corrects them.
 * Nothing is written until Create, and what gets created is what he edited.
 *
 * The card is the whole consent surface, exactly like `AthenaShipMilestoneCard`
 * beside it: there is no approval row behind it, so the edit affordances ARE
 * the correction path for a proposal that is usually 80% right.
 */
export function AthenaShipGoalsCard({
  config,
  title,
  cardId,
}: {
  config?: Record<string, unknown>;
  title?: string;
  /** Durable `companion_chat_card` row id — lets this proposal survive a
   *  refresh and records its resolution. */
  cardId?: string;
}) {
  const { t, tx } = useTranslation();
  const c = t.plugins.companion;
  const milestoneId = typeof config?.milestone_id === 'string' ? config.milestone_id : '';
  const milestoneName =
    typeof config?.milestone_name === 'string' ? config.milestone_name : '';
  // Present only when the decomposition came out of a Notepad note. It rides
  // back to the backend on Create so the note can be closed with the goal ids
  // it produced — the only link between what he wrote and what came of it.
  const noteId = typeof config?.note_id === 'string' ? config.note_id : null;
  const [rows, setRows] = useState<ShipGoalProposal[]>(() => parseGoalRows(config?.rows));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  if (created !== null) {
    return (
      <div
        className="rounded-card border border-emerald-500/30 bg-emerald-500/[0.06] p-3 typo-caption text-foreground"
        data-testid="athena-ship-goals-card"
      >
        {created}
      </div>
    );
  }

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await companionCreateShipGoals(
        milestoneId,
        rows.map((r) => ({
          title: r.title.trim(),
          description: r.description?.trim() ? r.description.trim() : null,
          contextId: r.contextId ?? null,
        })),
        noteId,
      );
      // `created` and `bound` are reported separately because they are
      // different facts: eight new goals and eight adoptions read identically
      // as "8 goals", and the difference is the whole idempotence rule.
      const message = tx(c.ship_goals_created, {
        name: milestoneName,
        created: result.created,
        bound: result.bound,
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
    rows.length > 0 && rows.every((r) => r.title.trim().length > 0) && !busy;

  return (
    <div
      className="rounded-card border border-primary/30 bg-primary/[0.04] p-4 space-y-3"
      data-testid="athena-ship-goals-card"
    >
      <header className="flex items-baseline gap-2">
        <ListChecks className="w-3.5 h-3.5 text-primary shrink-0 translate-y-0.5" />
        <div className="min-w-0 flex-1">
          <p className="typo-body-strong text-foreground break-words">
            {title || c.ship_goals_heading}
          </p>
          <p className="typo-caption text-foreground">
            {tx(
              rows.length === 1 ? c.ship_goals_count_one : c.ship_goals_count_other,
              { count: rows.length, name: milestoneName },
            )}
          </p>
        </div>
      </header>

      {rows.length === 0 ? (
        <p className="typo-caption text-foreground">{c.ship_goals_empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row, i) => (
            <AthenaShipGoalsRow
              // Index-keyed on purpose: the title is EDITABLE here, so keying
              // on it would remount the input on every keystroke and lose the
              // caret. The milestone card can key on its id because its rows
              // carry an immutable one.
              key={i}
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
          data-testid="athena-ship-goals-error"
        >
          {resolveErrorTranslated(t, error).message}
        </p>
      )}

      <p className="typo-caption text-foreground">{c.ship_goals_core_note}</p>

      <div className="flex items-center justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setDismissed(true);
            resolveChatCard(cardId, 'dismissed');
          }}
          disabled={busy}
          data-testid="athena-ship-goals-cancel"
        >
          {c.ship_goals_cancel}
        </Button>
        <AsyncButton
          variant="primary"
          size="sm"
          isLoading={busy}
          disabled={!canConfirm}
          onClick={confirm}
          data-testid="athena-ship-goals-confirm"
        >
          {c.ship_goals_confirm}
        </AsyncButton>
      </div>
    </div>
  );
}
