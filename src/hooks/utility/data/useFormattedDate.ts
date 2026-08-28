import { useMemo } from 'react';
import { useTranslation } from '@/i18n/useTranslation';

export interface UseFormattedDateOptions {
  /**
   * BCP-47 locale override. **Defaults to the active UI language**, not the
   * runtime/OS locale — the app ships 14 languages and an explicit active
   * language, so a user running it in Japanese on an en-US machine used to
   * get English dates next to Japanese chrome. Pass this only as a genuine
   * override (e.g. a fixed-locale export preview). Mirrors the binding
   * `display/Numeric` already does for number separators.
   */
  locale?: string;
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

/**
 * Memoized `Date.toLocaleString` for the render path.
 *
 * Many list/grid rows call `new Date(ts).toLocaleString()` inside their JSX
 * (`PersonaOverviewColumns`, `ExecutionListRow`, etc.). Doing that on every
 * render allocates a fresh Date and runs the ICU formatter for each row;
 * with 50+ rows and routine parent re-renders the work is small but
 * compounding. This hook memoizes per render-site by primitive deps.
 *
 * For unknown/empty input returns `''`. Invalid timestamps also return `''`
 * rather than throwing or yielding `'Invalid Date'`.
 *
 * Identified by `/architect` performance scan 2026-05-17; established by
 * [[Architect/decisions/2026-05-17-list-memo-hygiene]].
 */
export function useFormattedDate(
  ts: string | number | Date | null | undefined,
  options?: UseFormattedDateOptions,
): string {
  const { language: activeLanguage } = useTranslation();
  const locale = options?.locale ?? activeLanguage;
  const dateStyle = options?.dateStyle;
  const timeStyle = options?.timeStyle;
  return useMemo(() => {
    if (ts == null) return '';
    const date = ts instanceof Date ? ts : new Date(ts);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(locale, {
      ...(dateStyle ? { dateStyle } : {}),
      ...(timeStyle ? { timeStyle } : {}),
    });
  }, [ts, locale, dateStyle, timeStyle]);
}
