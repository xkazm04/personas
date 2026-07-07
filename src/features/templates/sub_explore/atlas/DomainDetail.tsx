/**
 * Explore — shared domain detail: illustrated header + back + cluster map.
 * Used by the Illustrated-Tiles and Bento-Mosaic variants so drilling in feels
 * identical regardless of how the domain was picked. PROTOTYPE: hardcoded English.
 */
import { ChevronLeft } from 'lucide-react';
import { domainById } from '../exploreDomains';
import type { ExploreItem } from '../useExploreCatalog';
import { AtlasClusterMap } from './AtlasClusterMap';

interface Props {
  domainId: string;
  items: ExploreItem[];
  count: number;
  onBack: () => void;
  onSelect?: (i: ExploreItem) => void;
}

export function DomainDetail({ domainId, items, count, onBack, onSelect }: Props) {
  const d = domainById(domainId)!;
  return (
    <div className="space-y-5">
      <button onClick={onBack} className="inline-flex items-center gap-1.5 typo-body text-foreground opacity-70 hover:opacity-100">
        <ChevronLeft className="w-4 h-4" /> All domains
      </button>
      <div className="relative rounded-modal border border-primary/10 overflow-hidden p-5 flex items-center" style={{ minHeight: 96 }}>
        <img src={d.illustration} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" />
        <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, var(--background) 30%, ${d.color}22)` }} />
        <div className="relative">
          <div className="typo-heading-lg font-semibold text-foreground">{d.label}</div>
          <div className="typo-caption text-foreground opacity-80">{count} templates · {d.blurb}</div>
        </div>
      </div>
      <AtlasClusterMap items={items} accent={d.color} onSelect={onSelect} />
    </div>
  );
}
