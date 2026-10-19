/**
 * RadioFooter: the YouTube engine starts when its player becomes ready.
 *
 * The IFrame API loads from the network, so the radio state normally arrives
 * first. The engine-sync effect found no player, returned, and had nothing to
 * re-run it when the player came up: a station already `playing` at that
 * moment (resume on launch) stayed silent, with no watchdog armed.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';

import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { RadioState } from '@/lib/bindings/RadioState';
import type { NowPlaying } from '@/lib/bindings/NowPlaying';
import type { Station } from '@/lib/bindings/Station';

const api = vi.hoisted(() => ({
  radioNext: vi.fn().mockResolvedValue({}),
  radioPause: vi.fn().mockResolvedValue({}),
  radioPlay: vi.fn().mockResolvedValue({}),
  radioPrev: vi.fn().mockResolvedValue({}),
  radioReportStatus: vi.fn().mockResolvedValue({}),
  radioSetStation: vi.fn().mockResolvedValue({}),
  radioSetVolume: vi.fn().mockResolvedValue({}),
  radioTrackEnded: vi.fn().mockResolvedValue({}),
  radioFetchSomafmMetadata: vi.fn().mockResolvedValue(null),
}));
vi.mock('@/api/radio', () => api);

const radio = vi.hoisted(() => ({
  snap: {
    state: null as RadioState | null,
    nowPlaying: null as NowPlaying | null,
    stations: [] as Station[],
    loaded: true,
  },
}));
vi.mock('../../hooks/useRadioState', () => ({ useRadioState: () => radio.snap }));
const yt = vi.hoisted(() => ({
  callbacks: {} as { onReady?: () => void },
  handle: { current: null as null | Record<string, ReturnType<typeof vi.fn>> },
}));
vi.mock('../../hooks/useYouTubePlayer', () => ({
  useYouTubePlayer: (_host: unknown, callbacks: { onReady?: () => void }) => {
    yt.callbacks = callbacks;
    return yt.handle;
  },
}));
vi.mock('../../hooks/useMediaSession', () => ({ useMediaSession: () => undefined }));

const store = vi.hoisted(() => ({
  state: {
    radioAutoResume: false,
    radioEnabled: true,
    disabledStationIds: [] as string[],
    collapsedSourceKinds: [] as string[],
    setSourceKindCollapsed: () => undefined,
    setStationDisabled: () => undefined,
    setRadioEnabled: () => undefined,
  },
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof store.state) => unknown) => selector(store.state),
}));

const MIX: Station = {
  id: 'mix',
  slug: 'mix',
  name: 'Mix',
  description: 'A mix',
  accentColor: '#e11d48',
  sourceUrl: null,
  sourceLabel: 'YouTube',
  source: {
    kind: 'youtubeTracks',
    tracks: [{ videoId: 'dQw4w9WgXcQ', title: 'One', artist: 'A', durationSec: null }],
  },
} as Station;

function fakePlayer() {
  return {
    loadVideo: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    setVolume: vi.fn(),
    getCurrentTime: vi.fn().mockReturnValue(0),
    getDuration: vi.fn().mockReturnValue(0),
  };
}

describe('RadioFooter YouTube engine', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['radio']);
  });

  beforeEach(async () => {
    yt.callbacks = {};
    yt.handle.current = null;
    // Not a launch: this session already drove the radio.
    const launchMod = await import('../../hooks/radioLaunch');
    launchMod.markRadioDriven();
    radio.snap = {
      state: {
        currentStationId: 'mix',
        status: 'playing',
        volume: 0.4,
        stationCursors: { mix: { currentTrackIndex: 0, positionSec: 0, shuffleOrder: [0] } },
      } as RadioState,
      nowPlaying: { station: MIX, track: (MIX.source as { tracks: NowPlaying['track'][] }).tracks[0]!, trackIndexInStation: 0, status: 'playing' },
      stations: [MIX],
      loaded: true,
    };
  });

  it('loads the playing track once the IFrame player reports ready', async () => {
    const { default: RadioFooter } = await import('../RadioFooter');
    await act(async () => {
      render(<RadioFooter />);
    });

    // The IFrame API finished loading after the radio state arrived.
    const player = fakePlayer();
    yt.handle.current = player;
    await act(async () => {
      yt.callbacks.onReady?.();
    });

    expect(player.loadVideo).toHaveBeenCalledTimes(1);
    expect(player.loadVideo).toHaveBeenCalledWith('dQw4w9WgXcQ', { startSeconds: 0, autoplay: true });
    expect(player.setVolume).toHaveBeenCalledWith(0.4);
  });
});
