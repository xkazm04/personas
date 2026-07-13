/**
 * Tests for the appearance-preference mirror (lib/appearanceMirror.ts).
 *
 * Covers the durability contract:
 *  - fresh/cleared profile hydrates from the backend (mocked empty localStorage
 *    path via hadLocalAppearance = false)
 *  - existing-local + no-backend-row → one-time migration push (idempotent)
 *  - existing-local + backend-row → no push at boot
 *  - write-through is debounced
 *  - coercion rejects unknown enum values without throwing
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/system/settings', () => ({
  getAppSetting: vi.fn().mockResolvedValue(null),
  setAppSetting: vi.fn().mockResolvedValue(undefined),
}));

import { getAppSetting, setAppSetting } from '@/api/system/settings';
import {
  APPEARANCE_PREFERENCES_KEY,
  bootstrapAppearanceMirror,
  coerceAppearancePrefs,
  scheduleWriteThrough,
  snapshotAppearance,
  WRITE_THROUGH_DEBOUNCE_MS,
  __resetAppearanceMirrorForTests,
} from '@/lib/appearanceMirror';
import { useThemeStore } from '@/stores/themeStore';

const mockGet = vi.mocked(getAppSetting);
const mockSet = vi.mocked(setAppSetting);

function resetStore() {
  useThemeStore.setState({
    themeId: 'dark-midnight',
    textScale: 'larger',
    brightness: 'low',
    density: 'comfortable',
    timezone: 'local',
    ambientTimeOfDay: true,
    dim: false,
    cvdSafe: false,
    highContrast: false,
    reduceMotion: false,
    customTheme: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue(null);
  mockSet.mockResolvedValue(undefined);
  __resetAppearanceMirrorForTests();
  resetStore();
});

describe('coerceAppearancePrefs', () => {
  it('accepts a valid blob', () => {
    const prefs = coerceAppearancePrefs({
      themeId: 'dark-cyan',
      textScale: 'xl',
      brightness: 'high',
      density: 'compact',
      timezone: 'America/New_York',
      dim: true,
    });
    expect(prefs.themeId).toBe('dark-cyan');
    expect(prefs.textScale).toBe('xl');
    expect(prefs.brightness).toBe('high');
    expect(prefs.density).toBe('compact');
    expect(prefs.timezone).toBe('America/New_York');
    expect(prefs.dim).toBe(true);
  });

  it('falls back to current store value for unknown enums instead of throwing', () => {
    const cur = snapshotAppearance();
    const prefs = coerceAppearancePrefs({
      themeId: 'not-a-real-theme',
      textScale: 'gigantic',
      brightness: 'ultra',
      density: 'spacious',
    });
    expect(prefs.themeId).toBe(cur.themeId);
    expect(prefs.textScale).toBe(cur.textScale);
    expect(prefs.brightness).toBe(cur.brightness);
    expect(prefs.density).toBe(cur.density);
  });

  it('returns current snapshot for non-object input', () => {
    const cur = snapshotAppearance();
    expect(coerceAppearancePrefs(null)).toEqual(cur);
    expect(coerceAppearancePrefs('garbage')).toEqual(cur);
  });
});

describe('bootstrapAppearanceMirror — hydrate (fresh profile)', () => {
  it('applies backend prefs to the store when localStorage was empty', async () => {
    mockGet.mockResolvedValue(
      JSON.stringify({ themeId: 'dark-bronze', textScale: 'xl', brightness: 'high' }),
    );

    await bootstrapAppearanceMirror(/* hadLocalAppearance */ false);

    const s = useThemeStore.getState();
    expect(s.themeId).toBe('dark-bronze');
    expect(s.textScale).toBe('xl');
    expect(s.brightness).toBe('high');
    // Hydrate must NOT immediately echo back to the backend.
    expect(mockSet).not.toHaveBeenCalled();
  });

  it('leaves defaults untouched when backend also has no row', async () => {
    mockGet.mockResolvedValue(null);
    await bootstrapAppearanceMirror(false);
    expect(useThemeStore.getState().themeId).toBe('dark-midnight');
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('bootstrapAppearanceMirror — migration (existing local)', () => {
  it('pushes current prefs when local exists but backend has no row', async () => {
    mockGet.mockResolvedValue(null);
    await bootstrapAppearanceMirror(/* hadLocalAppearance */ true);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockSet).toHaveBeenCalledWith(APPEARANCE_PREFERENCES_KEY, expect.any(String));
  });

  it('is idempotent — no push when the backend already has a row', async () => {
    mockGet.mockResolvedValue(JSON.stringify(snapshotAppearance()));
    await bootstrapAppearanceMirror(true);
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe('write-through debounce', () => {
  it('coalesces rapid changes into a single debounced backend write', async () => {
    vi.useFakeTimers();
    try {
      // Bootstrap with an existing local + backend row so boot itself writes nothing.
      mockGet.mockResolvedValue(JSON.stringify(snapshotAppearance()));
      await bootstrapAppearanceMirror(true);
      expect(mockSet).not.toHaveBeenCalled();

      scheduleWriteThrough();
      scheduleWriteThrough();
      scheduleWriteThrough();
      expect(mockSet).not.toHaveBeenCalled(); // still within debounce window

      vi.advanceTimersByTime(WRITE_THROUGH_DEBOUNCE_MS);
      expect(mockSet).toHaveBeenCalledTimes(1);
      expect(mockSet).toHaveBeenCalledWith(APPEARANCE_PREFERENCES_KEY, expect.any(String));
    } finally {
      vi.useRealTimers();
    }
  });
});
