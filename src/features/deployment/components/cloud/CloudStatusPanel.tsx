import { useTranslation } from '@/i18n/useTranslation';
import { RefreshCw } from 'lucide-react';
import { LoadingSpinner } from '@/features/shared/components/feedback/LoadingSpinner';
import { SectionHeading } from '@/features/shared/components/layout/SectionHeading';
import { motion, useMotionValueEvent, useSpring, useTransform } from 'framer-motion';
import { useMemo, useState } from 'react';
import { ExecutionProgressBar } from '../ExecutionProgressBar';

export interface CloudStatusPanelProps {
  status: {
    workerCounts: { idle: number; executing: number; disconnected: number };
    queueLength: number;
    activeExecutions: number;
    hasClaudeToken: boolean;
  } | null;
  isLoading: boolean;
  onRefresh: () => void;
  /** Currently active cloud execution ID (if any) for progress tracking. */
  activeExecutionId?: string | null;
  /** Timestamp from usePolling -- when non-null, auto-refresh is active. */
  lastPolled?: number | null;
}

export function CloudStatusPanel({ status, isLoading, onRefresh, activeExecutionId, lastPolled }: CloudStatusPanelProps) {
  const { t } = useTranslation();
  const dt = t.deployment;
  if (!status && isLoading) {
    return (
      <div role="status" aria-live="polite" className="flex items-center justify-center py-12 text-muted-foreground/90">
        <LoadingSpinner size="lg" />
        <span className="sr-only">Loading cloud status...</span>
      </div>
    );
  }

  if (!status) {
    return (
      <p className="text-sm text-muted-foreground/90 py-8 text-center">
        No status data available.
      </p>
    );
  }

  const workers = status.workerCounts;

  return (
    <div className="space-y-6">
      {/* Live indicator + Refresh button */}
      <div className="flex items-center justify-between">
        {lastPolled != null ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground/60">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            Live
          </div>
        ) : <div />}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-modal bg-secondary/40 border border-primary/15 text-muted-foreground/80 hover:text-foreground/95 hover:border-primary/25 disabled:opacity-40 transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {/* Worker counts */}
      <div>
        <SectionHeading className="mb-3">{dt.cloud_status.workers}</SectionHeading>
        <div className="flex flex-wrap gap-3">
          <WorkerBadge label="Idle" count={workers.idle} color="emerald" />
          <WorkerBadge label="Executing" count={workers.executing} color="blue" />
          <WorkerBadge label="Disconnected" count={workers.disconnected} color="red" />
        </div>
      </div>

      {/* Stats */}
      <div>
        <SectionHeading className="mb-3">{dt.cloud_status.activity}</SectionHeading>
        <div className="grid grid-cols-2 3xl:grid-cols-4 gap-3">
          <ActivityGauge
            label="Queue Length"
            value={status.queueLength}
            tone="violet"
            maxHint={10}
          />
          <ActivityGauge
            label="Active Executions"
            value={status.activeExecutions}
            tone="blue"
            maxHint={Math.max(5, status.workerCounts.executing + status.workerCounts.idle)}
          />
        </div>
      </div>

      {/* Active execution progress */}
      {activeExecutionId && (
        <div>
          <SectionHeading className="mb-3">{dt.cloud_status.active_execution}</SectionHeading>
          <ExecutionProgressBar executionId={activeExecutionId} />
        </div>
      )}

      {/* Claude token indicator */}
      <div>
        <SectionHeading className="mb-3">{dt.cloud_status.claude_token}</SectionHeading>
        <div className="flex items-center gap-2 p-3 rounded-card bg-secondary/30 border border-primary/10">
          {status.hasClaudeToken ? (
            <>
              <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <span className="text-sm text-foreground/80">{dt.status.token_available}</span>
            </>
          ) : (
            <>
              <div className="w-5 h-5 rounded-full bg-red-500/20 flex items-center justify-center">
                <svg className="w-3 h-3 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
              <span className="text-sm text-foreground/80">{dt.status.no_token_configured}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function WorkerBadge({ label, count, color }: { label: string; count: number; color: 'emerald' | 'blue' | 'red' }) {
  const colorMap = {
    emerald: 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400',
    blue: 'bg-blue-500/10 border-blue-500/20 text-blue-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  };

  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-modal border ${colorMap[color]}`}>
      <span className="text-lg font-semibold">{count}</span>
      <span className="text-sm opacity-70">{label}</span>
    </div>
  );
}

function ActivityGauge({
  label,
  value,
  tone,
  maxHint,
}: {
  label: string;
  value: number;
  tone: 'violet' | 'blue';
  maxHint: number;
}) {
  const safeMax = useMemo(() => {
    const baseline = Math.max(1, maxHint, value);
    return Math.ceil(baseline / 5) * 5;
  }, [maxHint, value]);

  const progressTarget = Math.min(1, Math.max(0, value / safeMax));
  const spring = useSpring(progressTarget, { stiffness: 180, damping: 22, mass: 0.55 });
  const arcLength = 157;
  const dashOffset = useTransform(spring, (p) => arcLength * (1 - p));

  const [displayValue, setDisplayValue] = useState(value);
  useMotionValueEvent(spring, 'change', (p) => {
    setDisplayValue(Math.round(p * safeMax));
  });

  const toneClasses =
    tone === 'violet'
      ? {
          glow: 'shadow-[0_0_22px_rgba(139,92,246,0.24)]',
          fg: 'stroke-violet-400',
          text: 'text-violet-300',
        }
      : {
          glow: 'shadow-[0_0_22px_rgba(59,130,246,0.24)]',
          fg: 'stroke-blue-400',
          text: 'text-blue-300',
        };

  return (
    <div className="p-3 rounded-card bg-secondary/30 border border-primary/10">
      <p className="text-sm text-muted-foreground/90 mb-2">{label}</p>
      <div className="relative h-24 rounded-card bg-gradient-to-b from-secondary/40 to-secondary/10 border border-primary/10 overflow-hidden">
        <div className={`absolute inset-0 pointer-events-none ${toneClasses.glow}`} />
        <svg viewBox="0 0 120 70" className="w-full h-full" role="img" aria-label={`${label} gauge`}>
          <path
            d="M 10 60 A 50 50 0 0 1 110 60"
            fill="none"
            className="stroke-primary/20"
            strokeWidth="10"
            strokeLinecap="round"
          />
          <motion.path
            d="M 10 60 A 50 50 0 0 1 110 60"
            fill="none"
            className={toneClasses.fg}
            strokeWidth="10"
            strokeLinecap="round"
            strokeDasharray={arcLength}
            style={{ strokeDashoffset: dashOffset }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
          <div className={`text-xl font-semibold ${toneClasses.text}`}>{displayValue}</div>
          <div className="text-sm text-muted-foreground/60">of {safeMax}</div>
        </div>
      </div>
    </div>
  );
}
