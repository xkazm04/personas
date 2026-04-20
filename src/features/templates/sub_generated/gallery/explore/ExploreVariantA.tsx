/**
 * Explore Variant A: "Role-first Discovery"
 *
 * Design philosophy: Users first identify their role/department via large
 * illustrated cards, then see templates ranked by relevance to that role.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────┐
 * │  "What's your role?" — illustrated role card grid   │
 * ├─────────────────────────────────────────────────────┤
 * │  Role description + category chips                  │
 * ├──────────────────────────┬──────────────────────────┤
 * │  Top templates for role  │  Quick-start templates   │
 * │  (card grid)             │  (ready to deploy)       │
 * └──────────────────────────┴──────────────────────────┘
 */
import { useState, useMemo } from 'react';
import { CheckCircle2, Download, ArrowRight } from 'lucide-react';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { CATEGORY_ROLE_GROUPS, getCategoryMeta } from '../search/filters/searchConstants';
import { useTranslation } from '@/i18n/useTranslation';
import { useIsDarkTheme } from '@/stores/themeStore';

interface Props {
  availableCategories: CategoryWithCount[];
  allItems: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  userServiceTypes: string[];
  onSelectCategory: (category: string) => void;
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

/** Illustration paths keyed by role — dark and light variants */
const ROLE_ILLUSTRATIONS: Record<string, { dark: string; light: string }> = {
  software:     { dark: '/illustrations/explore/software-dark.png', light: '/illustrations/explore/software-light.png' },
  business:     { dark: '/illustrations/explore/business-dark.png', light: '/illustrations/explore/business-light.png' },
  research:     { dark: '/illustrations/explore/content-dark.png',  light: '/illustrations/explore/content-light.png' },
  customer:     { dark: '/illustrations/explore/customer-dark.png', light: '/illustrations/explore/customer-light.png' },
  productivity: { dark: '/illustrations/explore/data-dark.png',     light: '/illustrations/explore/data-light.png' },
};

export function ExploreVariantA({
  allItems,
  readyTemplates,
  onSelectCategory,
  onSelectTemplate,
}: Props) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const roleGroup = selectedRole
    ? CATEGORY_ROLE_GROUPS.find((g) => g.role === selectedRole)
    : null;

  const roleTemplates = useMemo(() => {
    if (!roleGroup) return [];
    const cats = new Set(roleGroup.categories);
    return allItems
      .filter((item) => item.category && cats.has(item.category))
      .sort((a, b) => b.adoption_count - a.adoption_count)
      .slice(0, 9);
  }, [allItems, roleGroup]);

