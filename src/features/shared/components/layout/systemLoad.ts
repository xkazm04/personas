// systemLoad — pure logic for the footer system-load gauge.
//
// The Rust side (get_system_metrics) returns raw CPU% + memory numbers; all the
// UX tuning (smoothing + the green/amber/red banding) lives here so it is cheap
// to iterate and unit-testable without a DOM (see systemLoad.test.ts).

export type LoadLevel = 'green' | 'amber' | 'red';

/**
 * Exponential moving average. `prev === null` seeds with the first sample.
 * A small alpha (~0.25) damps single-tick spikes while staying responsive —
 * it separates a transient burst from sustained load.
 */
export function ema(prev: number | null, sample: number, alpha = 0.25): number {
  return prev === null ? sample : alpha * sample + (1 - alpha) * prev;
}

// Two-threshold hysteresis: a metric must cross the (higher) ENTER threshold to
// move to a worse level, and fall below the (lower) EXIT threshold to step back
// down. The gap between them is what stops the gauge flickering at a cusp.
// CPU is in %, memory in *used*-% (so a high value = little headroom left).
const CPU_ENTER_RED = 88, CPU_ENTER_AMBER = 72, CPU_EXIT_RED = 80, CPU_EXIT_AMBER = 64;
const MEM_ENTER_RED = 90, MEM_ENTER_AMBER = 78, MEM_EXIT_RED = 84, MEM_EXIT_AMBER = 72;

/**
 * Resolve the next load level from smoothed CPU% and used-RAM% with hysteresis.
 * `prev` is the level from the previous tick; the worst of the two metrics wins.
 */
export function nextLoadLevel(prev: LoadLevel, cpu: number, memUsedPct: number): LoadLevel {
  const entersRed = cpu >= CPU_ENTER_RED || memUsedPct >= MEM_ENTER_RED;
  if (entersRed) return 'red';
  // Hold red until BOTH metrics drop below their red-exit thresholds.
  if (prev === 'red' && (cpu >= CPU_EXIT_RED || memUsedPct >= MEM_EXIT_RED)) return 'red';

  const entersAmber = cpu >= CPU_ENTER_AMBER || memUsedPct >= MEM_ENTER_AMBER;
  if (entersAmber) return 'amber';
  // Coming down from amber/red, hold amber until BOTH drop below amber-exit.
  if ((prev === 'amber' || prev === 'red') && (cpu >= CPU_EXIT_AMBER || memUsedPct >= MEM_EXIT_AMBER)) {
    return 'amber';
  }
  return 'green';
}
