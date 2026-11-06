import { useState } from 'react';
import { Trash2, Clock, type LucideIcon } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import { RelativeTime } from '@/features/shared/components/display/RelativeTime';
import { statusBadge } from '@/lib/eval/evalFramework';
import { ConfirmDialog } from '@/features/shared/components/feedback/ConfirmDialog';
import { LabEmptyState } from './LabEmptyState';
import Button from '@/features/shared/components/buttons/Button';

export interface LabHistoryColumn<TRun> {
  key: string;
  label: string;
  render: (run: TRun) => React.ReactNode;
  className?: string;
}

interface LabHistoryTableProps<TRun extends { id: string; status: string; createdAt: string }> {
  runs: TRun[];
  columns: LabHistoryColumn<TRun>[];
  activeRunId: string | null;
  onRowClick: (runId: string) => void;
  onDelete: (runId: string) => void;
  emptyIcon?: LucideIcon;
  emptyTitle: string;
  emptySubtitle: string;
  title: string;
}

export function LabHistoryTable<TRun extends { id: string; status: string; createdAt: string }>({
  runs,
  columns,
  activeRunId,
  onRowClick,
  onDelete,
  emptyIcon,
  emptyTitle,
  emptySubtitle,
  title,
}: LabHistoryTableProps<TRun>) {
  const { t } = useTranslation();
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  if (runs.length === 0) {
    return (
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 typo-label text-ink-1">
          <Clock className="w-3 h-3" />
          {title}
        </h4>
        <LabEmptyState icon={emptyIcon} title={emptyTitle} subtitle={emptySubtitle} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {pendingDeleteId && (
        <ConfirmDialog
          danger
          title={t.agents.lab.delete_run}
          body={t.common.confirm_destructive_cannot_undo}
          confirmLabel={t.common.delete}
          onConfirm={() => {
            onDelete(pendingDeleteId);
            setPendingDeleteId(null);
          }}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      <h4 className="flex items-center gap-2.5 typo-label text-ink-1">
        <Clock className="w-3 h-3" />
        {title}
        <span className="text-ink-1 font-normal normal-case">({runs.length})</span>
      </h4>

      <div className="border border-hair rounded-modal overflow-hidden">
        <table className="w-full typo-body">
          <thead>
            <tr className="border-b border-hair bg-surface-1">
              {columns.map((col) => (
                <th key={col.key} className={`text-left px-3 py-2 typo-eyebrow text-ink-1 ${col.className ?? ''}`}>
                  {col.label}
                </th>
              ))}
              <th className="text-left px-3 py-2 w-[140px] typo-eyebrow text-ink-1">{t.common.status}</th>
              <th className="text-left px-3 py-2 w-[150px] typo-eyebrow text-ink-1">{t.agents.lab.col_time}</th>
              <th className="w-10 typo-eyebrow text-ink-1" />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => onRowClick(run.id)}
                className={`border-b border-primary/[0.05] last:border-0 cursor-pointer transition-colors ${
                  activeRunId === run.id
                    ? 'bg-surface-1'
                    : 'hover:bg-surface-1'
                }`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2.5 ${col.className ?? ''}`}>
                    {col.render(run)}
                  </td>
                ))}
                <td className="px-3 py-2.5">
                  <span className={statusBadge(run.status)}>{tokenLabel(t, 'execution', run.status)}</span>
                </td>
                <td className="px-3 py-2.5 typo-caption text-ink-1 whitespace-nowrap">
                  <RelativeTime timestamp={run.createdAt} />
                </td>
                <td className="px-2 py-2.5">
                  <Button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setPendingDeleteId(run.id); }}
                    tooltip={t.agents.lab.delete_run}
                    aria-label={t.agents.lab.delete_run}
                    variant="ghost"
                    size="icon-sm"
                    icon={<Trash2 className="w-3 h-3" />}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
