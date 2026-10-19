import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

interface EstimatedProgressBarProps {
  isRunning: boolean;
  estimatedSeconds?: number;
  className?: string;
}

const MILESTONE_POSITIONS = [25, 50, 75] as const;

/**
 * Returns the bar color based on progress phase.
 *
 * Every colour token here is a HEX value (`--primary: #06b6d4` and its theme
 * overrides in globals.css), so these must be `var()` / `color-mix()`, never
 * `hsl(var(--token))`. They were `hsl(...)`, which is invalid at computed-value
 * time over a hex token: the browser drops the whole declaration, so the filled
 * bar had NO background colour in every phase except overtime, and the milestone
 * ticks had none at all.
 */
function getBarColor(progress: number, isOvertime: boolean, done: boolean): string {
  if (done) return 'var(--primary)';
  if (isOvertime) return 'var(--status-warning)';
  // Gradient from primary toward a slightly lighter tint as progress increases
  if (progress < 50) return 'var(--primary)';
  if (progress < 75) return 'color-mix(in srgb, var(--primary) 90%, transparent)';
  return 'color-mix(in srgb, var(--primary) 85%, transparent)';
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
  const { t } = useTranslation();
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
    rafRef.current = requestAnimationFrame(tickRef.current);
  }, [estimatedSeconds]);

  // Keep the latest tick in a ref so the driver effect below doesn't need to
  // depend on it (tick's identity changes whenever estimatedSeconds changes,
  // which would otherwise cancel and fail to reschedule the rAF loop mid-run).
  const tickRef = useRef(tick);
  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      // Starting
      startRef.current = Date.now();
      setProgress(0);
      setElapsed(0);
      rafRef.current = requestAnimationFrame(tickRef.current);
    } else if (!isRunning && wasRunningRef.current) {
      // Completed -- jump to 100%
      cancelAnimationFrame(rafRef.current);
      setProgress(100);
    }
    wasRunningRef.current = isRunning;

    return () => cancelAnimationFrame(rafRef.current);
  }, [isRunning]);

  // Don't show anything if never started
  if (progress === 0 && !isRunning) return null;

  const remaining = Math.max(0, Math.ceil(estimatedSeconds - elapsed));
  const elapsedInt = Math.floor(elapsed);
  const isOvertime = isRunning && elapsed >= estimatedSeconds;
  const isDone = !isRunning && progress >= 100;
  const barColor = getBarColor(progress, isOvertime, isDone);

  return (
    <div className={`space-y-1.5 ${className ?? ''}`}>
      {/* A progressbar carries its value as numbers, not as an English label.
          The old wrapper was a polite live region whose aria-label was the
          literal "Progress: N%" / "Complete", rewritten on every animation frame. */}
      <div
        role="progressbar"
        aria-label={t.shared.sidebar_extra.progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress)}
        className="relative h-2 rounded-full bg-primary/10 overflow-hidden"
      >
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
                ? 'color-mix(in srgb, var(--background) 35%, transparent)'
                : 'color-mix(in srgb, var(--foreground) 10%, transparent)',
            }}
          />
        ))}
      </div>
      <div className="flex justify-between typo-body text-foreground">
        <span>{elapsedInt}{t.shared.progress_extra.s_elapsed}</span>
        {isRunning && !isOvertime && (
          <span>~{remaining}{t.shared.progress_extra.s_remaining}</span>
        )}
        {isOvertime && (
          <span className="text-amber-500/80">{t.shared.progress_extra.taking_longer}</span>
        )}
        {isDone && (
          <span>{t.shared.progress_extra.complete}</span>
        )}
      </div>
    </div>
  );
}
