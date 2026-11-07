import { CheckCircle2, AlertCircle, FlaskConical, X } from 'lucide-react';
import { getConnectorMeta, ConnectorIcon } from '@/lib/connectors/connectorMeta';
import { categoryLabel, getCategoryMeta } from './searchConstants';
import { ARCH_CATEGORIES } from '../../../shared/architecturalCategories';
import { useTranslation } from '@/i18n/useTranslation';
import Button from '@/features/shared/components/buttons/Button';
import { OptionChip } from '@/features/shared/components/forms/OptionChip';

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
  coverageCounts?: { all: number; ready: number; partial: number; drafts?: number };
  componentFilter?: string[];
  onComponentFilterChange?: (components: string[]) => void;
}) {
  const { t, tx } = useTranslation();
  const removeLabel = (label: string) => tx(t.templates.search.remove_filter_aria, { label });
  const activeCategoryMeta = selectedCategory ? getCategoryMeta(selectedCategory) : null;
  const activeCategoryLabel = selectedCategory ? categoryLabel(t, selectedCategory) : '';
  const ActiveCategoryIcon = activeCategoryMeta?.icon ?? null;

  // "Drafts" is a dev-only filter: the chip appears only when draft (unpublished)
  // templates are present, which happens solely in dev builds (the catalog skips
  // them in production), so it's auto-hidden in release builds.
  const coverageOptions = [
    { value: 'all', label: t.templates.search.coverage_all, color: 'violet', icon: null, countKey: 'all' as const },
    { value: 'full', label: t.templates.search.coverage_ready, color: 'emerald', icon: CheckCircle2, countKey: 'ready' as const },
    { value: 'partial', label: t.templates.search.coverage_partial, color: 'amber', icon: AlertCircle, countKey: 'partial' as const },
    ...((coverageCounts?.drafts ?? 0) > 0
      ? [{ value: 'drafts', label: t.templates.search.coverage_drafts, color: 'slate', icon: FlaskConical, countKey: 'drafts' as const }]
      : []),
  ];

  return (
    <>
      {/* Active category chip */}
      {selectedCategory && activeCategoryMeta && ActiveCategoryIcon && (
        <span className="inline-flex items-center gap-1.5 typo-body text-role-agent flex-shrink-0">
          <ActiveCategoryIcon className="w-3 h-3" style={{ color: activeCategoryMeta.color }} />
          {activeCategoryLabel}
          <Button
            type="button"
            onClick={() => onCategoryFilterChange([])}
            aria-label={removeLabel(activeCategoryLabel)}
            variant="ghost"
            size="icon-sm"
            className="ml-0.5"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </Button>
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
                className="inline-flex items-center gap-1.5 typo-body text-role-agent"
              >
                <ConnectorIcon meta={meta} size="w-3 h-3" />
                {meta.label}
                <Button
                  type="button"
                  onClick={() => onConnectorFilterChange(connectorFilter.filter((c) => c !== name))}
                  aria-label={removeLabel(meta.label)}
                  variant="ghost"
                  size="icon-sm"
                  className="ml-0.5"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </Button>
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
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 typo-body rounded-full border border-role-agent/20 text-role-agent"
                style={{ backgroundColor: `${cat.color}15` }}
              >
                <CatIcon className="w-3 h-3" style={{ color: cat.color }} />
                {cat.label}
                <Button
                  type="button"
                  onClick={() => onComponentFilterChange(componentFilter.filter((c) => c !== key))}
                  aria-label={removeLabel(cat.label)}
                  variant="ghost"
                  size="icon-sm"
                  className="ml-0.5"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </Button>
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
            aria-label={t.templates.search.coverage_filter_aria}
            onKeyDown={(e) => {
              const values = coverageOptions.map((o) => o.value);
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
            className="inline-flex items-center rounded-card border border-hair overflow-hidden flex-shrink-0"
          >
            {coverageOptions.map((opt) => {
              const isActive = (coverageFilter ?? 'all') === opt.value;
              const Icon = opt.icon;
              const count = coverageCounts?.[opt.countKey];
              return (
                <OptionChip
                  key={opt.value}
                  role="radio"
                  selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  data-value={opt.value}
                  onSelect={() => onCoverageFilterChange(opt.value)}
                  icon={Icon ? <Icon className="w-3 h-3" /> : undefined}
                  count={count !== undefined && count > 0 ? count : undefined}
                >
                  {opt.label}
                </OptionChip>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
