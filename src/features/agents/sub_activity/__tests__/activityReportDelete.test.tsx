/**
 * A FAILED REPORT DELETE IS TOLD TO THE USER.
 *
 * The report modal's Delete is a confirmed, user-initiated action, but its
 * failure went to `silentCatch`: the modal closed, the feed refreshed, and the
 * report reappeared with nothing said. Pinned: the rejection reaches a toast
 * carrying the backend's reason (an AppError object, not an Error).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import type { PersonaReport } from '@/lib/types/types';

const h = vi.hoisted(() => ({ deleteReport: vi.fn(), addToast: vi.fn() }));
vi.mock('@/api/overview/reports', () => ({ deleteReport: (...a: unknown[]) => h.deleteReport(...a) }));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: h.addToast }) }),
}));
vi.mock('@/lib/decisions/rowWrites', () => ({ resolveReviewRow: vi.fn() }));
vi.mock('@/features/shared/components/modals/ExecutionDetailModal', () => ({ ExecutionDetailModal: () => null }));
vi.mock('@/features/overview/sub_events/EventDetailModal', () => ({ EventDetailModal: () => null }));
vi.mock('@/features/overview/sub_memories/components/MemoryDetailModal', () => ({ default: () => null }));
vi.mock('@/features/overview/components/dashboard/widgets/DetailModal', () => ({ default: () => null }));
vi.mock('@/features/overview/sub_reports/components/ReportDetailModal', () => ({
  ReportDetailModal: ({ onDelete }: { onDelete: () => Promise<void> }) => (
    <button type="button" onClick={() => { void onDelete(); }}>delete-report</button>
  ),
}));
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: new Proxy({}, { get: () => new Proxy({}, { get: (_o, k) => String(k) }) }), tx: (s: unknown) => String(s), language: 'en' }),
}));

import { useActivityModals } from '../ActivityModals';

const report = { id: 'm1', title: 'Weekly', content: 'x', created_at: '2026-09-01T00:00:00Z' } as unknown as PersonaReport;
const onDataChanged = vi.fn();

function Harness() {
  const { handleRowClick, modals } = useActivityModals({ personaName: 'Ada', personaColor: '#000', onDataChanged });
  useEffect(() => {
    handleRowClick({ type: 'message', id: 'm1', title: 'Weekly', subtitle: '', status: 'normal', timestamp: '2026-09-01T00:00:00Z', useCaseId: null, raw: report });
  }, [handleRowClick]);
  return <>{modals}</>;
}

beforeEach(() => { h.deleteReport.mockReset(); h.addToast.mockReset(); onDataChanged.mockReset(); });

describe('activity report delete', () => {
  it('toasts the backend reason when the delete fails', async () => {
    h.deleteReport.mockRejectedValue({ error: 'report is locked by a run', kind: 'Conflict' });
    render(<Harness />);
    fireEvent.click(await screen.findByText('delete-report'));
    await waitFor(() => expect(h.addToast).toHaveBeenCalledTimes(1));
    expect(String(h.addToast.mock.calls[0]?.[0])).toContain('report is locked by a run');
  });

  it('stays quiet when the delete lands', async () => {
    h.deleteReport.mockResolvedValue(undefined);
    render(<Harness />);
    fireEvent.click(await screen.findByText('delete-report'));
    await waitFor(() => expect(onDataChanged).toHaveBeenCalledTimes(1));
    expect(h.addToast).not.toHaveBeenCalled();
  });
});
