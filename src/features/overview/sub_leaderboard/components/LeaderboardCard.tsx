import { motion, useReducedMotion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { SpringCount } from '@/features/shared/components/display/SpringCount';
import type { LeaderboardEntry, Medal, PerformanceTier } from '../libs/leaderboardScoring';
import { headlineScore, type RankKey } from '../libs/leaderboardRanking';
import { DebtText } from '@/i18n/DebtText';


// ── Medal display ──────────────────────────────────────────────────────

const MEDAL_CONFIG: Record<NonNullable<Medal>, { emoji: string; bg: string; border: string; text: string }> = {
  gold:   { emoji: '1st', bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400' },
  silver: { emoji: '2nd', bg: 'bg-slate-300/15', border: 'border-slate-400/30', text: 'text-slate-300' },
  bronze: { emoji: '3rd', bg: 'bg-orange-600/15', border: 'border-orange-600/30', text: 'text-orange-400' },
};

const TIER_CONFIG: Record<PerformanceTier, { label: string; color: string }> = {
  elite:      { label: 'Elite', color: 'text-amber-400' },
  strong:     { label: 'Strong', color: 'text-emerald-400' },
  average:    { label: 'Average', color: 'text-blue-400' },
  developing: { label: 'Developing', color: 'text-foreground' },
};

const TREND_ICON = {
  improving: { Icon: TrendingUp, color: 'text-emerald-400' },
  stable: { Icon: Minus, color: 'text-foreground' },
  degrading: { Icon: TrendingDown, color: 'text-red-400' },
};

// ── Mini score ring ────────────────────────────────────────────────────

function MiniScoreRing({ score, size = 48 }: { score: number; size?: number }) {
  const reduce = useReducedMotion();
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score / 100;
  const strokeColor = score >= 80 ? '#10B981' : score >= 60 ? '#3B82F6' : score >= 40 ? '#F59E0B' : '#EF4444';

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary/10" />
        <motion.circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={strokeColor} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: circumference * (1 - progress) }}
          transition={{ duration: reduce ? 0 : 0.7, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <SpringCount value={score} className="typo-body font-bold text-foreground tabular-nums" />
      </div>
    </div>
  );
}

// ── Dimension bar ──────────────────────────────────────────────────────

function DimensionBar({ label, value, raw, delay = 0, active = false }: { label: string; value: number; raw: string; delay?: number; active?: boolean }) {
  const reduce = useReducedMotion();
  const barColor = value >= 80 ? 'bg-emerald-500/70' : value >= 60 ? 'bg-blue-500/70' : value >= 40 ? 'bg-amber-500/70' : 'bg-red-500/70';
  return (
    <div className="flex items-center gap-2">
      <span className={`typo-caption w-14 text-right flex-shrink-0 ${active ? 'text-primary font-semibold' : 'text-foreground'}`}>{label}</span>
      <div className={`flex-1 rounded-full bg-primary/10 overflow-hidden transition-all ${active ? 'h-2 ring-1 ring-primary/30' : 'h-1.5'}`}>
        <motion.div
          className={`h-full rounded-full ${barColor}`}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${value}%` }}
          transition={{ duration: reduce ? 0 : 0.55, delay: reduce ? 0 : delay, ease: [0.22, 0.61, 0.36, 1] }}
        />
      </div>
      <span className={`typo-caption font-mono w-16 flex-shrink-0 ${active ? 'text-primary font-semibold' : 'text-foreground'}`}>{raw}</span>
    </div>
  );
}

// ── LeaderboardCard ────────────────────────────────────────────────────

interface LeaderboardCardProps {
  entry: LeaderboardEntry;
  selected?: boolean;
  onClick?: () => void;
  onNavigateToAgent?: (personaId: string) => void;
  /** Index in the visible list — used to stagger entrance animations. */
  index?: number;
  /** Active ranking dimension — drives the headline score + accented bar. */
  rankKey?: RankKey;
}

export function LeaderboardCard({ entry, selected, onClick, onNavigateToAgent, index = 0, rankKey = 'overall' }: LeaderboardCardProps) {
  const reduce = useReducedMotion();
  const medalCfg = entry.medal ? MEDAL_CONFIG[entry.medal] : null;
  const tierCfg = TIER_CONFIG[entry.tier];
  const trendCfg = TREND_ICON[entry.trend];
  const TrendIcon = trendCfg.Icon;

  return (
    <motion.button
      layout
      onClick={onClick}
      data-testid={`leaderboard-card-${entry.personaId}`}
      initial={reduce ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.28, delay: reduce ? 0 : index * 0.035, ease: [0.22, 0.61, 0.36, 1] }}
      whileHover={reduce ? undefined : { y: -1 }}
      className={`relative w-full text-left p-3.5 rounded-modal border transition-colors duration-200 ${
        selected
          ? 'bg-primary/8 border-primary/30 ring-1 ring-primary/25 shadow-elevation-2'
          : 'bg-secondary/[0.03] border-primary/[0.08] hover:bg-primary/[0.04] hover:border-primary/15'
      }`}
    >
      {selected && (
        <span aria-hidden className="absolute left-0 top-2.5 bottom-2.5 w-1 rounded-full bg-primary" />
      )}
      <div className="flex items-center gap-3">
        {/* Rank */}
        <div className="w-9 flex-shrink-0 text-center">
          {medalCfg ? (
            <span className={`inline-flex items-center justify-center w-8 h-7 rounded-card typo-caption font-bold border ${medalCfg.bg} ${medalCfg.border} ${medalCfg.text}`}>
              {medalCfg.emoji}
            </span>
          ) : (
            <span className="typo-body font-semibold text-foreground tabular-nums">#{entry.rank}</span>
          )}
        </div>

        {/* Avatar + name */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} display="pop" frameSize="lg" />
          <div className="min-w-0">
            <p className="typo-body font-semibold text-foreground truncate leading-tight">{entry.personaName}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`typo-caption font-semibold ${tierCfg.color}`}>{tierCfg.label}</span>
              <TrendIcon className={`w-3.5 h-3.5 ${trendCfg.color}`} aria-label={`Trend: ${entry.trend}`} />
            </div>
          </div>
        </div>

        {/* Score ring */}
        <MiniScoreRing score={headlineScore(entry, rankKey)} />
      </div>

      {/* Dimension bars */}
      <div className="mt-3 space-y-1.5 pl-12">
        {entry.dimensions.map((dim, i) => (
          <DimensionBar key={dim.label} label={dim.label} value={dim.value} raw={dim.raw} delay={i * 0.05} active={rankKey !== 'overall' && dim.key === rankKey} />
        ))}
      </div>

      {/* Open Agent link */}
      {onNavigateToAgent && (
        <div className="mt-2.5 pl-12">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onNavigateToAgent(entry.personaId); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onNavigateToAgent(entry.personaId); } }}
            className="inline-flex items-center gap-1 typo-caption font-medium text-primary/70 hover:text-primary transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
            <DebtText k="auto_open_agent_e247e3d5" />
          </span>
        </div>
      )}
    </motion.button>
  );
}
