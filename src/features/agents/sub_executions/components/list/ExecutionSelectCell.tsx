import { useTranslation } from '@/i18n/useTranslation';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import type { useExecutionCompare } from './useExecutionCompare';
import type { useExecutionBulk } from './useExecutionBulk';

interface ExecutionSelectCellProps {
  row: ExecutionListItem;
  bulk: ReturnType<typeof useExecutionBulk>;
  compare: ReturnType<typeof useExecutionCompare>;
}

/** Leading cell while selecting: a bulk-rerun checkbox, or the compare A/B slot. */
export function ExecutionSelectCell({ row, bulk, compare }: ExecutionSelectCellProps) {
  const { t } = useTranslation();
  if (bulk.bulkMode) {
    return (
      <input
        type="checkbox"
        checked={bulk.bulkSelected.has(row.id)}
        disabled={bulk.running}
        onClick={(ev) => ev.stopPropagation()}
        onChange={() => bulk.toggle(row.id)}
        className="w-4 h-4 accent-primary"
        aria-label={t.agents.executions.bulk_rerun_select_row}
      />
    );
  }
  const label = compare.compareLeft === row.id ? 'A' : compare.compareRight === row.id ? 'B' : null;
  if (!label) return <span className="block w-5 h-5 rounded-card border border-primary/20 bg-background/30" />;
  // Cool (A) / warm (B) split on semantic status tokens.
  const tone = label === 'A'
    ? 'bg-status-info/20 text-status-info border-status-info/30'
    : 'bg-status-error/20 text-status-error border-status-error/30';
  return <span className={`w-5 h-5 rounded-card border flex items-center justify-center typo-heading ${tone}`}>{label}</span>;
}
