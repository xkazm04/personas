/**
 * THE PRESSED VERDICT SHOWS BUSY; THE OTHER ONE IS HELD.
 *
 * Approve / Reject were hand-rolled buttons behind one boolean: pressing
 * either dimmed both and lit neither, so a slow verdict looked like a dead
 * control. Pinned: the pressed button carries aria-busy and a real spinner
 * glyph, and its sibling is disabled without pretending to be busy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { useEffect, type ReactNode } from 'react';
import type { PersonaManualReview } from '@/lib/bindings/PersonaManualReview';

const h = vi.hoisted(() => ({ resolveReviewRow: vi.fn() }));
vi.mock('@/lib/decisions/rowWrites', () => ({ resolveReviewRow: (...a: unknown[]) => h.resolveReviewRow(...a) }));
vi.mock('@/api/overview/reports', () => ({ deleteReport: vi.fn() }));
vi.mock('@/features/shared/components/modals/ExecutionDetailModal', () => ({ ExecutionDetailModal: () => null }));
vi.mock('@/features/overview/sub_events/EventDetailModal', () => ({ EventDetailModal: () => null }));
vi.mock('@/features/overview/sub_memories/components/MemoryDetailModal', () => ({ default: () => null }));
vi.mock('@/features/overview/sub_reports/components/ReportDetailModal', () => ({ ReportDetailModal: () => null }));
vi.mock('@/features/overview/components/dashboard/widgets/DetailModal', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="detail-modal">{children}</div>,
}));

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

import { useActivityModals } from '../ActivityModals';

const review = {
  id: 'r1', persona_id: 'p1', title: 'Check the invoice', description: null, context_data: null,
  status: 'pending', severity: 'low', reviewer_notes: null, created_at: '2026-09-01T00:00:00Z',
} as unknown as PersonaManualReview;

function Harness() {
  const { handleRowClick, modals } = useActivityModals({ personaName: 'Ada', personaColor: '#000', onDataChanged: () => {} });
  useEffect(() => {
    handleRowClick({ type: 'review', id: 'r1', title: 'Check the invoice', subtitle: '', status: 'pending', timestamp: '2026-09-01T00:00:00Z', useCaseId: null, raw: review });
  }, [handleRowClick]);
  return <>{modals}</>;
}

beforeEach(() => { h.resolveReviewRow.mockReset(); });

describe('activity review verdict buttons', () => {
  it('shows a busy glyph on the pressed verdict and holds the other one', async () => {
    h.resolveReviewRow.mockReturnValue(new Promise(() => {}));
    render(<Harness />);
    const approve = await screen.findByRole('button', { name: /activity\.approve/ });
    const reject = screen.getByRole('button', { name: /activity\.reject/ });
    fireEvent.click(approve);
    await waitFor(() => expect(approve).toHaveAttribute('aria-busy', 'true'));
    expect(approve.querySelector('svg')).not.toBeNull();
    expect(reject).toBeDisabled();
    expect(reject).not.toHaveAttribute('aria-busy');
  });
});
