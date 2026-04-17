import { TrendingUp, TrendingDown, Minus, ExternalLink } from 'lucide-react';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import type { LeaderboardEntry, Medal, PerformanceTier } from '../libs/leaderboardScoring';

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

function MiniScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = score / 100;
  const strokeColor = score >= 80 ? '#10B981' : score >= 60 ? '#3B82F6' : score >= 40 ? '#F59E0B' : '#EF4444';

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg className="w-full h-full -rotate-90" viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth="3" className="text-primary/10" />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={strokeColor} strokeWidth="3"
          strokeLinecap="round" strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-xs font-bold text-foreground/90">{score}</span>
      </div>
    </div>
  );
}

// ── Dimension bar ──────────────────────────────────────────────────────

function DimensionBar({ label, value, raw }: { label: string; value: number; raw: string }) {
  const barColor = value >= 80 ? 'bg-emerald-500/60' : value >= 60 ? 'bg-blue-500/60' : value >= 40 ? 'bg-amber-500/60' : 'bg-red-500/60';
  return (
    <div className="flex items-center gap-2">
      <span className="text-[10px] text-foreground w-12 text-right flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-primary/10 overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] text-foreground w-14 flex-shrink-0">{raw}</span>
    </div>
  );
}

// ── LeaderboardCard ────────────────────────────────────────────────────

interface LeaderboardCardProps {
  entry: LeaderboardEntry;
  selected?: boolean;
  onClick?: () => void;
  onNavigateToAgent?: (personaId: string) => void;
}

export function LeaderboardCard({ entry, selected, onClick, onNavigateToAgent }: LeaderboardCardProps) {
  const medalCfg = entry.medal ? MEDAL_CONFIG[entry.medal] : null;
  const tierCfg = TIER_CONFIG[entry.tier];
  const trendCfg = TREND_ICON[entry.trend];
  const TrendIcon = trendCfg.Icon;

  return (
    <button
      onClick={onClick}
      data-testid={`leaderboard-card-${entry.personaId}`}
      className={`w-full text-left p-3 rounded-modal border transition-all duration-200 ${
        selected
          ? 'bg-primary/8 border-primary/25 ring-1 ring-primary/15'
          : 'bg-secondary/[0.03] border-primary/[0.08] hover:bg-primary/[0.04] hover:border-primary/15'
      }`}
    >
      <div className="flex items-center gap-3">
        {/* Rank */}
        <div className="w-8 flex-shrink-0 text-center">
          {medalCfg ? (
            <span className={`inline-flex items-center justify-center w-7 h-7 rounded-card text-xs font-bold border ${medalCfg.bg} ${medalCfg.border} ${medalCfg.text}`}>
              {medalCfg.emoji}
            </span>
          ) : (
            <span className="text-sm font-medium text-foreground">#{entry.rank}</span>
          )}
        </div>

        {/* Avatar + name */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} display="pop" frameSize="lg" />
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground truncate">{entry.personaName}</p>
            <div className="flex items-center gap-1.5">
              <span className={`text-[10px] font-medium ${tierCfg.color}`}>{tierCfg.label}</span>
              <TrendIcon className={`w-3 h-3 ${trendCfg.color}`} />
            </div>
          </div>
        </div>

        {/* Score ring */}
        <MiniScoreRing score={entry.compositeScore} />
      </div>

      {/* Dimension bars */}
      <div className="mt-2.5 space-y-1 pl-11">
        {entry.dimensions.map((dim) => (
          <DimensionBar key={dim.label} label={dim.label} value={dim.value} raw={dim.raw} />
        ))}
      </div>

      {/* Open Agent link */}
      {onNavigateToAgent && (
        <div className="mt-2 pl-11">
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onNavigateToAgent(entry.personaId); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onNavigateToAgent(entry.personaId); } }}
            className="inline-flex items-center gap-1 text-[11px] text-primary/60 hover:text-primary transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
            Open Agent
          </span>
        </div>
      )}
    </button>
  );
}
