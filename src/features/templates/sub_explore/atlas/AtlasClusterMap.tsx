/**
 * Explore — shared "cluster map" for a single domain: its real templates grouped
 * into sub-domain (category) columns, node opacity scaled by capability weight.
 * Reused by the Illustrated-Tiles (drill-down) and Split-Explorer variants.
 * PROTOTYPE: hardcoded English.
 */
import { clustersFor, type ExploreItem } from '../useExploreCatalog';
import { categoryLabel } from '../exploreDomains';
import { ExploreItemCard } from '../shared/ExploreItemCard';

interface Props {
  items: ExploreItem[];
  accent: string;
  onSelect?: (i: ExploreItem) => void;
}

export function AtlasClusterMap({ items, accent, onSelect }: Props) {
  const clusters = clustersFor(items);

  if (items.length === 0) {
    return <div className="typo-body text-foreground opacity-60 py-8 text-center">No templates in this domain yet.</div>;
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-3">
      {clusters.map(({ category, items: list }) => (
        <div key={category} className="flex-shrink-0 w-72 space-y-2">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: accent }} />
            <span className="typo-body font-medium text-foreground">{categoryLabel(category)}</span>
            <span className="typo-caption text-foreground opacity-60">{list.length}</span>
          </div>
          <div className="space-y-2">
            {list.map((item) => (
              <div key={item.id} style={{ opacity: 0.65 + 0.35 * item.weight }}>
                <ExploreItemCard item={item} accent={accent} onSelect={onSelect} compact={item.weight < 0.4} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
