/**
 * The row is the ONLY thing holding the handle to a spawned dev server — a
 * real OS process on a real port. These tests pin the reaper: unmounting the
 * row (card collapse, navigation, a poll that re-keys the list) must stop the
 * process, and must not fire a stop for a row that never started one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { fireEvent } from '@testing-library/react';
import type { DevCompetitionSlot } from '@/lib/bindings/DevCompetitionSlot';
import type { DevTask } from '@/lib/bindings/DevTask';

const startSlotServer = vi.fn();
const stopSlotServer = vi.fn();
vi.mock('@/api/devTools/devTools', () => ({
  startSlotServer: (...args: unknown[]) => startSlotServer(...args),
  stopSlotServer: (...args: unknown[]) => stopSlotServer(...args),
  getCompetitionSlotDiff: vi.fn().mockResolvedValue(''),
  switchToWorktree: vi.fn().mockResolvedValue(undefined),
  parseCompetitionSlotDiffStats: () => null,
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) => selector({ addToast }),
}));

import { CompetitionSlotRow } from '../CompetitionSlotRow';

const SLOT: DevCompetitionSlot = {
  id: 'slot-1',
  competition_id: 'comp-1',
  task_id: 'task-1',
  strategy_label: 'Terse',
  strategy_prompt: 'role: senior',
  worktree_name: 'wt-1',
  branch_name: 'b-1',
  slot_index: 0,
  disqualified: false,
  disqualify_reason: null,
  diff_hash: null,
  diff_stats_json: null,
  diff_analyzed_at: null,
  created_at: '2026-01-01T00:00:00Z',
};

const TASK: DevTask = {
  id: 'task-1',
  project_id: 'proj-1',
  title: 'Do the thing',
  description: null,
  source_idea_id: null,
  goal_id: null,
  status: 'completed',
  session_id: null,
  progress_pct: 100,
  output_lines: 12,
  error: null,
  started_at: '2026-01-01T00:00:00Z',
  completed_at: '2026-01-01T00:05:00Z',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:05:00Z',
  depth: 'quick',
  parent_task_id: null,
  attempt: 1,
};

function renderRow() {
  return render(
    <CompetitionSlotRow
      slot={SLOT}
      task={TASK}
      isWinner={false}
      isFinished={false}
      onPickWinner={vi.fn()}
      picking={null}
    />,
  );
}

beforeEach(() => {
  startSlotServer.mockReset();
  stopSlotServer.mockReset();
  addToast.mockReset();
  startSlotServer.mockResolvedValue({ port: 5173, pid: 4242, url: 'http://localhost:5173' });
  stopSlotServer.mockResolvedValue(undefined);
});

describe('CompetitionSlotRow — spawned dev-server lifecycle', () => {
  it('stops the spawned server when the row unmounts', async () => {
    const { unmount } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(startSlotServer).toHaveBeenCalledWith('slot-1'));
    // The port link only renders once the handle is in state.
    await waitFor(() => expect(screen.getByText(':5173')).toBeInTheDocument());

    unmount();

    expect(stopSlotServer).toHaveBeenCalledWith('slot-1');
  });

  it('does not stop anything when a row that never started a server unmounts', () => {
    const { unmount } = renderRow();
    unmount();
    expect(stopSlotServer).not.toHaveBeenCalled();
  });

  it('does not double-stop when the user stopped the server before unmounting', async () => {
    const { unmount } = renderRow();

    fireEvent.click(screen.getByRole('button', { name: /preview/i }));
    await waitFor(() => expect(screen.getByText(':5173')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(stopSlotServer).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(':5173')).not.toBeInTheDocument());

    unmount();

    expect(stopSlotServer).toHaveBeenCalledTimes(1);
  });
});
