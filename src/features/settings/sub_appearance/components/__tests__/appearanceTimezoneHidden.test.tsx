import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { en } from '@/i18n/en';
import AppearanceSettings from '../AppearanceSettings';

/**
 * themeStore.timezone has no reader anywhere (operator choice 2026-10-31: hide
 * the picker until one is built). The store field and persistence stay.
 */
describe('Appearance page does not offer the unwired timezone picker', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('renders no timezone section or hint', () => {
    render(<AppearanceSettings />);
    const a = en.settings.appearance;
    expect(screen.queryByText(a.timezone_hint)).toBeNull();
    expect(screen.queryByRole('button', { name: new RegExp(a.timezone, 'i') })).toBeNull();
    expect(document.getElementById('timezone')).toBeNull();
  });
});
