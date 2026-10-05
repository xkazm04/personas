// The Port map's scale: a banded, broken port axis, pure so it can be tested.
//
// Dev ports cluster (3000-3005) and then jump (4321, 5173, 8000, 8080). A linear
// axis would crush the cluster into one pixel and a log axis still bunches it, so
// the axis is cut into BANDS of nearby ports: inside a band every port gets one
// unit (a short run keeps its free holes, so "3004 is free" is visible), and
// between bands a fixed break stands for the skipped range. Positions are in
// TENTHS of a unit so the component can lay them on a CSS grid of 1fr columns.
//
// Cards do NOT sit on the axis: a dense band leaves a port ~60px of axis at
// 1280px, far too little for a readable card. They hang in an evenly spaced
// callout row in port order instead, each tied to its tick by a leader line;
// sorted cards to sorted ticks means no two leaders ever cross.

import type { DevServerView } from '@/lib/bindings/DevServerView';

/** Columns per port unit. */
export const UNIT = 10;
/** Edge padding, in columns, so the outermost cards do not overhang the frame. */
const PAD = 5;
/** Width of a break between bands, in columns. */
const BREAK = 5;
/** Ports at most this far apart share a band. */
const BAND_GAP = 10;
/** A band keeps its free holes only while it is short and mostly occupied. */
const MAX_LINEAR_SPAN = 12;
/** Card rows: 0 sits nearest the axis, 1 stands above it on a longer stem. */
export type PinRow = 0 | 1;

export interface AxisPin {
  port: number;
  /** Every server configured on this port; more than one is a collision and stacks. */
  servers: DevServerView[];
  /** Grid line at the centre of the pin. */
  center: number;
  /** Order along the axis; it is also the card's slot in the callout row. */
  index: number;
  row: PinRow;
}

export interface AxisHole {
  port: number;
  center: number;
}

export interface AxisBand {
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface AxisBreak {
  /** First skipped port and last skipped port. */
  from: number;
  to: number;
  start: number;
  end: number;
}

export interface PortAxis {
  cols: number;
  pins: AxisPin[];
  holes: AxisHole[];
  bands: AxisBand[];
  breaks: AxisBreak[];
}

function splitBands(ports: number[]): number[][] {
  const bands: number[][] = [];
  for (const port of ports) {
    const last = bands[bands.length - 1];
    if (last && port - last[last.length - 1]! <= BAND_GAP) last.push(port);
    else bands.push([port]);
  }
  return bands;
}

/** The ports a band draws: every port of a short dense run, else only occupied ones. */
function bandSlots(band: number[]): { port: number; hole: boolean }[] {
  const from = band[0]!;
  const span = band[band.length - 1]! - from + 1;
  if (span > MAX_LINEAR_SPAN || span > band.length * 2) return band.map((port) => ({ port, hole: false }));
  const occupied = new Set(band);
  return Array.from({ length: span }, (_, i) => ({ port: from + i, hole: !occupied.has(from + i) }));
}

export function buildPortAxis(servers: readonly DevServerView[]): PortAxis {
  const byPort = new Map<number, DevServerView[]>();
  for (const server of servers) {
    const list = byPort.get(server.devPort);
    if (list) list.push(server);
    else byPort.set(server.devPort, [server]);
  }
  const ports = [...byPort.keys()].sort((a, b) => a - b);

  const pins: AxisPin[] = [];
  const holes: AxisHole[] = [];
  const bands: AxisBand[] = [];
  const breaks: AxisBreak[] = [];
  let cursor = PAD;

  for (const band of splitBands(ports)) {
    const prev = bands[bands.length - 1];
    if (prev) {
      breaks.push({ from: prev.to + 1, to: band[0]! - 1, start: cursor, end: cursor + BREAK });
      cursor += BREAK;
    }
    const start = cursor;
    for (const slot of bandSlots(band)) {
      const center = cursor + UNIT / 2;
      if (slot.hole) holes.push({ port: slot.port, center });
      else pins.push({ port: slot.port, servers: byPort.get(slot.port)!, center, index: pins.length, row: 0 });
      cursor += UNIT;
    }
    bands.push({ from: band[0]!, to: band[band.length - 1]!, start, end: cursor });
  }
  const cols = cursor + PAD;

  // Cards hang in two rows of callouts, alternating, so each card is two slots
  // wide and a far card's leader always drops through the gap between two near ones.
  pins.forEach((pin) => {
    pin.row = (pin.index % 2) as PinRow;
  });

  return { cols, pins, holes, bands, breaks };
}
