import { useMemo, useState } from 'react';
import { CheckSquare, Layers, RotateCw, X, Calendar } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';

interface BulkRerunToolbarProps {
  bulkMode: boolean;
  onEnter: () => void;
  onExit: () => void;
  selectedIds: Set<string>;
  rows: ExecutionListItem[];
  annotations: ExecutionAnnotation[];
  onSelectAllFailed: () => void;
  onSelectSinceTimestamp: (isoTimestamp: string) => void;
  onClear: () => void;
  onStart: () => void;
  hasExecutions: boolean;
  hasEnoughToBulk: boolean;
}

function isFailed(status: string): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'timeout';
}

export function BulkRerunToolbar({
  bulkMode,
  onEnter,
  onExit,
  selectedIds,
  rows,
  annotations,
  onSelectAllFailed,
  onSelectSinceTimestamp,
  onClear,
  onStart,
  hasExecutions,
  hasEnoughToBulk,
}: BulkRerunToolbarProps) {
  const { t, tx } = useTranslation();
  const e = t.agents.executions;
  const [showSincePicker, setShowSincePicker] = useState(false);
  const [sinceValue, setSinceValue] = useState<string>('');

  const failedCount = useMemo(() => rows.filter((r) => isFailed(r.status)).length, [rows]);

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
      <button
        onClick={onEnter}
        disabled={!hasExecutions}
        className="flex items-center gap-1 px-2 py-1 typo-body rounded-card text-foreground hover:text-muted-foreground/70 border border-transparent transition-colors disabled:opacity-40"
        title={e.bulk_rerun_enter_tooltip}
      >
        <Layers className="w-3 h-3" />
        {e.bulk_rerun_enter}
      </button>
    );
  }

  const selectedCount = selectedIds.size;

  return (
    <>
      <button
        onClick={onExit}
        className="flex items-center gap-1 px-2 py-1 typo-body rounded-card bg-primary/15 text-primary/80 border border-primary/20 transition-colors"
      >
        <X className="w-3 h-3" />
        {e.cancel}
      </button>

      <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-modal typo-body col-span-full flex-wrap">
        <CheckSquare className="w-3.5 h-3.5 text-primary/60 flex-shrink-0" />
        <span className="text-foreground">
          {tx(e.bulk_rerun_selected_count, { n: selectedCount })}
        </span>

        <button
          onClick={onSelectAllFailed}
          disabled={failedCount === 0}
          className="px-2 py-0.5 typo-body rounded-card text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-40"
        >
          {tx(e.bulk_rerun_select_all_failed, { n: failedCount })}
        </button>

        <button
          onClick={() => setShowSincePicker((v) => !v)}
          className="flex items-center gap-1 px-2 py-0.5 typo-body rounded-card text-foreground hover:bg-secondary/40 transition-colors"
        >
          <Calendar className="w-3 h-3" />
          {e.bulk_rerun_since_fix}
        </button>

        {selectedCount > 0 && (
          <button
            onClick={onClear}
            className="px-2 py-0.5 typo-body rounded-card text-foreground hover:bg-secondary/40 transition-colors"
          >
            {e.bulk_rerun_clear_selection}
          </button>
        )}

        <button
          onClick={onStart}
          disabled={selectedCount === 0}
          className="ml-auto flex items-center gap-1.5 px-2.5 py-1 typo-heading rounded-modal bg-primary/15 text-primary/90 border border-primary/25 hover:bg-primary/25 transition-colors disabled:opacity-40"
        >
          <RotateCw className="w-3 h-3" />
          {tx(e.bulk_rerun_start, { n: selectedCount })}
        </button>

        {showSincePicker && (
          <div className="w-full mt-1 flex flex-wrap items-center gap-2 pt-2 border-t border-primary/10">
            <span className="typo-body text-foreground">{e.bulk_rerun_since_picker_label}</span>
            <input
              type="datetime-local"
              value={sinceValue}
              onChange={(ev) => setSinceValue(ev.target.value)}
              className="px-2 py-1 typo-body rounded-card bg-background/60 border border-primary/20 text-foreground"
              aria-label={e.bulk_rerun_since_picker_label}
            />
            <button
              onClick={() => {
                if (!sinceValue) return;
                const iso = new Date(sinceValue).toISOString();
                onSelectSinceTimestamp(iso);
              }}
              disabled={!sinceValue}
              className="px-2 py-1 typo-body rounded-card bg-primary/10 text-primary/80 border border-primary/20 hover:bg-primary/20 transition-colors disabled:opacity-40"
            >
              {e.bulk_rerun_apply_since}
            </button>
            {latestAnnotationDate && (
              <button
                onClick={() => {
                  setSinceValue(latestAnnotationDate.slice(0, 16));
                  onSelectSinceTimestamp(latestAnnotationDate);
                }}
                className="px-2 py-1 typo-body rounded-card text-primary/80 hover:bg-primary/10 transition-colors"
                title={latestAnnotationDate}
              >
                {e.bulk_rerun_use_latest_annotation}
              </button>
            )}
            <button
              onClick={() => setShowSincePicker(false)}
              className="px-2 py-1 typo-body rounded-card text-foreground hover:bg-secondary/40 transition-colors"
            >
              {e.bulk_rerun_close_picker}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
