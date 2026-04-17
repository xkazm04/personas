import { CheckCircle2, AlertCircle, X } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/features/shared/components/display/ConnectorMeta';
import { getCategoryMeta } from './searchConstants';
import { ARCH_CATEGORIES } from '../../matrix/architecturalCategories';

export function FilterChips({
  selectedCategory,
  connectorFilter,
  onCategoryFilterChange,
  onConnectorFilterChange,
  coverageFilter,
  onCoverageFilterChange,
  coverageCounts,
  componentFilter,
  onComponentFilterChange,
}: {
  selectedCategory: string | null;
  connectorFilter: string[];
  onCategoryFilterChange: (categories: string[]) => void;
  onConnectorFilterChange: (connectors: string[]) => void;
  coverageFilter?: string;
  onCoverageFilterChange?: (value: string) => void;
  coverageCounts?: { all: number; ready: number; partial: number };
  componentFilter?: string[];
  onComponentFilterChange?: (components: string[]) => void;
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

      {/* Active component filter chips */}
      {componentFilter && componentFilter.length > 0 && onComponentFilterChange && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {(selectedCategory || connectorFilter.length > 0 || componentFilter.length > 0) && <div className="w-px h-5 bg-primary/10 mx-0.5" />}
          {componentFilter.map((key) => {
            const cat = ARCH_CATEGORIES[key];
            if (!cat) return null;
            const CatIcon = cat.icon;
            return (
              <span
                key={key}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-full border border-violet-500/20 text-violet-300"
                style={{ backgroundColor: `${cat.color}15` }}
              >
                <CatIcon className="w-3 h-3" style={{ color: cat.color }} />
                {cat.label}
                <button
                  onClick={() => onComponentFilterChange(componentFilter.filter((c) => c !== key))}
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
          <div
            role="radiogroup"
            aria-label="Coverage filter"
            onKeyDown={(e) => {
              const values = ['all', 'full', 'partial'];
              const idx = values.indexOf(coverageFilter ?? 'all');
              let next: number;

              switch (e.key) {
                case 'ArrowRight':
                case 'ArrowDown':
                  next = (idx + 1) % values.length;
                  break;
                case 'ArrowLeft':
                case 'ArrowUp':
                  next = (idx - 1 + values.length) % values.length;
                  break;
                case 'Home':
                  next = 0;
                  break;
                case 'End':
                  next = values.length - 1;
                  break;
                default:
                  return;
              }

              e.preventDefault();
              const nextValue = values[next]!;
              onCoverageFilterChange(nextValue);
              const target = e.currentTarget.querySelector<HTMLElement>(`[data-value="${nextValue}"]`);
              target?.focus();
            }}
            className="inline-flex items-center rounded-card border border-primary/15 overflow-hidden flex-shrink-0"
          >
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
                  role="radio"
                  aria-checked={isActive}
                  tabIndex={isActive ? 0 : -1}
                  data-value={opt.value}
                  onClick={() => onCoverageFilterChange(opt.value)}
                  className={`px-2.5 py-1.5 text-sm font-medium transition-colors flex items-center gap-1 ${
                    isActive
                      ? opt.color === 'violet'
                        ? 'bg-violet-500/20 text-violet-300'
                        : opt.color === 'emerald'
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-amber-500/20 text-amber-300'
                      : 'text-foreground hover:text-muted-foreground/80 hover:bg-secondary/40'
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
