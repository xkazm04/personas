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

  it('marks the button aria-busy + disabled while loading and blocks re-clicks', () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const btn = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('swaps the leading icon for the spinner while loading (icon hidden, spinner shown)', () => {
    const { rerender } = render(
      <Button icon={<span data-testid="leading-icon">x</span>}>Save</Button>,
    );
    expect(screen.queryByTestId('leading-icon')).toBeTruthy();

    rerender(
      <Button loading icon={<span data-testid="leading-icon">x</span>}>
        Save
      </Button>,
    );
    // The original icon is unmounted...
    expect(screen.queryByTestId('leading-icon')).toBeNull();
    // ...and an animate-spin spinner takes its place.
    const btn = screen.getByRole('button', { name: 'Save' });
    expect(btn.querySelector('.animate-spin')).toBeTruthy();
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

/**
 * The accent variant's colour comes from ONE closed `tone` map: a status or a role
 * token, never a raw palette step, and never beside a second text colour.
 */
describe('Button tone', () => {
  const TONES = {
    agent: 'role-agent', human: 'role-human', external: 'role-external', highlight: 'role-highlight',
    success: 'status-success', warning: 'status-warning', error: 'status-error', info: 'status-info',
  } as const;

  it.each(Object.entries(TONES))('tone %s renders the %s token recipe', (tone, token) => {
    render(<Button variant="accent" tone={tone as keyof typeof TONES}>Go</Button>);
    const cls = screen.getByRole('button', { name: 'Go' }).className;
    expect(cls).toContain(`text-${token}`);
    expect(cls).toContain(`bg-${token}/10`);
    expect(cls).toContain(`border-${token}/30`);
    expect(cls).not.toMatch(/text-foreground/);
    expect(cls).not.toMatch(/-(?:violet|emerald|amber|rose|cyan|sky|blue|indigo)-\d/);
  });

  it('renders a neutral bordered button for accent without a tone', () => {
    render(<Button variant="accent">Go</Button>);
    const cls = screen.getByRole('button', { name: 'Go' }).className;
    expect(cls).toContain('text-foreground/90');
    expect(cls).not.toMatch(/role-|status-/);
  });

  it('ignores tone outside the accent variant', () => {
    render(<Button variant="ghost" tone="success">Go</Button>);
    expect(screen.getByRole('button', { name: 'Go' }).className).not.toContain('status-success');
  });
});
