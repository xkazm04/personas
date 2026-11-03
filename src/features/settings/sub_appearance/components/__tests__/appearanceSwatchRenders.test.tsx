import { describe, it, expect, vi } from 'vitest';
import { render, act } from '@testing-library/react';

/**
 * AppearanceThemeSwatch is memo()-wrapped, but the section passed a fresh `() => setTheme(id)`
 * closure per swatch per render, so one theme change re-rendered all 11 swatches. Every render of
 * the section and of each swatch calls useTranslation exactly once, which makes it the counter.
 */
const renders = vi.hoisted(() => ({ n: 0 }));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return {
    ...mod,
    useTranslation: () => {
      renders.n++;
      return mod.useTranslation();
    },
  };
});

import { useThemeStore } from '@/stores/themeStore';
import AppearanceThemingSection from '../AppearanceThemingSection';

describe('theme swatches re-render only when their own props change', () => {
  it('one theme change re-renders the section plus the two swatches whose active state flipped', () => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
    render(<AppearanceThemingSection />);
    renders.n = 0;
    act(() => {
      useThemeStore.getState().setTheme('dark-cyan');
    });
    expect(renders.n).toBe(3);
  });
});
