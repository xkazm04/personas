/**
 * Explore prototype — shared item preview card. Used by every variant so an
 * "item" reads the same regardless of which hierarchy surfaced it.
 * PROTOTYPE: hardcoded English.
 */
import { ArrowRight } from 'lucide-react';
import type { ExploreItem } from '../exploreMockData';
import { ItemMeta } from './exploreBits';

interface Props {
  item: ExploreItem;
  /** Accent color from the surfacing context (industry / function / archetype). */
  accent?: string;
  /** Optional "why this surfaced" line — used by the Task Flow shortlist. */
  reason?: string;
  onSelect?: (item: ExploreItem) => void;
  compact?: boolean;
}

export function ExploreItemCard({ item, accent, reason, onSelect, compact }: Props) {
  return (
    <button
      onClick={() => onSelect?.(item)}
      className="group/card text-left w-full rounded-modal border border-primary/10 bg-secondary/10 hover:bg-secondary/20 hover:border-primary/25 transition-all p-4 flex flex-col gap-2"
      style={accent ? { boxShadow: `inset 3px 0 0 0 ${accent}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="typo-body font-medium template-name-themed">{item.name}</span>
        <ArrowRight className="w-3.5 h-3.5 opacity-0 group-hover/card:opacity-50 transition-opacity flex-shrink-0 mt-0.5" />
      </div>
      {!compact && <p className="typo-body text-foreground line-clamp-2">{item.blurb}</p>}
      {reason && (
        <p className="typo-caption text-foreground" style={{ color: accent }}>
          {reason}
        </p>
      )}
      <ItemMeta item={item} />
    </button>
  );
}
