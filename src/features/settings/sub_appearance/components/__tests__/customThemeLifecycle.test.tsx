import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { en } from '@/i18n/en';
import CustomThemeCreator from '../CustomThemeCreator';

/**
 * The custom theme editor's save / switch / reopen / reset lifecycle. Each case reproduced a
 * defect at HEAD before its fix (scan-sweep 2026-10-31):
 * - Reset cleared the custom theme AND switched an active non-custom theme to Midnight, because
 *   clearCustomTheme always applies the dark-midnight fallback.
 */
const SAVED = { baseMode: 'dark' as const, primaryColor: '#8b5cf6', accentColor: null, label: 'Mine' };

describe('custom theme editor lifecycle', () => {
  const a = en.settings.appearance;
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });
  beforeEach(() => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
  });

  it('Reset keeps an active non-custom theme', () => {
    act(() => { useThemeStore.getState().setCustomTheme(SAVED); });
    act(() => { useThemeStore.getState().setTheme('light-ice'); });
    render(<CustomThemeCreator />);
    fireEvent.click(screen.getByRole('button', { name: a.reset }));
    expect(useThemeStore.getState().customTheme).toBeNull();
    expect(useThemeStore.getState().themeId).toBe('light-ice');
  });

  it('Reset of the ACTIVE custom theme falls back to a built-in theme', () => {
    act(() => { useThemeStore.getState().setCustomTheme(SAVED); });
    render(<CustomThemeCreator />);
    fireEvent.click(screen.getByRole('button', { name: a.reset }));
    expect(useThemeStore.getState().customTheme).toBeNull();
    expect(useThemeStore.getState().themeId).not.toBe('custom');
  });
});
