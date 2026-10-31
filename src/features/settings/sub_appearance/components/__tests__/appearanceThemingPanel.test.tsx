import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { en } from '@/i18n/en';
import AppearanceThemingSection from '../AppearanceThemingSection';

/**
 * The Theming section swaps a Default swatch grid and the Custom editor behind a tab strip.
 * - The editor's draft lives in local state, so unmounting it on a tab switch discarded unsaved picks.
 * - The tabs claimed no panel: aria-controls was withheld and no element was role=tabpanel.
 */
describe('Theming section tabs', () => {
  const a = en.settings.appearance;
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });
  beforeEach(() => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
  });

  it('keeps an unsaved custom-theme edit across a Default / Custom round trip', () => {
    render(<AppearanceThemingSection />);
    fireEvent.click(screen.getByRole('tab', { name: a.custom_tab }));
    fireEvent.change(screen.getByLabelText(a.theme_name), { target: { value: 'Draft' } });
    fireEvent.click(screen.getByRole('tab', { name: a.default_tab }));
    fireEvent.click(screen.getByRole('tab', { name: a.custom_tab }));
    expect((screen.getByLabelText(a.theme_name) as HTMLInputElement).value).toBe('Draft');
  });

  it('every tab controls a tabpanel that exists, and only the active one is visible', () => {
    render(<AppearanceThemingSection />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    for (const tab of tabs) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
      expect(panel?.hidden).toBe(tab.getAttribute('aria-selected') !== 'true');
    }
  });
});
