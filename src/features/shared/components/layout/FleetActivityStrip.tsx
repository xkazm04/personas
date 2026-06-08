// FleetActivityStrip (v3) — the always-on fleet pulse rendered directly under
// the titlebar across the whole app.
//
// A 2px-tall, 20-bar hairline that is ALWAYS visible (a faint baseline at rest)
// and always opens the Monitor on click — so the fleet's live state is legible,
// and the Monitor reachable, from anywhere in the app.
//
// Bars fill from the CENTRE outward: the first running execution lights the
// central bar, the second switches to the other side, and so on — the strip
// grows symmetrically from the middle (see fleetStripModel.layoutSlots). A dim
// tail continues outward for queued runs.
//
// v3 over v2:
//   • 2px tall, always-visible faint baseline (was 1px, invisible at rest).
//   • Centre-out fill instead of left→right.
//   • Position-based primary→accent ramp (centre = primary, edges = accent).
//   • Centre-origin "breathing" shimmer replaces the left→right comet.
//
// The visible bar stays a 2px hairline; the interactive hit-zone is a few px
// tall but absolutely positioned so it never pushes content down.

import { useState, useEffect, useMemo } from 'react';
import { motion, useMotionValue, animate } from 'framer-motion';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { getAppSettingCoalesced } from '@/hooks/utility/data/useSettings';
import { computeFleetPulse, layoutSlots, slotCountForCapacity } from './fleetStripModel';
import { elapsedStr } from './monitor/monitorModel';

/** App-settings key for the global concurrency cap (mirrors the Rust const). */
const MAX_PARALLEL_KEY = 'max_parallel_executions';

/**
 * Bar fill colour along the primary→accent ramp, keyed to the bar's ABSOLUTE
 * distance from centre — central bars are primary, edge bars accent — so the
 * ramp is stable regardless of how many are lit. `mid` is the centre line of
 * the (now dynamic) bar track.
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
  const setMonitorOpen = useSystemStore((s) => s.setMonitorOpen);

  // One shared, synchronized pulse for ALL running bars. Every running bar
  // reads this single MotionValue for its opacity, so they breathe in unison —
  // a bar that lights up later joins the same phase instead of drifting into
  // its own confusing rhythm. Slow + gentle to read as "work in progress".
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

  // Self-heal stale `running` entries: an execution that completed/failed via a
  // path that never emitted `processEnded` (backend restart + orphan-recovery,
  // dropped completion event) would otherwise show "running" forever and inflate
  // the monitor count vs reality. The engine hard-caps a single execution at
  // 20 min, so reap anything `running` past 25 min. Runs every 60s from this
  // always-mounted chrome strip.
  const reapStaleRunning = useOverviewStore((s) => s.reapStaleRunning);
  useEffect(() => {
    const STALE_MS = 25 * 60 * 1000;
    reapStaleRunning(STALE_MS); // reap once on mount (catches post-restart staleness)
    const id = setInterval(() => reapStaleRunning(STALE_MS), 60_000);
    return () => clearInterval(id);
  }, [reapStaleRunning]);

  // Subscribe to the whole map but reduce to the pulse with a memo keyed on the
  // map identity — the store replaces `activeProcesses` immutably on change, so
  // this recomputes exactly when the fleet's live state moves.
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  const pulse = useMemo(() => computeFleetPulse(activeProcesses), [activeProcesses]);

  // Capacity-gauge: the strip renders one bar per concurrent slot, so a full
  // strip means the fleet is at the configured `max_parallel_executions` limit.
  // The cap lives in the store (kept fresh by QUEUE_STATUS events + the Limits
  // panel); seed it once on mount from the persisted setting so a custom cap is
  // reflected before any queue activity.
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

  const running = pulse.running;
  const queued = pulse.queued;
  const active = running > 0 || queued > 0;

  const [hovered, setHovered] = useState(false);

  // Tick once a second only while the readout is open and something runs, so
  // the "oldest" age stays live without a permanent timer.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!hovered || running === 0) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [hovered, running]);

  return (
    <div
      className="relative w-full h-[2px] flex-shrink-0 z-30"
      data-testid="fleet-activity-strip"
    >
      <button
        type="button"
        // Absolutely positioned so the taller hit-zone never reflows content;
        // the visible bar sits at the very top. Always interactive — the strip
        // is a global affordance to open the Monitor.
        className="absolute inset-x-0 top-0 h-2.5 px-3 cursor-pointer"
        aria-label={tx(t.monitor.strip_aria, { running, queued })}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => setMonitorOpen(true)}
      >
        {/* Bar track — pinned to the top hairline. */}
        <span className="absolute inset-x-3 top-0 h-[2px] flex items-stretch gap-px">
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
      </button>

      {/* Hover readout — floats below the hairline as an overlay (no reflow). */}
      {hovered && (
        <motion.div
          // Centre horizontally via framer's own x:-50% (NOT Tailwind
          // -translate-x-1/2, which framer's y animation would clobber on the
          // shared transform). left-1/2 = left:50%.
          initial={{ opacity: 0, x: '-50%', y: -3 }}
          animate={{ opacity: 1, x: '-50%', y: 0 }}
          transition={{ duration: 0.12 }}
          className="absolute left-1/2 top-2.5 z-50 flex items-center gap-2.5 whitespace-nowrap rounded-card border border-primary/15 bg-background/95 backdrop-blur-md shadow-elevation-3 px-3 py-1.5 pointer-events-none"
          role="status"
          data-testid="fleet-strip-readout"
        >
          {active ? (
            <>
              <span className="inline-flex items-center gap-1.5 typo-caption font-medium text-primary">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
                {tx(t.monitor.strip_running, { count: running })}
              </span>
              {queued > 0 && (
                <span className="inline-flex items-center gap-1.5 typo-caption text-foreground">
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/40" />
                  {tx(t.monitor.strip_queued, { count: queued })}
                </span>
              )}
              {pulse.oldestRunningSince !== null && (
                <span className="typo-caption text-foreground tabular-nums">
                  {tx(t.monitor.strip_oldest, { elapsed: elapsedStr(pulse.oldestRunningSince, now) })}
                </span>
              )}
              {pulse.liveCostUsd > 0 && (
                <span className="typo-caption text-foreground tabular-nums">
                  ${pulse.liveCostUsd.toFixed(3)}
                </span>
              )}
              <span className="typo-caption text-foreground border-l border-primary/15 pl-2.5">
                {t.monitor.strip_open_hint}
              </span>
            </>
          ) : (
            <span className="typo-caption text-foreground">{t.monitor.strip_idle_hint}</span>
          )}
        </motion.div>
      )}
    </div>
  );
}
