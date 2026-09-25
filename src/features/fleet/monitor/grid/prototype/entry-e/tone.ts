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
    default:
      return { tone: 'off', lit: false };
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
