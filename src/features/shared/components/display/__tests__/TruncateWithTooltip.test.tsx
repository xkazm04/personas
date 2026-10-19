import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { TruncateWithTooltip } from '../TruncateWithTooltip';

// jsdom has no layout: every box is 0x0. Drive overflow through the two
// properties the component reads.
let overflowing = true;
const scrollWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth');
const clientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get() { return overflowing ? 300 : 100; },
  });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() { return 100; },
  });
});

afterEach(() => {
  vi.useRealTimers();
  if (scrollWidth) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', scrollWidth);
  if (clientWidth) Object.defineProperty(HTMLElement.prototype, 'clientWidth', clientWidth);
});

const FULL = 'a-very-long-connector-name-that-does-not-fit';

describe('TruncateWithTooltip', () => {
  it('shows the full text on the FIRST hover of truncated text', () => {
    overflowing = true;
    render(<TruncateWithTooltip text={FULL} />);
    fireEvent.mouseEnter(screen.getByText(FULL));
    act(() => { vi.advanceTimersByTime(2000); });
    // hidden: the tip waits a frame for its position, but it is mounted and described.
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe(FULL);
  });

  it('keeps keyboard focus on the text when focus reveals the tooltip', () => {
    overflowing = true;
    render(<TruncateWithTooltip text={FULL} />);
    const el = screen.getByText(FULL);
    act(() => { el.focus(); });
    act(() => { vi.advanceTimersByTime(2000); });
    expect(document.activeElement?.classList.contains('truncate')).toBe(true);
  });

  it('is not a tab stop when nothing is hidden', () => {
    overflowing = false;
    render(<TruncateWithTooltip text="short" />);
    expect(screen.getByText('short').getAttribute('tabindex')).toBeNull();
  });

  it('is a tab stop when truncated, so keyboard users can reach the full text', () => {
    overflowing = true;
    render(<TruncateWithTooltip text={FULL} />);
    expect(screen.getByText(FULL).getAttribute('tabindex')).toBe('0');
  });
});
