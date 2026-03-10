import { useMemo } from 'react';
import { CheckCircle2, Download } from 'lucide-react';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { CATEGORY_ROLE_GROUPS } from '../search/filters/searchConstants';
import { RoleGroupCard } from './RoleGroupCard';

interface ExploreViewProps {
  availableCategories: CategoryWithCount[];
  allItems: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  onSelectCategory: (category: string) => void;
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function ExploreView({
  availableCategories,
  allItems,
  readyTemplates,
  onSelectCategory,
  onSelectTemplate,
}: ExploreViewProps) {
  // Build category count map
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of availableCategories) {
      map.set(cat.name, cat.count);
    }
    return map;
  }, [availableCategories]);

  // Build top templates per role group (by adoption count)
  const topTemplatesByGroup = useMemo(() => {
    const map = new Map<string, PersonaDesignReview[]>();
    for (const group of CATEGORY_ROLE_GROUPS) {
      const groupCats = new Set(group.categories);
      const matching = allItems
        .filter((t) => t.category && groupCats.has(t.category))
        .sort((a, b) => b.adoption_count - a.adoption_count)
        .slice(0, 3);
      map.set(group.role, matching);
    }
    return map;
  }, [allItems]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 2xl:px-8 3xl:px-12 4xl:px-16">
      {/* Ready to Deploy section */}
      {readyTemplates.length > 0 && (
        <div className="mb-6 max-w-5xl 3xl:max-w-7xl 4xl:max-w-[1800px] mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
            <h2 className="text-sm font-semibold text-foreground/80">Ready to Deploy</h2>
            <span className="text-sm text-muted-foreground/60">Templates with all connectors configured</span>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {readyTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => onSelectTemplate(t)}
                className="flex-shrink-0 w-52 bg-secondary/20 border border-emerald-500/15 rounded-xl p-3 text-left hover:border-emerald-500/30 hover:bg-secondary/30 transition-all"
              >
                <div className="text-sm font-medium text-foreground/80 truncate">{t.test_case_name}</div>
                <div className="text-sm text-muted-foreground/50 truncate mt-0.5">
                  {t.instruction.length > 60 ? t.instruction.slice(0, 60) + '...' : t.instruction}
                </div>
                {t.adoption_count > 0 && (
                  <div className="flex items-center gap-1 mt-2 text-sm text-emerald-400/60">
                    <Download className="w-2.5 h-2.5" />
                    {t.adoption_count} adoption{t.adoption_count !== 1 ? 's' : ''}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Role group grid */}
      <div className={`grid gap-4 max-w-6xl 3xl:max-w-[1800px] 4xl:max-w-[2400px] mx-auto ${IS_MOBILE ? '[grid-template-columns:1fr]' : '[grid-template-columns:repeat(auto-fill,minmax(320px,1fr))]'}`}>
        {CATEGORY_ROLE_GROUPS.map((group) => (
          <RoleGroupCard
            key={group.role}
            group={group}
            categoryCounts={categoryCounts}
            topTemplates={topTemplatesByGroup.get(group.role) ?? []}
            onSelectCategory={onSelectCategory}
          />
        ))}
      </div>
    </div>
  );
}
