import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { en } from '@/i18n/en';
import CustomThemeCreator from '../CustomThemeCreator';

/**
 * The "Theme Name" label sat beside its input with no htmlFor/id link, so the field's accessible
 * name fell back to its placeholder ("Custom") - which is also its default value.
 */
describe('custom theme editor labels', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('the theme name field is named by its visible label', () => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
    render(<CustomThemeCreator />);
    expect(screen.queryAllByRole('textbox', { name: en.settings.appearance.theme_name })).toHaveLength(1);
  });
});
