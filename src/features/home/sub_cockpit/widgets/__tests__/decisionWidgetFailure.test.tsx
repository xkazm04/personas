import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listManualReviews = vi.fn();
const companionListDesignDecisions = vi.fn();

vi.mock('@/api/overview/reviews', () => ({
  listManualReviewsByExecution: (...a: unknown[]) => listManualReviews(...a),
}));
vi.mock('@/api/companion', () => ({
  companionListDesignDecisions: (...a: unknown[]) => companionListDesignDecisions(...a),
}));

import { LinkedDecisionsWidget } from '../LinkedDecisionsWidget';
import { RecentDecisionsWidget } from '../RecentDecisionsWidget';

const review = (id: string, executionId: string) => ({
  id,
  persona_id: 'p1',
  execution_id: executionId,
  title: `Review ${id}`,
  description: null,
  severity: 'warning',
  status: 'pending',
  reviewer_notes: null,
  context_data: null,
  suggested_actions: null,
  created_at: '2026-09-17T00:00:00Z',
  resolved_at: null,
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Both widgets collapsed a thrown list call into the EMPTY rendering: linked
 * decisions showed its italic "no linked decisions" line, recent decisions
 * unmounted entirely. A broken IPC therefore read as "nothing to decide" —
 * `CockpitPanel` already splits a failed fetch from a never-composed spec, and
 * these two predate that split.
 */
describe('LinkedDecisionsWidget — failure is not inbox zero', () => {
  const props = { config: { executionId: 'e1', personaId: 'p1' }, title: 'Linked' } as never;

  it('shows an error with retry when the review list throws', async () => {
    listManualReviews.mockRejectedValue(new Error('IPC down'));
    render(<LinkedDecisionsWidget {...props} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.queryByText(/no linked decisions/i)).toBeNull();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('retry re-runs the fetch and clears the error on success', async () => {
    listManualReviews.mockRejectedValueOnce(new Error('IPC down'));
    render(<LinkedDecisionsWidget {...props} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    listManualReviews.mockResolvedValueOnce([review('r1', 'e1')]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Review r1')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
    expect(listManualReviews).toHaveBeenCalledTimes(2);
  });

  it('a successful fetch with zero rows still shows the empty copy, not an error', async () => {
    listManualReviews.mockResolvedValue([]);
    const { container } = render(<LinkedDecisionsWidget {...props} />);
    await waitFor(() => expect(container.querySelector('[data-testid="cockpit-widget-linked_decisions"]')).toBeTruthy());
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // The widget kept its slot and says the queue is clean — the one state
    // that is allowed to look like inbox zero.
    expect(container.textContent).not.toContain('Could not load');
  });
});

describe('RecentDecisionsWidget — failure keeps the slot', () => {
  const props = { config: { persona_context: 'design', limit: 3 }, title: 'Recent' } as never;

  it('renders an error with retry instead of unmounting', async () => {
    companionListDesignDecisions.mockRejectedValue(new Error('IPC down'));
    render(<RecentDecisionsWidget {...props} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByTestId('companion-recent-decisions-widget')).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('retry refetches and renders the chips', async () => {
    companionListDesignDecisions.mockRejectedValueOnce(new Error('IPC down'));
    render(<RecentDecisionsWidget {...props} />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());

    companionListDesignDecisions.mockResolvedValueOnce([
      { id: 'd1', label: 'Theme', choice: 'Dark' },
    ]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Dark')).toBeTruthy());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('an empty success still unmounts — that is the soft-surface contract', async () => {
    companionListDesignDecisions.mockResolvedValue([]);
    const { container } = render(<RecentDecisionsWidget {...props} />);
    await waitFor(() => expect(container.querySelector('[data-testid="companion-recent-decisions-widget"]')).toBeNull());
  });
});
