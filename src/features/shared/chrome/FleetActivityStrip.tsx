// FleetActivityStrip (v4) — the always-on fleet pulse rendered directly under
// the titlebar across the whole app.
//
// A 2px-tall, 20-bar hairline that is ALWAYS visible (a faint baseline at
// rest). VIEW-ONLY as of v4: the strip is a pure indicator of active personas
// — no hover readout, no click. The Monitor keeps its own doors (nav-mode M,
// the titlebar capsule, Ctrl+M); this hairline just tells the truth at a
// glance.
//
// Bars fill from the CENTRE outward: the first running execution lights the
// central bar, the second switches to the other side, and so on — the strip
// grows symmetrically from the middle (see fleetStripModel.layoutSlots). A dim
// tail continues outward for queued runs.
//
// v4 over v3: interactivity removed (the hover readout + click-to-open-Monitor
// were retired; the strip was competing with the Monitor capsule as a door and
// its hover popover read as noise). Visuals unchanged.

import { useEffect, useMemo } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { useOverviewStore } from '@/stores/overviewStore';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { getAppSettingCoalesced } from '@/hooks/utility/data/useSettings';
import { computeFleetPulse, layoutSlots, slotCountForCapacity } from '@/features/shared/chrome/fleetStripModel';

/** App-settings key for the global concurrency cap (mirrors the Rust const). */
const MAX_PARALLEL_KEY = 'max_parallel_executions';

/**
 * Bar fill colour along the primary→accent ramp, keyed to the bar's ABSOLUTE
 * distance from centre — central bars are primary, edge bars accent — so the
 * ramp is stable regardless of how many are lit. `mid` is the centre line of
 * the (dynamic) bar track.
 */
function rampColor(index: number, mid: number): string {
  const pct = mid <= 0 ? 0 : Math.round((Math.abs(index - mid) / mid) * 100);
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--primary))`;
}

/** Resting opacity for each slot kind. Empty stays faintly visible (baseline). */
const SLOT_OPACITY = { running: 1, queued: 0.5, empty: 0.12 } as const;

export default function FleetActivityStrip() {
  const { t, tx } = useTranslation();
  const prefersReducedMotion = useReducedMotion();

  // One shared, synchronized pulse for ALL running bars — they breathe in
  // unison instead of each drifting into its own rhythm.
  const pulseOpacity = useMotionValue(1);
  useEffect(() => {
    if (prefersReducedMotion) {
      pulseOpacity.set(1);
      return;
    }
    const controls = animate(pulseOpacity, [0.45, 1, 0.45], {
      duration: 3.2,
      repeat: Infinity,
      ease: 'easeInOut',
    });
    return () => controls.stop();
  }, [prefersReducedMotion, pulseOpacity]);

  // Self-heal stale `running` entries: an execution that completed via a path
  // that never emitted `processEnded` would otherwise show "running" forever.
  // The engine hard-caps an execution at 20 min; reap past 25 min. Runs every
  // 60s from this always-mounted chrome strip.
  const reapStaleRunning = useOverviewStore((s) => s.reapStaleRunning);
  useEffect(() => {
    const STALE_MS = 25 * 60 * 1000;
    reapStaleRunning(STALE_MS); // once on mount (catches post-restart staleness)
    const id = setInterval(() => reapStaleRunning(STALE_MS), 60_000);
    return () => clearInterval(id);
  }, [reapStaleRunning]);

  // Subscribe to the whole map, reduce to the pulse keyed on map identity.
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  const pulse = useMemo(() => computeFleetPulse(activeProcesses), [activeProcesses]);

  // Capacity gauge: one bar per concurrent slot, so a full strip = the fleet is
  // at the configured `max_parallel_executions` limit. Seed the cap once from
  // the persisted setting so a custom cap shows before any queue activity.
  const maxParallel = useOverviewStore((s) => s.maxParallelExecutions);
  const setMaxParallel = useOverviewStore((s) => s.setMaxParallelExecutions);
  useEffect(() => {
    let cancelled = false;
    void getAppSettingCoalesced(MAX_PARALLEL_KEY).then((raw) => {
      if (cancelled || raw == null) return;
      const n = Number.parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) setMaxParallel(n);
    });
    return () => {
      cancelled = true;
    };
  }, [setMaxParallel]);

  const slotCount = useMemo(() => slotCountForCapacity(maxParallel), [maxParallel]);
  const mid = (slotCount - 1) / 2;
  const slots = useMemo(() => layoutSlots(pulse, slotCount), [pulse, slotCount]);

  return (
    <div
      className="relative w-full h-[2px] flex-shrink-0 z-30"
      role="status"
      aria-label={tx(t.monitor.strip_aria, { running: pulse.running, queued: pulse.queued })}
      data-testid="fleet-activity-strip"
    >
      {/* Bar track — pinned to the top hairline. Pure indicator, no hit-zone. */}
      <span aria-hidden="true" className="absolute inset-x-3 top-0 h-[2px] flex items-stretch gap-px">
        {slots.map((kind, i) => {
          const background = kind === 'running' ? rampColor(i, mid) : 'var(--primary)';
          // Running bars share ONE pulse MotionValue → synchronized breathing.
          // Queued/empty hold a static opacity (springing on kind change).
          if (kind === 'running' && !prefersReducedMotion) {
            return (
              <motion.span
                key={i}
                className="flex-1 h-full rounded-[1px]"
                style={{ background, opacity: pulseOpacity }}
              />
            );
          }
          const opacity = SLOT_OPACITY[kind];
          if (prefersReducedMotion) {
            return (
              <span
                key={i}
                className="flex-1 h-full rounded-[1px]"
                style={{ background, opacity }}
              />
            );
          }
          return (
            <motion.span
              key={i}
              className="flex-1 h-full rounded-[1px]"
              style={{ background }}
              initial={false}
              animate={{ opacity }}
              transition={{ type: 'spring', stiffness: 380, damping: 28 }}
            />
          );
        })}
      </span>
    </div>
  );
}
