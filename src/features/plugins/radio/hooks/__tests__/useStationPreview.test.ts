/**
 * useStationPreview: a station is "previewing" only while something can play it.
 *
 * The footer engines mount only while the radio is enabled. With the radio off,
 * the backend can still hold `playing` (persisted from the last session, or left
 * when the radio was switched off mid-song), and the Settings strip used to show
 * that silent station with a pause glyph and a running equalizer; its first
 * press then PAUSED (enabling the footer into silence) instead of playing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import type { RadioState } from '@/lib/bindings/RadioState';

const api = vi.hoisted(() => ({
  radioPause: vi.fn().mockResolvedValue({}),
  radioPlay: vi.fn().mockResolvedValue({}),
  radioSetStation: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/api/radio', () => api);

const store = vi.hoisted(() => ({
  state: { radioEnabled: false, setRadioEnabled: vi.fn() },
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof store.state) => unknown) => selector(store.state),
}));

import { useStationPreview } from '../useStationPreview';

const LIVE: RadioState = { currentStationId: 'groovesalad', status: 'playing', volume: 0.5, stationCursors: {} };

describe('useStationPreview', () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockClear();
    store.state.setRadioEnabled.mockClear();
  });

  it('radio off: a persisted playing station is not shown as previewing, and a press plays it', async () => {
    store.state.radioEnabled = false;
    const { result } = renderHook(() => useStationPreview(LIVE));
    expect(result.current.previewingId).toBeNull();

    await act(async () => {
      result.current.preview('groovesalad');
    });
    expect(store.state.setRadioEnabled).toHaveBeenCalledWith(true);
    expect(api.radioPause).not.toHaveBeenCalled();
    expect(api.radioSetStation).toHaveBeenCalledWith('groovesalad');
    expect(api.radioPlay).toHaveBeenCalledTimes(1);
  });

  it('radio on: the live station is previewing, and a press pauses it', async () => {
    store.state.radioEnabled = true;
    const { result } = renderHook(() => useStationPreview(LIVE));
    expect(result.current.previewingId).toBe('groovesalad');

    await act(async () => {
      result.current.preview('groovesalad');
    });
    expect(api.radioPause).toHaveBeenCalledTimes(1);
    expect(api.radioPlay).not.toHaveBeenCalled();
  });
});
