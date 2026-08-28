import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import { resetInvokeMocks } from '@/test/tauriMock';
import TeamMemoryPanel from '../TeamMemoryPanel';

/**
 * `getTeamMemoryStats(teamId, category, search)` has no runId, so the footer
 * stats — and the per-category counts under them — always describe the whole
 * team. Filter the list to one run and the two disagreed with nothing on
 * screen saying so. Threading runId through would be an IPC contract change;
 * naming the scope is not, and it removes the contradiction.
 */
function memory(over: Partial<TeamMemory> = {}): TeamMemory {
  return {
    id: 'tm-1',
    team_id: 'team-1',
    run_id: 'run-1',
    member_id: null,
    persona_id: null,
    title: 'a decision',
    content: 'ship on fridays',
    category: 'decision',
    importance: 4,
    tags: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

const STATS: TeamMemoryStats = {
  total: 8n,
  auto_generated: 4n,
  max_memories: 100n,
  avg_importance: 4.2,
  category_counts: [['decision', 5n], ['fact', 3n]],
  run_counts: [['run-1', 5n], ['run-2', 3n]],
};

function renderPanel() {
  return render(
    <TeamMemoryPanel
      teamId="team-1"
      memories={[memory(), memory({ id: 'tm-2', run_id: 'run-2', title: 'another' })]}
      total={8}
      stats={STATS}
      onClose={vi.fn()}
      onDelete={vi.fn()}
      onImportanceChange={vi.fn()}
      onCreate={vi.fn()}
      onFilter={vi.fn()}
      onLoadMore={vi.fn(async () => {})}
      onFilterByRun={vi.fn()}
    />,
  );
}

/** Drive the panel to "filtered to one run" the way a user does. */
async function filterToFirstRun() {
  await act(async () => {
    fireEvent.click(screen.getByTitle(/timeline/i));
  });
  // Run markers start collapsed; the filter affordance lives inside one.
  await act(async () => {
    fireEvent.click(screen.getAllByRole('button', { name: /run-/i })[0]!);
  });
  await act(async () => {
    fireEvent.click(screen.getByText(/filter to (this )?run/i));
  });
}

describe('TeamMemoryPanel — footer stats scope', () => {
  beforeEach(() => {
    resetInvokeMocks();
  });

  it('does not qualify the footer while the list is unfiltered', async () => {
    renderPanel();

    expect(screen.getByText(/Avg importance/i)).toBeInTheDocument();
    expect(screen.queryByText('team-wide')).not.toBeInTheDocument();
  });

  it('marks the footer stats team-wide once a run filter is active', async () => {
    renderPanel();
    await filterToFirstRun();

    expect(screen.getByText(/Avg importance/i)).toBeInTheDocument();
    expect(screen.getByText('team-wide')).toBeInTheDocument();
  });
});
