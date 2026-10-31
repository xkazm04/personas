import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { THEMES } from '@/stores/themeStore';
import { getContrastRatio } from '@/lib/theme/contrastRatio';
import { AppearanceThemeSwatch } from '../AppearanceThemeSwatch';

/** The contrast badge text a swatch exposes to assistive tech: its aria-label plus whatever its
 *  aria-describedby resolves to. An aria-label replaces content-derived names, so the badge inside
 *  the button is only reachable through aria-describedby. */
function exposedContrastText(container: HTMLElement): string {
  const btn = container.querySelector('button')!;
  const ids = (btn.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
  const described = ids
    .map((id) => container.ownerDocument.getElementById(id))
    .map((el) => el?.getAttribute('aria-label') ?? el?.textContent ?? '')
    .join(' ');
  return `${btn.getAttribute('aria-label') ?? ''} ${described}`;
}

describe('theme swatch contrast level reaches assistive tech', () => {
  it('every swatch exposes its contrast level through aria-describedby', () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(11);
    let exposing = 0;
    for (const theme of THEMES) {
      const { container, unmount } = render(
        <AppearanceThemeSwatch theme={theme} active={false} onSelect={() => {}} />,
      );
      if (/contrast/i.test(exposedContrastText(container))) exposing++;
      unmount();
    }
    expect(exposing).toBe(THEMES.length);
  });

  it('the badge carries no unreachable title tooltip', () => {
    const { container } = render(
      <AppearanceThemeSwatch theme={THEMES[0]} active={false} onSelect={() => {}} />,
    );
    expect(container.querySelector('button [title]')).toBeNull();
  });
});

describe('theme swatch contrast badge is legible on its own tile', () => {
  it('paints the chip from the theme samples, not the app status tokens', () => {
    let legible = 0;
    for (const theme of THEMES) {
      const { container, unmount } = render(
        <AppearanceThemeSwatch theme={theme} active={false} onSelect={() => {}} />,
      );
      const badge = container.querySelector<HTMLElement>('button span[id]')!;
      expect(badge.className).not.toMatch(/status-/);
      // jsdom normalises inline colours to rgb(); compare through a probe element.
      const probe = document.createElement('span');
      probe.style.color = theme.foregroundSample;
      probe.style.backgroundColor = theme.backgroundSample;
      if (badge.style.color === probe.style.color && badge.style.backgroundColor === probe.style.backgroundColor
        && getContrastRatio(theme.foregroundSample, theme.backgroundSample) >= 4.5) legible++;
      unmount();
    }
    expect(legible).toBe(THEMES.length);
  });
});
