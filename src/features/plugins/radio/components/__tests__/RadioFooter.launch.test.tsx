/**
 * RadioFooter: the launch decision.
 *
 * - "Resume on launch" is decided once per APP LAUNCH. The backend persists
 *   `status` as it was at quit, so a session that quit mid-song launches
 *   `playing`; with the setting off that must be silenced, not played. The
 *   footer also unmounts all session (fleet grid, radio toggle), and a remount
 *   must not re-run the decision.
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
vi.mock('../../hooks/useYouTubePlayer', () => ({ useYouTubePlayer: () => ({ current: null }) }));
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

const STATION: Station = {
  id: 'groovesalad',
  slug: 'groovesalad',
  name: 'Groove Salad',
  description: 'Ambient beats',
  accentColor: '#7c3aed',
  sourceUrl: null,
  sourceLabel: 'SomaFM',
  source: { kind: 'stream', streamUrl: 'https://example.invalid/groovesalad.mp3' },
};

function setPersisted(status: RadioState['status']) {
  radio.snap = {
    state: { currentStationId: STATION.id, status, volume: 0.5, stationCursors: {} },
    nowPlaying: { station: STATION, track: null, trackIndexInStation: null, status },
    stations: [STATION],
    loaded: true,
  };
}

/** A reset latch is a fresh app launch (the latch is module scope). */
async function launch() {
  const launchMod = await import('../../hooks/radioLaunch');
  launchMod.resetRadioLaunchDecision();
  const { default: RadioFooter } = await import('../RadioFooter');
  return { RadioFooter, launchMod };
}

describe('RadioFooter launch decision', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['radio']);
    Object.defineProperty(HTMLMediaElement.prototype, 'play', {
      configurable: true,
      value: () => Promise.resolve(),
    });
    Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: () => undefined });
    Object.defineProperty(HTMLMediaElement.prototype, 'load', { configurable: true, value: () => undefined });
  });

  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockClear();
    store.state.radioAutoResume = false;
  });

  it('setting off: a status persisted as playing is silenced, never played', async () => {
    setPersisted('playing');
    const { RadioFooter } = await launch();
    await act(async () => {
      render(<RadioFooter />);
    });
    expect(api.radioPause).toHaveBeenCalledTimes(1);
    expect(api.radioPlay).not.toHaveBeenCalled();
  });

  it('setting on: resumes a paused station once per launch, not on every remount', async () => {
    store.state.radioAutoResume = true;
    setPersisted('paused');
    const { RadioFooter } = await launch();
    const first = render(<RadioFooter />);
    await act(async () => {});
    expect(api.radioPlay).toHaveBeenCalledTimes(1);

    // The user pauses, then the fleet grid takes the footer slot and gives it back.
    setPersisted('paused');
    first.unmount();
    await act(async () => {
      render(<RadioFooter />);
    });
    expect(api.radioPlay).toHaveBeenCalledTimes(1);
  });

  it('a Settings preview that mounts the footer is not mistaken for a persisted status', async () => {
    setPersisted('playing');
    const { RadioFooter, launchMod } = await launch();
    launchMod.markRadioDriven();
    await act(async () => {
      render(<RadioFooter />);
    });
    expect(api.radioPause).not.toHaveBeenCalled();
  });
});
