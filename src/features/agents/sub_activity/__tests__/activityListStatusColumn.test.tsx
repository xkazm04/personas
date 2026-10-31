/**
 * THE ACTIVITY STATUS COLUMN SAYS EACH THING ONCE.
 *
 * The memory feed stores its status as "importance: N" and the status cell
 * prefixed it a second time, so the tooltip read "Importance: importance: 5".
 */
import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ActivityItem } from '../activityTypes';

vi.mock('@/lib/utils/formatters', () => ({
  formatRelativeTime: (s: string) => s,
  getStatusEntry: () => null,
  badgeClass: () => '',
}));
const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
const translation = { t, tx: (s: unknown) => String(s), language: 'en' };
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => translation }));

import { ActivityList } from '../ActivityList';

const useCaseOptions: { id: string; title: string }[] = [];
const annotations = new Map();

function renderItems(items: ActivityItem[]) {
  return render(
    <ActivityList items={items} isLoading={false} useCaseOptions={useCaseOptions}
      annotationsByExecution={annotations} onRowClick={() => {}} />,
  );
}

const row = (type: ActivityItem['type'], status: string): ActivityItem => ({
  type, id: `${type}-1`, title: `T ${type}`, subtitle: '', status,
  timestamp: '2026-09-01T00:00:00Z', useCaseId: null, raw: {} as never,
});

describe('ActivityList status column', () => {
  it('shows a memory importance tooltip once', () => {
    const { container } = renderItems([row('memory', 'importance: 7')]);
    const titles = Array.from(container.querySelectorAll('[title]')).map((e) => e.getAttribute('title'));
    expect(titles).toContain('Importance: 7');
    expect(titles.some((x) => /importance:.*importance:/i.test(x ?? ''))).toBe(false);
  });

  it('renders review statuses as translated StatusBadge pills, not ad-hoc colours', () => {
    const { container } = renderItems([row('review', 'approved'), row('review', 'rejected'), row('review', 'pending')]);
    const html = container.innerHTML;
    expect(html).toContain('activity.review_status_approved');
    expect(html).toContain('activity.review_status_rejected');
    expect(html).toContain('activity.review_status_pending');
    expect(html).not.toMatch(/bg-(emerald|red|amber)-500\/15/);
  });
});
