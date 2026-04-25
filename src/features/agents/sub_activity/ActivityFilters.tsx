import { motion } from 'framer-motion';
import { FILTER_TABS, type ActivityType } from './activityTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface ActivityFiltersProps {
  filter: ActivityType;
  statusFilter: string;
  useCaseFilter: string;
  counts: Record<ActivityType, number>;
  availableStatuses: string[];
  useCaseOptions: { id: string; title: string }[];
  onFilterChange: (f: ActivityType) => void;
  onStatusFilterChange: (s: string) => void;
  onUseCaseFilterChange: (s: string) => void;
}

export function ActivityFilters({
  filter, statusFilter, useCaseFilter, counts, availableStatuses, useCaseOptions,
  onFilterChange, onStatusFilterChange, onUseCaseFilterChange,
}: ActivityFiltersProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3 border-b border-primary/10 pb-0">
      <div className="flex gap-1">
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => { onFilterChange(tab.id); onStatusFilterChange('all'); }}
              className={`relative px-3 py-1.5 typo-body font-medium rounded-t-lg transition-colors duration-150 ease-out ${
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-foreground hover:text-foreground hover:bg-primary/5'
              }`}
            >
              {tab.label}
              {counts[tab.id] > 0 && (
                <span className="ml-1.5 text-foreground">({counts[tab.id]})</span>
              )}
              {isActive && (
                <motion.div
                  layoutId="activityFilterTab"
                  className="absolute -bottom-px left-2 right-2 h-0.5 bg-primary rounded-full"
                  transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                />
              )}
            </button>
          );
        })}
      </div>
      <div className="ml-auto flex items-center gap-2">
        {useCaseOptions.length > 0 && (
          <select
            value={useCaseFilter}
            onChange={(e) => onUseCaseFilterChange(e.target.value)}
            className="px-2 py-1 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none"
            title="Filter by capability"
          >
            <option value="all">All capabilities</option>
            <option value="__none__">Persona-wide</option>
            {useCaseOptions.map((uc) => (
              <option key={uc.id} value={uc.id}>{uc.title}</option>
            ))}
          </select>
        )}
        {availableStatuses.length > 1 && (
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="px-2 py-1 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none"
          >
            <option value="all">{t.agents.activity.all_statuses}</option>
            {availableStatuses.map((s) => (
              <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
}
