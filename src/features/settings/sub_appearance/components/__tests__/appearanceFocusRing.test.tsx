import { describe, it, expect, beforeAll } from 'vitest';
import { render } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { useThemeStore, THEMES } from '@/stores/themeStore';
import { AppearanceOptionTile } from '../AppearanceOptionTile';
import { AppearanceThemeSwatch } from '../AppearanceThemeSwatch';
import { ColorRow } from '../ColorRow';
import CustomThemeCreator from '../CustomThemeCreator';

/**
 * Design.md section 7: focus-ring on every interactive element. Only the theme-name input carried
 * it; every picker tile, swatch, base-mode button, gradient toggle and colour-row button fell back
 * to the WebView's default outline, which is not theme-tuned.
 */
function buttonsWithoutRing(container: HTMLElement): string[] {
  return [...container.querySelectorAll('button')]
    .filter((b) => !b.classList.contains('focus-ring'))
    .map((b) => b.getAttribute('aria-label') ?? b.getAttribute('title') ?? b.textContent ?? '(unnamed)');
}

describe('appearance controls carry the focus-ring token', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });

  it('option tile', () => {
    const { container } = render(<AppearanceOptionTile active={false} onSelect={() => {}} label="Tile" />);
    expect(buttonsWithoutRing(container)).toEqual([]);
  });

  it('theme swatch', () => {
    const { container } = render(<AppearanceThemeSwatch theme={THEMES[0]} active={false} onSelect={() => {}} />);
    expect(buttonsWithoutRing(container)).toEqual([]);
  });

  it('colour row swatch and reset button', () => {
    const { container } = render(<ColorRow label="Primary" value="#336699" derivedValue={undefined} onChange={() => {}} />);
    expect(container.querySelectorAll('button')).toHaveLength(2);
    expect(buttonsWithoutRing(container)).toEqual([]);
  });

  it('custom theme editor buttons (base mode, gradient toggle, colour rows)', () => {
    useThemeStore.setState({ customTheme: null, themeId: 'dark-midnight' });
    const { container } = render(<CustomThemeCreator />);
    expect(buttonsWithoutRing(container)).toEqual([]);
  });
});
