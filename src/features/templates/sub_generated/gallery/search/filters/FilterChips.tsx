import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { getCategoryMeta } from './searchConstants';

export function FilterChips({
  selectedCategory,
  connectorFilter,
  onCategoryFilterChange,
  onConnectorFilterChange,
  coverageFilter,
  onCoverageFilterChange,
  coverageCounts,
}: {
  selectedCategory: string | null;
  connectorFilter: string[];
  onCategoryFilterChange: (categories: string[]) => void;
  onConnectorFilterChange: (connectors: string[]) => void;
  coverageFilter?: string;
  onCoverageFilterChange?: (value: string) => void;
  coverageCounts?: { all: number; ready: number; partial: number };
}) {
  const activeCategoryMeta = selectedCategory ? getCategoryMeta(selectedCategory) : null;
  const ActiveCategoryIcon = activeCategoryMeta?.icon ?? null;

  return (
    <>
      {/* Active category chip */}
      {selectedCategory && activeCategoryMeta && ActiveCategoryIcon && (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300 flex-shrink-0">
          <ActiveCategoryIcon className="w-3 h-3" style={{ color: activeCategoryMeta.color }} />
          {activeCategoryMeta.label}
          <button
            onClick={() => onCategoryFilterChange([])}
            className="ml-0.5 hover:text-white transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </span>
      )}

      {/* Active connector filter chips */}
      {connectorFilter.length > 0 && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(selectedCategory || connectorFilter.length > 0) && <div className="w-px h-5 bg-primary/10 mx-0.5" />}
          {connectorFilter.map((name) => {
            const meta = getConnectorMeta(name);
            return (
              <span
                key={name}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full bg-violet-500/10 border border-violet-500/20 text-violet-300"
              >
                <ConnectorIcon meta={meta} size="w-3 h-3" />
                {meta.label}
                <button
                  onClick={() => onConnectorFilterChange(connectorFilter.filter((c) => c !== name))}
                  className="ml-0.5 hover:text-white transition-colors"
                >
                  <X className="w-3 h-3" />
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Coverage filter segmented control */}
      {onCoverageFilterChange && (
        <>
          {(selectedCategory || connectorFilter.length > 0) && <div className="w-px h-5 bg-primary/10 mx-0.5" />}
          <div className="inline-flex items-center rounded-lg border border-primary/15 overflow-hidden flex-shrink-0">
            {([
              { value: 'all', label: 'All', color: 'violet', countKey: 'all' as const },
              { value: 'full', label: 'Ready', color: 'emerald', icon: CheckCircle2, countKey: 'ready' as const },
              { value: 'partial', label: 'Partial', color: 'amber', icon: AlertCircle, countKey: 'partial' as const },
            ]).map((opt) => {
              const isActive = (coverageFilter ?? 'all') === opt.value;
              const Icon = 'icon' in opt ? opt.icon : null;
              const count = coverageCounts?.[opt.countKey];
              return (
                <button
                  key={opt.value}
                  onClick={() => onCoverageFilterChange(opt.value)}
                  className={`px-2.5 py-1.5 text-sm font-medium transition-colors flex items-center gap-1 ${
                    isActive
                      ? opt.color === 'violet'
                        ? 'bg-violet-500/20 text-violet-300'
                        : opt.color === 'emerald'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      : 'text-muted-foreground/60 hover:text-muted-foreground/80 hover:bg-secondary/40'
                  }`}
                >
                  {Icon && <Icon className="w-3 h-3" />}
                  {opt.label}
                  {count !== undefined && count > 0 && (
                    <span className={`ml-0.5 text-sm tabular-nums ${isActive ? 'opacity-80' : 'opacity-50'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
