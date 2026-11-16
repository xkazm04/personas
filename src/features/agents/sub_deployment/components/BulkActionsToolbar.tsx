import { useRef, useState } from 'react';
import { Pause, Play, Trash2, X, AlertTriangle } from 'lucide-react';
import Button from '@/features/shared/components/buttons/Button';
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
  const busyRef = useRef(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const addToast = useToastStore((s) => s.addToast);
  const { t, tx } = useTranslation();
  const dt = t.deployment.dashboard;

  const cloudRows = selectedRows.filter((r) => r._cloud);
  const pausableIds = cloudRows.filter((r) => r.status === 'active').map((r) => r._cloud!.id);
  const resumableIds = cloudRows.filter((r) => r.status === 'paused').map((r) => r._cloud!.id);
  const removableIds = cloudRows.map((r) => r._cloud!.id);
  // Every action below acts on cloud rows only; the count says "N selected"
  // for all of them, so the rows no action can touch are named, not silent.
  const skippedCount = selectedRows.length - cloudRows.length;

  const reportResults = (action: string, results: BulkActionResult[]) => {
    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed === 0) {
      addToast(tx(dt.bulk_result_ok, { action, count: succeeded }), 'success');
    } else {
      addToast(tx(dt.bulk_result_partial, { action, succeeded, failed }), 'error');
    }
  };

  const handleBulk = async (op: BulkOp) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusyOp(op);
    try {
      let results: BulkActionResult[];
      switch (op) {
        case 'pause':
          results = await cloudBulkPause(pausableIds);
          reportResults(dt.bulk_action_pause, results);
          break;
        case 'resume':
          results = await cloudBulkResume(resumableIds);
          reportResults(dt.bulk_action_resume, results);
          break;
        case 'delete':
          results = await cloudBulkRemove(removableIds);
          reportResults(dt.bulk_action_delete, results);
          break;
      }
      onClearSelection();
    } finally {
      setConfirmingDelete(false);
      busyRef.current = false;
      setBusyOp(null);
    }
  };

  const isBusy = busyOp !== null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-card bg-surface-2 border border-hair shadow-elevation-4 shadow-black/30 backdrop-blur-md">
      <span className="typo-data text-ink-1">
        {tx(dt.bulk_selected, { count: selectedRows.length })}
      </span>

      {skippedCount > 0 && (
        <span data-testid="bulk-cloud-only-note" className="typo-caption text-ink-2">
          {tx(skippedCount === 1 ? dt.bulk_cloud_only_one : dt.bulk_cloud_only_other, { count: skippedCount })}
        </span>
      )}

      <div className="w-px h-5 bg-primary/15" />

      {pausableIds.length > 0 && (
        <Button
          variant="accent"
          tone="warning"
          size="sm"
          onClick={() => handleBulk('pause')}
          disabled={isBusy}
          loading={busyOp === 'pause'}
          icon={<Pause className="w-3.5 h-3.5" />}
        >
          {tx(dt.bulk_pause, { count: pausableIds.length })}
        </Button>
      )}

      {resumableIds.length > 0 && (
        <Button
          variant="accent"
          tone="success"
          size="sm"
          onClick={() => handleBulk('resume')}
          disabled={isBusy}
          loading={busyOp === 'resume'}
          icon={<Play className="w-3.5 h-3.5" />}
        >
          {tx(dt.bulk_resume, { count: resumableIds.length })}
        </Button>
      )}

      {removableIds.length > 0 && (
        confirmingDelete ? (
          <div className="flex items-center gap-1.5">
            <span className="typo-caption text-status-warning flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              {tx(dt.bulk_delete_confirm, { count: removableIds.length })}
            </span>
            <Button
              variant="danger"
              size="sm"
              onClick={() => handleBulk('delete')}
              disabled={isBusy}
              loading={busyOp === 'delete'}
            >
              {t.common.confirm}
            </Button>
            <Button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              disabled={isBusy}
              variant="secondary"
              size="sm"
            >{t.common.cancel}</Button>
          </div>
        ) : (
          <Button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            disabled={isBusy}
            variant="danger"
            size="sm"
            icon={<Trash2 className="w-3.5 h-3.5" />}
          >{tx(dt.bulk_delete, { count: removableIds.length })}</Button>
        )
      )}

      <div className="w-px h-5 bg-primary/15" />

      <Button aria-label={dt.clear_selection}
        type="button"
        onClick={onClearSelection}
        disabled={isBusy}
        tooltip={dt.clear_selection}
        variant="ghost"
        size="icon-sm"
        icon={<X className="w-4 h-4" />}
      />
    </div>
  );
}
