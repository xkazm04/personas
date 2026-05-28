// FleetActivityStrip (v2) — the always-on fleet pulse rendered directly under
// the titlebar across the whole app.
//
// One bright bar per running execution, filling left→right along a 20-bar
// track that spans the full window width. A dim tail of bars trails for
// queued runs, so the strip reads as "how much live work + how much pressure"
// at a single glance — without ever summarising attention or mapping personas
// (that is the Monitor's job).
//
// v2 over v1:
//   • Bars ramp the active theme's primary → accent across the lit region.
//   • Bars spring in/out as executions start and finish.
//   • A subtle highlight "comet" sweeps across the running region (liveness).
//   • Hovering reveals a floating readout (counts · oldest age · live cost)
//     without reflowing the app (the 1px reserve is fixed; the readout is an
//     overlay).
//   • Clicking the strip opens the Persona Monitor.
//
// The resting height stays a 1px hairline; the interactive hit-zone is a few
// px tall but absolutely positioned so it never pushes content down.

import { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useOverviewStore } from '@/stores/overviewStore';
import { useSystemStore } from '@/stores/systemStore';
import { useReducedMotion } from '@/hooks/utility/interaction/useMotion';
import { useTranslation } from '@/i18n/useTranslation';
import { computeFleetPulse, layoutSlots, STRIP_SLOTS } from './fleetStripModel';
import { elapsedStr } from './monitor/monitorModel';

/** Bar fill colour along the primary→accent ramp for running slot `index`. */
function runningSlotColor(index: number, runningCount: number): string {
  if (runningCount <= 1) return 'var(--primary)';
  const t = Math.min(1, index / (runningCount - 1));
  const pct = Math.round(t * 100);
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--primary))`;
}

export default function FleetActivityStrip() {
  const { t, tx } = useTranslation();
  const prefersReducedMotion = useReducedMotion();
  const setMonitorOpen = useSystemStore((s) => s.setMonitorOpen);

  // Subscribe to the whole map but reduce to the pulse with a memo keyed on the
  // map identity — the store replaces `activeProcesses` immutably on change, so
  // this recomputes exactly when the fleet's live state moves.
  const activeProcesses = useOverviewStore((s) => s.activeProcesses);
  const pulse = useMemo(() => computeFleetPulse(activeProcesses), [activeProcesses]);
  const slots = useMemo(() => layoutSlots(pulse, STRIP_SLOTS), [pulse]);

  const running = pulse.running;
  const queued = pulse.queued;
  const active = running > 0 || queued > 0;
  const runningCells = Math.min(running, STRIP_SLOTS);

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
      className="relative w-full h-[1px] flex-shrink-0 z-30"
      data-testid="fleet-activity-strip"
    >
      <button
        type="button"
        // Absolutely positioned so the taller hit-zone never reflows content;
        // the visible bar sits at the very top (the 1px reserve line).
        className={`absolute inset-x-0 top-0 h-2.5 px-3 ${active ? 'cursor-pointer' : 'pointer-events-none'}`}
        aria-hidden={!active}
        aria-label={active ? tx(t.monitor.strip_aria, { running, queued }) : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocus={() => setHovered(true)}
        onBlur={() => setHovered(false)}
        onClick={() => active && setMonitorOpen(true)}
      >
        {/* Bar track — pinned to the top hairline. */}
        <span className="absolute inset-x-3 top-0 h-[1px] flex items-stretch gap-px overflow-hidden">
          {slots.map((kind, i) => {
            const isRunning = kind === 'running';
            const isQueued = kind === 'queued';
            const color = isRunning ? runningSlotColor(i, runningCells) : undefined;
            if (prefersReducedMotion) {
              return (
                <span
                  key={i}
                  className={`flex-1 h-full rounded-[0.5px] ${isQueued ? 'bg-primary/30' : ''}`}
                  style={{
                    background: color,
                    opacity: kind === 'empty' ? 0 : 1,
                  }}
                />
              );
            }
            return (
              <motion.span
                key={i}
                className={`flex-1 h-full origin-center rounded-[0.5px] ${isQueued ? 'bg-primary/30' : ''}`}
                style={color ? { background: color } : undefined}
                initial={false}
                animate={{
                  opacity: kind === 'empty' ? 0 : isQueued ? 0.55 : 1,
                  scaleY: kind === 'empty' ? 0.3 : 1,
                }}
                transition={{ type: 'spring', stiffness: 420, damping: 30 }}
              />
            );
          })}

          {/* Liveness "comet" — a soft highlight sweeping across the running
              region. One animated element; gated by reduced motion. */}
          {!prefersReducedMotion && runningCells > 0 && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute top-0 left-0 h-full w-10 bg-gradient-to-r from-transparent via-foreground/50 to-transparent"
              animate={{ x: ['-12%', `${(runningCells / STRIP_SLOTS) * 100}%`] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut', repeatDelay: 0.6 }}
            />
          )}
        </span>
      </button>

      {/* Hover readout — floats below the hairline as an overlay (no reflow). */}
      {hovered && active && (
        <motion.div
          initial={{ opacity: 0, y: -3 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
          className="absolute left-3 top-2.5 z-50 flex items-center gap-2.5 rounded-card border border-primary/15 bg-background/95 backdrop-blur-md shadow-elevation-3 px-3 py-1.5 pointer-events-none"
          role="status"
          data-testid="fleet-strip-readout"
        >
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
        </motion.div>
      )}
    </div>
  );
}
