/**
 * The footer twin selector after the glyph swap: the disc wears the twin
 * glyph, the roster rows are glyph + name with no role line under it, and the
 * role moved into the tooltip as `name · role` (no em dash; the name alone
 * when there is no role).
 *
 * The i18n layer is NOT mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  state: {
    activeTwinId: 't1' as string | null,
    twinProfiles: [
      { id: 't1', name: 'Ada', role: 'Founder' },
      { id: 't2', name: 'Bob', role: null },
    ],
    fetchTwinProfiles: vi.fn(async () => undefined),
    setActiveTwin: vi.fn(async () => undefined),
  },
}));

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: <T,>(selector: (s: typeof h.state) => T): T => selector(h.state),
}));

import TwinFooterIcon, { twinTooltipLabel } from '../TwinFooterIcon';

beforeEach(() => {
  h.state.activeTwinId = 't1';
  h.state.setActiveTwin.mockClear();
});

describe('twinTooltipLabel', () => {
  it('joins name and role with a middle dot, never an em dash', () => {
    expect(twinTooltipLabel('Ada', 'Founder')).toBe('Ada · Founder');
    expect(twinTooltipLabel('Ada', 'Founder')).not.toContain('—');
  });

  it('is the name alone without a role', () => {
    expect(twinTooltipLabel('Bob', null)).toBe('Bob');
    expect(twinTooltipLabel('Bob', '   ')).toBe('Bob');
  });
});

describe('TwinFooterIcon', () => {
  it('renders nothing without an active twin', () => {
    h.state.activeTwinId = null;
    const { container } = render(<TwinFooterIcon />);
    expect(container).toBeEmptyDOMElement();
  });

  it('the disc wears the twin glyph', () => {
    render(<TwinFooterIcon />);
    const glyph = screen.getByTestId('footer-twin-glyph');
    expect(glyph.tagName.toLowerCase()).toBe('svg');
    expect(glyph.querySelectorAll('path')).toHaveLength(2);
  });

  it('the trigger tooltip reads name · role', async () => {
    vi.useFakeTimers();
    try {
      render(<TwinFooterIcon />);
      fireEvent.mouseEnter(screen.getByTestId('footer-twin-selector'));
      await act(async () => { vi.advanceTimersByTime(1000); });
      // jsdom cannot measure, so the positioned tip stays `visibility: hidden`.
      expect(screen.getByRole('tooltip', { hidden: true })).toHaveTextContent('Ada · Founder');
    } finally {
      vi.useRealTimers();
    }
  });

  it('roster rows are glyph + name with no role line, and picking one switches the twin', () => {
    render(<TwinFooterIcon />);
    fireEvent.click(screen.getByTestId('footer-twin-selector'));

    const ada = screen.getByTestId('footer-twin-option-t1');
    expect(ada).toHaveTextContent(/^Ada$/);
    expect(ada).not.toHaveTextContent('Founder');
    expect(ada.querySelector('svg path')).not.toBeNull();
    expect(ada).toHaveAttribute('aria-selected', 'true');
    // The private 10px role line is gone.
    expect(ada.innerHTML).not.toContain('text-[10px]');

    fireEvent.click(screen.getByTestId('footer-twin-option-t2'));
    expect(h.state.setActiveTwin).toHaveBeenCalledWith('t2');
  });
});
