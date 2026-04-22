import { Sparkles, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { LeaderboardEntry } from '../libs/leaderboardScoring';

export type PodiumSlot = 'gold' | 'silver' | 'bronze';

const PODIUM_CONFIG: Record<PodiumSlot, {
  label: string;
  heightClass: string;
  stepClass: string;
  ringClass: string;
  accentText: string;
  scoreText: string;
  orderClass: string;
}> = {
  gold: {
    label: '1st',
    heightClass: 'h-48',
    stepClass: 'bg-gradient-to-b from-amber-400/25 via-amber-500/15 to-amber-700/20 border-amber-400/40',
    ringClass: 'ring-2 ring-amber-400/50 shadow-[0_0_48px_rgba(251,191,36,0.35)]',
    accentText: 'text-amber-300',
    scoreText: 'text-amber-200',
    orderClass: 'md:order-2',
  },
  silver: {
    label: '2nd',
    heightClass: 'h-36',
    stepClass: 'bg-gradient-to-b from-slate-200/20 via-slate-300/10 to-slate-500/15 border-slate-300/35',
    ringClass: 'ring-2 ring-slate-300/45 shadow-[0_0_32px_rgba(203,213,225,0.25)]',
    accentText: 'text-slate-200',
    scoreText: 'text-slate-100',
    orderClass: 'md:order-1',
  },
  bronze: {
    label: '3rd',
    heightClass: 'h-28',
    stepClass: 'bg-gradient-to-b from-orange-500/20 via-orange-600/10 to-orange-800/15 border-orange-500/35',
    ringClass: 'ring-2 ring-orange-500/45 shadow-[0_0_24px_rgba(249,115,22,0.25)]',
    accentText: 'text-orange-300',
    scoreText: 'text-orange-200',
    orderClass: 'md:order-3',
  },
};

const TREND = {
  improving: { Icon: TrendingUp, color: 'text-emerald-400', label: 'improving' },
  stable:    { Icon: Minus, color: 'text-foreground/60', label: 'stable' },
  degrading: { Icon: TrendingDown, color: 'text-red-400', label: 'degrading' },
} as const;

interface PodiumStepProps {
  entry: LeaderboardEntry;
  slot: PodiumSlot;
  selected: boolean;
  onClick: () => void;
}

export function PodiumStep({ entry, slot, selected, onClick }: PodiumStepProps) {
  const cfg = PODIUM_CONFIG[slot];
  const trend = TREND[entry.trend];
  const TrendIcon = trend.Icon;

  return (
    <button
      onClick={onClick}
      className={`group flex flex-col items-center gap-3 flex-1 min-w-[180px] max-w-[260px] ${cfg.orderClass}`}
      data-testid={`podium-${slot}`}
    >
      <div
        className={`flex flex-col items-center gap-2 p-4 rounded-modal border transition-all duration-300 ${
          selected
            ? 'bg-primary/10 border-primary/30 scale-[1.02]'
            : 'bg-secondary/[0.04] border-primary/10 group-hover:bg-primary/[0.05]'
        }`}
      >
        <div className={`relative rounded-card ${cfg.ringClass} transition-transform duration-300 group-hover:-translate-y-0.5`}>
          <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} display="pop" frameSize="lg" />
          {slot === 'gold' && (
            <Sparkles className="absolute -top-2 -right-2 w-5 h-5 text-amber-300 animate-pulse" />
          )}
        </div>
        <p className={`typo-body font-semibold ${cfg.accentText} text-center max-w-[180px] truncate`}>
          {entry.personaName}
        </p>
        <div className="flex items-center gap-2">
          <span className={`typo-heading-lg font-bold tabular-nums ${cfg.scoreText}`}>
            {entry.compositeScore}
          </span>
          <TrendIcon className={`w-4 h-4 ${trend.color}`} aria-label={trend.label} />
        </div>
      </div>
      <div className={`w-full ${cfg.heightClass} border rounded-t-card ${cfg.stepClass} flex items-start justify-center pt-3 transition-all duration-500`}>
        <span className={`typo-heading-lg font-black tracking-widest ${cfg.accentText}`}>
          {cfg.label}
        </span>
      </div>
    </button>
  );
}
