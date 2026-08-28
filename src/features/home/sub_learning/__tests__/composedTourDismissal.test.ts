import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ComposedTourRecord } from '@/stores/slices/system/dynamicTours';
import type { TourDef } from '@/stores/slices/system/tourSlice';

/**
 * A stale composed tour used to be permanent: correct degradation (dimmed, no
 * start affordance) with no exit, so the list only ever grew. These pin the
 * three properties the dismissal has to hold —
 *
 *   1. dismissing hides the entry,
 *   2. the dismissal is dropped the moment the tour becomes playable again
 *      (it is "stop showing me this broken card", not a retirement), and
 *   3. the dismissal set is pruned to what the server still returns, so the
 *      unbounded growth does not simply move one layer down.
 */

const listComposedTours = vi.fn<() => Promise<ComposedTourRecord[]>>();
const ingestComposedTour = vi.fn<(record: ComposedTourRecord) => string | null>();
const getTourById = vi.fn<(id: string) => TourDef | undefined>();

vi.mock('@/stores/slices/system/dynamicTours', () => ({
  listComposedTours: (...args: []) => listComposedTours(...args),
  ingestComposedTour: (record: ComposedTourRecord) => ingestComposedTour(record),
}));
vi.mock('@/stores/slices/system/tourSlice', () => ({
  getTourById: (id: string) => getTourById(id),
}));

const { useComposedTours } = await import('../useComposedTours');
const { useDismissedComposedTours } = await import('../dismissedComposedTours');

function record(id: string, status: 'ready' | 'stale'): ComposedTourRecord {
  return {
    id, status,
    topic: 'topic', title: `Tour ${id}`, description: '',
    icon: 'compass', color: 'violet', stepsJson: '[]', createdAt: '2026-08-01T00:00:00Z',
  };
}

const DEF = { id: 'athena-a', steps: [{}] } as unknown as TourDef;

beforeEach(() => {
  vi.clearAllMocks();
  useDismissedComposedTours.setState({ dismissed: {} });
  ingestComposedTour.mockReturnValue('athena-a');
  getTourById.mockReturnValue(DEF);
});

describe('composed tour dismissal', () => {
  it('hides a dismissed stale tour and keeps the true total', async () => {
    listComposedTours.mockResolvedValue([record('athena-a', 'stale'), record('athena-b', 'stale')]);
    const { result } = renderHook(() => useComposedTours());
    await waitFor(() => expect(result.current.status).toBe('loaded'));
    expect(result.current.entries).toHaveLength(2);

    act(() => result.current.dismiss('athena-a'));

    expect(result.current.entries.map((e) => e.record.id)).toEqual(['athena-b']);
    // `total` is what the fetch returned — an emptied list must stay
    // distinguishable from "Athena composed nothing".
    expect(result.current.total).toBe(2);
  });

  it('brings a dismissed tour back once it is playable again', async () => {
    useDismissedComposedTours.setState({ dismissed: { 'athena-a': true } });
    listComposedTours.mockResolvedValue([record('athena-a', 'ready')]);
    const { result } = renderHook(() => useComposedTours());
    await waitFor(() => expect(result.current.status).toBe('loaded'));

    expect(result.current.entries.map((e) => e.record.id)).toEqual(['athena-a']);
  });

  it('prunes dismissals for records the server no longer returns', async () => {
    useDismissedComposedTours.setState({ dismissed: { 'athena-gone': true, 'athena-a': true } });
    listComposedTours.mockResolvedValue([record('athena-a', 'stale')]);
    const { result } = renderHook(() => useComposedTours());
    await waitFor(() => expect(result.current.status).toBe('loaded'));

    expect(Object.keys(useDismissedComposedTours.getState().dismissed)).toEqual(['athena-a']);
  });
});
