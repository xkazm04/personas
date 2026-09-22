import { X } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ShipGoalProposal } from '@/api/companion';

interface Props {
  row: ShipGoalProposal;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<ShipGoalProposal>) => void;
  onRemove: () => void;
}

/**
 * One editable proposed goal.
 *
 * The title AND the description are editable here — unlike the milestone
 * card's rows, where both id fields are read-only because they were resolved
 * against the registry and retyping one would point the cut at nothing. A goal
 * that does not exist yet has no id to protect: its title is the thing being
 * proposed, so it is the thing worth correcting.
 *
 * `contextId` stays out of the operator's hands for the milestone card's
 * reason: it WAS resolved against the real registry when the proposal was
 * drafted, and there is nowhere in a chat card to pick a different one
 * honestly.
 *
 * The "already exists" chip is the idempotence rule made visible. Confirming a
 * row that carries it binds the existing goal instead of creating a twin, and
 * saying so before the button is pressed is the difference between a rule and
 * a surprise.
 */
export function AthenaShipGoalsRow({ row, index, disabled, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const adopts = Boolean(row.existingId);

  return (
    <li
      className="rounded-card border border-border bg-secondary/30 p-3 space-y-2"
      data-testid={`athena-ship-goal-row-${index}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2 flex-wrap">
          <span
            className={`shrink-0 px-1.5 py-0.5 rounded-interactive typo-caption text-foreground ${
              adopts ? 'bg-teal-500/15' : 'bg-primary/15'
            }`}
          >
            {adopts ? c.ship_goals_badge_existing : c.ship_goals_badge_new}
          </span>
          {row.contextId && (
            <Tooltip content={c.ship_goals_context_label}>
              <span className="typo-caption text-foreground font-mono break-all min-w-0">
                {row.contextId}
              </span>
            </Tooltip>
          )}
        </div>
        <Tooltip content={c.ship_goals_remove_row}>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            aria-label={c.ship_goals_remove_row}
            className="shrink-0 p-1 rounded-interactive text-foreground hover:bg-secondary/70 disabled:is-disabled"
            data-testid={`athena-ship-goal-remove-${index}`}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      <input
        type="text"
        value={row.title}
        onChange={(e) => onChange({ title: e.target.value })}
        disabled={disabled}
        aria-label={c.ship_goals_title_label}
        placeholder={c.ship_goals_title_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body-strong text-foreground disabled:is-disabled"
        data-testid={`athena-ship-goal-title-${index}`}
      />
      <textarea
        value={row.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value })}
        disabled={disabled}
        rows={2}
        aria-label={c.ship_goals_description_label}
        placeholder={c.ship_goals_description_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body text-foreground resize-y disabled:is-disabled"
        data-testid={`athena-ship-goal-description-${index}`}
      />
    </li>
  );
}
