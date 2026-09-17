import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ColorPicker, COLOR_PRESETS, DEFAULT_PERSONA_COLOR } from '../ColorPicker';
import { contrastRatio, meetsWcagAA, parseHex, relativeLuminance } from '../colorContrast';

describe('colorContrast', () => {
  it('computes the canonical black/white ratio', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  it('expands 3-digit hex and rejects anything else', () => {
    expect(parseHex('#fff')).toEqual([255, 255, 255]);
    expect(parseHex('fff')).toBeNull();
    expect(parseHex('#ggg')).toBeNull();
    expect(relativeLuminance('nope')).toBeNull();
    expect(contrastRatio('#000', 'nope')).toBeNull();
  });

  it('judges amber on white as failing AA and amber on black as passing', () => {
    expect(meetsWcagAA('#f59e0b', '#ffffff')).toBe(false);
    expect(meetsWcagAA('#f59e0b', '#000000')).toBe(true);
    // Unparseable input is never a pass.
    expect(meetsWcagAA('#f59e0b', 'nope')).toBe(false);
  });
});

describe('ColorPicker', () => {
  it('gives every preset a programmatic name', () => {
    render(<ColorPicker value={DEFAULT_PERSONA_COLOR} onChange={vi.fn()} />);
    const named = COLOR_PRESETS.filter((c) =>
      screen.queryByRole('button', { name: new RegExp(c, 'i') }),
    );
    expect(named.length).toBe(COLOR_PRESETS.length);
    expect(screen.getByRole('button', { name: /Violet, #8b5cf6/i })).toBeTruthy();
  });

  it('marks the selected preset with aria-pressed', () => {
    render(<ColorPicker value="#10b981" onChange={vi.fn()} />);
    expect(
      screen.getByRole('button', { name: /Emerald, #10b981/i }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('renders a contrast verdict for the current value', () => {
    render(<ColorPicker value="#10b981" onChange={vi.fn()} />);
    expect(document.querySelector('[data-contrast-verdict]')).toBeTruthy();
  });

  it('hides the reset control when the value is the named default', () => {
    render(<ColorPicker value={DEFAULT_PERSONA_COLOR} onChange={vi.fn()} />);
    expect(screen.queryByTitle(/reset/i)).toBeNull();
  });
});
