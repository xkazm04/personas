import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import AppearanceBrightnessSettings from '../AppearanceBrightnessSettings';
import AppearanceTextSizeSettings from '../AppearanceTextSizeSettings';
import AppearanceDensitySettings from '../AppearanceDensitySettings';
import AppearanceTimezoneSettings from '../AppearanceTimezoneSettings';

/** The chosen tile's text must not be dimmer than its unchosen siblings. */
function expectSelectedNotDimmed() {
  const selected = screen.getAllByRole('button').find((b) => b.getAttribute('aria-pressed') === 'true')!;
  const dimmed = Array.from(selected.querySelectorAll('span')).filter((n) => /text-foreground\/\d+/.test(n.className));
  expect(dimmed).toHaveLength(0);
}

describe('selected picker tile keeps full-strength label text', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('brightness', () => {
    useThemeStore.setState({ brightness: 'mid' });
    render(<AppearanceBrightnessSettings />);
    expectSelectedNotDimmed();
  });
  it('text size', () => {
    useThemeStore.setState({ textScale: 'larger' });
    render(<AppearanceTextSizeSettings />);
    expectSelectedNotDimmed();
  });
  it('density', () => {
    useThemeStore.setState({ density: 'cozy' });
    render(<AppearanceDensitySettings />);
    expectSelectedNotDimmed();
  });
  it('timezone', () => {
    useThemeStore.setState({ timezone: 'utc' });
    render(<AppearanceTimezoneSettings />);
    expectSelectedNotDimmed();
  });
});
