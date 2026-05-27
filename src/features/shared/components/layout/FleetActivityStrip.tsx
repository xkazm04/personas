// FleetActivityStrip — the always-on, 1px-tall fleet pulse rendered
// directly under the titlebar across the whole app.
//
// One slot per running execution, populated left-to-right. The strip is a
// fixed 20-slot row spanning the full window width; each slot fades in when
// a new execution starts and fades out when one finishes, so the strip is a
// live "swarm heartbeat" — not a summary of attention, not a per-persona
// map. Idle (zero running) renders an invisible 1px reserve so the page
// layout never jumps.

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useOverviewStore } from '@/stores/overviewStore';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';

/** Number of slots composing the strip's full width. */
const TOTAL_SLOTS = 20;

/** Indices we render every time, regardless of running count. */
const SLOT_INDICES: ReadonlyArray<number> = Array.from({ length: TOTAL_SLOTS }, (_, i) => i);

/**
 * Global fleet activity strip.
 *
 * The number of running executions is selected as a primitive so the strip
 * re-renders only when the count changes — not on every process status
 * tick. Each slot is then animated independently via framer-motion.
 */
export default function FleetActivityStrip() {
  const runningCount = useOverviewStore((s) => {
    let n = 0;
    // Object.values would allocate every render; loop counts in place.
    const procs = s.activeProcesses;
    for (const key in procs) {
      if (procs[key]!.status === 'running') n += 1;
    }
    return n;
  });
  const prefersReducedMotion = useReducedMotion();

  // Clamp to the slot count — a swarm of 40 simultaneous runs maxes out
  // the strip at 20 lit slots (the bar's ceiling is intentional: past 20
  // the visual saturates and adding more says nothing useful).
  const lit = useMemo(() => Math.min(runningCount, TOTAL_SLOTS), [runningCount]);

  // Hide the row entirely when nothing is running so the 1px doesn't pick
  // up faint pixel-grid artefacts; we still take up the 1px so layout
  // remains stable.
  const someoneRunning = runningCount > 0;

  return (
    <div
      className="flex-shrink-0 w-full h-[1px] flex items-stretch gap-px px-3"
      aria-hidden={!someoneRunning}
      role={someoneRunning ? 'progressbar' : undefined}
      aria-label={someoneRunning ? `${runningCount} running` : undefined}
      aria-valuenow={someoneRunning ? runningCount : undefined}
      aria-valuemin={0}
      aria-valuemax={TOTAL_SLOTS}
      data-testid="fleet-activity-strip"
    >
      {SLOT_INDICES.map((i) => {
        const isLit = i < lit;
        // Reduced motion: skip the fade animation; toggle opacity instantly.
        if (prefersReducedMotion) {
          return (
            <span
              key={i}
              aria-hidden
              className="flex-1 h-full bg-primary"
              style={{ opacity: isLit ? 1 : 0 }}
            />
          );
        }
        return (
          <motion.span
            key={i}
            aria-hidden
            className="flex-1 h-full bg-primary origin-center"
            initial={false}
            animate={isLit
              ? { opacity: 1, scaleY: 1 }
              : { opacity: 0, scaleY: 0.35 }}
            transition={{
              opacity: { duration: isLit ? 0.32 : 0.45, ease: 'easeOut' },
              scaleY:  { duration: 0.32, ease: 'easeOut' },
            }}
          />
        );
      })}
    </div>
  );
}
