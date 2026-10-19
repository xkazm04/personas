import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { Tooltip } from '../Tooltip';

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const tip = () => screen.queryByRole('tooltip', { hidden: true });

describe('Tooltip', () => {
  it('waits for its delay before showing', () => {
    render(<Tooltip content="tip" delay={300}><button type="button">t</button></Tooltip>);
    fireEvent.mouseEnter(screen.getByText('t'));
    act(() => { vi.advanceTimersByTime(299); });
    expect(tip()).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(tip()?.textContent).toBe('tip');
  });

  it('leaves no ghost: a hover + focus pair followed by leave never opens it', () => {
    // mouseenter and focus can both fire before the matching leave; a second
    // show() that did not clear the first timer left one that fired after hide().
    render(<Tooltip content="tip" delay={300}><button type="button">t</button></Tooltip>);
    const el = screen.getByText('t');
    fireEvent.mouseEnter(el);
    fireEvent.focus(el);
    fireEvent.mouseLeave(el);
    act(() => { vi.advanceTimersByTime(1000); });
    expect(tip()).toBeNull();
  });

  it('dismisses on Escape (WCAG 1.4.13) and points the trigger at itself while open', () => {
    render(<Tooltip content="tip" delay={0}><button type="button">t</button></Tooltip>);
    const el = screen.getByText('t');
    fireEvent.focus(el);
    act(() => { vi.advanceTimersByTime(0); });
    const shown = tip();
    expect(shown).not.toBeNull();
    expect(el.parentElement?.getAttribute('aria-describedby')).toBe(shown?.id);
    fireEvent.keyDown(el, { key: 'Escape' });
    expect(tip()).toBeNull();
  });

  it('renders children bare when there is nothing to say', () => {
    const { container } = render(<Tooltip content={null}><span>t</span></Tooltip>);
    expect(container.innerHTML).toBe('<span>t</span>');
  });

  it('makes the wrapper the focus target for an inert child when triggerFocusable', () => {
    render(<Tooltip content="why" triggerFocusable><button type="button" disabled>t</button></Tooltip>);
    const wrapper = screen.getByText('t').parentElement!;
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.getAttribute('aria-disabled')).toBe('true');
  });
});
