/**
 * The caller's UTC offset in minutes EAST of UTC (UTC+2 -> +120, UTC-5 -> -300).
 *
 * `Date#getTimezoneOffset()` has the inverse sign (UTC+2 -> -120). Every
 * overview command that buckets rows by the user's LOCAL day (spend month,
 * health bundle, overview bundle, execution heatmap, SLA trend) takes this
 * value, so the sign flip lives here once instead of at each call site.
 */
export const localUtcOffsetMinutes = (): number => -new Date().getTimezoneOffset();
