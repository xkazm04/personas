import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const listMemoriesByExecution = vi.fn();

vi.mock('@/api/overview/memories', () => ({
  listMemoriesByExecution: (...a: unknown[]) => listMemoriesByExecution(...a),
}));

import { LinkedMemoriesWidget } from '../LinkedMemoriesWidget';

const TILE = 'cockpit-widget-linked_memories';
const EMPTY = /no memories recorded/i;

const memory = {
  id: 'm1',
  persona_id: 'p1',
  title: 'Prefers terse replies',
  content: 'The user asked for shorter answers.',
  category: 'preference',
  source_execution_id: 'e1',
  importance: 3,
  tier: 'active',
  tags: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * A thrown `listMemoriesByExecution` became `[]` and rendered the settled-empty
 * line "No memories recorded for this execution", the same failure-as-inbox-zero
 * its sibling LinkedDecisionsWidget was already fixed for.
 */
describe('LinkedMemoriesWidget failure is not "no memories"', () => {
  it('shows an error with Retry, never the empty claim, when the list throws', async () => {
    listMemoriesByExecution.mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    render(<LinkedMemoriesWidget config={{ executionId: 'e1' }} />);
    await waitFor(() => expect(listMemoriesByExecution).toHaveBeenCalled());
    await screen.findByRole('button', { name: /retry|try again/i });
    expect(screen.getByTestId(TILE).textContent ?? '').not.toMatch(EMPTY);
  });

  it('a retry that succeeds shows the rows', async () => {
    listMemoriesByExecution.mockRejectedValueOnce({ error: 'database is locked', kind: 'Database' });
    render(<LinkedMemoriesWidget config={{ executionId: 'e1' }} />);
    const retry = await screen.findByRole('button', { name: /retry|try again/i });
    listMemoriesByExecution.mockResolvedValueOnce([memory]);
    fireEvent.click(retry);
    await waitFor(() => expect(screen.getAllByText('Prefers terse replies').length).toBeGreaterThan(0));
  });

  it('a genuinely empty run still says so', async () => {
    listMemoriesByExecution.mockResolvedValue([]);
    render(<LinkedMemoriesWidget config={{ executionId: 'e1' }} />);
    await waitFor(() => expect(screen.getByTestId(TILE).textContent ?? '').toMatch(EMPTY));
  });
});
