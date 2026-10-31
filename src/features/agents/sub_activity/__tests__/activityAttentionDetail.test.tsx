/**
 * EVERY CLICKABLE ACTIVITY ROW OPENS ITS DETAIL.
 *
 * UnifiedTable makes each row clickable, but the row-click switch had no
 * attention case and the row subtitle cuts the reason at 80 characters, so an
 * attention-ledger row did nothing and its reason was unreadable. Pinned:
 * clicking an attention row opens a detail carrying the full reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useEffect } from 'react';
import type { AttentionLedgerEntry } from '@/lib/bindings/AttentionLedgerEntry';

vi.mock('@/api/overview/reports', () => ({ deleteReport: vi.fn() }));
vi.mock('@/lib/decisions/rowWrites', () => ({ resolveReviewRow: vi.fn() }));
vi.mock('@/features/shared/components/modals/ExecutionDetailModal', () => ({ ExecutionDetailModal: () => null }));
vi.mock('@/features/overview/sub_events/EventDetailModal', () => ({ EventDetailModal: () => null }));
vi.mock('@/features/overview/sub_memories/components/MemoryDetailModal', () => ({ default: () => null }));
vi.mock('@/features/overview/sub_reports/components/ReportDetailModal', () => ({ ReportDetailModal: () => null }));
vi.mock('@/features/overview/components/dashboard/widgets/DetailModal', () => ({
  default: ({ title, children }: { title: unknown; children: unknown }) => (
    <div data-testid="detail-modal">{String(title)}{children as never}</div>
  ),
}));
const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) => section === 'agents'
    ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
    : leaf(String(section)),
});
const translation = { t, tx: (s: unknown) => String(s), language: 'en' };
vi.mock('@/i18n/useTranslation', () => ({ useTranslation: () => translation }));

import { useActivityModals } from '../ActivityModals';

const reason = 'The consolidation pass found '.repeat(8) + 'END-OF-REASON';
const entry = {
  id: 'a1', personaId: 'p1', kind: 'attention', verdict: 'acted', reason,
  startedAt: '2026-09-01T00:00:00Z', completedAt: '2026-09-01T00:01:00Z',
} as unknown as AttentionLedgerEntry;

function Harness() {
  const { handleRowClick, modals } = useActivityModals({ personaName: 'Ada', personaColor: '#000', onDataChanged: () => {} });
  useEffect(() => {
    handleRowClick({ type: 'attention', id: 'a1', title: 'Attention pass', subtitle: reason.slice(0, 80), status: 'acted', timestamp: entry.startedAt, useCaseId: null, raw: entry });
  }, [handleRowClick]);
  return <>{modals}</>;
}

describe('attention row detail', () => {
  it('opens a detail with the full, untruncated reason', async () => {
    render(<Harness />);
    const modal = await screen.findByTestId('detail-modal');
    expect(modal.textContent).toContain('END-OF-REASON');
  });
});
