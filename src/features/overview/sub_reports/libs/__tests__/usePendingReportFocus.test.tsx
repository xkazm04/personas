import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import type { PersonaReport } from '@/lib/types/types';
import type { PersonaReport as RawPersonaReport } from '@/lib/bindings/PersonaReport';
import { useOverviewStore } from '@/stores/overviewStore';

const getReport = vi.fn();
vi.mock('@/api/overview/reports', () => ({
  getReport: (id: string) => getReport(id),
}));
const toast = vi.fn();
vi.mock('@/lib/silentCatch', () => ({
  toastCatch: (...args: unknown[]) => { toast(...args); return () => {}; },
  silentCatch: () => () => {},
}));

import { usePendingReportFocus } from '../usePendingReportFocus';

const raw = (id: string): RawPersonaReport => ({
  id, persona_id: 'p1', execution_id: null, title: `Report ${id}`, content: 'body', content_type: 'markdown',
  priority: 'normal', is_read: false, metadata: null, created_at: '2026-10-07T09:00:00Z', read_at: null,
  thread_id: null, use_case_id: null,
});
const loaded = (id: string): PersonaReport => ({ ...raw(id), persona_name: 'Council' });

const personaMap = new Map([
  ['p1', { id: 'p1', name: 'Council', icon: null, color: '#fff' }],
]) as unknown as Parameters<typeof usePendingReportFocus>[1];

describe('usePendingReportFocus', () => {
  beforeEach(() => {
    getReport.mockReset();
    toast.mockReset();
    useOverviewStore.setState({ pendingReportFocus: null });
  });

  it('does nothing without a pending id', () => {
    const open = vi.fn();
    renderHook(() => usePendingReportFocus([loaded('r1')], personaMap, open));
    expect(open).not.toHaveBeenCalled();
    expect(getReport).not.toHaveBeenCalled();
  });

  it('opens a report already in the loaded list, and clears the signal', () => {
    const open = vi.fn();
    useOverviewStore.setState({ pendingReportFocus: 'r2' });

    renderHook(() => usePendingReportFocus([loaded('r1'), loaded('r2')], personaMap, open));

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].id).toBe('r2');
    expect(getReport).not.toHaveBeenCalled();
    expect(useOverviewStore.getState().pendingReportFocus).toBeNull();
  });

  it('fetches a report that is not in the list, enriches it with its persona, and clears the signal', async () => {
    const open = vi.fn();
    getReport.mockResolvedValue(raw('old-9'));
    useOverviewStore.setState({ pendingReportFocus: 'old-9' });

    renderHook(() => usePendingReportFocus([], personaMap, open));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(getReport).toHaveBeenCalledWith('old-9');
    expect(open.mock.calls[0]![0]).toMatchObject({ id: 'old-9', persona_name: 'Council' });
    await waitFor(() => expect(useOverviewStore.getState().pendingReportFocus).toBeNull());
  });

  it('toasts and clears the signal when the report cannot be fetched', async () => {
    const open = vi.fn();
    getReport.mockRejectedValue(new Error('not found'));
    useOverviewStore.setState({ pendingReportFocus: 'gone' });

    renderHook(() => usePendingReportFocus([], personaMap, open));

    await waitFor(() => expect(useOverviewStore.getState().pendingReportFocus).toBeNull());
    expect(open).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('ReportList:openLinkedReport', 'That report is no longer available');
  });

  it('picks up a signal set after the tab is already mounted', async () => {
    const open = vi.fn();
    renderHook(() => usePendingReportFocus([loaded('r1')], personaMap, open));
    expect(open).not.toHaveBeenCalled();

    act(() => { useOverviewStore.getState().setPendingReportFocus('r1'); });

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(useOverviewStore.getState().pendingReportFocus).toBeNull();
  });
});
