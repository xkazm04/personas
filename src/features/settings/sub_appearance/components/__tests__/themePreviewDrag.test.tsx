import { describe, it, expect, beforeAll, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import { deriveCustomThemeVars } from '@/lib/theme/deriveCustomTheme';
import { ThemePreview } from '../ThemePreview';

/**
 * A native colour input fires onChange continuously while dragged. ThemePreview keyed its
 * AnimatePresence child by a hash of the colours, so every tick mounted a new full preview tree and
 * kept the previous one alive for its 200 ms exit (~12 stacked trees per window at 60 ticks/s).
 */
function layers(container: HTMLElement): number {
  return container.querySelectorAll('div.absolute.inset-0').length;
}

function hue(i: number): string {
  const h = (i * 37) % 255;
  return `#${h.toString(16).padStart(2, '0')}60a0`;
}

describe('theme preview during a colour drag', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['settings']);
  });
  afterEach(() => vi.useRealTimers());

  it('30 colour ticks inside 100 ms keep at most one preview tree mounted', () => {
    vi.useFakeTimers();
    const mk = (i: number) => deriveCustomThemeVars({ baseMode: 'dark', primaryColor: hue(i), accentColor: null, label: 'x' });
    const { container, rerender } = render(<ThemePreview vars={mk(0)} />);
    let peak = layers(container);
    for (let i = 1; i <= 30; i++) {
      act(() => { rerender(<ThemePreview vars={mk(i)} />); });
      act(() => { vi.advanceTimersByTime(3); });
      peak = Math.max(peak, layers(container));
    }
    expect(peak).toBe(1);
  });

  it('the preview still shows the latest colours', () => {
    const mk = (c: string) => deriveCustomThemeVars({ baseMode: 'dark', primaryColor: c, accentColor: null, label: 'x' });
    const { container, rerender } = render(<ThemePreview vars={mk('#112233')} />);
    rerender(<ThemePreview vars={mk('#aa5500')} />);
    expect(container.innerHTML.toLowerCase()).toMatch(/rgb\(170, 85, 0\)|#aa5500/);
  });
});
