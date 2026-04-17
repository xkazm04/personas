import { FILTER_TABS, type ActivityType } from './activityTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface ActivityFiltersProps {
  filter: ActivityType;
  statusFilter: string;
  counts: Record<ActivityType, number>;
  availableStatuses: string[];
  onFilterChange: (f: ActivityType) => void;
  onStatusFilterChange: (s: string) => void;
}

export function ActivityFilters({
  filter, statusFilter, counts, availableStatuses,
  onFilterChange, onStatusFilterChange,
}: ActivityFiltersProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 border-b border-primary/10 pb-0">
      <div className="flex gap-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => { onFilterChange(tab.id); onStatusFilterChange('all'); }}
            className={`px-3 py-1.5 text-sm font-medium rounded-t-lg transition-colors ${
              filter === tab.id
                ? 'bg-primary/10 text-primary border-b-2 border-primary'
                : 'text-foreground hover:text-foreground'
            }`}
          >
            {tab.label}
            {counts[tab.id] > 0 && (
              <span className="ml-1.5 text-foreground">({counts[tab.id]})</span>
            )}
          </button>
        ))}
      </div>
      {availableStatuses.length > 1 && (
        <select
          value={statusFilter}
          onChange={(e) => onStatusFilterChange(e.target.value)}
          className="ml-auto px-2 py-1 rounded-card border border-primary/15 bg-secondary/20 text-sm text-foreground outline-none"
        >
          <option value="all">{t.agents.activity.all_statuses}</option>
          {availableStatuses.map((s) => (
            <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
          ))}
        </select>
      )}
    </div>
  );
}
