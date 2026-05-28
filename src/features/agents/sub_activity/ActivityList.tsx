import { useMemo } from 'react';
import { Star } from 'lucide-react';
import { formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { TYPE_ICONS, renderImportanceStars, renderScoreStars, type ActivityItem } from './activityTypes';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';
import { useTranslation } from '@/i18n/useTranslation';
import type { ExecutionAnnotation } from '@/lib/bindings/ExecutionAnnotation';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

interface ActivityListProps {
  items: ActivityItem[];
  isLoading: boolean;
  useCaseOptions: { id: string; title: string }[];
  annotationsByExecution: Map<string, ExecutionAnnotation>;
  onRowClick: (item: ActivityItem) => void;
}

function useColumns(
  useCaseOptions: { id: string; title: string }[],
  annotationsByExecution: Map<string, ExecutionAnnotation>,
): TableColumn<ActivityItem>[] {
  const { t, tx } = useTranslation();
  const useCaseTitleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const uc of useCaseOptions) m.set(uc.id, uc.title);
    return m;
  }, [useCaseOptions]);
  return [
    {
      key: 'icon',
      label: '',
      width: '36px',
      render: (item) => {
        const info = TYPE_ICONS[item.type] ?? TYPE_ICONS.execution!;
        return (
          <div className={`w-7 h-7 rounded-card flex items-center justify-center ${info.bg}`} title={item.type}>
            <info.icon className={`w-3.5 h-3.5 ${info.color}`} />
          </div>
        );
      },
    },
    {
      key: 'activity',
      label: t.agents.activity.col_activity,
      width: '1fr',
      sortable: true,
      sortFn: (a, b) => a.title.localeCompare(b.title),
      render: (item) => {
        const annotation =
          item.type === 'execution' ? annotationsByExecution.get(item.id) : undefined;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              {annotation?.starred && (
                <Star className="w-3 h-3 text-amber-400 shrink-0" fill="currentColor" />
              )}
              <span className="typo-body font-medium text-foreground/85 truncate">{item.title}</span>
            </div>
            {annotation && (annotation.tags.length > 0 || annotation.note) && (
              <div className="flex flex-wrap items-center gap-1 mt-0.5">
                {annotation.tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-1.5 py-px typo-code rounded-card bg-primary/10 text-primary/80 border border-primary/15"
                  >
                    {tag}
                  </span>
                ))}
                {annotation.note && (
                  <span
                    className="typo-code text-foreground italic truncate max-w-[180px]"
                    title={annotation.note}
                  >
                    {annotation.note}
                  </span>
                )}
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'verdict',
      label: t.agents.activity.col_verdict,
      width: '110px',
      sortable: true,
      sortFn: (a, b) => {
        const sa = a.type === 'execution' ? ((a.raw as PersonaExecution).director_score ?? -1) : -1;
        const sb = b.type === 'execution' ? ((b.raw as PersonaExecution).director_score ?? -1) : -1;
        return sa - sb;
      },
      render: (item) => {
        if (item.type !== 'execution') return <span className="typo-body text-foreground/30">—</span>;
        const score = (item.raw as PersonaExecution).director_score;
        if (score == null) {
          return <span className="typo-body text-foreground/30" title={t.agents.activity.verdict_none}>—</span>;
        }
        return (
          <span
            className="typo-body text-amber-400 tabular-nums whitespace-nowrap"
            title={tx(t.agents.activity.verdict_tooltip, { score })}
          >
            {renderScoreStars(score)}
          </span>
        );
      },
    },
    {
      key: 'useCase',
      label: t.agents.activity.col_use_case,
      width: '160px',
      sortable: true,
      sortFn: (a, b) => {
        const at = a.useCaseId ? (useCaseTitleById.get(a.useCaseId) ?? a.useCaseId) : '';
        const bt = b.useCaseId ? (useCaseTitleById.get(b.useCaseId) ?? b.useCaseId) : '';
        return at.localeCompare(bt);
      },
      render: (item) => {
        if (!item.useCaseId) {
          return <span className="typo-body text-foreground italic">{t.agents.activity.use_case_persona_wide}</span>;
        }
        const title = useCaseTitleById.get(item.useCaseId) ?? item.useCaseId;
        return <span className="typo-body text-foreground truncate block" title={title}>{title}</span>;
      },
    },
    {
      key: 'status',
      label: t.agents.activity.col_status,
      width: '100px',
      render: (item) => {
        const statusEntry = item.type === 'execution' ? getStatusEntry(item.status) : null;
        if (statusEntry) {
          return <span className={`typo-body px-1.5 py-0.5 rounded ${badgeClass(statusEntry)}`}>{statusEntry.label}</span>;
        }
        if (item.type === 'memory') {
          return <span className="typo-body text-amber-400/70" title={`Importance: ${item.status}`}>{renderImportanceStars(item.status)}</span>;
        }
        if (item.type === 'review') {
          return (
            <span className={`typo-body px-1.5 py-0.5 rounded font-medium ${
              item.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' :
              item.status === 'rejected' ? 'bg-red-500/15 text-red-400' :
              'bg-amber-500/15 text-amber-400'
            }`}>{item.status}</span>
          );
        }
        return <span className="typo-body text-foreground">{item.status}</span>;
      },
    },
    {
      key: 'time',
      label: t.agents.activity.col_time,
      width: '120px',
      sortable: true,
      sortFn: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      align: 'right',
      render: (item) => (
        <span className="typo-body text-foreground whitespace-nowrap">{formatRelativeTime(item.timestamp)}</span>
      ),
    },
  ];
}

export function ActivityList({ items, isLoading, useCaseOptions, annotationsByExecution, onRowClick }: ActivityListProps) {
  const { t } = useTranslation();
  const columns = useColumns(useCaseOptions, annotationsByExecution);
  return (
    <div
      key={isLoading ? 'loading' : 'ready'}
      className={`animate-fade-slide-in transition-opacity duration-150 ${isLoading ? 'opacity-60' : 'opacity-100'}`}
    >
      <UnifiedTable
        columns={columns}
        data={items}
        getRowKey={(item) => `${item.type}-${item.id}`}
        onRowClick={onRowClick}
        isLoading={isLoading}
        emptyTitle={t.agents.activity.no_activity}
      />
    </div>
  );
}
