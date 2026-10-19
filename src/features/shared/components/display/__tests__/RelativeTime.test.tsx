import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_t, k) => String(k) }) }),
    tx: (s: unknown) => String(s),
    language: 'cs',
  }),
  getActiveTranslations: () => ({}),
}));

const { RelativeTime } = await import('../RelativeTime');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-14T12:40:00Z'));
});
afterEach(() => {
  vi.useRealTimers();
});

function hover(text: string) {
  fireEvent.mouseEnter(screen.getByText(text));
  act(() => { vi.advanceTimersByTime(2000); });
}

describe('RelativeTime', () => {
  it('renders the fallback for a NaN epoch instead of throwing RangeError', () => {
    render(<RelativeTime timestamp={Number.NaN} fallback="n/a" />);
    expect(screen.getByText('n/a')).toBeTruthy();
  });

  it('renders the fallback for an out-of-range epoch instead of throwing', () => {
    render(<RelativeTime timestamp={Number.POSITIVE_INFINITY} fallback="n/a" />);
    expect(screen.getByText('n/a')).toBeTruthy();
  });

  it('never paints "Invalid Date" into the tooltip of an unparseable string', () => {
    render(<RelativeTime timestamp="not-a-date" fallback="n/a" />);
    hover('n/a');
    expect(screen.queryByRole('tooltip', { hidden: true })).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('reads a bare SQLite datetime as UTC and dates the tooltip in the UI language', () => {
    const bare = '2026-08-14 12:34:56';
    const { container } = render(<RelativeTime timestamp={bare} className="rt" />);
    // The label's language comes from the i18n store (formatters.ts), not this
    // mock, so only its number is asserted: 5 minutes, not 5 min + 2 h of skew.
    const label = container.querySelector('.rt')!;
    expect(label.textContent).toContain('5');
    fireEvent.mouseEnter(label);
    act(() => { vi.advanceTimersByTime(2000); });
    const expected = new Date('2026-08-14T12:34:56Z').toLocaleString('cs');
    expect(screen.getByRole('tooltip', { hidden: true }).textContent).toBe(expected);
  });
});
