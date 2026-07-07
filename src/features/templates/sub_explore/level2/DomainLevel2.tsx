/**
 * Explore level 2 — a domain's templates + recipes as a sub-domain-filtered,
 * sortable table (the chosen direction for volume/orientation). Illustrated
 * header + DomainTable. Level-1 (Bento) is the locked, i18n'd surface; this
 * level's copy is still hardcoded until finalized.
 */
import { ChevronLeft } from 'lucide-react';
import { domainById, domainArt, domainLabel } from '../exploreDomains';
import { useExploreCatalog, recipesForDomain, type ExploreItem, type ExploreRecipe } from '../useExploreCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { DomainTable } from './DomainTable';

interface Props {
  domainId: string;
  onBack: () => void;
  onSelect?: (i: ExploreItem) => void;
  onSelectRecipe?: (r: ExploreRecipe) => void;
}

export function DomainLevel2({ domainId, onBack, onSelect, onSelectRecipe }: Props) {
  const { byDomain, loading } = useExploreCatalog();
  const isDark = useIsDarkTheme();
  const { t } = useTranslation();

  const d = domainById(domainId)!;
  const templates = byDomain[domainId] ?? [];
  const recipes = recipesForDomain(domainId);

  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 typo-body text-foreground opacity-70 hover:opacity-100">
        <ChevronLeft className="w-4 h-4" /> All domains
      </button>

      {/* Illustrated header */}
      <div className="relative rounded-modal border border-primary/10 overflow-hidden p-5 flex items-center" style={{ minHeight: 92 }}>
        <img src={domainArt(d, isDark)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--background) 32%, ${d.color}22)` }} />
        <div className="relative">
          <div className="typo-heading-lg text-foreground">{domainLabel(d, t.explore)}</div>
          <div className="typo-caption text-foreground opacity-80">
            {loading ? 'Loading…' : `${templates.length} templates · ${recipes.length} recipes`}
          </div>
        </div>
      </div>

      <DomainTable templates={templates} recipes={recipes} accent={d.color} onSelect={onSelect} onSelectRecipe={onSelectRecipe} />
    </div>
  );
}
