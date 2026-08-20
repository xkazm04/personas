import { X } from 'lucide-react';
import { Tooltip } from '@/features/shared/components/display/Tooltip';
import { useTranslation } from '@/i18n/useTranslation';
import type { ShipMilestoneRow } from '@/api/companion';

interface Props {
  row: ShipMilestoneRow;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<ShipMilestoneRow>) => void;
  onRemove: () => void;
}

/**
 * One editable scope member of Athena's proposed milestone. The `itemId` and
 * `itemKind` are READ-ONLY on purpose: they were resolved against the real
 * registry when the proposal was drafted, and letting the card retype an id
 * would turn a display surface into a way to point the cut at something that
 * does not exist. Removing the row is how a member is rejected; the
 * description is the part worth editing, because it is the operator's reason
 * for the cut, not Athena's.
 */
export function AthenaShipMilestoneRow({
  row,
  index,
  disabled,
  onChange,
  onRemove,
}: Props) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const kindLabel =
    row.itemKind === 'goal' ? c.ship_milestone_kind_goal : c.ship_milestone_kind_use_case;

  return (
    <li
      className="rounded-card border border-border bg-secondary/30 p-3 space-y-2"
      data-testid={`athena-ship-row-${index}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="shrink-0 px-1.5 py-0.5 rounded-interactive bg-primary/15 typo-caption text-foreground">
            {kindLabel}
          </span>
          <Tooltip content={row.itemId}>
            <span className="typo-caption text-foreground font-mono break-all min-w-0">
              {row.itemId}
            </span>
          </Tooltip>
        </div>
        <Tooltip content={c.ship_milestone_remove_row}>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={c.ship_milestone_remove_row}
          className="shrink-0 p-1 rounded-interactive text-foreground hover:bg-secondary/70 disabled:opacity-40"
          data-testid={`athena-ship-remove-${index}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
        </Tooltip>
      </div>

      <textarea
        value={row.description ?? ''}
        onChange={(e) => onChange({ description: e.target.value })}
        disabled={disabled}
        rows={2}
        aria-label={c.ship_milestone_description_label}
        placeholder={c.ship_milestone_description_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body text-foreground resize-y disabled:opacity-60"
        data-testid={`athena-ship-description-${index}`}
      />
    </li>
  );
}
