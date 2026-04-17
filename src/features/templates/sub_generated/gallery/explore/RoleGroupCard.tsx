import { Download } from 'lucide-react';
import type { PersonaDesignReview } from '@/lib/bindings/PersonaDesignReview';
import { getCategoryMeta, type RoleGroup } from '../search/filters/searchConstants';
import { SectionLabel } from '@/features/shared/components/display/SectionLabel';
import { useTranslation } from '@/i18n/useTranslation';
import { useIsDarkTheme } from '@/stores/themeStore';

/** Illustration paths keyed by role */
const ROLE_ILLUSTRATIONS: Record<string, { dark: string; light: string }> = {
  software:   { dark: '/illustrations/explore/software-dark.png',   light: '/illustrations/explore/software-light.png' },
  operations: { dark: '/illustrations/explore/operations-dark.png', light: '/illustrations/explore/operations-light.png' },
  business:   { dark: '/illustrations/explore/business-dark.png',   light: '/illustrations/explore/business-light.png' },
  content:    { dark: '/illustrations/explore/content-dark.png',    light: '/illustrations/explore/content-light.png' },
  customer:   { dark: '/illustrations/explore/customer-dark.png',   light: '/illustrations/explore/customer-light.png' },
  data:       { dark: '/illustrations/explore/data-dark.png',       light: '/illustrations/explore/data-light.png' },
};

interface RoleGroupCardProps {
  group: RoleGroup;
  categoryCounts: Map<string, number>;
  topTemplates: PersonaDesignReview[];
  onSelectCategory: (category: string) => void;
  onSelectTemplate?: (template: PersonaDesignReview) => void;
}

export function RoleGroupCard({ group, categoryCounts, topTemplates, onSelectCategory, onSelectTemplate }: RoleGroupCardProps) {
  const { t } = useTranslation();
  const isDark = useIsDarkTheme();
  const GroupIcon = group.icon;
  const illustration = ROLE_ILLUSTRATIONS[group.role];
  const imgSrc = illustration ? (isDark ? illustration.dark : illustration.light) : undefined;

  return (
    <div className="bg-secondary/20 border border-primary/10 rounded-2xl overflow-hidden hover:border-primary/20 transition-all">
      {/* Illustration header */}
      {imgSrc && (
        <div className="relative h-24 overflow-hidden">
          <img
            src={imgSrc}
            alt=""
            className="w-full h-full object-cover opacity-50"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        </div>
      )}

      <div className={`p-4 ${imgSrc ? '-mt-4 relative' : ''}`}>
        {/* Header */}
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-2 rounded-modal bg-primary/10 border border-primary/15">
            <GroupIcon className="w-4.5 h-4.5 text-primary/80" />
          </div>
          <div>
            <h3 className="typo-heading font-semibold text-foreground/85">{group.label}</h3>
            <p className="typo-caption text-foreground">{group.description}</p>
          </div>
        </div>

        {/* Category list */}
        <div className="space-y-1 mb-3">
          {group.categories.map((catName) => {
            const meta = getCategoryMeta(catName);
            const CatIcon = meta.icon;
            const count = categoryCounts.get(catName) ?? 0;

            return (
              <button
                key={catName}
                onClick={() => onSelectCategory(catName)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-card text-left hover:bg-primary/5 transition-colors group/cat"
              >
                <CatIcon className="w-3.5 h-3.5 flex-shrink-0" style={{ color: meta.color }} />
                <span className="typo-body text-foreground flex-1 group-hover/cat:text-foreground/90 transition-colors">
                  {meta.label}
                </span>
                {count > 0 && (
                  <span className="typo-data text-foreground tabular-nums">{count}</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Top templates preview */}
        {topTemplates.length > 0 && (
          <div className="border-t border-primary/8 pt-2.5">
            <SectionLabel as="div" className="mb-1.5 px-1">{t.templates.gallery.popular}</SectionLabel>
            {topTemplates.slice(0, 3).map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => onSelectTemplate?.(tmpl)}
                className="w-full flex items-center gap-2 px-1 py-1 typo-body text-foreground rounded-input hover:bg-primary/5 hover:text-foreground/80 transition-colors text-left"
              >
                <span className="flex-1 truncate">{tmpl.test_case_name}</span>
                {tmpl.adoption_count > 0 && (
                  <span className="inline-flex items-center gap-0.5 typo-data text-emerald-400/50 tabular-nums">
                    <Download className="w-2.5 h-2.5" />
                    {tmpl.adoption_count}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
