import { Download } from 'lucide-react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { getCategoryMeta, type RoleGroup } from '../search/filters/searchConstants';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';

interface RoleGroupCardProps {
  group: RoleGroup;
  categoryCounts: Map<string, number>;
  topTemplates: PersonaDesignReview[];
  onSelectCategory: (category: string) => void;
}

export function RoleGroupCard({ group, categoryCounts, topTemplates, onSelectCategory }: RoleGroupCardProps) {
  const GroupIcon = group.icon;

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-xl p-4 hover:border-primary/20 transition-all">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-3">
        <div className="p-2 rounded-lg bg-violet-500/10 border border-violet-500/15">
          <GroupIcon className="w-4.5 h-4.5 text-violet-300" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground/85">{group.label}</h3>
          <p className="text-sm text-muted-foreground/50">{group.description}</p>
        </div>
      </div>

      {/* Category list */}
      <div className="space-y-1 mb-3">
        {group.categories.map((catName) => {
          const meta = getCategoryMeta(catName);
          const Icon = meta.icon;
          const count = categoryCounts.get(catName) ?? 0;

          return (
            <button
              key={catName}
              onClick={() => onSelectCategory(catName)}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left hover:bg-primary/5 transition-colors group/cat"
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
              <span className="text-sm text-foreground/70 flex-1 group-hover/cat:text-foreground/90 transition-colors">
                {meta.label}
              </span>
              {count > 0 && (
                <span className="text-sm text-muted-foreground/60 tabular-nums">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Top templates preview */}
      {topTemplates.length > 0 && (
        <div className="border-t border-primary/8 pt-2.5">
          <SectionLabel as="div" className="mb-1.5 px-1">Popular</SectionLabel>
          {topTemplates.slice(0, 3).map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-1 py-1 text-sm text-muted-foreground/60">
              <span className="flex-1 truncate">{t.test_case_name}</span>
              {t.adoption_count > 0 && (
                <span className="inline-flex items-center gap-0.5 text-sm text-emerald-400/50 tabular-nums">
                  <Download className="w-2.5 h-2.5" />
                  {t.adoption_count}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
