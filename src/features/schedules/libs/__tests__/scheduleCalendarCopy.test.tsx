/**
 * The calendar toolbar reads its copy from the catalog.
 *
 * "Today", "Week" and "Month" were English literals in all 14 locales while
 * schedules.today / week / month sat translated with zero readers. Rendered
 * against the Czech catalog so an English literal cannot pass by coincidence.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import csSchedules from '@/i18n/section-locales/cs/schedules.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: { schedules: csSchedules }, tx: (s: string) => s, language: 'cs' }),
}));

const { default: ScheduleCalendar } = await import('../../components/ScheduleCalendar');

describe('schedule calendar toolbar copy', () => {
  it('today and the week/month switch are translated, and the switch reports its state', () => {
    render(<ScheduleCalendar entries={[]} />);
    expect(screen.getByRole('button', { name: csSchedules.today })).toBeTruthy();
    expect(screen.getByRole('button', { name: csSchedules.week }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: csSchedules.month }).getAttribute('aria-pressed')).toBe('false');
    for (const english of ['Today', 'Week', 'Month']) expect(screen.queryByText(english)).toBeNull();
  });
});
