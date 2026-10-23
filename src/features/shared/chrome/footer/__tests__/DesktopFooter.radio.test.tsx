/**
 * DesktopFooter: radio playback continuity.
 *
 * RadioFooter owns both playback engines (audio element + YouTube player).
 * Opening the fleet grid used to unmount it, which silenced the music while
 * the backend still said 'playing'. The direction (operator-decided): radio
 * keeps playing behind the grid; turning radio OFF stops it AND leaves the
 * backend status not 'playing'.
 */
import { useEffect } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  store: { radioEnabled: true, fleetGridOpen: false, notepadOpen: false },
  mounts: 0,
  unmounts: 0,
  backendStatus: 'playing' as string,
  radioPause: vi.fn(),
  getRadioState: vi.fn(),
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: typeof h.store) => unknown) => selector(h.store),
}));
vi.mock('@/features/companions/status/useAthenaEnabled', () => ({
  useAthenaEnabled: () => ({ enabled: false }),
}));
vi.mock('@/lib/utils/platform/platform', () => ({ IS_MOBILE: false }));
vi.mock('@/api/radio', () => ({
  getRadioState: h.getRadioState,
  radioPause: h.radioPause,
}));

function Null() {
  return null;
}
function RadioEngineStub() {
  useEffect(() => {
    h.mounts += 1;
    return () => {
      h.unmounts += 1;
    };
  }, []);
  return <div data-testid="radio-engine" />;
}
vi.mock('../lazyFooterIcons', () => ({
  AccountFooterIcon: Null,
  CollapseFooterIcon: Null,
  AthenaFooterIcon: Null,
  DevicesFooterIcon: Null,
  FleetDebugLogFooterPill: Null,
  FleetFooterIcon: Null,
  FooterSectionNav: () => <div data-testid="section-nav" />,
  NetworkFooterIcon: Null,
  NotepadFooterIcon: Null,
  OnboardingReplayFooterIcon: Null,
  PluginContextSelectors: Null,
  RadioFooter: RadioEngineStub,
  ShortcutsFooterIcon: Null,
  SystemLoadFooterIcon: Null,
  ThemeFooterIcon: Null,
  TourResumeFooterIcon: Null,
}));

import DesktopFooter from '../DesktopFooter';

beforeEach(() => {
  h.store.radioEnabled = true;
  h.store.fleetGridOpen = false;
  h.mounts = 0;
  h.unmounts = 0;
  h.backendStatus = 'playing';
  h.radioPause.mockReset().mockImplementation(async () => {
    h.backendStatus = 'paused';
  });
  h.getRadioState.mockReset().mockImplementation(async () => ({ status: h.backendStatus }));
});

describe('DesktopFooter radio continuity', () => {
  it('keeps the radio engines mounted while the fleet grid is open', () => {
    const { rerender } = render(<DesktopFooter />);
    expect(screen.getByTestId('radio-engine')).toBeTruthy();

    h.store.fleetGridOpen = true;
    rerender(<DesktopFooter />);

    // Same instance: never unmounted, so the audio element was not removed.
    expect(h.mounts).toBe(1);
    expect(h.unmounts).toBe(0);
    expect(screen.getByTestId('section-nav')).toBeTruthy();
    expect(screen.getByTestId('radio-engine').parentElement?.className).toContain('hidden');

    h.store.fleetGridOpen = false;
    rerender(<DesktopFooter />);
    expect(h.mounts).toBe(1);
    expect(screen.getByTestId('radio-engine').parentElement?.className).not.toContain('hidden');
  });

  it('does not touch the backend status while radio stays enabled', async () => {
    const { rerender } = render(<DesktopFooter />);
    h.store.fleetGridOpen = true;
    rerender(<DesktopFooter />);
    await Promise.resolve();
    expect(h.radioPause).not.toHaveBeenCalled();
  });

  it('turning radio off stops the engines and leaves the backend not playing', async () => {
    const { rerender } = render(<DesktopFooter />);
    h.store.radioEnabled = false;
    rerender(<DesktopFooter />);

    expect(h.unmounts).toBe(1);
    expect(screen.queryByTestId('radio-engine')).toBeNull();
    await waitFor(() => expect(h.radioPause).toHaveBeenCalledTimes(1));
    expect(h.backendStatus).not.toBe('playing');
  });

  it('does not pause a backend that is already not playing', async () => {
    h.backendStatus = 'stopped';
    h.store.radioEnabled = false;
    render(<DesktopFooter />);
    await waitFor(() => expect(h.getRadioState).toHaveBeenCalled());
    await Promise.resolve();
    expect(h.radioPause).not.toHaveBeenCalled();
  });
});
