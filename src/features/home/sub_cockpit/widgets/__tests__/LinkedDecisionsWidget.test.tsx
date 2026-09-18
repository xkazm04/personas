import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, cleanup } from '@testing-library/react';

const listManualReviewsByExecution = vi.fn();
const resolveReviewRow = vi.fn();

vi.mock('@/api/overview/reviews', async () => {
  const actual = await vi.importActual<typeof import('@/api/overview/reviews')>(
    '@/api/overview/reviews',
  );
  return {
    ...actual,
    listManualReviewsByExecution: (...args: unknown[]) => listManualReviewsByExecution(...args),
  };
});

vi.mock('@/lib/decisions/rowWrites', async () => {
  const actual = await vi.importActual<typeof import('@/lib/decisions/rowWrites')>(
    '@/lib/decisions/rowWrites',
  );
  return { ...actual, resolveReviewRow: (...args: unknown[]) => resolveReviewRow(...args) };
});

import { LinkedDecisionsWidget } from '../LinkedDecisionsWidget';

// A fixed stamp, not the renderer's clock: nothing here asserts ordering, and
// a `new Date()` in a fixture is the shape the chronological-feed gate exists
// to stop spreading.
const CREATED_AT = '2026-09-01T09:00:00.000Z';

function review(id: string) {
  return {
    id,
    persona_id: 'p1',
    execution_id: 'e1',
    title: `Approve ${id}`,
    description: 'needs a human',
    severity: 'medium',
    status: 'pending',
    context_data: null,
    created_at: CREATED_AT,
  };
}

/**
 * Approving from the cockpit is a write against the same door the manual-review
 * list uses, and the widget carries a deliberate distinction between "no linked
 * decisions" and "the list call failed" - a down IPC must not tell the user the
 * desk is clean. None of it was pinned.
 */
describe('LinkedDecisionsWidget', () => {
  beforeEach(() => {
    cleanup();
    listManualReviewsByExecution.mockReset();
    resolveReviewRow.mockReset();
    resolveReviewRow.mockResolvedValue(undefined);
  });

  it('approves a pending review and drops the row once the server agrees', async () => {
    // First read has the review; the revalidation after the verdict does not,
    // which is the shape of a resolve that actually landed.
    listManualReviewsByExecution.mockResolvedValueOnce([review('r1')]).mockResolvedValue([]);
    render(<LinkedDecisionsWidget config={{ executionId: 'e1' }} />);

    const approve = await screen.findByTestId('cockpit-pending-review-approve-r1');
    fireEvent.click(approve);

    await waitFor(() => {
      expect(resolveReviewRow).toHaveBeenCalledTimes(1);
    });
    expect(resolveReviewRow.mock.calls[0][1]).toBe('approved');
    await waitFor(() => {
      expect(screen.queryByTestId('cockpit-pending-review-row-r1')).toBeNull();
    });
  });

  it('rejects through the same door with the other verdict', async () => {
    listManualReviewsByExecution.mockResolvedValue([review('r2')]);
    render(<LinkedDecisionsWidget config={{ executionId: 'e1' }} />);

    fireEvent.click(await screen.findByTestId('cockpit-pending-review-reject-r2'));
    await waitFor(() => {
      expect(resolveReviewRow.mock.calls[0][1]).toBe('rejected');
    });
  });

  it('re-reads the list after a verdict lands', async () => {
    listManualReviewsByExecution.mockResolvedValue([review('r3')]);
    render(<LinkedDecisionsWidget config={{ executionId: 'e1' }} />);

    fireEvent.click(await screen.findByTestId('cockpit-pending-review-approve-r3'));
    await waitFor(() => {
      expect(listManualReviewsByExecution).toHaveBeenCalledTimes(2);
    });
  });

  it('shows only pending rows', async () => {
    listManualReviewsByExecution.mockResolvedValue([
      review('r4'),
      { ...review('r5'), status: 'approved' },
    ]);
    render(<LinkedDecisionsWidget config={{ executionId: 'e1' }} />);

    await screen.findByTestId('cockpit-pending-review-row-r4');
    expect(screen.queryByTestId('cockpit-pending-review-row-r5')).toBeNull();
  });

  it('does not report a clean desk when the list call failed', async () => {
    listManualReviewsByExecution.mockRejectedValue(new Error('ipc down'));
    render(<LinkedDecisionsWidget config={{ executionId: 'e1' }} />);

    await waitFor(() => {
      expect(screen.getByTestId('cockpit-widget-linked_decisions')).toBeInTheDocument();
    });
    // The empty-state copy must NOT be what a failure renders.
    await waitFor(() => {
      expect(screen.queryByText(/no linked decisions/i)).toBeNull();
    });
  });
});
