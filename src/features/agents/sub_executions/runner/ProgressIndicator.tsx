import { RunningIcon } from '../components/ExecutionLifecycleIcons';
import { formatElapsed } from '@/lib/utils/formatters';
import { MiniPlayerPinButton } from './MiniPlayerPinButton';
import type { StaleLevel } from '@/hooks/execution/useActivityMonitor';

interface ProgressIndicatorProps {
  elapsedMs: number;
  typicalDurationMs: number | null;
  staleLevel?: StaleLevel;
}

const ACTIVITY_LABELS: Record<StaleLevel, { text: string; dotClass: string }> = {
  active:  { text: 'Still receiving output', dotClass: 'bg-emerald-400 animate-pulse' },
  waiting: { text: 'Waiting for output...', dotClass: 'bg-amber-400 animate-pulse' },
  stuck:   { text: 'No output for a while', dotClass: 'bg-red-400' },
};

export function ProgressIndicator({ elapsedMs, typicalDurationMs, staleLevel }: ProgressIndicatorProps) {
  const isOvertime = typicalDurationMs != null && elapsedMs >= typicalDurationMs;
  const showHeartbeat = staleLevel != null && (isOvertime || staleLevel !== 'active');
  const activity = staleLevel ? ACTIVITY_LABELS[staleLevel] : null;

  return (
    <div
      className="animate-fade-slide-in flex items-center gap-3 px-4 py-2.5 bg-primary/5 border border-primary/10 rounded-xl"
    >
      <RunningIcon size={14} className="flex-shrink-0" />
      {/* Mini-player pin toggle */}
      <MiniPlayerPinButton />
      <div className="flex-1 min-w-0">
        {typicalDurationMs ? (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between typo-body">
              <span className="text-muted-foreground/80">
                {formatElapsed(elapsedMs)} elapsed
              </span>
              <span className="text-muted-foreground/80">
                {!isOvertime
                  ? `Typically completes in ~${formatElapsed(typicalDurationMs)}`
                  : 'Taking longer than usual...'}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
              <div
                className="animate-fade-in h-full rounded-full bg-primary/40" style={{ width: `${Math.min(100, (elapsedMs / typicalDurationMs) * 100)}%` }}
              />
            </div>
            {showHeartbeat && activity && (
              <div className="flex items-center gap-1.5 typo-body">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${activity.dotClass}`} />
                <span className="text-muted-foreground/70">{activity.text}</span>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center justify-between typo-body">
            <span className="text-muted-foreground/90">
              {formatElapsed(elapsedMs)} elapsed
            </span>
            {showHeartbeat && activity && (
              <span className="flex items-center gap-1.5 text-muted-foreground/70">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${activity.dotClass}`} />
                {activity.text}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
