import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { resolveError } from '@/lib/errors/errorRegistry';
import { BrainCycleReports, __resetCycleCacheForTests } from '../BrainCycleReports';
import type { CycleSummary } from '@/api/companion/brain';

const api = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock('@/api/companion/brain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/companion/brain')>();
  return { ...actual, companionListCycleReports: api.list };
});

function cycle(over: Partial<CycleSummary> = {}): CycleSummary {
  return {
    id: 'cyc_a',
    startedAt: '2026-08-26T02:00:00Z',
    finishedAt: '2026-08-26T02:04:00Z',
    status: 'completed',
    phases: [],
    statsJson: '{}',
    reportNodeId: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetCycleCacheForTests();
  api.list.mockResolvedValue([]);
});

describe('BrainCycleReports', () => {
  it('renders cycles newest-first regardless of the order the backend returns', async () => {
    api.list.mockResolvedValue([
      cycle({ id: 'cyc_old', startedAt: '2026-08-01T02:00:00Z' }),
      cycle({ id: 'cyc_new', startedAt: '2026-08-26T02:00:00Z' }),
      cycle({ id: 'cyc_mid', startedAt: '2026-08-12T02:00:00Z' }),
    ]);

    render(<BrainCycleReports />);

    await waitFor(() => expect(screen.getAllByTestId('cycle-card')).toHaveLength(3));
    expect(
      screen.getAllByTestId('cycle-card').map((el) => el.getAttribute('data-cycle-id')),
    ).toEqual(['cyc_new', 'cyc_mid', 'cyc_old']);
  });

  it('shows an empty state — not a ghost, not a spinner — when no cycle has ever run', async () => {
    api.list.mockResolvedValue([]);
    render(<BrainCycleReports />);
    await waitFor(() => expect(screen.getByTestId('cycles-empty')).toBeInTheDocument());
    expect(screen.queryAllByTestId('cycle-card')).toHaveLength(0);
  });

  it('renders the counters the cycle recorded and omits the ones it did not', async () => {
    api.list.mockResolvedValue([
      cycle({
        statsJson: JSON.stringify({
          episodes_in: 7,
          episodes_available: 9,
          facts_applied: 3,
          chars_in: 41234,
          // procedurals_applied deliberately absent — must not render as 0.
        }),
      }),
    ]);

    render(<BrainCycleReports />);
    await waitFor(() => expect(screen.getByTestId('cycle-card')).toBeInTheDocument());

    const card = screen.getByTestId('cycle-card');
    expect(card.textContent).toContain('7');
    expect(card.textContent).toContain('9');
    expect(card.textContent).toContain('3');
    // Eight possible chips; only the four recorded stats produce one, and the
    // episodes line is separate — so the chip list has exactly two entries
    // (facts_applied, chars_in).
    expect(card.querySelectorAll('dl > div')).toHaveLength(2);
  });

  it('surfaces a failed cycle with the reason the backend recorded', async () => {
    api.list.mockResolvedValue([
      cycle({
        id: 'cyc_bad',
        status: 'failed',
        statsJson: JSON.stringify({ error: 'compress leg returned no JSON' }),
      }),
    ]);
    render(<BrainCycleReports />);
    await waitFor(() =>
      expect(screen.getByText('compress leg returned no JSON')).toBeInTheDocument(),
    );
  });

  it('renders one phase chip per recorded phase', async () => {
    api.list.mockResolvedValue([
      cycle({
        phases: [
          { phase: 'compress', status: 'completed', detail: 'read 7', at: '2026-08-26T02:01:00Z' },
          { phase: 'reconcile', status: 'skipped', detail: '', at: '2026-08-26T02:02:00Z' },
        ],
      }),
    ]);
    render(<BrainCycleReports />);
    await waitFor(() => expect(screen.getByText('Compress')).toBeInTheDocument());
    expect(screen.getByText('Reconcile')).toBeInTheDocument();
  });

  it('falls back to an inline error state when the command rejects', async () => {
    api.list.mockRejectedValue(new Error('db locked'));
    render(<BrainCycleReports />);
    await waitFor(() => expect(screen.getByTestId('cycles-error')).toBeInTheDocument());
    // The inline state shows the registry's resolution of the raw error, not
    // the raw string - so assert against resolveError rather than restating
    // its output here, which would pin this test to today's wording.
    expect(screen.getByText(resolveError('db locked').message)).toBeInTheDocument();
  });

  it('paints warm from the module cache on a remount — no second ghost', async () => {
    api.list.mockResolvedValue([cycle({ id: 'cyc_warm' })]);
    const first = render(<BrainCycleReports />);
    await waitFor(() => expect(screen.getByTestId('cycle-card')).toBeInTheDocument());
    first.unmount();

    // Never resolves: if the remount painted from a ghost instead of the warm
    // cache, the card would be absent on the first synchronous render.
    api.list.mockReturnValue(new Promise(() => {}));
    render(<BrainCycleReports />);
    expect(screen.getByTestId('cycle-card')).toHaveAttribute('data-cycle-id', 'cyc_warm');
  });
});
