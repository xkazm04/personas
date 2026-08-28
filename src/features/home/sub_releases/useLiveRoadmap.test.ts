import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

import type { LiveRoadmapFailureKind, LiveRoadmapOutcome, LiveRoadmapResult } from '@/api/liveRoadmap';

const fetchLiveRoadmap = vi.fn<(opts?: { force?: boolean }) => Promise<LiveRoadmapOutcome>>();

vi.mock('@/api/liveRoadmap', () => ({
  fetchLiveRoadmap: (opts?: { force?: boolean }) => fetchLiveRoadmap(opts),
}));

// The hook only reads two flags off the system store (is the Roadmap tab the
// visible one) to decide whether its hourly poll may run. Feed the selector a
// literal instead of standing up the real store.
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: { sidebarSection: string; homeTab: string }) => unknown) =>
    selector({ sidebarSection: 'home', homeTab: 'roadmap' }),
}));

import { useLiveRoadmap } from './useLiveRoadmap';

function result(source: LiveRoadmapResult['source'], fetchedAt = '2026-08-27T10:00:00Z'): LiveRoadmapOutcome {
  return {
    ok: true,
    result: {
      roadmap: { schemaVersion: 1, release: { version: 'roadmap', status: 'roadmap', items: [] }, i18n: {} },
      fetchedAt,
      source,
    },
  };
}

/**
 * A failed fetch. The kind is now carried across the boundary instead of being
 * collapsed into `null`; the hook's posture is deliberately identical for every
 * kind, which is what the `schema` cases below pin.
 */
function failure(kind: LiveRoadmapFailureKind = 'offline'): LiveRoadmapOutcome {
  return {
    ok: false,
    failure: { kind, structural: kind === 'schema', message: `${kind} failure` },
  };
}

describe('useLiveRoadmap', () => {
  beforeEach(() => {
    fetchLiveRoadmap.mockReset();
  });

  it('reports the source of the first successful load', async () => {
    fetchLiveRoadmap.mockResolvedValue(result('cache'));
    const { result: hook } = renderHook(() => useLiveRoadmap());
    await waitFor(() => expect(hook.current.status).toBe('cached'));
    expect(hook.current.fetchedAt).toBe('2026-08-27T10:00:00Z');
  });

  it('falls to unavailable when the very first fetch fails', async () => {
    fetchLiveRoadmap.mockResolvedValue(failure());
    const { result: hook } = renderHook(() => useLiveRoadmap());
    await waitFor(() => expect(hook.current.status).toBe('unavailable'));
    expect(hook.current.roadmap).toBeNull();
  });

  it('degrades a loaded roadmap to stale when a manual refresh fails', async () => {
    // The regression this pins: the pill kept the previous healthy status, so a
    // refresh that could not reach the network looked exactly like one that
    // succeeded — same green dot, same timestamp, no way to tell.
    fetchLiveRoadmap.mockResolvedValueOnce(result('network'));
    const { result: hook } = renderHook(() => useLiveRoadmap());
    await waitFor(() => expect(hook.current.status).toBe('fresh'));

    fetchLiveRoadmap.mockResolvedValueOnce(failure());
    await act(async () => {
      await hook.current.refresh();
    });

    expect(hook.current.status).toBe('stale');
    // The content the user is reading is unchanged — only its honesty label moved.
    expect(hook.current.fetchedAt).toBe('2026-08-27T10:00:00Z');
    expect(hook.current.refreshing).toBe(false);
  });

  it('keeps unavailable as unavailable when a refresh also fails', async () => {
    fetchLiveRoadmap.mockResolvedValue(failure());
    const { result: hook } = renderHook(() => useLiveRoadmap());
    await waitFor(() => expect(hook.current.status).toBe('unavailable'));

    await act(async () => {
      await hook.current.refresh();
    });
    expect(hook.current.status).toBe('unavailable');
  });

  it('recovers to fresh when a later refresh succeeds', async () => {
    fetchLiveRoadmap.mockResolvedValueOnce(result('network'));
    const { result: hook } = renderHook(() => useLiveRoadmap());
    await waitFor(() => expect(hook.current.status).toBe('fresh'));

    fetchLiveRoadmap.mockResolvedValueOnce(failure());
    await act(async () => { await hook.current.refresh(); });
    expect(hook.current.status).toBe('stale');

    fetchLiveRoadmap.mockResolvedValueOnce(result('network', '2026-08-27T11:00:00Z'));
    await act(async () => { await hook.current.refresh(); });
    expect(hook.current.status).toBe('fresh');
    expect(hook.current.fetchedAt).toBe('2026-08-27T11:00:00Z');
  });

  it('treats a structural failure the same as a transient one on screen', async () => {
    // Schema drift is permanent and silent, and the reader has nothing useful
    // to do about it — so the pill stays honest ('stale') rather than growing a
    // second failure vocabulary. What changes is that the cause survives the
    // boundary at all; the API layer reports the structural ones to Sentry.
    fetchLiveRoadmap.mockResolvedValueOnce(result('network'));
    const { result: hook } = renderHook(() => useLiveRoadmap());
    await waitFor(() => expect(hook.current.status).toBe('fresh'));

    fetchLiveRoadmap.mockResolvedValueOnce(failure('schema'));
    await act(async () => { await hook.current.refresh(); });
    expect(hook.current.status).toBe('stale');
    expect(hook.current.fetchedAt).toBe('2026-08-27T10:00:00Z');
  });
});
