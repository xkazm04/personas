import type { FleetTranscriptSummary } from '@/lib/bindings/FleetTranscriptSummary';

/** Short-lived summary cache (optimizer pass): the panel remounts on every
 *  session-focus change and every terminal/insights toggle, and each mount
 *  refetched the rollup, so toggling back and forth re-read the same data
 *  seconds apart. Manual refresh bypasses the cache. */
const SUMMARY_CACHE = new Map<string, { summary: FleetTranscriptSummary; at: number }>();
export const SUMMARY_TTL_MS = 15_000;

/** Max sessions kept in the summary cache. Entries are small (a rollup, not a
 *  transcript), but a long-lived fleet session cycles through hundreds of
 *  Claude sessions over days, so cap it so the map doesn't grow unbounded. */
const MAX_SUMMARY_CACHE_ENTRIES = 50;

let summaryCacheEvictions = 0;

/** Read a session's cached summary, touching it to the MRU end on a hit. */
export function readSummaryCache(id: string): { summary: FleetTranscriptSummary; at: number } | undefined {
  const entry = SUMMARY_CACHE.get(id);
  if (entry) {
    SUMMARY_CACHE.delete(id);
    SUMMARY_CACHE.set(id, entry);
  }
  return entry;
}

/** Write a session's summary, evicting the least-recently-used entry past the cap. */
export function writeSummaryCache(id: string, entry: { summary: FleetTranscriptSummary; at: number }): void {
  SUMMARY_CACHE.delete(id);
  SUMMARY_CACHE.set(id, entry);
  while (SUMMARY_CACHE.size > MAX_SUMMARY_CACHE_ENTRIES) {
    const oldestKey = SUMMARY_CACHE.keys().next().value;
    if (oldestKey === undefined) break;
    SUMMARY_CACHE.delete(oldestKey);
    summaryCacheEvictions++;
  }
}

/** Test-only / diagnostic accessor for the eviction counter. */
export function __getInsightsCacheStats(): { size: number; evictions: number } {
  return { size: SUMMARY_CACHE.size, evictions: summaryCacheEvictions };
}

/** Test-only: the module-scope cache leaks between vitest cases otherwise. */
export function __resetInsightsCacheForTests(): void {
  SUMMARY_CACHE.clear();
  summaryCacheEvictions = 0;
}
