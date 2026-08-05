import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { FleetPlanRow } from '@/api/companion';

interface Props {
  row: FleetPlanRow;
  index: number;
  disabled: boolean;
  onChange: (patch: Partial<FleetPlanRow>) => void;
  onRemove: () => void;
}

/**
 * One editable session of Athena's fleet plan. The `cwd` is READ-ONLY on
 * purpose: it is the containment boundary (a registered dev project), it was
 * validated when the plan was drafted, and letting the card retype it would
 * turn a display surface into a path picker. Removing the row is the way to
 * reject a target.
 */
export function AthenaFleetPlanRow({ row, index, disabled, onChange, onRemove }: Props) {
  const { t } = useTranslation();
  const c = t.plugins.companion;
  const objectiveRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = objectiveRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [row.objective]);

  return (
    <li
      className="rounded-card border border-border bg-secondary/30 p-3 space-y-2"
      data-testid={`athena-plan-row-${index}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span
          className="typo-caption text-foreground font-mono break-all min-w-0"
          title={row.cwd}
        >
          {row.cwd}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={c.fleet_plan_remove_row}
          title={c.fleet_plan_remove_row}
          className="shrink-0 p-1 rounded-interactive text-foreground hover:text-foreground hover:bg-secondary/70 disabled:opacity-40"
          data-testid={`athena-plan-remove-${index}`}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <textarea
        ref={objectiveRef}
        value={row.objective}
        onChange={(e) => onChange({ objective: e.target.value })}
        disabled={disabled}
        rows={2}
        aria-label={c.fleet_plan_objective_label}
        placeholder={c.fleet_plan_objective_placeholder}
        className="w-full rounded-input bg-background/60 border border-border px-2 py-1.5 typo-body text-foreground resize-none overflow-hidden disabled:opacity-60"
        data-testid={`athena-plan-objective-${index}`}
      />

      <label className="flex items-center gap-2 typo-caption text-foreground">
        <span className="shrink-0">{c.fleet_plan_skill_label}</span>
        <input
          type="text"
          value={row.skill ?? ''}
          onChange={(e) => onChange({ skill: e.target.value })}
          disabled={disabled}
          placeholder={c.fleet_plan_skill_placeholder}
          className="min-w-0 flex-1 rounded-input bg-background/60 border border-border px-2 py-1 typo-caption text-foreground font-mono disabled:opacity-60"
          data-testid={`athena-plan-skill-${index}`}
        />
      </label>
    </li>
  );
}
