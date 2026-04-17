import { useState } from 'react';
import { Pause, Play, Trash2, X, AlertTriangle } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { UnifiedDeployment } from './deploymentTypes';
import type { BulkActionResult } from '@/stores/slices/system/cloudSlice';
import { useToastStore } from '@/stores/toastStore';
import { useTranslation } from '@/i18n/useTranslation';

type BulkOp = 'pause' | 'resume' | 'delete';

interface BulkActionsToolbarProps {
  selectedRows: UnifiedDeployment[];
  onClearSelection: () => void;
  cloudBulkPause: (ids: string[]) => Promise<BulkActionResult[]>;
  cloudBulkResume: (ids: string[]) => Promise<BulkActionResult[]>;
  cloudBulkRemove: (ids: string[]) => Promise<BulkActionResult[]>;
}

export function BulkActionsToolbar({
  selectedRows,
  onClearSelection,
  cloudBulkPause,
  cloudBulkResume,
  cloudBulkRemove,
}: BulkActionsToolbarProps) {
  const [busyOp, setBusyOp] = useState<BulkOp | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();
  const dt = t.deployment.dashboard;

  const cloudRows = selectedRows.filter((r) => r._cloud);
  const pausableIds = cloudRows.filter((r) => r.status === 'active').map((r) => r._cloud!.id);
  const resumableIds = cloudRows.filter((r) => r.status === 'paused').map((r) => r._cloud!.id);
  const removableIds = cloudRows.map((r) => r._cloud!.id);

  const reportResults = (action: string, results: BulkActionResult[]) => {
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) {
      addToast(`${action}: ${succeeded} deployment${succeeded !== 1 ? 's' : ''} updated`, 'success');
    } else {
      addToast(`${action}: ${succeeded} succeeded, ${failed} failed`, failed > 0 ? 'error' : 'success');
    }
  };

  const handleBulk = async (op: BulkOp) => {
    setBusyOp(op);
    try {
      let results: BulkActionResult[];
      switch (op) {
        case 'pause':
          results = await cloudBulkPause(pausableIds);
          reportResults('Bulk pause', results);
          break;
        case 'resume':
          results = await cloudBulkResume(resumableIds);
          reportResults('Bulk resume', results);
          break;
        case 'delete':
          results = await cloudBulkRemove(removableIds);
          reportResults('Bulk delete', results);
          break;
      }
      onClearSelection();
      setConfirmingDelete(false);
    } finally {
      setBusyOp(null);
    }
  };

  const isBusy = busyOp !== null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl bg-secondary/95 border border-primary/20 shadow-elevation-4 shadow-black/30 backdrop-blur-md">
      <span className="text-sm font-medium text-foreground/90 tabular-nums">
        {tx(dt.bulk_selected, { count: selectedRows.length })}
      </span>

      <div className="w-px h-5 bg-primary/15" />

      {pausableIds.length > 0 && (
        <button
          type="button"
          onClick={() => handleBulk('pause')}
          disabled={isBusy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-modal bg-amber-500/10 border border-amber-500/20 text-amber-400 hover:bg-amber-500/20 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {busyOp === 'pause' ? <LoadingSpinner size="sm" /> : <Pause className="w-3.5 h-3.5" />}
          {tx(dt.bulk_pause, { count: pausableIds.length })}
        </button>
      )}

      {resumableIds.length > 0 && (
        <button
          type="button"
          onClick={() => handleBulk('resume')}
          disabled={isBusy}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-modal bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-40 transition-colors cursor-pointer"
        >
          {busyOp === 'resume' ? <LoadingSpinner size="sm" /> : <Play className="w-3.5 h-3.5" />}
          {tx(dt.bulk_resume, { count: resumableIds.length })}
        </button>
      )}

      {removableIds.length > 0 && (
        confirmingDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-amber-400/70 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              {tx(dt.bulk_delete_confirm, { count: removableIds.length })}
            </span>
            <button
              type="button"
              onClick={() => {
                setConfirmingDelete(false);
                handleBulk('delete');
              }}
              disabled={isBusy}
              className="px-2.5 py-1.5 bg-red-500 hover:bg-red-600 text-foreground rounded-modal text-xs font-medium transition-colors disabled:opacity-40 cursor-pointer"
            >
              {busyOp === 'delete' ? <LoadingSpinner size="sm" /> : t.common.confirm}
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={isBusy}
              className="px-2.5 py-1.5 bg-secondary/50 text-foreground rounded-modal text-xs transition-colors hover:bg-secondary/70 disabled:opacity-40 cursor-pointer"
            >
              {t.common.cancel}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={isBusy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-modal bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-40 transition-colors cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {tx(dt.bulk_delete, { count: removableIds.length })}
          </button>
        )
      )}

      <div className="w-px h-5 bg-primary/15" />

      <button
        type="button"
        onClick={onClearSelection}
        disabled={isBusy}
        className="p-1.5 rounded-card text-foreground hover:text-foreground/80 hover:bg-secondary/50 disabled:opacity-40 transition-colors cursor-pointer"
        title={dt.clear_selection}
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
