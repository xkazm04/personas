import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Button from './Button';

/**
 * Regression coverage for the disabled-reason tooltip path. The core hazard: a native
 * disabled <button> cannot receive focus and swallows pointer events, so a tooltip attached
 * to it never surfaces. The fix wraps a disabled-with-reason button in a focusable span
 * (tabIndex 0, aria-disabled) and keeps the button pointer-events-none so hover/focus land
 * on the wrapper instead.
 *
 * Uses plain vitest/chai matchers (not jest-dom) to stay tsc-checked while co-located and
 * independent of the jest-dom setup, matching DeferUntilIdle.test.tsx.
 */
describe('Button disabledReason', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders an enabled, non-wrapped button when not disabled', () => {
    render(<Button>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    // No focusable disabled-reason wrapper around an enabled button.
    expect(btn.parentElement?.getAttribute('aria-disabled')).toBeNull();
  });

  it('wraps a disabled button with a focusable span (tabIndex 0 + aria-disabled)', () => {
    render(
      <Button disabled disabledReason="Add a name to continue">
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    // Inner button is inert so events fall through to the wrapper.
    expect(btn.className).toContain('is-disabled');

    const wrapper = btn.parentElement as HTMLElement;
    expect(wrapper.tagName).toBe('SPAN');
    expect(wrapper.getAttribute('tabindex')).toBe('0');
    expect(wrapper.getAttribute('aria-disabled')).toBe('true');
  });

  it('does NOT add a focusable wrapper when disabled without a reason', () => {
    render(<Button disabled>Save</Button>);
    const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.parentElement?.getAttribute('tabindex')).toBeNull();
    expect(btn.parentElement?.getAttribute('aria-disabled')).toBeNull();
  });

  it('surfaces the reason text after hovering past the tooltip delay', () => {
    vi.useFakeTimers();
    render(
      <Button disabled disabledReason="Add a name to continue">
        Save
      </Button>,
    );
    const wrapper = screen.getByRole('button', { name: 'Save' }).parentElement as HTMLElement;
    expect(screen.queryByText('Add a name to continue')).toBeNull();

    fireEvent.mouseEnter(wrapper);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    // The tooltip renders into a body portal; it stays visibility:hidden until its
    // positioning rAF runs (which it won't under fake timers), so query by text rather
    // than the (accessibility-tree-excluded) tooltip role.
    expect(screen.getByText('Add a name to continue')).toBeTruthy();
  });
});
