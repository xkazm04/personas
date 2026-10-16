// A calendar day (YYYY-MM-DD, the map's own day strings) in the app's language: "Oct 8". The day is UTC by
// construction (the map writes UTC days), so the formatter names UTC and the host's zone never moves it.
import { createModuleCache } from '@/hooks/utility/data/useModuleSubscription';

/** One formatter per language, held by the app's shared module cache (bounded). */
const cache = createModuleCache<string, Intl.DateTimeFormat>({ maxSize: 16 });

export function fmtDay(language: string, d: string): string {
  if (!d) return '';
  let f = cache.get(language);
  if (!f) { f = new Intl.DateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }); cache.set(language, f); }
  return f.format(new Date(d.slice(0, 10) + 'T00:00:00Z'));
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b.slice(0, 10) + 'T00:00:00Z') - Date.parse(a.slice(0, 10) + 'T00:00:00Z')) / 86_400_000);
