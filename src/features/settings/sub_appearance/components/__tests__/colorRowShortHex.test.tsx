import { describe, it, expect, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore } from '@/stores/themeStore';
import { deriveCustomThemeVars } from '@/lib/theme/deriveCustomTheme';
import { en } from '@/i18n/en';
import CustomThemeCreator from '../CustomThemeCreator';

/**
 * The shared ColorPicker accepts and commits a 3-digit hex ("#abc"), but every hex parser behind
 * the custom theme (deriveCustomTheme / contrastRatio hexToRgb) reads six digits, so "#abc" derived
 * 15 of 26 theme variables as "#NaNNaNNaN" and Save persisted them. ColorRow is the one door every
 * custom-theme colour passes through, so it hands the editor a six-digit value.
 */
describe('custom theme colour rows normalise short hex', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('a 3-digit primary colour derives a theme with no NaN variables', () => {
    const a = en.settings.appearance;
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
    render(<CustomThemeCreator />);

    fireEvent.click(screen.getByTitle(`Pick ${a.color_primary}`));
    const region = screen.getByRole('region', { name: `${a.color_primary} color picker` });
    fireEvent.change(within(region).getByRole('textbox'), { target: { value: '#abc' } });
    fireEvent.click(screen.getByRole('button', { name: a.save_apply }));

    const saved = useThemeStore.getState().customTheme;
    expect(saved?.primaryColor).toBe('#aabbcc');
    const nanVars = Object.entries(deriveCustomThemeVars(saved!)).filter(([, v]) => v.includes('NaN'));
    expect(nanVars).toEqual([]);
  });
});
