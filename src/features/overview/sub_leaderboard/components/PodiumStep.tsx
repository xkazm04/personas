import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crown, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { SpringCount } from '@/features/shared/components/display/SpringCount';
import type { LeaderboardEntry } from '../libs/leaderboardScoring';
import { headlineScore, type RankKey } from '../libs/leaderboardRanking';

export type PodiumSlot = 'gold' | 'silver' | 'bronze';

const PODIUM_CONFIG: Record<PodiumSlot, {
  label: string;
  heightClass: string;
  stepClass: string;
  ringClass: string;
  accentText: string;
  scoreText: string;
  orderClass: string;
  /** Stagger delay for entrance — gold lands first, then silver, then bronze. */
  staggerDelay: number;
}> = {
  gold: {
    label: '1st',
    heightClass: 'h-48',
    stepClass: 'bg-gradient-to-b from-amber-400/25 via-amber-500/15 to-amber-700/20 border-amber-400/40',
    ringClass: 'ring-2 ring-amber-400/50 shadow-[0_0_48px_rgba(251,191,36,0.35)]',
    accentText: 'text-amber-300',
    scoreText: 'text-amber-200',
    orderClass: 'md:order-2',
    staggerDelay: 0,
  },
  silver: {
    label: '2nd',
    heightClass: 'h-36',
    stepClass: 'bg-gradient-to-b from-slate-200/20 via-slate-300/10 to-slate-500/15 border-slate-300/35',
    ringClass: 'ring-2 ring-slate-300/45 shadow-[0_0_32px_rgba(203,213,225,0.25)]',
    accentText: 'text-slate-200',
    scoreText: 'text-slate-100',
    orderClass: 'md:order-1',
    staggerDelay: 0.08,
  },
  bronze: {
    label: '3rd',
    heightClass: 'h-28',
    stepClass: 'bg-gradient-to-b from-orange-500/20 via-orange-600/10 to-orange-800/15 border-orange-500/35',
    ringClass: 'ring-2 ring-orange-500/45 shadow-[0_0_24px_rgba(249,115,22,0.25)]',
    accentText: 'text-orange-300',
    scoreText: 'text-orange-200',
    orderClass: 'md:order-3',
    staggerDelay: 0.14,
  },
};

const TREND = {
  improving: { Icon: TrendingUp, color: 'text-emerald-400', label: 'improving' },
  stable:    { Icon: Minus, color: 'text-foreground', label: 'stable' },
  degrading: { Icon: TrendingDown, color: 'text-red-400', label: 'degrading' },
} as const;

interface PodiumStepProps {
  entry: LeaderboardEntry;
  slot: PodiumSlot;
  selected: boolean;
  onClick: () => void;
  /** Active ranking dimension — drives which score is shown as the headline. */
  rankKey: RankKey;
  /** Translated label for the active dimension (null when ranking by overall). */
  activeDimLabel?: string | null;
}

export function PodiumStep({ entry, slot, selected, onClick, rankKey, activeDimLabel }: PodiumStepProps) {
  const reduce = useReducedMotion();
  const cfg = PODIUM_CONFIG[slot];
  const trend = TREND[entry.trend];
  const TrendIcon = trend.Icon;
  const headline = headlineScore(entry, rankKey);

  return (
    <motion.button
      onClick={onClick}
      initial={reduce ? false : { opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.45, delay: reduce ? 0 : cfg.staggerDelay, ease: [0.22, 0.61, 0.36, 1] }}
      whileHover={reduce ? undefined : { y: -3 }}
      whileTap={reduce ? undefined : { scale: 0.98 }}
      className={`group flex flex-col items-center gap-3 flex-1 min-w-[180px] max-w-[260px] ${cfg.orderClass}`}
      data-testid={`podium-${slot}`}
    >
      <div
        className={`p-4 rounded-modal border transition-colors duration-300 ${
          selected
            ? 'bg-primary/10 border-primary/30'
            : 'bg-secondary/[0.04] border-primary/10 group-hover:bg-primary/[0.05]'
        }`}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={entry.personaId}
            className="flex flex-col items-center gap-2"
            initial={reduce ? false : { opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={reduce ? undefined : { opacity: 0, scale: 0.96 }}
            transition={{ duration: reduce ? 0 : 0.18, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <div className={`relative rounded-card ${cfg.ringClass} transition-transform duration-300 group-hover:-translate-y-0.5`}>
              {slot === 'gold' && (
                <motion.span
                  aria-hidden
                  className="pointer-events-none absolute -inset-3 rounded-full"
                  style={{ background: 'radial-gradient(circle, rgba(251,191,36,0.4) 0%, rgba(251,191,36,0.08) 45%, transparent 72%)' }}
                  animate={reduce ? { opacity: 0.5 } : { opacity: [0.45, 0.85, 0.45], scale: [0.94, 1.06, 0.94] }}
                  transition={reduce ? undefined : { duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <span className="relative z-10 block">
                <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} display="pop" frameSize="lg" />
              </span>
              {slot === 'gold' && (
                <motion.span
                  aria-hidden
                  className="absolute -top-5 left-1/2 z-20 -translate-x-1/2 text-amber-300"
                  animate={reduce ? undefined : { y: [-1, -3, -1] }}
                  transition={reduce ? undefined : { duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <Crown className="w-5 h-5 fill-amber-400/30 drop-shadow-[0_0_8px_rgba(251,191,36,0.6)]" />
                </motion.span>
              )}
            </div>
            <p className={`typo-heading font-semibold ${cfg.accentText} text-center max-w-[180px] truncate`}>
              {entry.personaName}
            </p>
            <div className="flex flex-col items-center gap-0.5">
              <div className="flex items-center gap-2">
                <SpringCount value={headline} className={`typo-display font-bold tabular-nums ${cfg.scoreText}`} />
                <TrendIcon className={`w-4 h-4 ${trend.color}`} aria-label={trend.label} />
              </div>
              {activeDimLabel && (
                <span className={`typo-caption font-medium ${cfg.accentText}`}>{activeDimLabel}</span>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
      <div className="w-full">
      <motion.div
        initial={reduce ? false : { scaleY: 0.4, opacity: 0 }}
        animate={{ scaleY: 1, opacity: 1 }}
        style={{ transformOrigin: 'bottom' }}
        transition={{ duration: reduce ? 0 : 0.55, delay: reduce ? 0 : cfg.staggerDelay + 0.15, ease: [0.34, 1.4, 0.64, 1] }}
        className={`relative w-full ${cfg.heightClass} border rounded-t-card ${cfg.stepClass} flex items-start justify-center pt-3 overflow-hidden shadow-[inset_0_-12px_24px_-12px_rgba(0,0,0,0.45)]`}
      >
        {/* Top bevel highlight — reads as the lit cap of an extruded pedestal */}
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-foreground/25" />
        {/* Soft vertical sheen down the face */}
        <span aria-hidden className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.07] to-transparent" />
        <span
          className={`relative typo-display font-black tracking-widest ${cfg.accentText}`}
          style={{ textShadow: '0 1px 0 rgba(255,255,255,0.18), 0 -1px 1px rgba(0,0,0,0.35)' }}
        >
          {cfg.label}
        </span>
      </motion.div>
      {/* Fading floor reflection beneath the riser */}
      <div aria-hidden className="pointer-events-none w-full h-10 overflow-hidden">
        <div
          className={`w-full ${cfg.heightClass} rounded-t-card border ${cfg.stepClass} -scale-y-100 origin-top opacity-25`}
          style={{
            maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent 55%)',
            WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.55), transparent 55%)',
          }}
        />
      </div>
      </div>
    </motion.button>
  );
}
