import { motion } from 'framer-motion';
import { memo, useState, useMemo } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { SIDEBAR_ICONS } from '@/features/shared/components/layout/sidebar/SidebarIcons';
import { useTier } from '@/hooks/utility/interaction/useTier';
import { useMotion } from '@/hooks/utility/interaction/useMotion';
import { SIMPLE_SECTIONS, DEV_MODE_SECTIONS } from '@/lib/utils/platform/platform';
import { prefetchNavTarget } from '../lib/prefetch';

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
const NavCardWrapper = memo(function NavCardWrapper({ card, i, cardT, onCardClick }: { card: NavCard; i: number; cardT: { label: string; description: string }; onCardClick: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const CustomIcon = SIDEBAR_ICONS[card.id];
  const { shouldAnimate, staggerDelay } = useMotion();

  return (
    <motion.button
      key={card.id}
      data-testid={`home-card-${card.id}`}
      initial={shouldAnimate ? { opacity: 0, y: 24 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={shouldAnimate ? { delay: 0.15 + i * staggerDelay, duration: 0.45, ease: [0.22, 1, 0.36, 1] } : { duration: 0 }}
      whileHover={shouldAnimate ? { y: -3, transition: { duration: 0.2, ease: 'easeOut' } } : {}}
      onClick={() => onCardClick(card.id)}
      onMouseEnter={() => setHovered(true)}
      onPointerEnter={() => prefetchNavTarget(card.id)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      className={`group relative text-left cursor-pointer h-[224px] flex flex-col rounded-modal outline-none focus-visible:ring-2 focus-visible:ring-offset-4 focus-visible:ring-offset-background focus-visible:ring-current ${card.iconText}`}
    >
      {/* Illustration area -- fixed height */}
      <div className={`relative w-full h-[140px] flex-shrink-0 rounded-modal border overflow-hidden bg-gradient-to-br ${card.gradFrom} ${card.gradTo} ${card.accentBorder} shadow-elevation-1 group-hover:shadow-elevation-3 transition-all duration-400`}>
        {/* Glow blob */}
        <div className={`absolute inset-0 ${card.glowColor} blur-3xl rounded-full opacity-0 group-hover:opacity-40 transition-opacity duration-500 pointer-events-none scale-75`} />

        {/* Large centered custom icon */}
        {CustomIcon && (
          <div className={`absolute inset-0 flex items-center justify-center ${card.iconText} transition-all duration-500 pointer-events-none ${hovered ? 'opacity-100 scale-110' : 'opacity-90 scale-100'}`}>
            <CustomIcon active={hovered} className="w-20 h-20" />
          </div>
        )}

        {/* Fallback: lucide icon */}
        {!CustomIcon && (
          <div className={`absolute inset-0 flex items-center justify-center ${card.iconText} transition-all duration-500 pointer-events-none ${hovered ? 'opacity-100' : 'opacity-90'}`}>
            <card.icon className="w-16 h-16" strokeWidth={1} />
          </div>
        )}

        {/* Module name overlaid at bottom of illustration */}
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-2.5 pt-8 bg-gradient-to-t dark:from-black/40 from-transparent to-transparent pointer-events-none z-10">
          <h3 className="typo-heading-lg font-semibold tracking-wide uppercase dark:text-white text-foreground/85 drop-shadow-elevation-1">{cardT.label}</h3>
        </div>

        {/* Arrow overlay */}
        <div className="absolute top-3 right-3 z-10">
          <ArrowRight className={`w-4 h-4 ${card.iconText} opacity-0 group-hover:opacity-80 group-focus-visible:opacity-80 translate-x-[-6px] group-hover:translate-x-0 group-focus-visible:translate-x-0 transition-all duration-300`} />
        </div>

        {/* Bottom gradient line */}
        <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${card.iconText.replace('text-', 'via-')}/30 to-transparent`} />
      </div>

      {/* Description below */}
      <div className="mt-2 px-1 h-[64px] flex items-start">
        <p className="typo-body leading-relaxed dark:text-foreground text-foreground line-clamp-3">{cardT.description}</p>
      </div>
    </motion.button>
  );
});

export default function NavigationGrid({ cards, translations, onCardClick }: NavigationGridProps) {
  const { isStarter: isSimple, isBuilder: isDevMode } = useTier();
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
