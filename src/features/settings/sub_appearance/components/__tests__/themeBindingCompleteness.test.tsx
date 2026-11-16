import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THEMES, customThemeDef } from '@/stores/themeStore';
import { useThemeStore } from '@/stores/themeStore';
import { AppearanceThemeHoverPreview } from '../AppearanceThemeHoverPreview';

const css = readFileSync(resolve(__dirname, '../../../../../styles/globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Ids that have a rule whose selector list names [data-theme="<id>"] and whose body binds --background. */
function boundIds(): Set<string> {
  const bound = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!/--background\s*:/.test(m[2])) continue;
    for (const sel of m[1].split(',')) {
      const id = /^\s*\[data-theme="([^"]+)"\]\s*$/.exec(sel.replace(/\/\*[\s\S]*?\*\//g, ''))?.[1];
      if (id) bound.add(id);
    }
  }
  return bound;
}

describe('hover preview paints the theme it names', () => {
  it('every previewable theme id has a [data-theme] block binding --background', () => {
    const bound = boundIds();
    const missing = THEMES.map((t) => t.id).filter((id) => !bound.has(id));
    expect(missing).toEqual([]);
  });

  it('the custom preview carries its own inline palette (no sheet exists while another theme is active)', () => {
    const config = { baseMode: 'light' as const, primaryColor: '#ff5500', accentColor: null, label: 'Mine' };
    useThemeStore.setState({ customTheme: config, themeId: 'dark-cyan' });
    const { container } = render(<AppearanceThemeHoverPreview theme={customThemeDef(config)} />);
    const scoped = container.querySelector<HTMLElement>('[data-theme]')!;
    expect(scoped.style.getPropertyValue('--background')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(scoped.getAttribute('data-theme')).toBe('light-custom');
  });
});
