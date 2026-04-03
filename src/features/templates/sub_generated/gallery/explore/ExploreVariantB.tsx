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
import { Search, TrendingUp, Download, Zap, MessageSquare, Database, Shield, BarChart3, Bell, GitBranch } from 'lucide-react';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';

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
  icon: React.ElementType;
  color: string;
  categories: string[];
}

const USE_CASE_LANES: UseCaseLane[] = [
  { title: 'Monitoring & Alerts', icon: Bell, color: '#f59e0b', categories: ['monitoring', 'alerting', 'observability', 'health-check'] },
  { title: 'Content & Communication', icon: MessageSquare, color: '#3b82f6', categories: ['content', 'social-media', 'email', 'copywriting', 'communication'] },
  { title: 'Data Processing', icon: Database, color: '#8b5cf6', categories: ['data-pipeline', 'etl', 'analytics', 'reporting', 'data-processing'] },
  { title: 'Security & Compliance', icon: Shield, color: '#ef4444', categories: ['security', 'compliance', 'audit', 'vulnerability'] },
  { title: 'DevOps & Automation', icon: GitBranch, color: '#10b981', categories: ['devops', 'ci-cd', 'deployment', 'infrastructure'] },
  { title: 'Business Intelligence', icon: BarChart3, color: '#06b6d4', categories: ['bi', 'dashboard', 'kpi', 'forecasting'] },
];

function TemplateMiniCard({ template, onClick }: { template: PersonaDesignReview; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-shrink-0 w-56 p-3.5 rounded-xl border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all text-left"
    >
      <div className="text-sm font-medium text-foreground/85 truncate">{template.test_case_name}</div>
      <p className="text-sm text-muted-foreground/60 line-clamp-2 mt-1">{template.instruction}</p>
      {template.adoption_count > 0 && (
        <div className="flex items-center gap-1 mt-2 text-sm text-emerald-400/60">
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
  // Build lane data: templates per use case lane
  const laneData = useMemo(() => {
    return USE_CASE_LANES.map((lane) => {
      const cats = new Set(lane.categories);
      const templates = allItems
        .filter((t) => t.category && cats.has(t.category))
        .sort((a, b) => b.adoption_count - a.adoption_count)
        .slice(0, 8);
      return { ...lane, templates };
    }).filter((lane) => lane.templates.length > 0);
  }, [allItems]);

  // Most adopted across all templates
  const mostAdopted = useMemo(() => {
    return [...allItems]
      .filter((t) => t.adoption_count > 0)
      .sort((a, b) => b.adoption_count - a.adoption_count)
      .slice(0, 8);
  }, [allItems]);

  return (
    <div className="flex-1 overflow-y-auto">
      {/* Hero prompt */}
      <div className="px-6 pt-8 pb-6 text-center">
        <h2 className="text-2xl font-bold text-foreground mb-2">What do you want to automate?</h2>
        <p className="text-sm text-muted-foreground/60 mb-5 max-w-md mx-auto">
          Browse by use case or search for templates that match your workflow needs.
        </p>
        <button
          onClick={onSearchFocus}
          className="inline-flex items-center gap-2 px-5 py-3 rounded-2xl border border-primary/15 bg-secondary/20 text-muted-foreground/50 hover:bg-secondary/30 hover:border-primary/25 transition-all max-w-md w-full justify-center"
        >
          <Search className="w-4 h-4" />
          <span className="text-sm">Search templates by keyword or describe your need...</span>
        </button>
      </div>

      <div className="px-6 space-y-8 pb-8">
        {/* Use case lanes */}
        {laneData.map((lane) => {
          const Icon = lane.icon;
          return (
            <div key={lane.title}>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${lane.color}15` }}>
                  <Icon className="w-4 h-4" style={{ color: lane.color }} />
                </div>
                <h3 className="text-sm font-semibold text-foreground/80">{lane.title}</h3>
                <span className="text-sm text-muted-foreground/40">{lane.templates.length} templates</span>
                {lane.categories[0] && (
                  <button
                    onClick={() => onSelectCategory(lane.categories[0]!)}
                    className="ml-auto text-sm text-primary/60 hover:text-primary transition-colors"
                  >
                    View all
                  </button>
                )}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {lane.templates.map((t) => (
                  <TemplateMiniCard key={t.id} template={t} onClick={() => onSelectTemplate(t)} />
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
              <h3 className="text-sm font-semibold text-foreground/80">Most Adopted</h3>
              <Zap className="w-3 h-3 text-amber-400/50" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {mostAdopted.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelectTemplate(t)}
                  className="text-left p-3.5 rounded-xl border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all"
                >
                  <div className="text-sm font-medium text-foreground/85 truncate">{t.test_case_name}</div>
                  <p className="text-sm text-muted-foreground/60 line-clamp-2 mt-1">{t.instruction}</p>
                  <div className="flex items-center gap-1 mt-2 text-sm text-emerald-400/70 font-medium">
                    <Download className="w-3 h-3" /> {t.adoption_count} adoption{t.adoption_count !== 1 ? 's' : ''}
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
