import { describe, it, expect, beforeEach } from 'vitest';
import { useThemeStore } from '../themeStore';
import type { CustomThemeConfig } from '@/lib/theme/deriveCustomTheme';

const cfg = (baseMode: 'dark' | 'light'): CustomThemeConfig => ({
  baseMode,
  primaryColor: '#3366cc',
  accentColor: null,
  label: 'Mine',
});

describe('custom theme family stamp', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.classList.remove('dark');
    useThemeStore.setState({ themeId: 'dark-midnight', customTheme: null });
  });

  it('a custom LIGHT theme lands in the light family the [data-theme^="light"] layer keys on', () => {
    useThemeStore.getState().setCustomTheme(cfg('light'));
    const el = document.documentElement;
    expect(el.getAttribute('data-theme')?.startsWith('light')).toBe(true);
    expect(el.classList.contains('dark')).toBe(false);
  });

  it('the injected variables follow the stamped attribute', () => {
    useThemeStore.getState().setCustomTheme(cfg('light'));
    const stamped = document.documentElement.getAttribute('data-theme');
    const css = document.getElementById('persona-custom-theme')?.textContent ?? '';
    expect(css).toContain(`[data-theme="${stamped}"]`);
  });

  it('a custom DARK theme stays out of the light family', () => {
    useThemeStore.getState().setCustomTheme(cfg('dark'));
    const el = document.documentElement;
    expect(el.getAttribute('data-theme')?.startsWith('light')).toBe(false);
    expect(el.classList.contains('dark')).toBe(true);
  });
});
