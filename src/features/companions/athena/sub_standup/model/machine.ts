/**
 * The machine row: measured host load before the pivot, the forecast lanes
 * after it. Pure, so the band redraws from data and never from layout.
 */
import type { ForecastSlot } from '@/lib/bindings/ForecastSlot';
import type { HostUtilizationPoint } from '@/lib/bindings/HostUtilizationPoint';
import { pos } from './timeAxis';
import type { BlockTone, LaneBlock, MachineBar, MachineView, Window } from './types';

const PAST_BINS = 36;
const MAX_LANES = 6;

/** Bin the 1-minute host rollups into fixed-width bars (peak CPU, any agent running). */
export function machineBars(points: readonly HostUtilizationPoint[], w: Window): { bars: MachineBar[]; unrecorded: number } {
  const span = w.to - w.from;
  if (span <= 0) return { bars: [], unrecorded: 1 };
  const width = 1 / PAST_BINS;
  const bins = new Map<number, { cpu: number; busy: boolean }>();
  for (const p of points) {
    if (p.minuteMs < w.from || p.minuteMs >= w.to) continue;
    const k = Math.min(PAST_BINS - 1, Math.floor(((p.minuteMs - w.from) / span) * PAST_BINS));
    const b = bins.get(k) ?? { cpu: 0, busy: false };
    b.cpu = Math.max(b.cpu, p.cpuMax ?? p.cpuAvg ?? 0);
    b.busy = b.busy || p.fleetRunning > 0;
    bins.set(k, b);
  }
  const bars: MachineBar[] = [];
  for (const [k, b] of [...bins.entries()].sort((a, c) => a[0] - c[0])) {
    bars.push({ pos: k * width, width, cpu: Math.min(1, Math.max(0, b.cpu)), busy: b.busy });
  }
  return { bars, unrecorded: 1 - bins.size / PAST_BINS };
}

/**
 * Greedy lane assignment: each slot takes the first lane free at its start.
 * More concurrent slots than MAX_LANES share the last lane (drawn on top).
 */
export function assignLanes(
  slots: readonly ForecastSlot[],
  toneOf: (slot: ForecastSlot) => BlockTone,
  w: Window,
): { laneBlocks: LaneBlock[]; lanes: number; deadShare: number; peakUnits: number } {
  const sorted = [...slots].filter((s) => s.endMs > w.from && s.startMs < w.to).sort((a, b) => a.startMs - b.startMs);
  const free: number[] = [];
  const laneBlocks: LaneBlock[] = [];
  for (const s of sorted) {
    let lane = free.findIndex((t) => t <= s.startMs);
    if (lane < 0) lane = free.length < MAX_LANES ? free.length : MAX_LANES - 1;
    free[lane] = Math.max(free[lane] ?? 0, s.endMs);
    laneBlocks.push({ id: `${s.itemId}:${s.startMs}`, lane, start: pos(s.startMs, w), end: pos(s.endMs, w), tone: toneOf(s) });
  }
  const lanes = Math.max(1, free.length);
  const busy = laneBlocks.reduce((sum, b) => sum + (b.end - b.start), 0);
  return { laneBlocks, lanes, deadShare: Math.max(0, 1 - busy / lanes), peakUnits: peakUnits(sorted) };
}

/** The highest sum of machine units that overlap at any slot start. */
function peakUnits(slots: readonly ForecastSlot[]): number {
  let peak = 0;
  for (const s of slots) {
    const at = s.startMs;
    const units = slots.reduce((n, o) => (o.startMs <= at && o.endMs > at ? n + o.machineUnits : n), 0);
    peak = Math.max(peak, units);
  }
  return peak;
}

export function machineView(
  points: readonly HostUtilizationPoint[],
  slots: readonly ForecastSlot[],
  toneOf: (slot: ForecastSlot) => BlockTone,
  past: Window,
  night: Window,
): MachineView {
  const { bars, unrecorded } = machineBars(points, past);
  return { bars, unrecorded, ...assignLanes(slots, toneOf, night) };
}
