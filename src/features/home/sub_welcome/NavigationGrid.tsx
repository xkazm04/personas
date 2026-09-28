import { memo, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ContextCard, ContextCards, type Tone } from '@/features/shared/components/kit';
import { SIDEBAR_ICONS } from '@/features/shared/chrome/sidebar/SidebarIcons';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { SIMPLE_SECTIONS, DEV_MODE_SECTIONS } from '@/lib/utils/platform/platform';
import { prefetchNavTarget } from '../lib/prefetch';
import NavStatChips from './NavStatChips';
import type { NavStatChip } from './lib/useNavCardStatus';

/** A module the Welcome surface links to. `tone` colours its illustration by what the module is. */
export interface NavCard {
  id: string;
  icon: LucideIcon;
  tone: Tone;
}

interface NavigationGridProps {
  cards: NavCard[];
  translations: Record<string, { label: string; description: string }>;
  onCardClick: (id: string) => void;
  /** Live status figures keyed by card id (Overview counts, Agents/Events trends, ...). */
  status?: Record<string, NavStatChip[]>;
  label: string;
}

/**
 * At most four cards a row, never narrower than 190px: eight modules read as two even rows from
 * the default window up and never leave a lone card on a third row.
 */
const GRID_MIN = 'max(190px, calc((100% - 36px) / 4))';

/** One module as a kit card: its name heads the card with its illustration as the card's art, its live figures on the foot. */
const NavTile = memo(function NavTile({ card, label, chips, onCardClick }: {
  card: NavCard;
  label: string;
  chips: NavStatChip[];
  onCardClick: (id: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const Illustration = SIDEBAR_ICONS[card.id];
  const art = Illustration
    ? <Illustration active={hovered} className="w-12 h-12" />
    : <card.icon className="w-10 h-10" strokeWidth={1} />;
  const lead = chips.find((c) => c.tone === 'error');
  return (
    <div
      className="contents"
      onPointerEnter={() => { setHovered(true); prefetchNavTarget(card.id); }}
      onPointerLeave={() => setHovered(false)}
    >
      <ContextCard
        title={<span data-testid={`home-card-${card.id}`}>{label}</span>}
        mark={lead ? { tone: 'error', glyph: 'solid', label: lead.title } : undefined}
        onPress={() => onCardClick(card.id)}
        art={<span className={`k-toned t-${card.tone}`}>{art}</span>}
        figures={chips.length > 0 ? <NavStatChips chips={chips} /> : undefined}
      />
    </div>
  );
});

export default function NavigationGrid({ cards, translations, onCardClick, status, label }: NavigationGridProps) {
  const { isStarter: isSimple, isBuilder: isDevMode } = useTier();
  const visibleCards = useMemo(() => {
    let filtered = cards;
    if (isSimple) filtered = filtered.filter((c) => SIMPLE_SECTIONS.has(c.id));
    if (!isDevMode) filtered = filtered.filter((c) => !DEV_MODE_SECTIONS.has(c.id));
    return filtered;
  }, [cards, isSimple, isDevMode]);

  return (
    <ContextCards label={label} min={GRID_MIN}>
      {visibleCards.map((card) => (
        <NavTile
          key={card.id}
          card={card}
          label={(translations[card.id] ?? { label: card.id }).label}
          chips={status?.[card.id] ?? []}
          onCardClick={onCardClick}
        />
      ))}
    </ContextCards>
  );
}
