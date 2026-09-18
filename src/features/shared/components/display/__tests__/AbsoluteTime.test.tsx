import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
});
