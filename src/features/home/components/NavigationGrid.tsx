import { motion } from 'framer-motion';
import { useState, useMemo } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { SIDEBAR_ICONS, SidebarIconStyles } from '@/features/shared/components/layout/sidebar/SidebarIcons';
import { useSimpleMode } from '@/hooks/utility/interaction/useSimpleMode';
import { useDevMode } from '@/hooks/utility/interaction/useDevMode';
import { SIMPLE_SECTIONS, DEV_MODE_SECTIONS } from '@/lib/utils/platform/platform';

export interface NavCard {
  id: string;
  icon: LucideIcon;
  color: string;
  gradFrom: string;
  gradTo: string;
  glowColor: string;
  accentBorder: string;
  iconBg: string;
  iconText: string;
}

interface NavigationGridProps {
  cards: NavCard[];
  translations: Record<string, { label: string; description: string }>;
  onCardClick: (id: string) => void;
}

/** Fixed-height card: illustration with label overlay + description below. */
function NavCardWrapper({ card, i, cardT, onCardClick }: { card: NavCard; i: number; cardT: { label: string; description: string }; onCardClick: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const CustomIcon = SIDEBAR_ICONS[card.id];

  return (
    <motion.button
      key={card.id}
      data-testid={`home-card-${card.id}`}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + i * 0.06, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -6, transition: { duration: 0.25 } }}
      onClick={() => onCardClick(card.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group relative text-left cursor-pointer focus-ring h-[200px] flex flex-col"
    >
      {/* Illustration area -- fixed height */}
      <div className={`relative w-full h-[140px] flex-shrink-0 rounded-xl border overflow-hidden bg-gradient-to-br ${card.gradFrom} ${card.gradTo} ${card.accentBorder} shadow-sm group-hover:shadow-xl transition-all duration-400`}>
        {/* Glow blob */}
        <div className={`absolute inset-0 ${card.glowColor} blur-3xl rounded-full opacity-0 group-hover:opacity-40 transition-opacity duration-500 pointer-events-none scale-75`} />

        {/* Large centered custom icon */}
        {CustomIcon && (
          <div className={`absolute inset-0 flex items-center justify-center ${card.iconText} transition-all duration-500 pointer-events-none ${hovered ? 'opacity-60 scale-110' : 'opacity-25 scale-100'}`}>
            <CustomIcon active={hovered} className="w-20 h-20" />
          </div>
        )}

        {/* Fallback: lucide icon */}
        {!CustomIcon && (
          <div className={`absolute inset-0 flex items-center justify-center ${card.iconText} transition-all duration-500 pointer-events-none ${hovered ? 'opacity-50' : 'opacity-20'}`}>
            <card.icon className="w-16 h-16" strokeWidth={1} />
          </div>
        )}

        {/* Module name overlaid at bottom of illustration */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-6 bg-gradient-to-t from-black/40 to-transparent pointer-events-none z-10">
          <h3 className="typo-heading-lg tracking-wide text-foreground/80 uppercase drop-shadow-sm">{cardT.label}</h3>
        </div>

        {/* Arrow overlay */}
        <div className="absolute top-3 right-3 z-10">
          <ArrowRight className={`w-4 h-4 ${card.iconText} opacity-0 group-hover:opacity-80 translate-x-[-6px] group-hover:translate-x-0 transition-all duration-300`} />
        </div>

        {/* Bottom gradient line */}
        <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${card.iconText.replace('text-', 'via-')}/30 to-transparent`} />
      </div>

      {/* Description below -- fixed height */}
      <div className="mt-1.5 px-1 h-[48px] flex items-start">
        <p className="typo-caption leading-relaxed text-muted-foreground/80 line-clamp-3">{cardT.description}</p>
      </div>
    </motion.button>
  );
}

export default function NavigationGrid({ cards, translations, onCardClick }: NavigationGridProps) {
  const isSimple = useSimpleMode();
  const isDevMode = useDevMode();
  const visibleCards = useMemo(
    () => {
      let filtered = cards;
      if (isSimple) filtered = filtered.filter((c) => SIMPLE_SECTIONS.has(c.id));
      if (!isDevMode) filtered = filtered.filter((c) => !DEV_MODE_SECTIONS.has(c.id));
      return filtered;
    },
    [cards, isSimple, isDevMode],
  );

  return (
    <>
      <SidebarIconStyles />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {visibleCards.map((card, i) => {
          const cardT = translations[card.id] || { label: card.id, description: '' };
          return (
            <NavCardWrapper
              key={card.id}
              card={card}
              i={i}
              cardT={cardT}
              onCardClick={onCardClick}
            />
          );
        })}
      </div>
    </>
  );
}
