import { motion } from 'framer-motion';
import { Star } from 'lucide-react';
import { FILTER_TABS, type ActivityType } from './activityTypes';
import { useTranslation } from '@/i18n/useTranslation';
import { DebtText, debtText } from '@/i18n/DebtText';


interface ActivityFiltersProps {
  filter: ActivityType;
  statusFilter: string;
  useCaseFilter: string;
  tagFilter: string;
  starredOnly: boolean;
  counts: Record<ActivityType, number>;
  availableStatuses: string[];
  availableTags: string[];
  useCaseOptions: { id: string; title: string }[];
  onFilterChange: (f: ActivityType) => void;
  onStatusFilterChange: (s: string) => void;
  onUseCaseFilterChange: (s: string) => void;
  onTagFilterChange: (s: string) => void;
  onStarredOnlyChange: (v: boolean) => void;
}

export function ActivityFilters({
  filter, statusFilter, useCaseFilter, tagFilter, starredOnly,
  counts, availableStatuses, availableTags, useCaseOptions,
  onFilterChange, onStatusFilterChange, onUseCaseFilterChange,
  onTagFilterChange, onStarredOnlyChange,
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
              className={`relative px-3 py-1.5 typo-body font-medium rounded-t-card transition-colors duration-150 ease-out ${
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
        <button
          type="button"
          onClick={() => onStarredOnlyChange(!starredOnly)}
          aria-pressed={starredOnly}
          title={t.agents.activity.filter_starred_only}
          className={`flex items-center gap-1 px-2 py-1 rounded-card border typo-body transition-colors ${
            starredOnly
              ? 'bg-amber-500/15 text-amber-400 border-amber-400/40'
              : 'bg-secondary/20 text-foreground border-primary/15 hover:text-foreground'
          }`}
        >
          <Star className="w-3 h-3" fill={starredOnly ? 'currentColor' : 'none'} />
          {t.agents.activity.filter_starred_only}
        </button>
        {availableTags.length > 0 && (
          <select
            value={tagFilter}
            onChange={(e) => onTagFilterChange(e.target.value)}
            className="px-2 py-1 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none"
            title={t.agents.activity.filter_tag}
          >
            <option value="all">{t.agents.activity.filter_tag_all}</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        )}
        {useCaseOptions.length > 0 && (
          <select
            value={useCaseFilter}
            onChange={(e) => onUseCaseFilterChange(e.target.value)}
            className="px-2 py-1 rounded-card border border-primary/15 bg-secondary/20 typo-body text-foreground outline-none"
            title={debtText("auto_filter_by_capability_4c8f68bf")}
          >
            <option value="all"><DebtText k="auto_all_capabilities_1b93e8ca" /></option>
            <option value="__none__"><DebtText k="auto_persona_wide_8f9b90e5" /></option>
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
