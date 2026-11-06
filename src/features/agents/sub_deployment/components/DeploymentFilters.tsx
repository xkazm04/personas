import { useState } from 'react';
import { Search, Filter, ChevronDown } from 'lucide-react';
import type { DeployTarget, DeployStatus } from './deploymentTypes';
import { useTranslation } from '@/i18n/useTranslation';
import { tokenLabel } from '@/i18n/tokenMaps';
import Button from '@/features/shared/components/buttons/Button';

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
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-ink-1" />
        <input
          type="text"
          placeholder={dt.search_placeholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-2 typo-body rounded-modal bg-surface-2 border border-hair
                     text-ink-1 placeholder:text-ink-3
                     focus-visible:outline-none focus-visible:border-primary/30 transition-colors"
        />
      </div>

      <div className="relative">
        <Button
          type="button"
          aria-expanded={filterOpen}
          onClick={() => setFilterOpen(!filterOpen)}
          variant={targetFilter !== 'all' || statusFilter !== 'all' ? 'secondary' : 'ghost'}
          size="sm"
          icon={<Filter className="w-3.5 h-3.5" />}
        >
          {dt.filter}
          <ChevronDown className={`w-3 h-3 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
        </Button>

        {filterOpen && (
          <div className="absolute top-full right-0 mt-1 z-30 bg-background border border-hair rounded-modal shadow-elevation-3 p-3 min-w-[200px] space-y-3">
            <div>
              <label className="typo-label text-ink-1">{dt.filter_target}</label>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(['all', 'cloud', 'gitlab'] as const).map((v) => (
                  <Button
                    type="button"
                    key={v}
                    onClick={() => onTargetFilterChange(v)}
                    variant={targetFilter === v ? 'secondary' : 'ghost'}
                    size="sm"
                  >{v === 'all' ? dt.filter_all : v === 'cloud' ? dt.cloud : 'GitLab'}</Button>
                ))}
              </div>
            </div>
            <div>
              <label className="typo-label text-ink-1">{dt.filter_status}</label>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {(['all', 'active', 'paused', 'failed', 'file-based', 'unknown'] as const).map((v) => (
                  <Button
                    type="button"
                    key={v}
                    onClick={() => onStatusFilterChange(v)}
                    variant={statusFilter === v ? 'secondary' : 'ghost'}
                    size="sm"
                  >{v === 'all' ? dt.filter_all : tokenLabel(t, 'deployment', v)}</Button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
