import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const language = { current: 'cs' };

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: new Proxy({}, { get: () => new Proxy({}, { get: (_t, k) => String(k) }) }),
    tx: (s: unknown) => String(s),
    get language() {
      return language.current;
    },
  }),
}));

// Tooltip pulls the shared translation proxy too; the mock above covers it.
const { AbsoluteTime } = await import('../AbsoluteTime');

const TS = '2026-08-14T12:34:56Z';

describe('AbsoluteTime', () => {
  it('formats with the active UI language, not the OS locale', () => {
    language.current = 'cs';
    render(<AbsoluteTime timestamp={TS} variant="date" showRelativeTooltip={false} />);
    const expected = new Intl.DateTimeFormat('cs', { dateStyle: 'medium' }).format(Date.parse(TS));
    const enUs = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(Date.parse(TS));
    expect(screen.getByText(expected)).toBeTruthy();
    expect(expected).not.toBe(enUs);
  });

  it('lets an explicit language override the active one', () => {
    language.current = 'cs';
    render(
      <AbsoluteTime timestamp={TS} variant="date" language="ja" showRelativeTooltip={false} />,
    );
    const expected = new Intl.DateTimeFormat('ja', { dateStyle: 'medium' }).format(Date.parse(TS));
    expect(screen.getByText(expected)).toBeTruthy();
  });

  it('renders the fallback for a missing or invalid timestamp', () => {
    render(<AbsoluteTime timestamp={null} fallback="n/a" showRelativeTooltip={false} />);
    expect(screen.getByText('n/a')).toBeTruthy();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('renders the fallback for a non-finite or out-of-range epoch instead of throwing', () => {
    // Number.isNaN alone let Infinity and |ms| > 8.64e15 through to
    // Intl.DateTimeFormat#format, which throws RangeError and unmounts the row.
    render(<AbsoluteTime timestamp={Number.POSITIVE_INFINITY} fallback="inf" />);
    render(<AbsoluteTime timestamp={9e15} fallback="far" />);
    expect(screen.getByText('inf')).toBeTruthy();
    expect(screen.getByText('far')).toBeTruthy();
  });

  it('computes the relative tooltip when it is shown, not when the row first rendered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(TS));
    const { container } = render(<AbsoluteTime timestamp={TS} className="at" />);
    // The row stays mounted (memo, same props) while two hours pass.
    vi.setSystemTime(new Date(Date.parse(TS) + 2 * 3_600_000));
    fireEvent.mouseEnter(container.querySelector('.at')!);
    act(() => { vi.advanceTimersByTime(2000); });
    const tip = screen.getByRole('tooltip', { hidden: true }).textContent ?? '';
    // Before: frozen at first render ("now"). After: two hours.
    expect(tip).toContain('2');
  });
});

describe('AbsoluteTime formatter reuse', () => {
  it('builds one Intl.DateTimeFormat per locale + variant, not one per render', () => {
    language.current = 'de';
    const Original = Intl.DateTimeFormat;
    let constructed = 0;
    class Counting extends Original {
      constructor(...args: ConstructorParameters<typeof Original>) {
        super(...args);
        constructed += 1;
      }
    }
    Intl.DateTimeFormat = Counting as typeof Intl.DateTimeFormat;
    const rows = ['2026-08-14T10:00:00Z', '2026-08-14T11:00:00Z', '2026-08-14T12:00:00Z'];
    render(<>{rows.map((r) => <AbsoluteTime key={r} timestamp={r} variant="compact" showRelativeTooltip={false} />)}</>);
    // 60.8 us to construct vs 1.3 us to reuse (node probe, cs datetime); a
    // 200-row table paid the construction 200 times per render.
    Intl.DateTimeFormat = Original;
    expect(constructed).toBe(1);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
