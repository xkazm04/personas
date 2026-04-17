import { useMemo } from 'react';
import { CheckCircle2, Download } from 'lucide-react';
import { Button } from '@/features/shared/components/buttons';
import { useTranslation } from '@/i18n/useTranslation';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { IS_MOBILE } from '@/lib/utils/platform/platform';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { CATEGORY_ROLE_GROUPS } from '../search/filters/searchConstants';
import { CARD_PADDING } from '@/lib/utils/designTokens';
import { RoleGroupCard } from './RoleGroupCard';
import { AutomationOpportunitiesRail } from './AutomationOpportunitiesRail';
import { useAutomationDiscovery } from './useAutomationDiscovery';

interface ExploreViewProps {
  availableCategories: CategoryWithCount[];
  allItems: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  userServiceTypes: string[];
  onSelectCategory: (category: string) => void;
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

export function ExploreView({
  availableCategories,
  allItems,
  readyTemplates,
  userServiceTypes,
  onSelectCategory,
  onSelectTemplate,
}: ExploreViewProps) {
  const { t } = useTranslation();
  const opportunities = useAutomationDiscovery(allItems, userServiceTypes);
  // Build category count map
  const categoryCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of availableCategories) {
      map.set(cat.name, cat.count);
    }
    return map;
  }, [availableCategories]);

  // Build top templates per role group (by adoption count)
  // Pre-index by category in O(n), then merge small lists per group
  const topTemplatesByGroup = useMemo(() => {
    // Single pass: bucket items by category, keeping only top 3 per category
    const byCategory = new Map<string, PersonaDesignReview[]>();
    for (const item of allItems) {
      if (!item.category) continue;
      let bucket = byCategory.get(item.category);
      if (!bucket) {
        bucket = [];
        byCategory.set(item.category, bucket);
      }
      if (bucket.length < 3) {
        bucket.push(item);
        // Insertion-sort to maintain descending adoption_count order
        for (let i = bucket.length - 1; i > 0; i--) {
          if (bucket[i]!.adoption_count > bucket[i - 1]!.adoption_count) {
            [bucket[i], bucket[i - 1]] = [bucket[i - 1]!, bucket[i]!];
          } else break;
        }
      } else if (item.adoption_count > bucket[2]!.adoption_count) {
        bucket[2] = item;
        for (let i = 2; i > 0; i--) {
          if (bucket[i]!.adoption_count > bucket[i - 1]!.adoption_count) {
            [bucket[i], bucket[i - 1]] = [bucket[i - 1]!, bucket[i]!];
          } else break;
        }
      }
    }

    // For each role group, merge the small per-category buckets
    const map = new Map<string, PersonaDesignReview[]>();
    for (const group of CATEGORY_ROLE_GROUPS) {
      const merged: PersonaDesignReview[] = [];
      for (const cat of group.categories) {
        const bucket = byCategory.get(cat);
        if (bucket) merged.push(...bucket);
      }
      merged.sort((a, b) => b.adoption_count - a.adoption_count);
      map.set(group.role, merged.slice(0, 3));
    }
    return map;
  }, [allItems]);

  const { isStarter: isSimple } = useTier();

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 2xl:px-8 3xl:px-12 4xl:px-16">
      {/* Ready to Deploy section */}
      {readyTemplates.length > 0 && (
        <div className="mb-6 max-w-5xl 3xl:max-w-7xl 4xl:max-w-[1800px] mx-auto">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
            <h2 className="typo-heading font-semibold text-foreground">{t.templates.explore.ready_to_deploy}</h2>
            {!isSimple && (
            <span className="typo-body text-foreground">{t.templates.explore.ready_to_deploy_hint}</span>
            )}
          </div>
          <div className="flex gap-3 overflow-x-auto pb-2">
            {readyTemplates.map((tmpl) => (
              <Button
                key={tmpl.id}
                variant="ghost"
                size="sm"
                onClick={() => onSelectTemplate(tmpl)}
                className={`flex-shrink-0 w-52 bg-secondary/20 border border-emerald-500/15 ${CARD_PADDING.compact} text-left hover:border-emerald-500/30 hover:bg-secondary/30`}
              >
                <div className="typo-body font-medium text-foreground truncate">{tmpl.test_case_name}</div>
                <div className="typo-body text-foreground truncate mt-0.5">
                  {(tmpl.instruction ?? '').length > 60 ? (tmpl.instruction ?? '').slice(0, 60) + '...' : (tmpl.instruction ?? '')}
                </div>
                {!isSimple && tmpl.adoption_count > 0 && (
                  <div className="flex items-center gap-1 mt-2 typo-body text-emerald-400/60">
                    <Download className="w-2.5 h-2.5" />
                    {(tmpl.adoption_count === 1 ? t.templates.explore.adoption_count_one : t.templates.explore.adoption_count_other).replace('{count}', String(tmpl.adoption_count))}
                  </div>
                )}
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Automation Opportunities */}
      {!isSimple && (
        <AutomationOpportunitiesRail
          opportunities={opportunities}
          onSelectTemplate={onSelectTemplate}
          onSelectCategory={onSelectCategory}
        />
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
            onSelectTemplate={onSelectTemplate}
          />
        ))}
      </div>
    </div>
  );
}
