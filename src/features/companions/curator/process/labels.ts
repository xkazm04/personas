import type { useTranslation } from '@/i18n/useTranslation';
import type { DevOutcome } from './engine/devAdapter';

export type ProcessStrings = ReturnType<typeof useTranslation>['t']['companions']['process'];

/** A station's name: its phase, or several joined when the data braids there. */
export function stationName(p: ProcessStrings, keys: string[]): string {
  return keys.map((k) => phaseName(p, k)).join(' / ');
}

function phaseName(p: ProcessStrings, key: string): string {
  switch (key) {
    case 'brief': return p.phase_brief;
    case 'explore': return p.phase_explore;
    case 'edit': return p.phase_edit;
    case 'verify': return p.phase_verify;
    case 'ship': return p.phase_ship;
    default: return key;
  }
}

export function outcomeName(p: ProcessStrings, o: string): string {
  switch (o as DevOutcome) {
    case 'landed': return p.outcome_landed;
    case 'interrupted': return p.outcome_interrupted;
    case 'errored': return p.outcome_errored;
    case 'quiet': return p.outcome_quiet;
    default: return o;
  }
}

export const pct = (k: number, n: number) => (n ? Math.round((100 * k) / n) : 0);
