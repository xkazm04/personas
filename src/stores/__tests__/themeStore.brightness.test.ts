import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@/lib/theme/deriveCustomTheme', () => ({
  deriveCustomThemeVars: vi.fn().mockReturnValue({}),
  injectCustomThemeStyle: vi.fn(),
  removeCustomThemeStyle: vi.fn(),
}));

import { useThemeStore, brightnessValue, resolveBrightness } from '../themeStore';
import { _resetDedupCacheForTests } from '../util/dedupedStorage';

const STORAGE_KEY = 'persona-theme';

function seed(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

describe('brightness per mode', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    useThemeStore.setState({ themeId: 'dark-midnight', brightness: 'low', brightnessByMode: {}, customTheme: null });
  });

  it('a light theme with no pick renders at Standard, not Dimmer', () => {
    useThemeStore.getState().setTheme('light');
    const { brightness } = useThemeStore.getState();
    expect(brightness).toBe('high');
    expect(brightnessValue(brightness, true)).toBe(1.0);
  });

  it('a dark theme with no pick renders at Standard (1.25)', () => {
    expect(brightnessValue(resolveBrightness({}, false), false)).toBe(1.25);
  });

  it('a pick is remembered for its own mode only', () => {
    const st = useThemeStore.getState();
    st.setBrightness('high');             // dark: Brighter
    st.setTheme('light');
    expect(useThemeStore.getState().brightness).toBe('high'); // light default, not the dark pick's meaning
    useThemeStore.getState().setBrightness('mid');           // light: Soft
    useThemeStore.getState().setTheme('dark-midnight');
    expect(useThemeStore.getState().brightness).toBe('high');
    useThemeStore.getState().setTheme('light');
    expect(useThemeStore.getState().brightness).toBe('mid');
  });

  it('rehydrating an old light profile on the shared default restarts at Standard', async () => {
    seed({ themeId: 'light', brightness: 'low' });
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().brightness).toBe('high');
  });

  it('rehydrating an old dark profile keeps its level as the dark pick', async () => {
    seed({ themeId: 'dark-midnight', brightness: 'mid' });
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().brightness).toBe('mid');
    expect(useThemeStore.getState().brightnessByMode).toEqual({ dark: 'mid' });
  });
});
