import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LeaderboardMatrixView } from '../LeaderboardMatrixView';
import type { LeaderboardEntry } from '../../libs/leaderboardScoring';

function entry(id: string, rank: number | null, composite: number | null, speed: number | null): LeaderboardEntry {
  return {
    personaId: id,
    personaName: id,
    personaIcon: null,
    personaColor: null,
    rank,
    compositeScore: composite,
    medal: null,
    dimensions: [
      { key: 'success', value: composite },
      { key: 'health', value: composite },
      { key: 'speed', value: speed },
      { key: 'cost', value: null },
      { key: 'activity', value: 10 },
    ],
  };
}

describe('LeaderboardMatrixView', () => {
  it('marks the sorted column for assistive tech', () => {
    render(
      <LeaderboardMatrixView
        leaderboard={[entry('a', 1, 80, 60), entry('b', null, null, null)]}
        fleetBenchmark={null}
        fleetAvgScore={80}
        onNavigateToAgent={vi.fn()}
      />,
    );
    const sorted = () => screen.getAllByRole('columnheader').filter((th) => th.getAttribute('aria-sort'));
    expect(sorted().map((th) => [th.textContent, th.getAttribute('aria-sort')])).toEqual([['Overall', 'descending']]);

    fireEvent.click(screen.getByRole('button', { name: 'Speed' }));
    expect(sorted().map((th) => [th.textContent, th.getAttribute('aria-sort')])).toEqual([['Speed', 'descending']]);
  });

  it('renders an unmeasured cell as "Not measured", not as a number', () => {
    render(
      <LeaderboardMatrixView
        leaderboard={[entry('a', 1, 80, 60), entry('b', null, null, null)]}
        fleetBenchmark={null}
        fleetAvgScore={80}
        onNavigateToAgent={vi.fn()}
      />,
    );
    // b: rank, overall, success, health, speed, cost; a: cost; fleet row: 5 dims (no benchmark)
    expect(screen.getAllByText('Not measured').length).toBe(6 + 1 + 5);
  });
});
