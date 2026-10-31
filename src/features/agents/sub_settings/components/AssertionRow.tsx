import { Trash2 } from 'lucide-react';
import type { OutputAssertion } from '@/lib/bindings/OutputAssertion';
import type { AssertionType } from '@/lib/bindings/AssertionType';
import { Numeric } from '@/features/shared/components/display/Numeric';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { AccessibleToggle } from '@/features/shared/components/forms/AccessibleToggle';
import { ThemedSelect } from '@/features/shared/components/forms/ThemedSelect';
import type { AssertionFailureAction } from '@/lib/bindings/AssertionFailureAction';
import { useTranslation } from '@/i18n/useTranslation';

/** One saved quality gate in the settings list. */
export type AssertionPatch = { enabled?: boolean; onFailure?: AssertionFailureAction };

export function AssertionRow({
  row,
  onDelete,
  onUpdate,
}: {
  row: OutputAssertion;
  onDelete: (row: OutputAssertion) => void;
  /** Pause/resume or change the on-failure action without delete + re-create. */
  onUpdate: (id: string, patch: AssertionPatch) => void;
}) {
  const { t } = useTranslation();
  const a = t.agents.assertions;
  // Exhaustive over AssertionType: gates are also created outside this form
  // (design promotion), so every stored type must be named truthfully, and tsc
  // flags a seventh.
  const typeLabels: Record<AssertionType, string> = {
    contains: a.type_contains,
    not_contains: a.type_not_contains,
    regex: a.type_regex,
    json_path: a.type_json_path,
    json_schema: a.type_json_schema,
    length: a.type_length,
  };

  return (
    <div
      className={`rounded-card border border-primary/10 bg-background/30 px-2.5 py-1.5 ${row.enabled ? '' : 'opacity-60'}`}
    >
      <div className="flex items-center gap-2">
        <span className="typo-body text-foreground truncate flex-1">{row.name}</span>
        {row.severity === 'critical' && (
          <span className="typo-caption rounded-input border border-status-error/30 bg-status-error/10 px-1.5 text-status-error">
            {a.severity_critical}
          </span>
        )}
        {!row.enabled && (
          <span className="typo-caption rounded-input border border-status-warning/30 bg-status-warning/10 px-1.5 text-status-warning">
            {a.paused}
          </span>
        )}
        <span className="typo-caption text-foreground">{typeLabels[row.assertionType] ?? row.assertionType}</span>
        <ThemedSelect
          value={row.onFailure}
          onChange={(e) => onUpdate(row.id, { onFailure: e.target.value as AssertionFailureAction })}
          wrapperClassName="min-w-[9rem]"
          aria-label={a.on_failure_label}
        >
          <option value="review">{a.action_review}</option>
          <option value="log">{a.action_log}</option>
          <option value="heal">{a.action_heal}</option>
        </ThemedSelect>
        <AccessibleToggle
          size="sm"
          checked={row.enabled}
          onChange={() => onUpdate(row.id, { enabled: !row.enabled })}
          label={a.enabled_label}
        />
        <button
          type="button"
          onClick={() => onDelete(row)}
          aria-label={a.delete}
          className="p-1 rounded-input text-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* The hit rate lives where the gate is managed, not only in executions. */}
      <p className="typo-caption text-foreground" data-testid="assertion-stats">
        <Numeric value={row.passCount} /> {a.stat_pass} / <Numeric value={row.failCount} /> {a.stat_fail}
        {' - '}
        {row.lastEvaluatedAt ? (
          <RelativeTime timestamp={row.lastEvaluatedAt} />
        ) : (
          a.never_evaluated
        )}
      </p>
    </div>
  );
}
