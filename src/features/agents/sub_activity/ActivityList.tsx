import { formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { TYPE_ICONS, renderImportanceStars, type ActivityItem } from './activityTypes';
import { UnifiedTable, type TableColumn } from '@/features/shared/components/display/UnifiedTable';

interface ActivityListProps {
  items: ActivityItem[];
  isLoading: boolean;
  onRowClick: (item: ActivityItem) => void;
}

const COLUMNS: TableColumn<ActivityItem>[] = [
  {
    key: 'icon',
    label: '',
    width: '36px',
    render: (item) => {
      const info = TYPE_ICONS[item.type] ?? TYPE_ICONS.execution!;
      return (
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${info.bg}`} title={item.type}>
          <info.icon className={`w-3.5 h-3.5 ${info.color}`} />
        </div>
      );
    },
  },
  {
    key: 'activity',
    label: 'Activity',
    width: '1fr',
    sortable: true,
    sortFn: (a, b) => a.title.localeCompare(b.title),
    render: (item) => (
      <div className="min-w-0">
        <span className="text-sm font-medium text-foreground/85 truncate block">{item.title}</span>
        <p className="text-sm text-muted-foreground/60 truncate">{item.subtitle}</p>
      </div>
    ),
  },
  {
    key: 'status',
    label: 'Status',
    width: '100px',
    render: (item) => {
      const statusEntry = item.type === 'execution' ? getStatusEntry(item.status) : null;
      if (statusEntry) {
        return <span className={`text-sm px-1.5 py-0.5 rounded ${badgeClass(statusEntry)}`}>{statusEntry.label}</span>;
      }
      if (item.type === 'memory') {
        return <span className="text-sm text-amber-400/70" title={`Importance: ${item.status}`}>{renderImportanceStars(item.status)}</span>;
      }
      if (item.type === 'review') {
        return (
          <span className={`text-sm px-1.5 py-0.5 rounded font-medium ${
            item.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' :
            item.status === 'rejected' ? 'bg-red-500/15 text-red-400' :
            'bg-amber-500/15 text-amber-400'
          }`}>{item.status}</span>
        );
      }
      return <span className="text-sm text-muted-foreground/50">{item.status}</span>;
    },
  },
  {
    key: 'time',
    label: 'Time',
    width: '120px',
    sortable: true,
    sortFn: (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    align: 'right',
    render: (item) => (
      <span className="text-sm text-muted-foreground/50 whitespace-nowrap">{formatRelativeTime(item.timestamp)}</span>
    ),
  },
];

export function ActivityList({ items, isLoading, onRowClick }: ActivityListProps) {
  return (
    <UnifiedTable
      columns={COLUMNS}
      data={items}
      getRowKey={(item) => `${item.type}-${item.id}`}
      onRowClick={onRowClick}
      isLoading={isLoading}
      emptyTitle="No activity yet"
    />
  );
}
