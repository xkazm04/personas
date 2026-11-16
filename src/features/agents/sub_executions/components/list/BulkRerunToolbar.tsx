import { useMemo, useState } from 'react';
import { CheckSquare, Layers, RotateCw, X, Calendar } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import { isFailedExecutionStatus } from '../../libs/executionStatus';

interface BulkRerunToolbarProps {
  bulkMode: boolean;
  onEnter: () => void;
  onExit: () => void;
  /**
   * How many selected rows the action will ACTUALLY rerun — i.e.
   * `rows.filter(r => selected.has(r.id)).length`, derived by the container
   * from the same set the handler acts on. Never `selected.size`: the two
   * differ whenever a display filter hides a selected row, and the button
   * would then promise N while the rerun did M < N
   * (bulk-selection-actions.md §7 D3).
   */
  selectedCount: number;
  rows: ExecutionListItem[];
  annotations: ExecutionAnnotation[];
  onSelectAllFailed: () => void;
  onSelectSinceTimestamp: (isoTimestamp: string) => void;
  onClear: () => void;
  onStart: () => void;
  /** True while a cohort is in flight — Start shows a spinner and refuses. */
  isRunning: boolean;
  hasExecutions: boolean;
  hasEnoughToBulk: boolean;
}

export function BulkRerunToolbar({
  bulkMode,
  onEnter,
  onExit,
  selectedCount,
  rows,
  annotations,
  onSelectAllFailed,
  onSelectSinceTimestamp,
  onClear,
  onStart,
  isRunning,
  hasExecutions,
  hasEnoughToBulk,
}: BulkRerunToolbarProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const [showSincePicker, setShowSincePicker] = useState(false);
  const [sinceValue, setSinceValue] = useState<string>('');

  const failedCount = useMemo(() => rows.filter((r) => isFailedExecutionStatus(r.status)).length, [rows]);

  const latestAnnotationDate = useMemo(() => {
    if (annotations.length === 0) return null;
    let max: string | null = null;
    for (const a of annotations) {
      const ts = a.updated_at ?? a.created_at;
      if (!max || ts > max) max = ts;
    }
    return max;
  }, [annotations]);

  if (!hasEnoughToBulk && !bulkMode) return null;

  if (!bulkMode) {
    return (
      <Button
        type="button"
        onClick={onEnter}
        disabled={!hasExecutions}
        tooltip={e.bulk_rerun_enter_tooltip}
        variant="secondary"
        size="xs"
        icon={<Layers className="w-3 h-3" />}
      >{e.bulk_rerun_enter}</Button>
    );
  }

  return (
    <>
      <Button type="button" onClick={onExit} variant="secondary" size="xs" icon={<X className="w-3 h-3" />}>{e.cancel}</Button>

      <div className="flex items-center gap-2 px-3 py-2 bg-surface-1 border border-hair rounded-modal typo-body col-span-full flex-wrap">
        <CheckSquare className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
        <span className="text-ink-1">
          {tx(e.bulk_rerun_selected_count, { n: selectedCount })}
        </span>

        <Button
          type="button"
          onClick={onSelectAllFailed}
          disabled={failedCount === 0}
          variant="ghost"
          size="icon-sm"
          icon={tx(e.bulk_rerun_select_all_failed, { n: failedCount })}
        />

        <Button
          type="button"
          onClick={() => setShowSincePicker((v) => !v)}
          variant="ghost"
          size="xs"
          icon={<Calendar className="w-3 h-3" />}
        >{e.bulk_rerun_since_fix}</Button>

        {selectedCount > 0 && (
          <Button type="button" onClick={onClear} variant="ghost" size="xs">{e.bulk_rerun_clear_selection}</Button>
        )}

        {/* The cohort's phase is owned by `useBulkRerun`, so this is the
            externally-owned-flag case: `Button loading={...}`, which renders a
            REAL spinner and disables itself. It used to be `disabled={selectedCount
            === 0}` alone, so a second click during a run started a second cohort,
            abandoned the first, and left its executePersona calls running — and
            billing. The rows were already guarded; the button was not. */}
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto bg-primary/15 text-primary/90 border-primary/25 hover:bg-primary/25"
          onClick={onStart}
          loading={isRunning}
          disabled={selectedCount === 0}
          icon={<RotateCw className="w-3 h-3" />}
        >
          {tx(e.bulk_rerun_start, { n: selectedCount })}
        </Button>

        {showSincePicker && (
          <div className="w-full mt-1 flex flex-wrap items-center gap-2 pt-2 border-t border-hair">
            <span className="typo-body text-ink-1">{e.bulk_rerun_since_picker_label}</span>
            <input
              type="datetime-local"
              value={sinceValue}
              onChange={(ev) => setSinceValue(ev.target.value)}
              className="px-2 py-1 typo-body rounded-card bg-background/60 border border-hair text-ink-1"
              aria-label={e.bulk_rerun_since_picker_label}
            />
            <Button
              type="button"
              onClick={() => {
                if (!sinceValue) return;
                const iso = new Date(sinceValue).toISOString();
                onSelectSinceTimestamp(iso);
              }}
              disabled={!sinceValue}
              variant="secondary"
              size="xs"
            >{e.bulk_rerun_apply_since}</Button>
            {latestAnnotationDate && (
              <Button
                type="button"
                onClick={() => {
                  const parsed = new Date(latestAnnotationDate);
                  const localValue = new Date(
                    parsed.getTime() - parsed.getTimezoneOffset() * 60000,
                  )
                    .toISOString()
                    .slice(0, 16);
                  setSinceValue(localValue);
                  onSelectSinceTimestamp(latestAnnotationDate);
                }}
                tooltip={latestAnnotationDate}
                variant="ghost"
                size="xs"
              >{e.bulk_rerun_use_latest_annotation}</Button>
            )}
            <Button type="button" onClick={() => setShowSincePicker(false)} variant="ghost" size="xs">{e.bulk_rerun_close_picker}</Button>
          </div>
        )}
      </div>
    </>
  );
}
