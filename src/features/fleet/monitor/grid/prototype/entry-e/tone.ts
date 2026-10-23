// Annunciator: the ONE vocabulary every lamp on the panel speaks.
//
// A lamp has a tone (which colour its light would be) and a lit flag (whether
// the light is on). Everything on the surface, from the census in the command
// bar to a single inbox row, resolves to that pair here, so a persona, a
// session, a slot and a usage window cannot disagree about what "amber" means.

import type { FleetSessionState } from '@/lib/bindings/FleetSessionState';
import type { SquareState } from '../../fleetGridModel';
import type { MeterTone } from '../../usageModel';
import type { TriageTone } from '../../rail/railModel';
import type { PileKey } from '../../skin/piles';

export type Tone = 'run' | 'warn' | 'err' | 'info' | 'ok' | 'off';

export interface Lamp {
  tone: Tone;
  lit: boolean;
}

/** CSS class that sets `--ae-tone` for a subtree. */
export const toneClass = (tone: Tone): string => `ae-t-${tone}`;

export const PERSONA_LAMP: Record<SquareState, Lamp> = {
  running: { tone: 'run', lit: true },
  attention: { tone: 'warn', lit: true },
  failed: { tone: 'err', lit: true },
  idle: { tone: 'off', lit: false },
};

export function sessionLamp(state: FleetSessionState): Lamp {
  switch (state) {
    case 'running':
    case 'spawning':
      return { tone: 'run', lit: true };
    case 'awaiting_input':
      return { tone: 'warn', lit: true };
    case 'stale':
      return { tone: 'warn', lit: false };
    case 'queued':
      return { tone: 'info', lit: false };
    case 'idle':
    case 'finished':
      return { tone: 'ok', lit: false };
    // `expired` is dark like `exited`, but it is named: the lamp is off
    // because the session never ran, not because the default caught it.
    case 'expired':
      return { tone: 'off', lit: false };
    default:
      return { tone: 'off', lit: false };
  }
}

/**
 * What a LINE of a bay wears, from its pile and whether it runs: one rule for
 * persona and session lines alike (polish P1, the owner's items 4 and 5).
 *
 *   needs you      the amber edge and lamp carry it, with the amber need
 *                  glyph; no background wash (the edge and glyph already say it)
 *   needs you AND  running: only the need glyph stays amber; the edge, lamp,
 *                  run glyph and sweep are the run tone, so a working line
 *                  reads as working and the glyph alone says what it asks
 *   critical       red edge, lamp and glyph with the stronger wash: an alarm
 *                  keeps the whole frame even while it runs
 *   working        the run edge and the sweep
 */
export interface LineSignal {
  /** Tone of the edge, the lamp, the status glyph and the sweep (`--ae-tone`). */
  tone: Tone;
  /** `.ae-line` edge classes (entryE.css). */
  edge: string;
  /** The ambient run sweep (`ae-sweep`). */
  sweep: boolean;
  /** Tone of the need glyph and count, when the line needs the operator. */
  need: Tone | null;
}

export function lineSignal(kind: PileKey, running: boolean): LineSignal {
  switch (kind) {
    case 'critical':
      return { tone: 'err', edge: 'is-lit is-critical', sweep: false, need: 'err' };
    case 'warning':
      return running
        ? { tone: 'run', edge: 'is-working', sweep: true, need: 'warn' }
        : { tone: 'warn', edge: 'is-lit', sweep: false, need: 'warn' };
    case 'working':
      return { tone: 'run', edge: 'is-working', sweep: true, need: null };
    case 'off':
      return { tone: 'off', edge: 'is-off', sweep: false, need: null };
    default:
      return { tone: 'off', edge: '', sweep: false, need: null };
  }
}

export const METER_TONE: Record<MeterTone, Tone> = { ok: 'run', warning: 'warn', error: 'err' };

export function triageTone(tone: TriageTone): Tone {
  switch (tone) {
    case 'danger':
      return 'err';
    case 'warning':
      return 'warn';
    case 'success':
      return 'ok';
    case 'accent':
      return 'run';
    default:
      return 'info';
  }
}

/**
 * Age as a lamp ladder: six rungs on a log scale (1m, 10m, 1h, 6h, 1d, 1w).
 * A session minutes old lights one rung, a week-old one lights all six, so the
 * forgotten session is the long bar, not a string that has to be parsed.
 */
const AGE_RUNGS_MS = [60_000, 600_000, 3_600_000, 21_600_000, 86_400_000, 604_800_000];
export const AGE_RUNG_COUNT = AGE_RUNGS_MS.length;
export function ageRungs(ageMs: number): number {
  let n = 0;
  for (const r of AGE_RUNGS_MS) if (ageMs >= r) n += 1;
  return Math.max(1, n);
}

/** `12s`, `4m`, `3h`, `6d` - the one compact age a window prints. */
export function compactAge(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
