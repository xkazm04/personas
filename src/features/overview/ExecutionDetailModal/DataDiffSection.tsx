import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Database, AlertTriangle, Undo2, Check, Loader2 } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { getExecutionDataDiff, undoExecution } from '@/api/overview/executionJournal';
import type { ExecutionDataDiff } from '@/lib/bindings/ExecutionDataDiff';
import type { ExecutionJournalEntry } from '@/lib/bindings/ExecutionJournalEntry';
import type { UndoExecutionResult } from '@/lib/bindings/UndoExecutionResult';
import { HighlightedJsonBlock } from '@/features/agents/sub_executions/detail/inspector/HighlightedJsonBlock';
import { silentCatch } from '@/lib/silentCatch';

interface DataDiffSectionProps {
  executionId: string;
}

const FALLBACK_STYLE = { symbol: '~', cls: 'text-amber-400 bg-amber-500/10', label: 'modified' };
const ACTION_STYLES: Record<string, { symbol: string; cls: string; label: string }> = {
  insert: { symbol: '+', cls: 'text-emerald-400 bg-emerald-500/10', label: 'created' },
  update: FALLBACK_STYLE,
  delete: { symbol: '−', cls: 'text-red-400 bg-red-500/10', label: 'deleted' },
};

function EntryRow({ entry }: { entry: ExecutionJournalEntry }) {
  const [showImage, setShowImage] = useState(false);
  const style = ACTION_STYLES[entry.action] ?? FALLBACK_STYLE;
  return (
    <div className="rounded-lg border border-primary/10 bg-secondary/10">
      <button
        type="button"
        onClick={() => entry.beforeImage && setShowImage((v) => !v)}
        className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left ${entry.beforeImage ? 'hover:bg-secondary/30 cursor-pointer' : 'cursor-default'} transition-colors`}
      >
        <span className={`inline-flex items-center justify-center w-5 h-5 rounded font-mono typo-body font-bold ${style.cls}`}>{style.symbol}</span>
        <span className="typo-body font-mono text-foreground truncate">{entry.table}</span>
        <span className="typo-body font-mono text-muted-foreground truncate" title={entry.rowPk ?? undefined}>
          {entry.rowPk ?? `(no pk)`}
        </span>
        <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
          {entry.hasLaterForeignWrite && entry.undoStatus == null && (
            <span className="inline-flex items-center gap-1 typo-body text-amber-400" title="This row was modified by another writer after the run — undo will park it as a conflict instead of overwriting.">
              <AlertTriangle className="w-3 h-3" /> changed since
            </span>
          )}
          {entry.undoStatus === 'undone' && (
            <span className="inline-flex items-center gap-1 typo-body text-emerald-400"><Check className="w-3 h-3" /> undone</span>
          )}
          {entry.undoStatus === 'conflict' && (
            <span className="inline-flex items-center gap-1 typo-body text-red-400"><AlertTriangle className="w-3 h-3" /> parked</span>
          )}
          {entry.beforeImage && (showImage ? <ChevronDown className="w-3 h-3 text-foreground" /> : <ChevronRight className="w-3 h-3 text-foreground" />)}
        </span>
      </button>
      {showImage && entry.beforeImage && (
        <div className="px-2.5 pb-2">
          <div className="typo-body text-muted-foreground mb-1">Row values before this change (encrypted columns stay encrypted):</div>
          <HighlightedJsonBlock raw={entry.beforeImage} />
        </div>
      )}
    </div>
  );
}

/**
 * Reversible Agent — "Execution Data Diff": the exact rows this run
 * created/modified/deleted, with before-images and a consent-gated
 * "Undo this run" action. Loads lazily on expand.
 */
export function DataDiffSection({ executionId }: DataDiffSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const [diff, setDiff] = useState<ExecutionDataDiff | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [undoResult, setUndoResult] = useState<UndoExecutionResult | null>(null);
  const [undoError, setUndoError] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(false);
    getExecutionDataDiff(executionId)
      .then(setDiff)
      .catch((err) => { silentCatch('DataDiffSection:getExecutionDataDiff')(err); setLoadError(true); })
      .finally(() => setLoading(false));
  }, [executionId]);

  useEffect(() => {
    if (expanded && diff === null && !loading && !loadError) load();
  }, [expanded, diff, loading, loadError, load]);

  const handleUndo = useCallback(() => {
    setUndoing(true);
    setUndoError(false);
    undoExecution(executionId)
      .then((result) => {
        setUndoResult(result);
        setConfirming(false);
        load();
      })
      .catch((err) => { silentCatch('DataDiffSection:undoExecution')(err); setUndoError(true); })
      .finally(() => setUndoing(false));
  }, [executionId, load]);

  return (
    <div className="rounded-xl border border-primary/10 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-secondary/30 transition-colors"
      >
        <Database className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
        <span className="typo-body font-medium text-foreground">Data changes</span>
        {diff !== null && (
          <span className="typo-body text-muted-foreground">{diff.total} row{diff.total === 1 ? '' : 's'}</span>
        )}
        <span className="ml-auto">{expanded ? <ChevronDown className="w-3.5 h-3.5 text-foreground" /> : <ChevronRight className="w-3.5 h-3.5 text-foreground" />}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {loading && (
            <div className="flex items-center gap-2 text-foreground typo-body py-1">
              <LoadingSpinner size="sm" label="Loading data changes" />
            </div>
          )}
          {loadError && (
            <div className="typo-body text-red-400">Could not load the data journal for this run.</div>
          )}
          {!loading && !loadError && diff !== null && diff.entries.length === 0 && (
            <div className="typo-body text-muted-foreground">
              This run made no journaled data changes. Only allowlisted tables are recorded, and runs older than the journal retention window have no entries.
            </div>
          )}
          {!loading && diff !== null && diff.entries.length > 0 && (
            <>
              <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
                {diff.entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}
              </div>
              {diff.truncated && (
                <div className="typo-body text-muted-foreground">Showing the newest {diff.entries.length} of {diff.total} changes.</div>
              )}

              {undoResult && (
                <div className="rounded-lg border border-primary/10 bg-secondary/10 px-2.5 py-1.5 typo-body">
                  <span className="text-emerald-400">{undoResult.undone} reversed</span>
                  {undoResult.conflicts.length > 0 && (
                    <span className="text-amber-400"> · {undoResult.conflicts.length} parked (changed since the run — left untouched)</span>
                  )}
                  {undoResult.skippedAlreadyProcessed > 0 && (
                    <span className="text-muted-foreground"> · {undoResult.skippedAlreadyProcessed} already processed</span>
                  )}
                </div>
              )}
              {undoError && <div className="typo-body text-red-400">Undo failed — no changes were applied.</div>}

              {/* Consent gate: undo is destructive-adjacent; require an explicit second confirmation. */}
              {diff.undoable && !confirming && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg typo-heading font-medium bg-red-500/10 text-red-400 hover:bg-red-500/15 transition-colors"
                >
                  <Undo2 className="w-3 h-3" /> Undo this run&apos;s data changes
                </button>
              )}
              {diff.undoable && confirming && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 space-y-2">
                  <div className="typo-body text-foreground">
                    Reverse every row this run created, modified or deleted? Rows changed since by you or another run are parked as conflicts — they are never overwritten. This runs as a single transaction.
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={undoing}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg typo-heading font-medium bg-red-500/15 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    >
                      {undoing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Undo2 className="w-3 h-3" />} Yes, undo the changes
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirming(false)}
                      disabled={undoing}
                      className="px-2.5 py-1 rounded-lg typo-heading font-medium text-foreground hover:bg-secondary/40 transition-colors disabled:opacity-50"
                    >
                      Keep them
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
