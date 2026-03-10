import { motion } from 'framer-motion';
import { useState } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';
import { SIDEBAR_ICONS, SidebarIconStyles } from '@/features/shared/components/layout/sidebar/SidebarIcons';

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

function AnimatedBorderGlow({ color }: { color: string }) {
  return (
    <div className="absolute inset-0 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none">
      <motion.div
        className={`absolute w-24 h-24 ${color} blur-2xl rounded-full`}
        animate={{
          x: ['-10%', '110%', '110%', '-10%', '-10%'],
          y: ['-10%', '-10%', '110%', '110%', '-10%'],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />
    </div>
  );
}

function CardPattern({ color, index }: { color: string; index: number }) {
  const patterns = [
    <svg key="circles" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><circle cx="96" cy="32" r="48" fill="none" stroke="currentColor" strokeWidth="1" /><circle cx="96" cy="32" r="32" fill="none" stroke="currentColor" strokeWidth="1" /><circle cx="96" cy="32" r="16" fill="none" stroke="currentColor" strokeWidth="1" /></svg>,
    <svg key="grid" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><path d="M0 16h128M0 32h128M0 48h128M0 64h128M16 0v128M32 0v128M48 0v128M64 0v128" stroke="currentColor" strokeWidth="0.5" /></svg>,
    <svg key="hex" className="absolute top-0 right-0 w-32 h-32 opacity-[0.06]" viewBox="0 0 128 128"><circle cx="20" cy="15" r="2" fill="currentColor" /><circle cx="50" cy="15" r="2" fill="currentColor" /><circle cx="35" cy="45" r="2" fill="currentColor" /></svg>,
    <svg key="diag" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><line x1="0" y1="0" x2="128" y2="128" stroke="currentColor" strokeWidth="0.5" /></svg>,
    <svg key="squares" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><rect x="64" y="0" width="48" height="48" rx="8" fill="none" stroke="currentColor" strokeWidth="1" /></svg>,
    <svg key="diamond" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><polygon points="96,8 120,32 96,56 72,32" fill="none" stroke="currentColor" strokeWidth="1" /></svg>,
    <svg key="wave" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><path d="M0,20 Q32,8 64,20 T128,20" fill="none" stroke="currentColor" strokeWidth="0.7" /></svg>,
    <svg key="gear" className="absolute top-0 right-0 w-32 h-32 opacity-[0.04]" viewBox="0 0 128 128"><circle cx="96" cy="32" r="24" fill="none" stroke="currentColor" strokeWidth="1" strokeDasharray="4 4" /></svg>,
  ];
  return <div className={color}>{patterns[index % patterns.length]}</div>;
}

interface NavigationGridProps {
  cards: NavCard[];
  translations: Record<string, { label: string; description: string }>;
  onCardClick: (id: string) => void;
}

function NavCardWrapper({ card, i, cardT, onCardClick }: { card: NavCard; i: number; cardT: { label: string; description: string }; onCardClick: (id: string) => void }) {
  const [hovered, setHovered] = useState(false);
  const CustomIcon = SIDEBAR_ICONS[card.id];

  return (
    <motion.button
      key={card.id}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -4, transition: { duration: 0.2 } }}
      onClick={() => onCardClick(card.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className={`group relative text-left rounded-xl border bg-gradient-to-br ${card.gradFrom} ${card.gradTo} ${card.accentBorder} shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background`}
    >
      <AnimatedBorderGlow color={card.glowColor} />
      <div className={`absolute -top-8 -right-8 w-32 h-32 ${card.glowColor} blur-3xl rounded-full opacity-0 group-hover:opacity-60 transition-opacity duration-500 pointer-events-none`} />

      {/* Custom icon as background silhouette */}
      {CustomIcon && (
        <div className={`absolute -bottom-4 -right-4 w-28 h-28 ${card.iconText} transition-opacity duration-500 pointer-events-none ${hovered ? 'opacity-[0.12]' : 'opacity-[0.05]'}`}>
          <CustomIcon active={hovered} className="w-full h-full" />
        </div>
      )}
      {!CustomIcon && <CardPattern color={card.iconText} index={i} />}

      <div className="relative z-10 p-4">
        <div className="flex items-center gap-2 mb-1.5">
          <h3 className="text-sm font-bold text-foreground/90 tracking-wide">{cardT.label}</h3>
          <ArrowRight className={`w-3.5 h-3.5 ${card.iconText} opacity-0 group-hover:opacity-100 translate-x-[-6px] group-hover:translate-x-0 transition-all duration-300 ml-auto flex-shrink-0`} />
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground/70 line-clamp-2">{cardT.description}</p>
      </div>

      <div className={`absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent ${card.iconText.replace('text-', 'via-')}/20 to-transparent`} />
    </motion.button>
  );
}

export default function NavigationGrid({ cards, translations, onCardClick }: NavigationGridProps) {
  return (
    <>
      <SidebarIconStyles />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((card, i) => {
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