  const roleReadyTemplates = useMemo(() => {
    if (!roleGroup) return [];
    const cats = new Set(roleGroup.categories);
    return readyTemplates.filter((item) => item.category && cats.has(item.category)).slice(0, 4);
  }, [readyTemplates, roleGroup]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-6 2xl:px-8">
      <div className="max-w-6xl 3xl:max-w-[1800px] mx-auto space-y-6">
        {/* Role card grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {CATEGORY_ROLE_GROUPS.map((group) => {
            const isActive = selectedRole === group.role;
            const GroupIcon = group.icon;
            const illustration = ROLE_ILLUSTRATIONS[group.role];
            const imgSrc = illustration
              ? (isDark ? illustration.dark : illustration.light)
              : undefined;

            return (
              <button
                key={group.role}
                onClick={() => setSelectedRole(isActive ? null : group.role)}
                className={`group relative overflow-hidden rounded-2xl border text-left transition-all duration-200 h-56 ${
                  isActive
                    ? 'border-primary/30 ring-2 ring-primary/20 bg-primary/[0.06]'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/20'
                }`}
              >
                {/* Full-card illustration */}
                {imgSrc && (
                  <img
                    src={imgSrc}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover opacity-45 group-hover:opacity-65 transition-opacity duration-300"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/30 to-background/85 pointer-events-none" />

                <div className="relative h-full flex flex-col justify-between p-4">
                  {/* Header: title + icon at top */}
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-modal border backdrop-blur-sm transition-colors ${
                      isActive
                        ? 'bg-primary/20 border-primary/30'
                        : 'bg-background/60 border-primary/15 group-hover:bg-background/75'
                    }`}>
                      <GroupIcon className="w-7 h-7 text-primary/80" />
                    </div>
                    <h3 className="text-2xl font-semibold text-foreground flex-1 min-w-0 truncate drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">{group.label}</h3>
                  </div>

                  {/* Tags at the bottom */}
                  <div className="flex flex-wrap gap-1.5">
                    {group.categories.slice(0, 5).map((cat) => {
                      const meta = getCategoryMeta(cat);
                      return (
                        <span
                          key={cat}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-input typo-caption bg-background/70 backdrop-blur-sm border border-primary/10 text-foreground"
                        >
                          <meta.icon className="w-3 h-3 flex-shrink-0" style={{ color: meta.color }} />
                          {meta.label}
                        </span>
                      );
                    })}
                    {group.categories.length > 5 && (
                      <span className="px-2 py-0.5 rounded-input typo-caption bg-background/70 backdrop-blur-sm text-foreground">
                        +{group.categories.length - 5}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* Expanded role content */}
        {roleGroup && (
          <>
            {/* Role description + category navigation */}
            <div className="rounded-modal border border-primary/10 bg-secondary/10 p-5">
              <h3 className="typo-body-lg font-semibold text-foreground mb-1">
                {t.templates.explore.role_templates.replace('{role}', roleGroup.label)}
              </h3>
              <p className="typo-body text-foreground mb-3">
                {t.templates.explore.categories_for_role
                  .replace('{count}', String(roleGroup.categories.length))
                  .replace('{role}', roleGroup.label.toLowerCase())}
              </p>
              <div className="flex flex-wrap gap-2">
                {roleGroup.categories.map((cat) => {
                  const meta = getCategoryMeta(cat);
                  return (
                    <button
                      key={cat}
                      onClick={(e) => { e.stopPropagation(); onSelectCategory(cat); }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-card typo-body bg-secondary/40 border border-primary/10 text-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
                    >
                      <meta.icon className="w-3.5 h-3.5" style={{ color: meta.color }} />
                      {meta.label}
                      <ArrowRight className="w-3 h-3 opacity-40" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Templates grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Top templates for role */}
              <div className="lg:col-span-2 space-y-3">
                <h3 className="typo-heading font-semibold text-foreground">
                  {t.templates.explore.popular_in.replace('{role}', roleGroup.label)}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {roleTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => onSelectTemplate(tmpl)}
                      className="text-left p-4 rounded-modal border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all group/card min-h-[140px] flex flex-col"
                    >
                      <div className="typo-body font-medium mb-1.5 template-name-themed">
                        {tmpl.test_case_name}
                      </div>
                      <p className="typo-body text-foreground line-clamp-4 flex-1">{tmpl.instruction}</p>
                      {tmpl.adoption_count > 0 && (
                        <div className="flex items-center gap-1 mt-2 typo-body text-emerald-400/60">
                          <Download className="w-3 h-3" />
                          {(tmpl.adoption_count === 1
                            ? t.templates.explore.adoption_count_one
                            : t.templates.explore.adoption_count_other
                          ).replace('{count}', String(tmpl.adoption_count))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick-start ready templates */}
              <div className="space-y-3">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400/70" />
                  <h3 className="typo-heading font-semibold text-foreground">{t.templates.explore.ready_to_deploy}</h3>
                </div>
                {roleReadyTemplates.length > 0 ? (
                  <div className="space-y-3">
                    {roleReadyTemplates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => onSelectTemplate(tmpl)}
                        className="w-full text-left p-4 rounded-modal border border-emerald-500/15 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors min-h-[140px] flex flex-col"
                      >
                        <div className="typo-body font-medium mb-1.5 template-name-themed">{tmpl.test_case_name}</div>
                        <p className="typo-body text-foreground line-clamp-4 flex-1">{tmpl.instruction}</p>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-modal border border-primary/10 bg-secondary/5 typo-body text-foreground text-center">
                    {t.templates.explore.configure_to_unlock}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
