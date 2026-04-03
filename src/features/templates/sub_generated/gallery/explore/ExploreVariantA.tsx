/**
 * Explore Variant A: "Role-first Discovery"
 *
 * Design philosophy: Users first identify their role/department, then see
 * templates ranked by relevance to that role. Uses a prominent role selector
 * at the top with a detail panel below showing curated templates.
 *
 * Layout:
 * ┌─────────────────────────────────────────────────────┐
 * │  "What's your role?" — horizontal role pills        │
 * ├─────────────────────────────────────────────────────┤
 * │  Role description + key benefits                    │
 * ├──────────────────────────┬──────────────────────────┤
 * │  Top templates for role  │  Quick-start templates   │
 * │  (card grid)             │  (ready to deploy)       │
 * └──────────────────────────┴──────────────────────────┘
 */
import { useState, useMemo } from 'react';
import { CheckCircle2, Download, ArrowRight, Users, Code, BarChart3, Shield, Megaphone, Wrench, Briefcase } from 'lucide-react';
import type { CategoryWithCount } from '@/api/overview/reviews';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { CATEGORY_ROLE_GROUPS } from '../search/filters/searchConstants';

interface Props {
  availableCategories: CategoryWithCount[];
  allItems: PersonaDesignReview[];
  readyTemplates: PersonaDesignReview[];
  userServiceTypes: string[];
  onSelectCategory: (category: string) => void;
  onSelectTemplate: (template: PersonaDesignReview) => void;
}

const ROLE_ICONS: Record<string, React.ElementType> = {
  'Engineering': Code,
  'Data & Analytics': BarChart3,
  'Security & Compliance': Shield,
  'Marketing & Content': Megaphone,
  'Operations & Support': Wrench,
  'Management': Briefcase,
};

export function ExploreVariantA({
  allItems,
  readyTemplates,
  onSelectCategory,
  onSelectTemplate,
}: Props) {
  const [selectedRole, setSelectedRole] = useState(CATEGORY_ROLE_GROUPS[0]?.role ?? '');

  const roleGroup = CATEGORY_ROLE_GROUPS.find((g) => g.role === selectedRole);

  const roleTemplates = useMemo(() => {
    if (!roleGroup) return [];
    const cats = new Set(roleGroup.categories);
    return allItems
      .filter((t) => t.category && cats.has(t.category))
      .sort((a, b) => b.adoption_count - a.adoption_count)
      .slice(0, 9);
  }, [allItems, roleGroup]);

  const roleReadyTemplates = useMemo(() => {
    if (!roleGroup) return [];
    const cats = new Set(roleGroup.categories);
    return readyTemplates.filter((t) => t.category && cats.has(t.category)).slice(0, 4);
  }, [readyTemplates, roleGroup]);

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Role selector */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-5 h-5 text-primary/60" />
            <h2 className="text-lg font-semibold text-foreground">What&apos;s your role?</h2>
          </div>
          <div className="flex flex-wrap gap-2">
            {CATEGORY_ROLE_GROUPS.map((group) => {
              const isActive = selectedRole === group.role;
              const Icon = ROLE_ICONS[group.role] ?? Briefcase;
              return (
                <button
                  key={group.role}
                  onClick={() => setSelectedRole(group.role)}
                  className={`flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-primary/10 border-primary/30 text-foreground ring-1 ring-primary/20'
                      : 'border-primary/10 text-muted-foreground/70 hover:border-primary/20 hover:bg-secondary/30'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {group.role}
                </button>
              );
            })}
          </div>
        </div>

        {/* Role description */}
        {roleGroup && (
          <div className="rounded-xl border border-primary/10 bg-secondary/10 p-5">
            <h3 className="text-base font-semibold text-foreground mb-1">{roleGroup.role} Templates</h3>
            <p className="text-sm text-muted-foreground/70 mb-3">
              {roleGroup.categories.length} categories with specialized agent templates for {roleGroup.role.toLowerCase()} workflows.
            </p>
            <div className="flex flex-wrap gap-2">
              {roleGroup.categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => onSelectCategory(cat)}
                  className="px-3 py-1 rounded-lg text-sm bg-secondary/40 border border-primary/10 text-foreground/70 hover:bg-secondary/60 hover:text-foreground transition-colors"
                >
                  {cat}
                  <ArrowRight className="w-3 h-3 inline ml-1 opacity-50" />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Top templates for role */}
          <div className="lg:col-span-2 space-y-3">
            <h3 className="text-sm font-semibold text-foreground/80">Popular in {selectedRole}</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {roleTemplates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onSelectTemplate(t)}
                  className="text-left p-4 rounded-xl border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/20 transition-all"
                >
                  <div className="text-sm font-medium text-foreground/85 mb-1">{t.test_case_name}</div>
                  <p className="text-sm text-muted-foreground/60 line-clamp-2">{t.instruction}</p>
                  {t.adoption_count > 0 && (
                    <div className="flex items-center gap-1 mt-2 text-sm text-emerald-400/60">
                      <Download className="w-3 h-3" /> {t.adoption_count} adoptions
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
              <h3 className="text-sm font-semibold text-foreground/80">Ready to Deploy</h3>
            </div>
            {roleReadyTemplates.length > 0 ? (
              <div className="space-y-2">
                {roleReadyTemplates.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => onSelectTemplate(t)}
                    className="w-full text-left p-3 rounded-xl border border-emerald-500/15 bg-emerald-500/5 hover:bg-emerald-500/10 transition-colors"
                  >
                    <div className="text-sm font-medium text-foreground/85">{t.test_case_name}</div>
                    <div className="text-sm text-muted-foreground/60 truncate mt-0.5">{t.instruction.slice(0, 60)}</div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 rounded-xl border border-primary/10 bg-secondary/5 text-sm text-muted-foreground/50 text-center">
                Configure connectors to unlock ready-to-deploy templates
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
