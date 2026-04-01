import { useMemo } from 'react';
import { HeartPulse, CheckCircle2, AlertCircle, HelpCircle } from 'lucide-react';
import { useTier } from '@/hooks/utility/interaction/useTier';
import type { CredentialMetadata } from '@/lib/types/types';
import type { useBulkHealthcheck } from '@/features/vault/shared/hooks/health/useBulkHealthcheck';

/* ── Compact SVG progress ring (24×24) ── */

const RING_SIZE = 24;
const RING_STROKE = 2.5;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function HealthProgressRing({ done, total, failed }: { done: number; total: number; failed: number }) {
  const fraction = total > 0 ? done / total : 0;
  const offset = RING_CIRCUMFERENCE - fraction * RING_CIRCUMFERENCE;
  const strokeColor = failed > 0 ? '#ef4444' : '#34d399'; // red-500 / emerald-400

  return (
    <div className="relative flex-shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
      <svg width={RING_SIZE} height={RING_SIZE} className="-rotate-90">
        {/* Background track */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth={RING_STROKE}
          className="text-primary/10"
        />
        {/* Progress arc */}
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          stroke={strokeColor}
          strokeWidth={RING_STROKE}
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.3s ease' }}
        />
      </svg>
      {/* Centered count */}
      <span
        className="absolute inset-0 flex items-center justify-center text-[8px] font-bold leading-none text-foreground/70"
        aria-label={`${done} of ${total}`}
      >
        {done}
      </span>
    </div>
  );
}

/* ── HealthStatusBar ── */

interface HealthStatusBarProps {
  credentials: CredentialMetadata[];
  bulk: ReturnType<typeof useBulkHealthcheck>;
  isDailyRun?: boolean;
}

export function HealthStatusBar({ credentials, bulk, isDailyRun }: HealthStatusBarProps) {
  const counts = useMemo(() => {
    let healthy = 0;
    let failing = 0;
    let untested = 0;
    for (const cred of credentials) {
      if (cred.healthcheck_last_success === null || cred.healthcheck_last_success === undefined) {
        untested++;
      } else if (cred.healthcheck_last_success) {
        healthy++;
      } else {
        failing++;
      }
    }
    return { healthy, failing, untested };
  }, [credentials]);

  const { isStarter: isSimple } = useTier();
  if (credentials.length === 0 || isSimple) return null;

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2 bg-secondary/20 border-b border-primary/10">
      {/* Health counts */}
      <div className="flex items-center gap-4 text-sm">
        {counts.healthy > 0 && (
          <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="w-3 h-3" />
            <span className="font-medium">{counts.healthy}</span>
            <span className="text-foreground/50">healthy</span>
          </span>
        )}
        {counts.failing > 0 && (
          <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400">
            <AlertCircle className="w-3 h-3" />
            <span className="font-medium">{counts.failing}</span>
            <span className="text-foreground/50">needs attention</span>
          </span>
        )}
        {counts.untested > 0 && (
          <span className="flex items-center gap-1.5 text-foreground/60">
            <HelpCircle className="w-3 h-3" />
            <span className="font-medium">{counts.untested}</span>
            <span className="text-foreground/50">untested</span>
          </span>
        )}
      </div>

      {/* Test All button */}
      <button
        onClick={bulk.isRunning ? bulk.cancel : () => bulk.run(credentials)}
        className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-medium border transition-colors ${
          bulk.isRunning
            ? 'bg-amber-600/15 text-amber-700 dark:text-amber-400 border-amber-600/25 dark:border-amber-500/20'
            : bulk.summary
              ? bulk.summary.failed > 0
                ? 'bg-red-600/15 text-red-700 dark:text-red-400 border-red-600/25 dark:border-red-500/20'
                : 'bg-emerald-600/15 text-emerald-700 dark:text-emerald-400 border-emerald-600/25 dark:border-emerald-500/20'
              : 'border-violet-600/25 dark:border-violet-500/20 text-violet-700 dark:text-violet-400/80 hover:bg-violet-600/10 dark:hover:bg-violet-500/10 hover:text-violet-700 dark:hover:text-violet-400'
        }`}
        title={bulk.isRunning ? 'Cancel healthcheck' : 'Test all credentials'}
      >
        {bulk.isRunning ? (
          <HealthProgressRing
            done={bulk.progress.done}
            total={bulk.progress.total}
            failed={bulk.progress.failed}
          />
        ) : bulk.summary ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : (
          <HeartPulse className="w-3 h-3" />
        )}
        {bulk.isRunning
          ? isDailyRun
            ? `Daily check ${bulk.progress.done}/${bulk.progress.total}...`
            : `Testing ${bulk.progress.done}/${bulk.progress.total}...`
          : bulk.summary
            ? `${bulk.summary.passed} passed${bulk.summary.failed > 0 ? `, ${bulk.summary.failed} failed` : ''}`
            : 'Test All'}
      </button>
    </div>
  );
}
