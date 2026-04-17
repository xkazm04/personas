import { useState } from 'react';
import { Search, Filter, ChevronDown } from 'lucide-react';
import type { DeployTarget, DeployStatus } from './deploymentTypes';
import { useTranslation } from '@/i18n/useTranslation';

interface DeploymentFiltersProps {
  search: string;
  onSearchChange: (value: string) => void;
  targetFilter: DeployTarget | 'all';
  onTargetFilterChange: (value: DeployTarget | 'all') => void;
  statusFilter: DeployStatus | 'all';
  onStatusFilterChange: (value: DeployStatus | 'all') => void;
}

export function DeploymentFilters({
  search,
  onSearchChange,
  targetFilter,
  onTargetFilterChange,
  statusFilter,
  onStatusFilterChange,
}: DeploymentFiltersProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const { t } = useTranslation();
  const dt = t.deployment.dashboard;

  return (
    <div className="flex items-center gap-2 mt-4">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
        <input
          type="text"
          placeholder={dt.search_placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 text-sm rounded-modal bg-secondary/40 border border-primary/15
                     text-foreground/80 placeholder:text-muted-foreground/50
                     focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
        />
      </div>

      <div className="relative">
        <button
          onClick={() => setFilterOpen(!filterOpen)}
          className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-modal border transition-colors cursor-pointer ${
            targetFilter !== 'all' || statusFilter !== 'all'
              ? 'bg-primary/10 border-primary/25 text-primary'
              : 'bg-secondary/40 border-primary/15 text-muted-foreground/80 hover:border-primary/25'
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {dt.filter}
          <ChevronDown className={`w-3 h-3 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
        </button>

        {filterOpen && (
          <div className="absolute top-full right-0 mt-1 z-30 bg-background border border-primary/20 rounded-modal shadow-elevation-3 p-3 min-w-[200px] space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">{dt.filter_target}</label>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(['all', 'cloud', 'gitlab'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => onTargetFilterChange(v)}
                    className={`px-2.5 py-1 text-xs rounded-card border transition-colors cursor-pointer ${
                      targetFilter === v
                        ? 'bg-primary/15 border-primary/25 text-primary'
                        : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
                    }`}
                  >
                    {v === 'all' ? dt.filter_all : v === 'cloud' ? dt.cloud : 'GitLab'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground/70 uppercase tracking-wider">{dt.filter_status}</label>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(['all', 'active', 'paused', 'failed'] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => onStatusFilterChange(v)}
                    className={`px-2.5 py-1 text-xs rounded-card border transition-colors cursor-pointer ${
                      statusFilter === v
                        ? 'bg-primary/15 border-primary/25 text-primary'
                        : 'bg-secondary/30 border-primary/10 text-muted-foreground/70 hover:bg-secondary/50'
                    }`}
                  >
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
