export interface FormatRelativeShortOptions {
  /** Current time in ms epoch; defaults to Date.now(). */
  now?: number;
  /**
   * When true, `iso` may be in the future relative to `now` and the result
   * carries a sign (`-Nm` etc.) plus an `overdue` flag for past-due
   * timestamps. When false (default), `iso` is treated as a past timestamp
   * and the label is always unsigned.
   */
  signed?: boolean;
  /** Hours before the label switches from `Nh` to `Nd`. Default 24. */
  hourCutoff?: number;
}

export interface RelativeShortResult {
  /** Short bucketed label, e.g. `now`, `5m`, `3h`, `2d` (or `-5m` when signed+overdue). */
  label: string;
  /** True when `iso` is in the past relative to `now` (only meaningful when `signed`). */
  overdue: boolean;
}

/**
 * Buckets the delta between `iso` and `now` into a short humanized label
 * (`now` / `Nm` / `Nh` / `Nd`). Shared by the overview dashboard cards that
 * render compact relative timestamps (upcoming routines, vault sync log)
 * instead of each card hand-rolling the same divisor math.
 *
 * Returns `null` for a missing or unparseable `iso`.
 */
export function formatRelativeShort(
  iso: string | null | undefined,
  options: FormatRelativeShortOptions = {},
): RelativeShortResult | null {
  if (!iso) return null;
  const { now = Date.now(), signed = false, hourCutoff = 24 } = options;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;

  const diffMs = signed ? t - now : now - t;
  const overdue = diffMs < 0;
  const abs = Math.abs(diffMs);
  const mins = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  let label: string;
  if (mins < 1) label = 'now';
  else if (mins < 60) label = `${mins}m`;
  else if (hours < hourCutoff) label = `${hours}h`;
  else label = `${days}d`;

  return { label: signed && overdue ? `-${label}` : label, overdue };
}
