import { describe, it, expect, beforeEach, vi } from 'vitest';

/**
 * Tests for the `persona-theme` persist `onRehydrateStorage` callback.
 *
 * Source: src/stores/themeStore.ts:265 — two migrations + DOM application:
 *   1. textScale 'default' (removed value) migrates to 'large' (new "Small")
 *   2. When themeId === 'custom' AND customTheme is non-null, the custom-theme
 *      style block is re-injected into the DOM (so the theme survives a reload)
 *   3. applyThemeToDOM / applyTextScale / applyBrightness are called as DOM
 *      side-effects (verified indirectly — these exist outside the migration
 *      contract; their tests live elsewhere)
 *
 * Strategy: seed localStorage with the persisted shape, mock the imported
 * custom-theme helpers so we can spy on `injectCustomThemeStyle`, call
 * `useThemeStore.persist.rehydrate()`, then read the migrated state.
 */

// Spy on the custom-theme DOM helpers so the rehydrate callback's call
// to injectCustomThemeStyle is observable. Must come before the store import.
vi.mock('@/lib/theme/deriveCustomTheme', () => ({
  deriveCustomThemeVars: vi.fn().mockReturnValue({}),
  injectCustomThemeStyle: vi.fn(),
  removeCustomThemeStyle: vi.fn(),
}));

import * as customTheme from '@/lib/theme/deriveCustomTheme';
import { useThemeStore } from '../themeStore';
import { _resetDedupCacheForTests } from '../util/dedupedStorage';

const STORAGE_KEY = 'persona-theme';

function seedPersistedThemeStore(state: Record<string, unknown>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ state, version: 0 }));
}

describe('themeStore onRehydrateStorage — textScale migration', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    vi.mocked(customTheme.injectCustomThemeStyle).mockClear();
    useThemeStore.setState({ textScale: 'larger' });
  });

  it("migrates removed 'default' textScale to 'large' (new 'Small')", async () => {
    seedPersistedThemeStore({ textScale: 'default' });
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().textScale).toBe('large');
  });

  it("preserves 'large' textScale as-is", async () => {
    seedPersistedThemeStore({ textScale: 'large' });
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().textScale).toBe('large');
  });

  it("preserves 'larger' textScale as-is", async () => {
    seedPersistedThemeStore({ textScale: 'larger' });
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().textScale).toBe('larger');
  });
});

describe('themeStore onRehydrateStorage — customTheme re-injection', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetDedupCacheForTests();
    vi.mocked(customTheme.injectCustomThemeStyle).mockClear();
    useThemeStore.setState({ themeId: 'dark-midnight', customTheme: null });
  });

  it('re-injects the custom-theme style block when themeId is custom AND a config is persisted', async () => {
    seedPersistedThemeStore({
      themeId: 'custom',
      customTheme: {
        baseMode: 'dark',
        accentColor: '#abcdef',
        backgroundColor: '#111111',
      },
    });
    await useThemeStore.persist.rehydrate();
    // Two calls because the rehydrate callback injects directly AND
    // applyThemeToDOM (called immediately after) re-injects via its own
    // `if (id === 'custom' && customConfig)` branch. The redundancy is
    // benign (idempotent style block) but worth knowing — if it gets
    // collapsed to one call, this assertion will fail and force a
    // deliberate update.
    expect(customTheme.injectCustomThemeStyle).toHaveBeenCalledTimes(2);
  });

  it('does NOT inject when themeId is custom but customTheme is null', async () => {
    // Defensive: if persisted state lost customTheme but kept themeId='custom',
    // we should not call injectCustomThemeStyle with null config.
    seedPersistedThemeStore({ themeId: 'custom', customTheme: null });
    await useThemeStore.persist.rehydrate();
    expect(customTheme.injectCustomThemeStyle).not.toHaveBeenCalled();
  });

  it('does NOT inject when themeId is a built-in theme', async () => {
    seedPersistedThemeStore({
      themeId: 'dark-midnight',
      customTheme: { baseMode: 'dark', accentColor: '#abcdef', backgroundColor: '#111' },
    });
    await useThemeStore.persist.rehydrate();
    expect(customTheme.injectCustomThemeStyle).not.toHaveBeenCalled();
  });
});
