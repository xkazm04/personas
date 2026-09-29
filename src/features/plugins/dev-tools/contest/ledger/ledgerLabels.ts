// The ledger's plain words for closed vocabularies: a seat's state ("Building",
// "Delivered", "Plan limit reached") and a chain station. One switch per
// vocabulary, with a `never` arm, so a new wire value is a compile error.
import type { ContestSeatState } from '@/lib/bindings/ContestSeatState';

import type { ChainStationId, StationStatus } from '../model/contestModel';
import type { ContestStrings } from '../model/labels';

export type LedgerStrings = ContestStrings['ledger'];

export function plainStateLabel(L: LedgerStrings, state: ContestSeatState): string {
  switch (state) {
    case 'idle': return L.state.idle;
    case 'queued': return L.state.queued;
    case 'running': return L.state.running;
    case 'completed': return L.state.completed;
    case 'seat-limit': return L.state.seat_limit;
    case 'timed-out': return L.state.timed_out;
    case 'errored': return L.state.errored;
    default: return unknown(state);
  }
}

export function stationLabel(L: LedgerStrings, id: ChainStationId): string {
  switch (id) {
    case 'collect': return L.station.collect;
    case 'visual': return L.station.visual;
    case 'judges': return L.station.judges;
    case 'ready': return L.station.ready;
    default: return unknown(id);
  }
}

export function stationStatusLabel(L: LedgerStrings, status: StationStatus): string {
  switch (status) {
    case 'done': return L.station_status.done;
    case 'active': return L.station_status.active;
    case 'pending': return L.station_status.pending;
    case 'skipped': return L.station_status.skipped;
    case 'failed': return L.station_status.failed;
    default: return unknown(status);
  }
}

/** A value this build does not know (a newer backend): show the raw token. */
function unknown(v: never): string {
  return String(v);
}
