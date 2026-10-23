/**
 * useRadioState: the `radio:state` subscription and the now-playing refresh.
 *
 * - A hook that unmounts while `listen()` is still attaching must release the
 *   listener when it arrives; the old code only released it if it had already
 *   landed, so every StrictMode mount and every fast remount leaked one.
 * - Two track changes in a row start two now-playing reads; IPC replies are not
 *   ordered, and only the newest may land.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { RadioState } from '@/lib/bindings/RadioState';
import type { Station } from '@/lib/bindings/Station';

type Handler = (event: { payload: RadioState }) => void;

const ev = vi.hoisted(() => ({
  handler: null as null | ((event: { payload: unknown }) => void),
  unlisten: vi.fn(),
  resolveListen: null as null | (() => void),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_name: string, handler: Handler) => {
    ev.handler = handler as (event: { payload: unknown }) => void;
    return new Promise<() => void>((resolve) => {
      ev.resolveListen = () => resolve(ev.unlisten);
    });
  }),
}));

const api = vi.hoisted(() => ({
  getRadioState: vi.fn(),
  getNowPlaying: vi.fn(),
  listStations: vi.fn(),
}));
vi.mock('@/api/radio', () => api);

import { useRadioState } from '../useRadioState';

const STATION: Station = {
  id: 'mix',
  slug: 'mix',
  name: 'Mix',
  description: 'A mix',
  accentColor: '#7c3aed',
  sourceUrl: null,
  sourceLabel: 'YouTube',
  source: {
    kind: 'youtubeTracks',
    tracks: [
      { videoId: 'aaaaaaaaaaa', title: 'One', artist: 'A', durationSec: null },
      { videoId: 'bbbbbbbbbbb', title: 'Two', artist: 'B', durationSec: null },
      { videoId: 'ccccccccccc', title: 'Three', artist: 'C', durationSec: null },
    ],
  },
} as Station;

function stateAt(index: number): RadioState {
  return {
    currentStationId: 'mix',
    status: 'playing',
    volume: 0.5,
    stationCursors: { mix: { currentTrackIndex: index, positionSec: 0, shuffleOrder: [0, 1, 2] } },
  } as RadioState;
}

function playingAt(index: number): NowPlaying {
  const tracks = STATION.source.kind === 'youtubeTracks' ? STATION.source.tracks : [];
  return { station: STATION, track: tracks[index]!, trackIndexInStation: index, status: 'playing' };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('useRadioState', () => {
  beforeEach(() => {
    ev.handler = null;
    ev.resolveListen = null;
    ev.unlisten.mockReset();
    api.getRadioState.mockReset().mockResolvedValue(stateAt(0));
    api.getNowPlaying.mockReset().mockResolvedValue(playingAt(0));
    api.listStations.mockReset().mockResolvedValue([STATION]);
  });

  it('releases a listener that finishes attaching after unmount', async () => {
    const { unmount } = renderHook(() => useRadioState());
    await waitFor(() => expect(ev.resolveListen).not.toBeNull());

    unmount();
    await act(async () => {
      ev.resolveListen!();
    });

    expect(ev.unlisten).toHaveBeenCalledTimes(1);
  });

  it('keeps the newest track when two now-playing reads resolve out of order', async () => {
    const { result } = renderHook(() => useRadioState());
    await waitFor(() => expect(ev.resolveListen).not.toBeNull());
    await act(async () => {
      ev.resolveListen!();
    });
    expect(result.current.nowPlaying?.trackIndexInStation).toBe(0);

    const older = deferred<NowPlaying>();
    const newer = deferred<NowPlaying>();
    api.getNowPlaying.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    // Two skips back to back: track 1, then track 2.
    act(() => {
      ev.handler!({ payload: stateAt(1) });
    });
    act(() => {
      ev.handler!({ payload: stateAt(2) });
    });
    expect(api.getNowPlaying).toHaveBeenCalledTimes(3);

    // The newer read lands first, then the older one arrives late.
    await act(async () => {
      newer.resolve(playingAt(2));
    });
    await act(async () => {
      older.resolve(playingAt(1));
    });

    expect(result.current.state?.stationCursors.mix?.currentTrackIndex).toBe(2);
    expect(result.current.nowPlaying?.trackIndexInStation).toBe(2);
  });
});
