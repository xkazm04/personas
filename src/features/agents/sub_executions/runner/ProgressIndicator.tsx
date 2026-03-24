import { RunningIcon } from '../components/ExecutionLifecycleIcons';
import { formatElapsed } from '@/lib/utils/formatters';
import { MiniPlayerPinButton } from './MiniPlayerPinButton';

interface ProgressIndicatorProps {
  elapsedMs: number;
  typicalDurationMs: number | null;
}

export function ProgressIndicator({ elapsedMs, typicalDurationMs }: ProgressIndicatorProps) {
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
                {elapsedMs < typicalDurationMs
                  ? `Typically completes in ~${formatElapsed(typicalDurationMs)}`
                  : 'Taking longer than usual...'}
              </span>
            </div>
            <div className="w-full h-1.5 rounded-full bg-secondary/50 overflow-hidden">
              <div
                className="animate-fade-in h-full rounded-full bg-primary/40" style={{ width: `${Math.min(100, (elapsedMs / typicalDurationMs) * 100)}%` }}
              />
            </div>
          </div>
        ) : (
          <span className="typo-body text-muted-foreground/90">
            {formatElapsed(elapsedMs)} elapsed
          </span>
        )}
      </div>
    </div>
  );
}
