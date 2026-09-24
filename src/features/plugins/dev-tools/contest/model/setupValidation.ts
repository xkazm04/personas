// SetupForm validation — pure, so the form and its tests agree on one verdict.
//
// Returns stable issue CODES; the form translates them. Errors block Create,
// warnings only advise (one seat is a legal contest, just not much of one).
import type { ContestSeatSpec } from '@/lib/bindings/ContestSeatSpec';

import { duplicateSeatIds, isSpecToken } from './seatCatalog';

export const VARIANTS_MIN = 1;
export const VARIANTS_MAX = 5;
export const VARIANTS_DEFAULT = 3;
export const TIMEOUT_MIN_DEFAULT = 60;
export const TIMEOUT_MIN_MIN = 5;
export const TIMEOUT_MIN_MAX = 600;
/** Two seats is the smallest panel that is actually a contest. */
export const RECOMMENDED_MIN_SEATS = 2;

export type SetupIssueCode =
  | 'title-missing'
  | 'project-missing'
  | 'brief-missing'
  | 'seats-missing'
  | 'seats-duplicate'
  | 'seat-token-invalid'
  | 'variants-range'
  | 'timeout-range'
  | 'judges-missing'
  | 'judges-duplicate'
  | 'start-in-past';

export interface SetupIssue {
  code: SetupIssueCode;
  /** The duplicated seat ids, for `seats-duplicate` / `judges-duplicate`. */
  ids?: string[];
}

export interface SetupDraft {
  title: string;
  projectId: string | null;
  brief: string;
  seats: ContestSeatSpec[];
  variantsPerSeat: number;
  timeoutMin: number;
  judgesEnabled: boolean;
  judges: ContestSeatSpec[];
  /** Epoch ms, or null for "as soon as admitted". */
  notBeforeMs: number | null;
}

export interface SetupVerdict {
  errors: SetupIssue[];
  /** Fewer than {@link RECOMMENDED_MIN_SEATS} seats. */
  fewSeats: boolean;
  ok: boolean;
}

export function validateSetup(d: SetupDraft, now = Date.now()): SetupVerdict {
  const errors: SetupIssue[] = [];
  if (!d.title.trim()) errors.push({ code: 'title-missing' });
  if (!d.projectId) errors.push({ code: 'project-missing' });
  if (!d.brief.trim()) errors.push({ code: 'brief-missing' });
  if (d.seats.length === 0) errors.push({ code: 'seats-missing' });
  const dup = duplicateSeatIds(d.seats);
  if (dup.length) errors.push({ code: 'seats-duplicate', ids: dup });
  const everySpec = [...d.seats, ...(d.judgesEnabled ? d.judges : [])];
  if (everySpec.some((s) => !isSpecToken(s.model) || (s.label !== null && !isSpecToken(s.label)))) {
    errors.push({ code: 'seat-token-invalid' });
  }
  if (!Number.isInteger(d.variantsPerSeat) || d.variantsPerSeat < VARIANTS_MIN || d.variantsPerSeat > VARIANTS_MAX) {
    errors.push({ code: 'variants-range' });
  }
  if (!Number.isInteger(d.timeoutMin) || d.timeoutMin < TIMEOUT_MIN_MIN || d.timeoutMin > TIMEOUT_MIN_MAX) {
    errors.push({ code: 'timeout-range' });
  }
  if (d.judgesEnabled) {
    if (d.judges.length === 0) errors.push({ code: 'judges-missing' });
    const jdup = duplicateSeatIds(d.judges);
    if (jdup.length) errors.push({ code: 'judges-duplicate', ids: jdup });
  }
  if (d.notBeforeMs !== null && d.notBeforeMs < now) errors.push({ code: 'start-in-past' });
  return {
    errors,
    fewSeats: d.seats.length > 0 && d.seats.length < RECOMMENDED_MIN_SEATS,
    ok: errors.length === 0,
  };
}

/** `<input type="datetime-local">` value → epoch ms (local time); null when blank or invalid. */
export function parseLocalDateTime(value: string): number | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}
