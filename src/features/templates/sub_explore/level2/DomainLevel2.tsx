/**
 * Explore level 2 — a domain's templates + recipes. Prototype host: an
 * illustrated header + a switcher between two approaches to the templates/recipes
 * UI (Capability Tree vs Unified Shelf). Level 2 is still being explored, so its
 * copy is hardcoded; level 1 (Bento) is the locked, i18n'd surface.
 */
import { useState } from 'react';
import { ChevronLeft, ListTree, LayoutGrid, FlaskConical } from 'lucide-react';
import { domainById, domainArt, domainLabel } from '../exploreDomains';
import { useExploreCatalog, recipesForDomain, type ExploreItem, type ExploreRecipe } from '../useExploreCatalog';
import { useIsDarkTheme } from '@/stores/themeStore';
import { useTranslation } from '@/i18n/useTranslation';
import { CapabilityTree } from './CapabilityTree';
import { UnifiedShelf } from './UnifiedShelf';

type L2Variant = 'tree' | 'shelf';

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
  const [variant, setVariant] = useState<L2Variant>('tree');

  const d = domainById(domainId)!;
  const templates = byDomain[domainId] ?? [];
  const recipes = recipesForDomain(domainId);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 typo-body text-foreground opacity-70 hover:opacity-100">
          <ChevronLeft className="w-4 h-4" /> All domains
        </button>
        <div className="inline-flex rounded-input border border-primary/10 p-0.5 bg-background/40">
          {([['tree', 'Capability Tree', ListTree], ['shelf', 'Unified Shelf', LayoutGrid]] as const).map(([id, label, Icon]) => (
            <button key={id} onClick={() => setVariant(id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-input typo-caption transition-colors ${variant === id ? 'bg-primary/15 text-primary' : 'text-foreground opacity-70 hover:opacity-100'}`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Illustrated header */}
      <div className="relative rounded-modal border border-primary/10 overflow-hidden p-5 flex items-center" style={{ minHeight: 92 }}>
        <img src={domainArt(d, isDark)} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--background) 32%, ${d.color}22)` }} />
        <div className="relative">
          <div className="typo-heading-lg font-semibold text-foreground">{domainLabel(d, t.explore)}</div>
          <div className="typo-caption text-foreground opacity-80">
            {loading ? 'Loading…' : `${templates.length} templates · ${recipes.length} recipes`}
          </div>
        </div>
      </div>

      <div className="inline-flex items-center gap-2 typo-caption text-foreground opacity-55">
        <FlaskConical className="w-3 h-3" /> Level-2 prototype — comparing two templates/recipes layouts
      </div>

      {variant === 'tree'
        ? <CapabilityTree templates={templates} recipes={recipes} accent={d.color} onSelect={onSelect} onSelectRecipe={onSelectRecipe} />
        : <UnifiedShelf templates={templates} recipes={recipes} accent={d.color} onSelect={onSelect} onSelectRecipe={onSelectRecipe} />}
    </div>
  );
}
