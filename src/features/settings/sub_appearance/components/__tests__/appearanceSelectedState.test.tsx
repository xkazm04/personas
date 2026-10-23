import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import AppearanceBrightnessSettings from '../AppearanceBrightnessSettings';
import AppearanceTextSizeSettings from '../AppearanceTextSizeSettings';
import AppearanceTimezoneSettings from '../AppearanceTimezoneSettings';
import AppearanceDensitySettings from '../AppearanceDensitySettings';
import AppearanceThemingSection from '../AppearanceThemingSection';
import CustomThemeCreator from '../CustomThemeCreator';
import { en } from '@/i18n/en';

/**
 * Every Appearance picker is a grid of buttons where the chosen one is marked
 * only by a check glyph and a tinted border. Density carried `aria-pressed`;
 * brightness, text size, timezone and the theme swatches did not, so a screen
 * reader heard N identical buttons and no current choice. The onboarding
 * pickers (`AppearancePickers.tsx`) already mark all of theirs.
 */
function pressedStates(): Array<string | null> {
  return screen.getAllByRole('button').map((b) => b.getAttribute('aria-pressed'));
}

function expectExactlyOneChosen(states: Array<string | null>) {
  expect(states.every((s) => s === 'true' || s === 'false')).toBe(true);
  expect(states.filter((s) => s === 'true')).toHaveLength(1);
}

describe('Appearance pickers announce the current choice', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('brightness', () => {
    useThemeStore.setState({ brightness: 'mid' });
    render(<AppearanceBrightnessSettings />);
    // The four a11y switches below the ramp are role=switch, not buttons.
    expectExactlyOneChosen(pressedStates());
  });

  it('text size', () => {
    useThemeStore.setState({ textScale: 'larger' });
    render(<AppearanceTextSizeSettings />);
    expectExactlyOneChosen(pressedStates());
  });

  it('timezone', () => {
    useThemeStore.setState({ timezone: 'utc' });
    render(<AppearanceTimezoneSettings />);
    expectExactlyOneChosen(pressedStates());
  });

  it('density (the one that already did)', () => {
    useThemeStore.setState({ density: 'cozy' });
    render(<AppearanceDensitySettings />);
    expectExactlyOneChosen(pressedStates());
  });

  it('theme swatches', () => {
    useThemeStore.setState({ themeId: 'dark-cyan', customTheme: null });
    render(<AppearanceThemingSection />);
    const swatches = screen
      .getAllByRole('button')
      .filter((b) => b.closest('[role="tablist"]') === null);
    const states = swatches.map((b) => b.getAttribute('aria-pressed'));
    expectExactlyOneChosen(states);
  });

  it('custom theme base mode', () => {
    useThemeStore.setState({ customTheme: null });
    render(<CustomThemeCreator />);
    const a = en.settings.appearance;
    const modes = [a.dark, a.light].map((name) => screen.getByRole('button', { name }));
    expectExactlyOneChosen(modes.map((b) => b.getAttribute('aria-pressed')));
  });
});
