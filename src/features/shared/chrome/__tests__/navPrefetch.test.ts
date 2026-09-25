import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  SECTION_CHUNKS,
  NAV_INTENT_DELAY_MS,
  prefetchSection,
  prefetchSectionOnIntent,
  cancelSectionIntent,
  __resetNavPrefetchForTests,
} from '../navPrefetch';
import { prefetchNavTarget } from '@/features/home/lib/prefetch';

type ChunkKey = keyof typeof SECTION_CHUNKS;

/** Replace a section's import thunk with a counting stub (no real chunk loads). */
function stubChunk(id: ChunkKey, impl: () => Promise<unknown> = () => Promise.resolve({ default: () => null })) {
  // The thunk map is a plain object at runtime (`as const` is type-only), so a
  // spy can stand in for the dynamic import.
  return vi.spyOn(SECTION_CHUNKS, id).mockImplementation(impl as never);
}

describe('navPrefetch', () => {
  beforeEach(() => {
    __resetNavPrefetchForTests();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('dedupes: repeated prefetches of one section share a single import', async () => {
    const spy = stubChunk('overview');
    const first = prefetchSection('overview');
    const second = prefetchSection('overview');
    expect(second).toBe(first);
    await first;
    prefetchSection('overview');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('drops a failed entry so the next intent retries', async () => {
    const spy = stubChunk('events', () => Promise.reject(new Error('chunk 404')));
    await prefetchSection('events');
    await prefetchSection('events');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('returns undefined for a section with no chunk (overlay-only Schedules)', () => {
    expect(prefetchSection('schedules')).toBeUndefined();
  });

  it('debounces intent: a sweep across the rail fetches only where the pointer rests', () => {
    vi.useFakeTimers();
    const overview = stubChunk('overview');
    const events = stubChunk('events');
    const settings = stubChunk('settings');

    prefetchSectionOnIntent('overview');
    vi.advanceTimersByTime(NAV_INTENT_DELAY_MS / 2);
    prefetchSectionOnIntent('events');
    vi.advanceTimersByTime(NAV_INTENT_DELAY_MS / 2);
    prefetchSectionOnIntent('settings');
    vi.advanceTimersByTime(NAV_INTENT_DELAY_MS);

    expect(overview).not.toHaveBeenCalled();
    expect(events).not.toHaveBeenCalled();
    expect(settings).toHaveBeenCalledTimes(1);
  });

  it('cancels a pending intent when the pointer leaves before the delay', () => {
    vi.useFakeTimers();
    const spy = stubChunk('credentials');
    prefetchSectionOnIntent('credentials');
    cancelSectionIntent();
    vi.advanceTimersByTime(NAV_INTENT_DELAY_MS * 2);
    expect(spy).not.toHaveBeenCalled();
  });

  it('hover, unhover, hover again on a warmed section is still one import', () => {
    vi.useFakeTimers();
    const spy = stubChunk('studio');
    prefetchSectionOnIntent('studio');
    vi.advanceTimersByTime(NAV_INTENT_DELAY_MS);
    cancelSectionIntent();
    prefetchSectionOnIntent('studio');
    vi.advanceTimersByTime(NAV_INTENT_DELAY_MS);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("Home's card prefetch goes through the same deduped map", async () => {
    const spy = stubChunk('teams');
    prefetchNavTarget('teams');
    await prefetchSection('teams');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
