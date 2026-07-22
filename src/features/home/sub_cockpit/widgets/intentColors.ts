/**
 * Shared intent/trend -> text-color mapping for cockpit widgets.
 *
 * The `good -> emerald-400 / warn -> amber-400 / bad -> rose-400` palette
 * (plus a neutral default/info shade) was re-implemented as an inline
 * ternary or Record in MetricSparkWidget, StatGridWidget,
 * ComparisonCardsWidget, and VerdictWidget. Centralizing it here means a
 * future palette tweak (e.g. the `text-status-*` token migration
 * BrowserTestReportWidget already adopted) only has to change one file.
 */
export type CockpitIntent = 'default' | 'info' | 'good' | 'warn' | 'bad';

const INTENT_TEXT_CLASS: Record<CockpitIntent, string> = {
  default: 'text-foreground',
  info: 'text-primary',
  good: 'text-emerald-400',
  warn: 'text-amber-400',
  bad: 'text-rose-400',
};

/**
 * Resolve an intent string (free-form config from Athena) to its text-color
 * class. `fallback` picks the neutral shade for an unrecognized/missing
 * intent — widgets that default to a plain foreground pass `'default'`,
 * widgets that default to the primary accent pass `'info'`.
 */
export function intentTextClass(
  intent: string | undefined,
  fallback: 'default' | 'info' = 'default',
): string {
  if (intent && intent in INTENT_TEXT_CLASS) {
    return INTENT_TEXT_CLASS[intent as CockpitIntent];
  }
  return INTENT_TEXT_CLASS[fallback];
}

/**
 * Resolve an up/down trend to its text-color class. `neutralClass` covers
 * `'flat'`/missing trend — callers that want no color override pass `''`.
 */
export function intentTrendClass(
  trend: string | undefined,
  neutralClass = 'text-foreground',
): string {
  if (trend === 'up') return 'text-emerald-400';
  if (trend === 'down') return 'text-rose-400';
  return neutralClass;
}
