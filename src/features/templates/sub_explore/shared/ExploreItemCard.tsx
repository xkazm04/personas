/**
 * Explore — shared real-template card used by every Atlas variant.
 * PROTOTYPE: hardcoded English.
 */
import { ArrowRight } from 'lucide-react';
import type { ExploreItem } from '../useExploreCatalog';
import { categoryLabel } from '../exploreDomains';

interface Props {
  item: ExploreItem;
  accent?: string;
  onSelect?: (item: ExploreItem) => void;
  compact?: boolean;
}

export function ExploreItemCard({ item, accent, onSelect, compact }: Props) {
  return (
    <button
      onClick={() => onSelect?.(item)}
      className="group/card text-left w-full rounded-modal border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/25 transition-all p-3.5 flex flex-col gap-1.5"
      style={accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="typo-body font-medium template-name-themed leading-snug">{item.name}</span>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover/card:opacity-50 transition-opacity flex-shrink-0 mt-0.5" />
      </div>
      {!compact && item.blurb && (
        <p className="typo-caption text-foreground opacity-80 line-clamp-2">{item.blurb}</p>
      )}
      <div className="flex items-center gap-2 flex-wrap mt-0.5">
        <span className="typo-caption px-1.5 py-0.5 rounded-input" style={{ color: accent, backgroundColor: accent ? `${accent}18` : undefined }}>
          {categoryLabel(item.category)}
        </span>
        {item.serviceFlow.slice(0, compact ? 0 : 3).map((s) => (
          <span key={s} className="typo-caption text-foreground opacity-55">{s}</span>
        ))}
      </div>
    </button>
  );
}
