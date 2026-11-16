import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { en } from '@/i18n/en';
import AppearanceBrightnessSettings from '../AppearanceBrightnessSettings';

/** Light-theme brightness options only dim (0.82-1.0); the hint must not promise brightening. */
describe('brightness hint matches the ramp it describes', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });
  const a = en.settings.appearance as Record<string, string>;

  it('dark themes keep the brighten hint', () => {
    useThemeStore.setState({ themeId: 'dark-midnight', customTheme: null });
    render(<AppearanceBrightnessSettings />);
    expect(screen.getByText(a.brightness_hint)).toBeTruthy();
  });

  it('light themes get the glare hint, not the "too dark" one', () => {
    useThemeStore.setState({ themeId: 'light', customTheme: null });
    render(<AppearanceBrightnessSettings />);
    expect(a.brightness_hint_light).toBeTruthy();
    expect(screen.getByText(a.brightness_hint_light)).toBeTruthy();
    expect(screen.queryByText(a.brightness_hint)).toBeNull();
  });
});
