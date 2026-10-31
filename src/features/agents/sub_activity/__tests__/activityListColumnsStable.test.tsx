/**
 * AN UNCHANGED ACTIVITY ROW DOES NOT RE-RENDER WHEN ITS PARENT DOES.
 *
 * UnifiedTableRow is memoized and compares `columns` by reference.
 * ActivityList rebuilt its column array on every render, so every ActivityTab
 * render (six feed landings, each filter change) re-rendered every mounted row.
 * Instrument: the time column's formatter is called once per rendered row;
 * re-rendering the list with identical props must not call it again.
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ActivityItem } from '../activityTypes';

const h = vi.hoisted(() => ({ formatRelativeTime: vi.fn((s: string) => `ago:${s}`) }));
vi.mock('@/lib/utils/formatters', () => ({
  formatRelativeTime: (s: string) => h.formatRelativeTime(s),
  getStatusEntry: () => null,
  badgeClass: () => '',
}));
const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
// Stable across renders, as the real hook's memoized return is.
const tx = (s: unknown) => String(s);
const translation = { t, tx, language: 'en' };
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => translation }));

import { ActivityList } from '../ActivityList';

const items: ActivityItem[] = ['a', 'b', 'c'].map((id, i) => ({
  type: 'event', id, title: `Event ${id}`, subtitle: '', status: 'delivered',
  timestamp: `2026-09-0${i + 1}T00:00:00Z`, useCaseId: null, raw: {} as never,
}));
const useCaseOptions: { id: string; title: string }[] = [];
const annotations = new Map();
const onRowClick = () => {};

describe('ActivityList row memoization', () => {
  it('does not re-render unchanged rows on a parent re-render', () => {
    const props = { items, isLoading: false, useCaseOptions, annotationsByExecution: annotations, onRowClick };
    const { rerender } = render(<ActivityList {...props} />);
    const first = h.formatRelativeTime.mock.calls.length;
    expect(first).toBeGreaterThanOrEqual(3);

    rerender(<ActivityList {...props} />);
    expect(h.formatRelativeTime.mock.calls.length - first).toBe(0);
  });
});
