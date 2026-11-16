import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { StateMark, type StateMarkState } from '../StateMark';
import { Kbd } from '../Kbd';
import { Figs } from '../Figs';

const GLYPHS: Record<StateMarkState, string> = {
  proposed: 'dashed-ring',
  decided: 'square',
  running: 'hatch',
  done: 'check',
  waits: 'diamond',
  skipped: 'dash',
  blank: 'dotted-ring',
  filler: 'dotted-square',
  refused: 'struck-ring',
  paused: 'pause-bars',
  building: 'hatch-bar',
  queued: 'dotted-loop',
  success: 'check',
  warning: 'diamond-outline',
  error: 'diamond',
  info: 'ring',
  neutral: 'dash',
  processing: 'hatch',
};

describe('StateMark', () => {
  for (const [state, glyph] of Object.entries(GLYPHS) as [StateMarkState, string][]) {
    it(`${state}: ${glyph} glyph and its word`, () => {
      const { container } = render(<StateMark state={state} label={`word-${state}`} />);
      expect(container.querySelector('[data-state]')?.getAttribute('data-state')).toBe(state);
      expect(container.querySelector('svg')?.getAttribute('data-glyph')).toBe(glyph);
      expect(container.textContent).toBe(`word-${state}`);
      // Hatch must not lean on a page-level <defs>.
      expect(container.innerHTML).not.toContain('url(#');
    });
  }

  it('renders a glyph-only mark without a label', () => {
    const { container } = render(<StateMark state="done" />);
    expect(container.textContent).toBe('');
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('takes the accent only for the decided word', () => {
    const { container } = render(<StateMark state="decided" label="chosen" />);
    expect(container.querySelector('span span')?.className).toContain('text-primary');
  });
});

describe('Kbd', () => {
  it('renders a keycap and a solid variant', () => {
    const { container, rerender } = render(<Kbd>K</Kbd>);
    expect(container.querySelector('kbd')?.textContent).toBe('K');
    expect(container.querySelector('kbd')?.className).toContain('border-hair-2');
    rerender(<Kbd solid>K</Kbd>);
    expect(container.querySelector('kbd')?.className).toContain('text-btn-primary-fg');
  });
});

describe('Figs', () => {
  it('wraps every figure in .num and leaves words alone', () => {
    const { container } = render(<p><Figs text="3 of 12 done at 14:30, 87% sure" /></p>);
    const nums = Array.from(container.querySelectorAll('.num')).map((n) => n.textContent);
    expect(nums).toEqual(['3', '12', '14:30', '87%']);
    expect(container.textContent).toBe('3 of 12 done at 14:30, 87% sure');
  });
});
