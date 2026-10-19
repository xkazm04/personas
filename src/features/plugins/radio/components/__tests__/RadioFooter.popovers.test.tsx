/**
 * RadioFooter: a popover's trigger closes it. The trigger sits outside the
 * popover, so an outside-press listener that ignores it closed the popover on
 * mousedown and the trigger's click then re-opened it.
 */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

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

async function mountFooter() {
  const { default: RadioFooter } = await import('../RadioFooter');
  return { RadioFooter };
}

describe('RadioFooter popover triggers', () => {
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
    store.state.radioAutoResume = false;
    setPersisted('paused');
  });

  it('the volume trigger closes the popover it opened', async () => {
    const { RadioFooter } = await mountFooter();
    await act(async () => {
      render(<RadioFooter />);
    });
    const trigger = screen.getByRole('button', { name: /volume/i, expanded: false });

    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');

    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('the station trigger closes the picker it opened, and an outside press still closes it', async () => {
    const { RadioFooter } = await mountFooter();
    await act(async () => {
      render(<RadioFooter />);
    });
    const trigger = screen.getByRole('button', { expanded: false, name: /station/i });

    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.mouseDown(document.body);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
