import { memo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';
import { Play, Pause, Zap, Clock, CheckCircle2, TrendingUp, Radio } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import type { RealtimeStats } from '@/hooks/realtime/useRealtimeEvents';

interface Props {
  stats: RealtimeStats;
  isPaused: boolean;
  isConnected: boolean;
  testFlowLoading: boolean;
  onPause: () => void;
  onTestFlow: () => void;
}

const AnimatedNumber = memo(function AnimatedNumber({ value, color }: { value: string | number; color?: string }) {
  return (
    <span
        key={String(value)}
        className={`animate-fade-slide-in font-bold text-sm ${color ?? 'text-foreground'}`}
      >
        {value}
      </span>
  );
});

export default function RealtimeStatsBar({ stats, isPaused, isConnected, testFlowLoading, onPause, onTestFlow }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center justify-between px-3 sm:px-4 md:px-6 py-3 md:py-4 bg-gradient-to-b from-secondary/40 to-secondary/10 border-b border-primary/10 shadow-[0_1px_2px_rgba(0,0,0,0.1)] relative z-20">
      {/* Stats */}
      <div className="flex items-center gap-2 sm:gap-3 md:gap-6">
        {/* Connection status */}
        <div className="flex items-center gap-1.5 sm:gap-2 bg-background/50 px-2 sm:px-3 py-1.5 rounded-modal border border-primary/5 shadow-inner">
          <div className="relative flex h-2 w-2">
            {isConnected && !isPaused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-400' : isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
          </div>
          <span className="typo-heading text-foreground/80 uppercase tracking-widest hidden sm:inline">
            {isPaused ? t.overview.realtime_page.paused : isConnected ? t.overview.realtime_page.live : t.overview.realtime_page.offline}
          </span>
          <span className="sr-only">{isPaused ? t.overview.realtime_page.connection_paused : isConnected ? t.overview.realtime_page.connection_live : t.overview.realtime_page.connection_offline}</span>
        </div>

        {/* Events/min */}
        <div className="flex items-center gap-1.5 md:gap-3" title={t.overview.realtime_page.events_per_min}>
          <div className="w-6 h-6 md:w-8 md:h-8 rounded-card bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 shadow-elevation-1 flex items-center justify-center">
            <Zap className="w-3 h-3 md:w-4 md:h-4 text-purple-400" />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={stats.eventsPerMinute} color="text-purple-400 text-[15px]" />
            <span className="text-sm text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5 hidden md:block">{t.overview.realtime_page.events_per_min}</span>
          </div>
        </div>

        <div className="w-px h-6 md:h-8 bg-primary/10" />

        {/* Pending */}
        <div className="flex items-center gap-1.5 md:gap-3" title={t.overview.realtime_page.pending}>
          <div className="w-6 h-6 md:w-8 md:h-8 rounded-card bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 shadow-elevation-1 flex items-center justify-center">
            <Clock className="w-3 h-3 md:w-4 md:h-4 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={stats.pendingCount} color="text-amber-400 text-[15px]" />
            <span className="text-sm text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5 hidden md:block">{t.overview.realtime_page.pending}</span>
          </div>
        </div>

        <div className="w-px h-6 md:h-8 bg-primary/10" />

        {/* Success rate */}
        <div className="flex items-center gap-1.5 md:gap-3" title={t.overview.realtime_page.success}>
          <div className={`w-6 h-6 md:w-8 md:h-8 rounded-card border shadow-elevation-1 flex items-center justify-center bg-gradient-to-br ${
            stats.successRate >= 90 ? 'from-emerald-500/10 to-transparent border-emerald-500/20' : 'from-red-500/10 to-transparent border-red-500/20'
          }`}>
            <CheckCircle2 className={`w-3 h-3 md:w-4 md:h-4 ${stats.successRate >= 90 ? 'text-emerald-400' : 'text-red-400'}`} />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={`${stats.successRate}%`} color={stats.successRate >= 90 ? 'text-emerald-400 text-[15px]' : 'text-red-400 text-[15px]'} />
            <span className="text-sm text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5 hidden md:block">{t.overview.realtime_page.success}</span>
          </div>
        </div>

        <div className="w-px h-6 md:h-8 bg-primary/10 hidden sm:block" />

        {/* Total in window -- hidden below sm */}
        <div className="hidden sm:flex items-center gap-1.5 md:gap-3" title={t.overview.realtime_page.in_window}>
          <div className="w-6 h-6 md:w-8 md:h-8 rounded-card bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20 shadow-elevation-1 flex items-center justify-center">
            <TrendingUp className="w-3 h-3 md:w-4 md:h-4 text-blue-400" />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={stats.totalInWindow} color="text-blue-400 text-[15px]" />
            <span className="text-sm text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5 hidden md:block">{t.overview.realtime_page.in_window}</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Test Flow button */}
        <button
          onClick={onTestFlow}
          disabled={testFlowLoading}
          aria-label={testFlowLoading ? 'Testing flow...' : 'Test event flow'}
          className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-4 py-2 typo-heading rounded-modal bg-gradient-to-r from-purple-500/15 to-primary/15 border border-purple-500/25 text-purple-300 hover:from-purple-500/25 hover:to-primary/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-elevation-1"
        >
          {testFlowLoading ? (
            <LoadingSpinner />
          ) : (
            <Radio className="w-4 h-4" />
          )}
          <span className="hidden sm:inline">{t.overview.realtime_page.test_flow}</span>
        </button>

        {/* Pause/Resume */}
        <button
          onClick={onPause}
          aria-label={isPaused ? 'Resume realtime stream' : 'Pause realtime stream'}
          className={`p-2 rounded-modal border transition-all shadow-elevation-1 active:scale-[0.95] ${
            isPaused
              ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-transparent text-emerald-400 hover:from-emerald-500/30'
              : 'border-primary/20 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-secondary/60'
          }`}
          title={isPaused ? t.overview.realtime_page.resume : t.overview.realtime_page.pause}
        >
          {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
