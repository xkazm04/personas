import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Trophy, TrendingUp, TrendingDown, Minus, ChevronRight } from 'lucide-react';
import { useOverviewStore } from '@/stores/overviewStore';
import { PersonaIcon } from '@/features/shared/components/display/PersonaIcon';
import { computeLeaderboard, type LeaderboardEntry, type Medal } from '@/features/overview/sub_leaderboard/libs/leaderboardScoring';

const MEDAL_STYLES: Record<NonNullable<Medal>, { bg: string; border: string; text: string; label: string }> = {
  gold:   { bg: 'bg-amber-500/15', border: 'border-amber-500/30', text: 'text-amber-400', label: '1st' },
  silver: { bg: 'bg-slate-300/15', border: 'border-slate-400/30', text: 'text-slate-300', label: '2nd' },
  bronze: { bg: 'bg-orange-600/15', border: 'border-orange-600/30', text: 'text-orange-400', label: '3rd' },
};

const TREND_ICON = {
  improving: { Icon: TrendingUp, color: 'text-emerald-400' },
  stable:    { Icon: Minus, color: 'text-foreground' },
  degrading: { Icon: TrendingDown, color: 'text-red-400' },
};

export function TopPerformersWidget() {
  const { t } = useTranslation();
  const healthSignals = useOverviewStore((s) => s.healthSignals);
  const setOverviewTab = useOverviewStore((s) => s.setOverviewTab);

  const topEntries = useMemo(() => {
    const leaderboard = computeLeaderboard(healthSignals);
    return leaderboard.slice(0, 3);
  }, [healthSignals]);

  if (topEntries.length < 2) return null;

  return (
    <div className="rounded-modal border border-primary/[0.08] bg-secondary/[0.03] p-4" data-testid="top-performers-widget">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-400" />
          <h3 className="text-sm font-semibold text-foreground">{t.overview.widgets.top_performers}</h3>
        </div>
        <button
          onClick={() => setOverviewTab('leaderboard')}
          className="flex items-center gap-0.5 text-[11px] text-primary/70 hover:text-primary transition-colors"
        >
          Leaderboard <ChevronRight className="w-3 h-3" />
        </button>
      </div>

      <div className="space-y-2">
        {topEntries.map((entry) => (
          <TopPerformerRow key={entry.personaId} entry={entry} />
        ))}
      </div>
    </div>
  );
}

function TopPerformerRow({ entry }: { entry: LeaderboardEntry }) {
  const medal = entry.medal ? MEDAL_STYLES[entry.medal] : null;
  const trend = TREND_ICON[entry.trend];
  const TrendIcon = trend.Icon;
  const scoreColor = entry.compositeScore >= 80 ? 'text-emerald-400' :
                     entry.compositeScore >= 60 ? 'text-blue-400' :
                     entry.compositeScore >= 40 ? 'text-amber-400' : 'text-red-400';

  return (
    <div className="flex items-center gap-2.5 px-2 py-1.5 rounded-card hover:bg-primary/[0.03] transition-colors">
      {/* Medal / rank */}
      <div className="w-7 flex-shrink-0 text-center">
        {medal ? (
          <span className={`inline-flex items-center justify-center w-6 h-6 rounded-input text-[10px] font-bold border ${medal.bg} ${medal.border} ${medal.text}`}>
            {medal.label}
          </span>
        ) : (
          <span className="text-xs text-foreground">#{entry.rank}</span>
        )}
      </div>

      {/* Avatar + name */}
      <PersonaIcon icon={entry.personaIcon} color={entry.personaColor} display="pop" frameSize="lg" />
      <span className="text-sm text-foreground truncate flex-1 min-w-0">{entry.personaName}</span>

      {/* Trend */}
      <TrendIcon className={`w-3 h-3 flex-shrink-0 ${trend.color}`} />

      {/* Score */}
      <span className={`text-sm font-bold flex-shrink-0 ${scoreColor}`}>{entry.compositeScore}</span>
    </div>
  );
}
