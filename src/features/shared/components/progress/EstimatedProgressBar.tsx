import { useState, useEffect, useRef, useCallback } from 'react';

interface EstimatedProgressBarProps {
  isRunning: boolean;
  estimatedSeconds?: number;
  className?: string;
}

const MILESTONE_POSITIONS = [25, 50, 75] as const;

/** Returns the bar color based on progress phase */
function getBarColor(progress: number, isOvertime: boolean, done: boolean): string {
  if (done) return 'hsl(var(--primary))';
  if (isOvertime) return 'hsl(38 92% 50%)'; // amber
  // Gradient from primary toward a slightly shifted hue as progress increases
  if (progress < 50) return 'hsl(var(--primary))';
  if (progress < 75) return 'hsl(var(--primary) / 0.9)';
  return 'hsl(var(--primary) / 0.85)';
}

/**
 * Visual progress bar with milestone markers and phase-aware color transitions.
 *
 * - While running: linear 0->85% over `estimatedSeconds`, then asymptotic crawl toward 98%
 * - Milestone tick marks at 25%, 50%, 75%
 * - Amber tint when past estimated time (asymptotic crawl phase)
 * - When process completes (isRunning -> false): jumps to 100% with primary color
 * - Shows elapsed time and estimated remaining below the bar
 */
export function EstimatedProgressBar({
  isRunning,
  estimatedSeconds = 30,
  className,
}: EstimatedProgressBarProps) {
  const [progress, setProgress] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef<number>(0);
  const rafRef = useRef<number>(0);
  const wasRunningRef = useRef(false);

  const tick = useCallback(() => {
    const now = Date.now();
    const elapsedSec = (now - startRef.current) / 1000;
    setElapsed(elapsedSec);

    let p: number;
    if (elapsedSec < estimatedSeconds) {
      // Linear phase: 0 -> 85%
      p = (elapsedSec / estimatedSeconds) * 85;
    } else {
      // Asymptotic crawl: 85% -> ~98%
      const over = elapsedSec - estimatedSeconds;
      p = 85 + 13 * (1 - 1 / (1 + over * 0.05));
    }
    setProgress(p);
    rafRef.current = requestAnimationFrame(tick);
  }, [estimatedSeconds]);

  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      // Starting
      startRef.current = Date.now();
      setProgress(0);
      setElapsed(0);
      rafRef.current = requestAnimationFrame(tick);
    } else if (!isRunning && wasRunningRef.current) {
      // Completed -- jump to 100%
      cancelAnimationFrame(rafRef.current);
      setProgress(100);
    }
    wasRunningRef.current = isRunning;

    return () => cancelAnimationFrame(rafRef.current);
  }, [isRunning, tick]);

  // Don't show anything if never started
  if (progress === 0 && !isRunning) return null;

  const remaining = Math.max(0, Math.ceil(estimatedSeconds - elapsed));
  const elapsedInt = Math.floor(elapsed);
  const isOvertime = isRunning && elapsed >= estimatedSeconds;
  const isDone = !isRunning && progress >= 100;
  const barColor = getBarColor(progress, isOvertime, isDone);

  return (
    <div role="status" aria-live="polite" aria-label={isRunning ? `Progress: ${Math.round(progress)}%` : 'Complete'} className={`space-y-1.5 ${className ?? ''}`}>
      <div className="relative h-2 rounded-full bg-primary/10 overflow-hidden">
        {/* Filled bar with color transition */}
        <div
          className="animate-fade-in h-full rounded-full"
          style={{
            width: `${progress}%`,
            backgroundColor: barColor,
            transition: 'background-color 0.8s ease',
          }}
        />
        {/* Milestone tick marks */}
        {MILESTONE_POSITIONS.map((pos) => (
          <div
            key={pos}
            className="absolute top-0 h-full w-px"
            style={{
              left: `${pos}%`,
              backgroundColor: progress >= pos
                ? 'hsl(var(--background) / 0.35)'
                : 'hsl(var(--foreground) / 0.1)',
            }}
          />
        ))}
      </div>
      <div className="flex justify-between typo-body text-muted-foreground/60">
        <span>{elapsedInt}s elapsed</span>
        {isRunning && !isOvertime && (
          <span>~{remaining}s remaining</span>
        )}
        {isOvertime && (
          <span className="text-amber-500/80">Taking longer than expected</span>
        )}
        {isDone && (
          <span>Complete</span>
        )}
      </div>
    </div>
  );
}
