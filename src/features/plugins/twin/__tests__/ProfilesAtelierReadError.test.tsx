import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

// A rejected roster read leaves twinProfiles empty exactly like a first run;
// the page must show the failure with a retry, not the create-your-first-twin hero.

const fetchTwinProfiles = vi.hoisted(() => vi.fn());
const state = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state.current),
}));
vi.mock('../useProfileDashboards', () => ({ useProfileDashboards: () => ({}) }));
vi.mock('../sub_profiles/TwinHero', () => ({ TwinHero: () => <div data-testid="twin-hero" /> }));

import ProfilesAtelier from '../sub_profiles/ProfilesAtelier';

beforeAll(async () => {
  await preloadSectionsAsync('en', ['plugins', 'shared']);
});
beforeEach(() => {
  fetchTwinProfiles.mockClear();
  state.current = {
    twinProfiles: [],
    twinProfilesLoading: false,
    twinProfilesError: null,
    activeTwinId: null,
    fetchTwinProfiles,
    setActiveTwin: vi.fn(),
    deleteTwinProfile: vi.fn(),
    setTwinTab: vi.fn(),
  };
});

describe('ProfilesAtelier roster read failure', () => {
  it('shows an error with retry instead of the first-run hero', () => {
    state.current.twinProfilesError = { error: 'database is locked', kind: 'database' };
    render(<ProfilesAtelier />);
    expect(screen.queryByTestId('twin-hero')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(fetchTwinProfiles).toHaveBeenCalledWith({ force: true });
  });

  it('an empty roster with no error is still the first run', () => {
    render(<ProfilesAtelier />);
    expect(screen.getByTestId('twin-hero')).toBeTruthy();
  });
});
