/**
 * Explore Variant B: "Need-based Discovery"
 *
 * Design philosophy: Users describe what they need to accomplish, and the
 * view surfaces templates matching that intent. Combines a prominent search
 * prompt with curated "use case lanes" organized by business outcome.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────┐
 * │  "What do you want to automate?" — hero prompt      │
 * ├─────────────────────────────────────────────────────┤
 * │  Use case lanes (horizontal scrolling cards)        │
 * │  ├── Monitoring & Alerts                            │
 * │  ├── Content & Communication                        │
 * │  ├── Data Processing & Analysis                     │
 * │  └── Security & Compliance                          │
 * ├─────────────────────────────────────────────────────┤
 * │  "Most adopted" grid (social proof)                 │
 * └─────────────────────────────────────────────────────┘
 */
import { useMemo } from 'react';
import { Search, TrendingUp, Download, Zap, MessageSquare, Database, Shield, BarChart3, Bell, GitBranch, type LucideIcon } from 'lucide-react';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { useTranslation } from '@/i18n/useTranslation';
import { useIsDarkTheme } from '@/stores/themeStore';

interface Props {
  availableCategories: CategoryWithCount[];
  allItems: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  userServiceTypes: string[];
  onSelectCategory: (category: string) => void;
  onSelectTemplate: (template: PersonaDesignReview) => void;
  onSearchFocus?: () => void;
}

interface UseCaseLane {
  title: string;
  icon: LucideIcon;
  color: string;
  categories: string[];
  /** Maps to a role illustration for the lane header */
  illustrationKey: string;
}

const USE_CASE_LANES: UseCaseLane[] = [
  { title: 'Monitoring & Alerts',    icon: Bell,          color: '#f59e0b', categories: ['monitoring', 'alerting', 'observability', 'health-check'], illustrationKey: 'operations' },
  { title: 'Content & Communication', icon: MessageSquare, color: '#3b82f6', categories: ['content', 'social-media', 'email', 'copywriting', 'communication'], illustrationKey: 'content' },
  { title: 'Data Processing',        icon: Database,      color: '#8b5cf6', categories: ['data-pipeline', 'etl', 'analytics', 'reporting', 'data-processing'], illustrationKey: 'data' },
  { title: 'Security & Compliance',  icon: Shield,        color: '#ef4444', categories: ['security', 'compliance', 'audit', 'vulnerability'], illustrationKey: 'operations' },
  { title: 'DevOps & Automation',    icon: GitBranch,     color: '#10b981', categories: ['devops', 'ci-cd', 'deployment', 'infrastructure'], illustrationKey: 'software' },
  { title: 'Business Intelligence',  icon: BarChart3,     color: '#06b6d4', categories: ['bi', 'dashboard', 'kpi', 'forecasting'], illustrationKey: 'business' },
];

/** Illustration paths keyed by role */
const LANE_ILLUSTRATIONS: Record<string, { dark: string; light: string }> = {
  software:   { dark: '/illustrations/explore/software-dark.png',   light: '/illustrations/explore/software-light.png' },
  operations: { dark: '/illustrations/explore/operations-dark.png', light: '/illustrations/explore/operations-light.png' },
  business:   { dark: '/illustrations/explore/business-dark.png',   light: '/illustrations/explore/business-light.png' },
  content:    { dark: '/illustrations/explore/content-dark.png',    light: '/illustrations/explore/content-light.png' },
  customer:   { dark: '/illustrations/explore/customer-dark.png',   light: '/illustrations/explore/customer-light.png' },
  data:       { dark: '/illustrations/explore/data-dark.png',       light: '/illustrations/explore/data-light.png' },
};

function TemplateMiniCard({ template, onClick }: { template: PersonaDesignReview; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-64 p-4 rounded-xl border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all text-left group/card"
    >
      <div className="text-sm font-medium text-foreground/85 truncate group-hover/card:text-foreground transition-colors">
        {template.test_case_name}
      </div>
      <p className="text-sm text-muted-foreground/60 line-clamp-2 mt-1.5 leading-relaxed">{template.instruction}</p>
      {template.adoption_count > 0 && (
        <div className="flex items-center gap-1 mt-2.5 text-sm text-emerald-400/60">
          <Download className="w-3 h-3" /> {template.adoption_count}
        </div>
      )}
    </button>
  );
}

