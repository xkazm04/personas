/**
 * THE ACTIVITY TYPE TABS SPEAK THE USER'S LANGUAGE.
 *
 * Six of the seven tab labels were English literals in `FILTER_TABS`, while
 * the translated catalog for exactly those labels (`agents.activity_filters`,
 * present in all 14 locales) had no reader. Pinned: every tab label comes from
 * the translation object, none from a literal.
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

describe('ActivityFilters tab labels', () => {
  it('resolves every type tab through the translation catalog', () => {
    render(
      <ActivityFilters
        filter="all" statusFilter="all" useCaseFilter="all" tagFilter="all" starredOnly={false}
        counts={counts} availableStatuses={[]} availableTags={[]} useCaseOptions={[]} hideSecondaryFilters
        onFilterChange={noop} onStatusFilterChange={noop} onUseCaseFilterChange={noop}
        onTagFilterChange={noop} onStarredOnlyChange={noop}
      />,
    );
    const labels = screen.getAllByRole('button').map((b) => b.textContent);
    expect(labels).toEqual([
      'activity_filters.all',
      'activity_filters.executions',
      'activity_filters.events',
      'activity_filters.memories',
      'activity_filters.reviews',
      'activity_filters.messages',
      'life.activity_filter_attention',
    ]);
    expect(labels).toHaveLength(FILTER_TABS.length);
  });
});
