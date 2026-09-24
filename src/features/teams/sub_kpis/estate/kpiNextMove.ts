// THE ONE SENTENCE: what a human should do about this place today.
//
// Every surface in the module prints it — the map's rail, the ledger's row,
// the river's tributary — and all three get it from here, so the estate never
// says two different things about the same project. The rule the contest's
// winning entry established: a place is described by what it OWES, in the
// order the debts matter, and a place that owes nothing says so plainly.
//
// Pure. The function returns a DESCRIPTOR, never a string, because the wording
// is i18n's job (the repo pattern from `describeMeasurement`): `nextMoveText`
// renders one with the caller's `t`/`tx`.
import type { DevKpi } from '@/lib/bindings/DevKpi';
import type { Translations } from '@/i18n/generated/types';

import { kpiOffTrackReason, kpiTrack } from '../kpiMath';
import { distancePct } from '../kpiDistance';
import { ageDays, isStale, verdictGap, type KpiTally, type VerdictGap } from './kpiEstate';

type Tx = (template: string, vars: Record<string, string | number>) => string;

/** Coverage at or below this is the headline: a band drawn over this little
 *  of a place is not a reading of the place. */
export const THIN_COVERAGE = 0.25;

export type NextMove =
  | { kind: 'off-track'; offTrack: number; verdicts: number }
  | { kind: 'dark'; total: number }
  | { kind: 'thin'; measured: number; total: number }
  | { kind: 'stale'; stale: number; measured: number }
  | { kind: 'unpaced'; unpaced: number }
  | { kind: 'unobserved'; unmeasured: number; total: number }
  | { kind: 'settled' }
  | { kind: 'kpi-off-track'; pct: number | null; reason: 'floor' | 'crit' | 'pace' | null }
  | { kind: 'kpi-dark' }
  | { kind: 'kpi-unpaced'; gap: VerdictGap }
  | { kind: 'kpi-stale'; days: number; cadence: string }
  | { kind: 'kpi-met' }
  | { kind: 'kpi-on-track' };

/**
 * The move for a PLACE (portfolio, project or group), in priority order:
 * a wrong number first, then a place nobody reads at all, then a band drawn
 * over too little, then readings that have gone stale, then numbers that
 * cannot be judged, then what is simply still dark.
 */
export function nextMoveOf(tally: KpiTally): NextMove {
  if (tally.offTrack > 0) return { kind: 'off-track', offTrack: tally.offTrack, verdicts: tally.verdicts };
  if (tally.total > 0 && tally.measured === 0) return { kind: 'dark', total: tally.total };
  if (tally.coverage < THIN_COVERAGE) return { kind: 'thin', measured: tally.measured, total: tally.total };
  if (tally.stale > 0) return { kind: 'stale', stale: tally.stale, measured: tally.measured };
  if (tally.unpaced > 0) return { kind: 'unpaced', unpaced: tally.unpaced };
  if (tally.unmeasured > 0) return { kind: 'unobserved', unmeasured: tally.unmeasured, total: tally.total };
  return { kind: 'settled' };
}

/** The move for one KPI. Same priority, one row deep. */
export function kpiNextMoveOf(kpi: DevKpi, now: number): NextMove {
  const track = kpiTrack(kpi);
  if (track === 'off-track') return { kind: 'kpi-off-track', pct: distancePct(kpi), reason: kpiOffTrackReason(kpi) };
  if (track === 'unmeasured') return { kind: 'kpi-dark' };
  if (track === 'unpaced') return { kind: 'kpi-unpaced', gap: verdictGap(kpi) };
  if (isStale(kpi, now)) {
    return { kind: 'kpi-stale', days: Math.round(ageDays(kpi, now) ?? 0), cadence: kpi.cadence ?? 'manual' };
  }
  return track === 'met' ? { kind: 'kpi-met' } : { kind: 'kpi-on-track' };
}

/** Which debt a place is carrying — the word a rail or a chip prints beside
 *  the rank, and the key into `next_move_kinds`. */
export function moveKind(move: NextMove): 'off' | 'dark' | 'stale' | 'unpaced' | 'settled' {
  switch (move.kind) {
    case 'off-track':
    case 'kpi-off-track':
      return 'off';
    case 'dark':
    case 'thin':
    case 'unobserved':
    case 'kpi-dark':
      return 'dark';
    case 'stale':
    case 'kpi-stale':
      return 'stale';
    case 'unpaced':
    case 'kpi-unpaced':
      return 'unpaced';
    default:
      return 'settled';
  }
}

/** Render a descriptor with the caller's translations. */
export function nextMoveText(move: NextMove, t: Translations, tx: Tx): string {
  const m = t.kpis.overview.moves;
  switch (move.kind) {
    case 'off-track':
      return tx(m.off_track, { offTrack: move.offTrack, verdicts: move.verdicts });
    case 'dark':
      return tx(m.dark, { total: move.total });
    case 'thin':
      return tx(m.thin, { measured: move.measured, total: move.total });
    case 'stale':
      return tx(m.stale, { stale: move.stale, measured: move.measured });
    case 'unpaced':
      return tx(m.unpaced, { unpaced: move.unpaced });
    case 'unobserved':
      return tx(m.unobserved, { unmeasured: move.unmeasured, total: move.total });
    case 'settled':
      return m.settled;
    case 'kpi-off-track':
      return move.pct == null
        ? m.kpi_off_track_unplaced
        : tx(m.kpi_off_track, { pct: Math.round(move.pct), reason: m.reasons[move.reason ?? 'pace'] });
    case 'kpi-dark':
      return m.kpi_dark;
    case 'kpi-unpaced':
      return tx(m.kpi_unpaced, { missing: m.gaps[move.gap ?? 'target-date'] });
    case 'kpi-stale':
      return tx(m.kpi_stale, { days: move.days, cadence: move.cadence });
    case 'kpi-met':
      return m.kpi_met;
    case 'kpi-on-track':
      return m.kpi_on_track;
  }
}
