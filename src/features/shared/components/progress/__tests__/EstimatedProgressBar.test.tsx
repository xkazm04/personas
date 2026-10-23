import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { EstimatedProgressBar } from '../EstimatedProgressBar';

/**
 * Every colour this bar paints is a HEX custom property (`--primary: #06b6d4`,
 * globals.css). `hsl(var(--primary))` over a hex value is invalid at computed-
 * value time and the browser drops the declaration, so the fill rendered with no
 * colour at all. jsdom does not compute custom properties, so the guard asserts
 * the declarations the component writes, and the token's real format is read
 * from globals.css so the premise cannot rot silently.
 */
describe('EstimatedProgressBar colours', () => {
  let frames: FrameRequestCallback[] = [];

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      frames.push(cb);
      return frames.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads --primary as a hex token (the premise of the fix)', () => {
    const css = readFileSync(resolve(__dirname, '../../../../../styles/globals.css'), 'utf8');
    const primaries = [...css.matchAll(/^\s*--primary:\s*([^;]+);/gm)].map((m) => m[1]!.trim());
    expect(primaries.length).toBeGreaterThan(0);
    for (const v of primaries) expect(v).toMatch(/^#[0-9a-f]{3,8}$/i);
  });

  it('never wraps a hex token in hsl(), running or complete', () => {
    const { container, rerender } = render(<EstimatedProgressBar isRunning estimatedSeconds={10} />);
    act(() => {
      const due = frames;
      frames = [];
      for (const cb of due) cb(16);
    });
    const styles = () =>
      [...container.querySelectorAll<HTMLElement>('[style]')].map((el) => el.getAttribute('style') ?? '');
    expect(styles().length).toBeGreaterThan(0);
    for (const s of styles()) expect(s).not.toMatch(/hsl\(\s*var\(/);

    rerender(<EstimatedProgressBar isRunning={false} estimatedSeconds={10} />);
    for (const s of styles()) expect(s).not.toMatch(/hsl\(\s*var\(/);
    expect(styles().some((s) => s.includes('var(--primary)'))).toBe(true);
  });

  it('exposes its value as a progressbar, not an English aria-label', () => {
    render(<EstimatedProgressBar isRunning estimatedSeconds={10} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('0');
  });
});
