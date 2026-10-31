/**
 * THE ACTIVITY FILTERS ARE OPERABLE WITHOUT SIGHT.
 *
 * The status select carried no accessible name and the type tabs showed the
 * active one by colour only. Pinned: the select is a named combobox and every
 * type button exposes aria-pressed.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));

import { ActivityFilters } from '../ActivityFilters';
import { FILTER_TABS, type ActivityType } from '../activityTypes';

const counts = { all: 0, execution: 0, event: 0, memory: 0, review: 0, message: 0, attention: 0 } as Record<ActivityType, number>;
const noop = () => {};

function renderFilters() {
  return render(
    <ActivityFilters
      filter="event" statusFilter="all" useCaseFilter="all" tagFilter="all" starredOnly={false}
      counts={counts} availableStatuses={['a', 'b']} availableTags={[]} useCaseOptions={[]}
      onFilterChange={noop} onStatusFilterChange={noop} onUseCaseFilterChange={noop}
      onTagFilterChange={noop} onStarredOnlyChange={noop}
    />,
  );
}

describe('ActivityFilters accessibility', () => {
  it('names the status select', () => {
    renderFilters();
    expect(screen.getByRole('combobox', { name: 'activity.col_status' })).toBeTruthy();
  });

  it('exposes pressed state on every type button', () => {
    renderFilters();
    const tabs = screen.getAllByRole('button', { pressed: true }).concat(screen.getAllByRole('button', { pressed: false }));
    const typeButtons = tabs.filter((b) => FILTER_TABS.length > 0 && b.getAttribute('aria-pressed') !== null);
    // 7 type buttons (the starred toggle is offered on All only)
    expect(typeButtons.length).toBe(FILTER_TABS.length);
    expect(screen.getByRole('button', { pressed: true }).textContent).toContain('activity_filters.events');
  });

  it('lets the strip and its control groups wrap instead of overflowing at narrow widths', () => {
    renderFilters();
    const strip = screen.getByTestId('activity-filter-strip');
    expect(strip.className).toContain('flex-wrap');
    const groups = Array.from(strip.children) as HTMLElement[];
    expect(groups.length).toBe(2);
    for (const g of groups) expect(g.className).toContain('flex-wrap');
  });
});