export function ExploreVariantB({
  allItems,
  onSelectCategory,
  onSelectTemplate,
  onSearchFocus,
}: Props) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();

  // Build lane data: templates per use case lane
  const laneData = useMemo(() => {
    return USE_CASE_LANES.map((lane) => {
      const cats = new Set(lane.categories);
      const templates = allItems
        .filter((item) => item.category && cats.has(item.category))
        .sort((a, b) => b.adoption_count - a.adoption_count)
        .slice(0, 8);
      return { ...lane, templates };
    }).filter((lane) => lane.templates.length > 0);
  }, [allItems]);

  // Most adopted across all templates
  const mostAdopted = useMemo(() => {
    return [...allItems]
      .filter((item) => item.adoption_count > 0)
      .sort((a, b) => b.adoption_count - a.adoption_count)
      .slice(0, 8);
  }, [allItems]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero prompt */}
      <div className="px-6 pt-8 pb-6 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">{t.templates.explore.hero_title}</h2>
        <p className="text-sm text-muted-foreground/60 mb-5 max-w-md mx-auto">
          {t.templates.explore.hero_subtitle}
        </p>
        <button
          onClick={onSearchFocus}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl border border-primary/15 bg-secondary/20 text-muted-foreground/50 hover:bg-secondary/30 hover:border-primary/25 transition-all max-w-md w-full justify-center"
        >
          <Search className="w-4 h-4" />
          <span className="text-sm">{t.templates.explore.hero_search_placeholder}</span>
        </button>
      </div>

      <div className="px-6 space-y-8 pb-8">
        {/* Use case lanes */}
        {laneData.map((lane) => {
          const Icon = lane.icon;
          const illustration = LANE_ILLUSTRATIONS[lane.illustrationKey];
          const imgSrc = illustration
            ? (isDark ? illustration.dark : illustration.light)
            : undefined;

          return (
            <div key={lane.title}>
              {/* Lane header with illustration accent */}
              <div className="relative overflow-hidden rounded-xl mb-3">
                {imgSrc && (
                  <div className="absolute inset-0 overflow-hidden rounded-xl">
                    <img
                      src={imgSrc}
                      alt=""
                      className="w-full h-full object-cover opacity-15"
                    />
                    <div className="absolute inset-0 bg-gradient-to-r from-background via-background/80 to-background/40" />
                  </div>
                )}
                <div className="relative flex items-center gap-2.5 px-4 py-3">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center border"
                    style={{ backgroundColor: `${lane.color}15`, borderColor: `${lane.color}25` }}
                  >
                    <Icon className="w-4.5 h-4.5" style={{ color: lane.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground/90">{lane.title}</h3>
                    <span className="text-xs text-muted-foreground/40">
                      {(lane.templates.length === 1
                        ? t.templates.explore.templates_count_one
                        : t.templates.explore.templates_count_other
                      ).replace('{count}', String(lane.templates.length))}
                    </span>
                  </div>
                  {lane.categories[0] && (
                    <button
                      onClick={() => onSelectCategory(lane.categories[0]!)}
                      className="text-sm text-primary/60 hover:text-primary transition-colors font-medium"
                    >
                      {t.templates.explore.view_all}
                    </button>
                  )}
                </div>
              </div>

              {/* Template cards */}
              <div className="flex gap-3 overflow-x-auto pb-2">
                {lane.templates.map((tmpl) => (
                  <TemplateMiniCard key={tmpl.id} template={tmpl} onClick={() => onSelectTemplate(tmpl)} />
                ))}
              </div>
            </div>
          );
        })}

        {/* Most adopted — social proof */}
        {mostAdopted.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-emerald-400/70" />
              <h3 className="text-sm font-semibold text-foreground/80">{t.templates.explore.most_adopted}</h3>
              <Zap className="w-3 h-3 text-amber-400/50" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {mostAdopted.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => onSelectTemplate(tmpl)}
                  className="text-left p-4 rounded-xl border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all group/card"
                >
                  <div className="text-sm font-medium text-foreground/85 truncate group-hover/card:text-foreground transition-colors">
                    {tmpl.test_case_name}
                  </div>
                  <p className="text-sm text-muted-foreground/60 line-clamp-2 mt-1.5 leading-relaxed">{tmpl.instruction}</p>
                  <div className="flex items-center gap-1 mt-2.5 text-sm text-emerald-400/70 font-medium">
                    <Download className="w-3 h-3" />
                    {(tmpl.adoption_count === 1
                      ? t.templates.explore.adoption_count_one
                      : t.templates.explore.adoption_count_other
                    ).replace('{count}', String(tmpl.adoption_count))}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
