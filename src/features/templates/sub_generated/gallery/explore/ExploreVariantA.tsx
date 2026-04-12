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
  software:   { dark: '/illustrations/explore/software-dark.png',   light: '/illustrations/explore/software-light.png' },
  operations: { dark: '/illustrations/explore/operations-dark.png', light: '/illustrations/explore/operations-light.png' },
  business:   { dark: '/illustrations/explore/business-dark.png',   light: '/illustrations/explore/business-light.png' },
  content:    { dark: '/illustrations/explore/content-dark.png',    light: '/illustrations/explore/content-light.png' },
  customer:   { dark: '/illustrations/explore/customer-dark.png',   light: '/illustrations/explore/customer-light.png' },
  data:       { dark: '/illustrations/explore/data-dark.png',       light: '/illustrations/explore/data-light.png' },
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
                className={`group relative overflow-hidden rounded-2xl border text-left transition-all duration-200 ${
                  isActive
                    ? 'border-primary/30 ring-2 ring-primary/20 bg-primary/[0.06]'
                    : 'border-primary/10 hover:border-primary/20 hover:bg-secondary/20'
                }`}
              >
                {/* Illustration header */}
                {imgSrc && (
                  <div className="relative h-28 overflow-hidden">
                    <img
                      src={imgSrc}
                      alt=""
                      className="w-full h-full object-cover opacity-60 group-hover:opacity-80 transition-opacity duration-300"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
                  </div>
                )}

                {/* Card body */}
                <div className={`px-4 pb-4 ${imgSrc ? '-mt-6 relative' : 'pt-4'}`}>
                  <div className="flex items-center gap-2.5 mb-2">
                    <div className={`p-2 rounded-xl border transition-colors ${
                      isActive
                        ? 'bg-primary/15 border-primary/25'
                        : 'bg-secondary/30 border-primary/10 group-hover:bg-secondary/50'
                    }`}>
                      <GroupIcon className="w-5 h-5 text-primary/80" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">{group.label}</h3>
                      <p className="text-xs text-muted-foreground/60 truncate">{group.description}</p>
                    </div>
                  </div>

                  {/* Category pills */}
                  <div className="flex flex-wrap gap-1.5">
                    {group.categories.slice(0, 4).map((cat) => {
                      const meta = getCategoryMeta(cat);
                      return (
                        <span
                          key={cat}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-secondary/30 text-muted-foreground/60"
                        >
                          <meta.icon className="w-3 h-3 flex-shrink-0" style={{ color: meta.color }} />
                          {meta.label}
                        </span>
                      );
                    })}
                    {group.categories.length > 4 && (
                      <span className="px-2 py-0.5 rounded-md text-xs text-muted-foreground/40">
                        +{group.categories.length - 4}
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
            <div className="rounded-xl border border-primary/10 bg-secondary/10 p-5">
              <h3 className="text-base font-semibold text-foreground mb-1">
                {t.templates.explore.role_templates.replace('{role}', roleGroup.label)}
              </h3>
              <p className="text-sm text-muted-foreground/70 mb-3">
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
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-secondary/40 border border-primary/10 text-foreground/70 hover:bg-secondary/60 hover:text-foreground transition-colors"
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
                <h3 className="text-sm font-semibold text-foreground/80">
                  {t.templates.explore.popular_in.replace('{role}', roleGroup.label)}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {roleTemplates.map((tmpl) => (
                    <button
                      key={tmpl.id}
                      onClick={() => onSelectTemplate(tmpl)}
                      className="text-left p-4 rounded-xl border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all group/card"
                    >
                      <div className="text-sm font-medium text-foreground/85 mb-1 group-hover/card:text-foreground transition-colors">
                        {tmpl.test_case_name}
                      </div>
                      <p className="text-sm text-muted-foreground/60 line-clamp-2">{tmpl.instruction}</p>
                      {tmpl.adoption_count > 0 && (
                        <div className="flex items-center gap-1 mt-2 text-sm text-emerald-400/60">
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
                  <h3 className="text-sm font-semibold text-foreground/80">{t.templates.explore.ready_to_deploy}</h3>
                </div>
                {roleReadyTemplates.length > 0 ? (
                  <div className="space-y-2">
                    {roleReadyTemplates.map((tmpl) => (
                      <button
                        key={tmpl.id}
                        onClick={() => onSelectTemplate(tmpl)}
                        className="w-full text-left p-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
                      >
                        <div className="text-sm font-medium text-foreground/85">{tmpl.test_case_name}</div>
                        <div className="text-sm text-muted-foreground/60 truncate mt-0.5">
                          {(tmpl.instruction ?? '').slice(0, 60)}
                        </div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-primary/10 bg-secondary/5 text-sm text-muted-foreground/50 text-center">
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
