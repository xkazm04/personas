import { formatRelativeTime, getStatusEntry, badgeClass } from '@/lib/utils/formatters';
import { TYPE_ICONS, renderImportanceStars, type ActivityItem } from './activityTypes';

interface ActivityListProps {
  items: ActivityItem[];
  isLoading: boolean;
  onRowClick: (item: ActivityItem) => void;
}

export function ActivityList({ items, isLoading, onRowClick }: ActivityListProps) {
  if (isLoading) {
    return <div className="py-8 text-center text-muted-foreground/50 text-sm">Loading activity...</div>;
  }

  if (items.length === 0) {
    return <div className="py-8 text-center text-muted-foreground/50 text-sm">No activity yet</div>;
  }

  return (
    <div className="border border-primary/10 rounded-xl overflow-hidden">
      {/* Table header */}
      <div className="grid grid-cols-[36px_1fr_100px_120px] gap-3 px-4 py-2 bg-primary/5 border-b border-primary/10 text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider">
        <span></span>
        <span>Activity</span>
        <span>Status</span>
        <span>Time</span>
      </div>
      {/* Table rows */}
      {items.map((item, idx) => {
        const info = TYPE_ICONS[item.type] ?? TYPE_ICONS.execution!;
        const statusEntry = item.type === 'execution' ? getStatusEntry(item.status) : null;
        return (
          <div
            key={`${item.type}-${item.id}`}
            onClick={() => onRowClick(item)}
            className={`grid grid-cols-[36px_1fr_100px_120px] gap-3 px-4 py-2.5 cursor-pointer transition-colors hover:bg-white/[0.04] items-center ${
              idx > 0 ? 'border-t border-primary/[0.06]' : ''
            }`}
          >
            <div
              className={`w-7 h-7 rounded-lg flex items-center justify-center ${info.bg}`}
              title={item.type.charAt(0).toUpperCase() + item.type.slice(1)}
            >
              <info.icon className={`w-3.5 h-3.5 ${info.color}`} />
            </div>
            <div className="min-w-0">
              <span className="text-sm font-medium text-foreground/85 truncate block">{item.title}</span>
              <p className="text-sm text-muted-foreground/60 truncate">{item.subtitle}</p>
            </div>
            <div>
              {statusEntry ? (
                <span className={`text-sm px-1.5 py-0.5 rounded ${badgeClass(statusEntry)}`}>{statusEntry.label}</span>
              ) : item.type === 'memory' ? (
                <span className="text-sm text-amber-400/70" title={`Importance: ${item.status}`}>
                  {renderImportanceStars(item.status)}
                </span>
              ) : item.type === 'review' ? (
                <span className={`text-sm px-1.5 py-0.5 rounded font-medium ${
                  item.status === 'approved' ? 'bg-emerald-500/15 text-emerald-400' :
                  item.status === 'rejected' ? 'bg-red-500/15 text-red-400' :
                  'bg-amber-500/15 text-amber-400'
                }`}>{item.status}</span>
              ) : (
                <span className="text-sm text-muted-foreground/50">{item.status}</span>
              )}
            </div>
            <span className="text-sm text-muted-foreground/50 whitespace-nowrap">
              {formatRelativeTime(item.timestamp)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
