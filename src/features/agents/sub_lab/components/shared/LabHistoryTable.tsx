import { Trash2, Clock } from 'lucide-react';
import { useTranslation } from '@/i18n/useTranslation';
import { statusBadge } from '@/lib/eval/evalFramework';
import { LabEmptyState } from './LabEmptyState';

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
  emptyIcon: React.ComponentType<{ className?: string }>;
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
  emptyIcon: EmptyIcon,
  emptyTitle,
  emptySubtitle,
  title,
}: LabHistoryTableProps<TRun>) {
  const { t } = useTranslation();
  if (runs.length === 0) {
    return (
      <div className="space-y-3">
        <h4 className="flex items-center gap-2.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
          <Clock className="w-3 h-3" />
          {title}
        </h4>
        <LabEmptyState icon={EmptyIcon} title={emptyTitle} subtitle={emptySubtitle} />
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="flex items-center gap-2.5 text-xs font-semibold text-muted-foreground/70 uppercase tracking-wider">
        <Clock className="w-3 h-3" />
        {title}
        <span className="text-muted-foreground/50 font-normal normal-case">({runs.length})</span>
      </h4>

      <div className="border border-primary/10 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-primary/10 bg-secondary/20">
              {columns.map((col) => (
                <th key={col.key} className={`text-left px-3 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider ${col.className ?? ''}`}>
                  {col.label}
                </th>
              ))}
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider w-[140px]">{t.common.status}</th>
              <th className="text-left px-3 py-2 text-xs font-medium text-muted-foreground/60 uppercase tracking-wider w-[150px]">{t.agents.lab.col_time}</th>
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr
                key={run.id}
                onClick={() => onRowClick(run.id)}
                className={`border-b border-primary/[0.05] last:border-0 cursor-pointer transition-colors ${
                  activeRunId === run.id
                    ? 'bg-primary/5'
                    : 'hover:bg-secondary/20'
                }`}
              >
                {columns.map((col) => (
                  <td key={col.key} className={`px-3 py-2.5 ${col.className ?? ''}`}>
                    {col.render(run)}
                  </td>
                ))}
                <td className="px-3 py-2.5">
                  <span className={statusBadge(run.status)}>{run.status}</span>
                </td>
                <td className="px-3 py-2.5 text-xs text-muted-foreground/60 whitespace-nowrap">
                  {new Date(run.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-2 py-2.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(run.id); }}
                    className="p-1 rounded-lg hover:bg-red-500/15 text-muted-foreground/40 hover:text-red-400 transition-colors"
                    title={t.agents.lab.delete_run}
                    aria-label={t.agents.lab.delete_run}
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
