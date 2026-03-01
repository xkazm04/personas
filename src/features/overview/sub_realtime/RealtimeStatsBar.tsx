import { memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Pause, Zap, Clock, CheckCircle2, TrendingUp, Loader2, Radio } from 'lucide-react';
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
    <AnimatePresence mode="wait">
      <motion.span
        key={String(value)}
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ duration: 0.15 }}
        className={`font-bold text-sm ${color ?? 'text-foreground'}`}
      >
        {value}
      </motion.span>
    </AnimatePresence>
  );
});

export default function RealtimeStatsBar({ stats, isPaused, isConnected, testFlowLoading, onPause, onTestFlow }: Props) {
  return (
    <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-b from-secondary/40 to-secondary/10 border-b border-primary/10 shadow-[0_1px_2px_rgba(0,0,0,0.1)] relative z-20">
      {/* Stats */}
      <div className="flex items-center gap-6">
        {/* Connection status */}
        <div className="flex items-center gap-2 bg-background/50 px-3 py-1.5 rounded-md border border-primary/5 shadow-inner">
          <div className="relative flex h-2 w-2">
            {isConnected && !isPaused && (
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            )}
            <span className={`relative inline-flex rounded-full h-2 w-2 ${isPaused ? 'bg-amber-400' : isConnected ? 'bg-emerald-500' : 'bg-red-500'}`}></span>
          </div>
          <span className="text-[11px] font-bold text-foreground/80 uppercase tracking-widest">
            {isPaused ? 'Paused' : isConnected ? 'Live' : 'Offline'}
          </span>
          <span className="sr-only">Connection status: {isPaused ? 'Paused' : isConnected ? 'Live' : 'Disconnected'}</span>
        </div>

        {/* Events/min */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/10 to-transparent border border-purple-500/20 shadow-sm flex items-center justify-center">
            <Zap className="w-4 h-4 text-purple-400" />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={stats.eventsPerMinute} color="text-purple-400 text-[15px]" />
            <span className="text-[11px] text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5">events/min</span>
          </div>
        </div>

        <div className="w-px h-8 bg-primary/10" />

        {/* Pending */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/10 to-transparent border border-amber-500/20 shadow-sm flex items-center justify-center">
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={stats.pendingCount} color="text-amber-400 text-[15px]" />
            <span className="text-[11px] text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5">pending</span>
          </div>
        </div>

        <div className="w-px h-8 bg-primary/10" />

        {/* Success rate */}
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg border shadow-sm flex items-center justify-center bg-gradient-to-br ${
            stats.successRate >= 90 ? 'from-emerald-500/10 to-transparent border-emerald-500/20' : 'from-red-500/10 to-transparent border-red-500/20'
          }`}>
            <CheckCircle2 className={`w-4 h-4 ${stats.successRate >= 90 ? 'text-emerald-400' : 'text-red-400'}`} />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={`${stats.successRate}%`} color={stats.successRate >= 90 ? 'text-emerald-400 text-[15px]' : 'text-red-400 text-[15px]'} />
            <span className="text-[11px] text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5">success</span>
          </div>
        </div>

        <div className="w-px h-8 bg-primary/10 hidden sm:block" />

        {/* Total in window */}
        <div className="hidden sm:flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500/10 to-transparent border border-blue-500/20 shadow-sm flex items-center justify-center">
            <TrendingUp className="w-4 h-4 text-blue-400" />
          </div>
          <div className="flex flex-col">
            <AnimatedNumber value={stats.totalInWindow} color="text-blue-400 text-[15px]" />
            <span className="text-[11px] text-muted-foreground/70 font-semibold uppercase tracking-widest -mt-0.5">in window</span>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        {/* Test Flow button */}
        <button
          onClick={onTestFlow}
          disabled={testFlowLoading}
          aria-label={testFlowLoading ? 'Testing flow...' : 'Test event flow'}
          className="flex items-center gap-2 px-4 py-2 text-sm font-bold rounded-xl bg-gradient-to-r from-purple-500/15 to-primary/15 border border-purple-500/25 text-purple-300 hover:from-purple-500/25 hover:to-primary/25 active:scale-[0.97] disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          {testFlowLoading ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Radio className="w-4 h-4" />
          )}
          Test Flow
        </button>

        {/* Pause/Resume */}
        <button
          onClick={onPause}
          aria-label={isPaused ? 'Resume realtime stream' : 'Pause realtime stream'}
          className={`p-2 rounded-xl border transition-all shadow-sm active:scale-[0.95] ${
            isPaused
              ? 'border-emerald-500/30 bg-gradient-to-br from-emerald-500/20 to-transparent text-emerald-400 hover:from-emerald-500/30'
              : 'border-primary/20 bg-background/50 text-muted-foreground hover:text-foreground hover:bg-secondary/60'
          }`}
          title={isPaused ? 'Resume' : 'Pause'}
        >
          {isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
