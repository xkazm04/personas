/**
 * The attention registry reads the Decision Center roster's counts.
 *
 * Pending reviews, unread reports and open incidents are three of the
 * roster's chips; the sidebar badges for them must name the same number the
 * hub strip does. So the registry derives them from `PendingCounts` — the one
 * read the roster's chips are built from — and falls back to the overview
 * store's legacy fields only before that read has landed.
 */
import { describe, expect, it } from 'vitest';

import { buildChipCounts } from '@/features/decision-center/roster/chipCounts';
import { pendingCounts } from '@/features/decision-center/__tests__/rosterFixtures';
import type { OverviewStore } from '@/stores/storeTypes';

import { ATTENTION_REGISTRY, attentionDomainsForScope, type AttentionDomainId } from '../registry';

/** Legacy overview fields deliberately DIFFERENT from the roster's read. */
const overview = {
  pendingReviewCount: 99,
  unreadReportCount: 98,
  pendingEventCount: 5,
  memoryActions: [],
} as unknown as OverviewStore;

function count(id: AttentionDomainId, pending: ReturnType<typeof pendingCounts> | null): number {
  const domain = ATTENTION_REGISTRY.find((d) => d.id === id);
  if (!domain) throw new Error(`no domain ${id}`);
  return domain.count({ overview, pending });
}

describe('attention registry x the roster counts', () => {
  it('reads the same numbers the roster\'s chips are built from', () => {
    const pending = pendingCounts();
    const chips = buildChipCounts({
      pending,
      pendingFailed: false,
      questions: 0,
      chat: { n: 0, failed: false },
      ready: { n: 0, failed: false },
    });

    expect(count('pending_reviews', pending)).toBe(pending.manualReviews);
    expect(count('unread_reports', pending)).toBe(chips.reports.n);
    expect(count('open_incidents', pending)).toBe(chips.incidents.n);
  });

  it('falls back to the overview store only before the first counts read', () => {
    expect(count('pending_reviews', null)).toBe(99);
    expect(count('unread_reports', null)).toBe(98);
    // No legacy field ever counted incidents: unknown is 0, not invented.
    expect(count('open_incidents', null)).toBe(0);
  });

  it('badges Overview › Incidents in the sidebar scope', () => {
    expect(attentionDomainsForScope('sidebar').map((d) => d.id)).toContain('open_incidents');
    // Not in the dashboard totals: adding it there would move numbers the
    // dashboards already print.
    expect(attentionDomainsForScope('dashboard').map((d) => d.id)).not.toContain('open_incidents');
  });
});
