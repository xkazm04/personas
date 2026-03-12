import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { MOTION_TIMING } from '@/features/templates/animationPresets';

interface EstimatedProgressBarProps {
  isRunning: boolean;
  estimatedSeconds?: number;
  className?: string;
}

/**
 * Hardcoded visual progress bar that fills linearly over the estimated duration.
 *
 * - While running: linear 0->85% over `estimatedSeconds`, then asymptotic crawl toward 98%
 * - When process completes (isRunning -> false): jumps to 100%
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

  return (
    <div role="status" aria-live="polite" aria-label={isRunning ? `Progress: ${Math.round(progress)}%` : 'Complete'} className={`space-y-1.5 ${className ?? ''}`}>
      <div className="h-2 rounded-full bg-primary/10 overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={{ width: '0%' }}
          animate={{ width: `${progress}%` }}
          transition={MOTION_TIMING.FLOW}
        />
      </div>
      <div className="flex justify-between text-sm text-muted-foreground/60">
        <span>{elapsedInt}s elapsed</span>
        {isRunning && elapsed < estimatedSeconds && (
          <span>~{remaining}s remaining</span>
        )}
        {!isRunning && progress >= 100 && (
          <span>Complete</span>
        )}
      </div>
    </div>
  );
}
