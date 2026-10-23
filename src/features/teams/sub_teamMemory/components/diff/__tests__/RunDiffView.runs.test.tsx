import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import type { TeamMemory } from '@/lib/bindings/TeamMemory';
import type { TeamMemoryStats } from '@/lib/bindings/TeamMemoryStats';
import en from '@/i18n/locales/en.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));
vi.mock('@/api/pipeline/teamMemories', () => ({
  listTeamMemoriesByRun: vi.fn(),
}));

import { listTeamMemoriesByRun } from '@/api/pipeline/teamMemories';
import RunDiffView from '../RunDiffView';
import MemoryTimeline from '../../timeline/MemoryTimeline';

/**
 * `get_stats` groups by `COALESCE(run_id, 'manual')`, so `run_counts` carries a
 * `'manual'` bucket for every hand-written memory. Read as a run, it made a
 * one-run team comparable -- against `listTeamMemoriesByRun('manual')`, which
 * matches no row -- and its timeline say "2 runs".
 */
const STATS: TeamMemoryStats = {
  total: 6n,
  auto_generated: 5n,
  max_memories: 100n,
  avg_importance: 3,
  category_counts: [['decision', 6n]],
  run_counts: [['run-1', 5n], ['manual', 1n]],
};

const mem = (id: string, run_id: string | null): TeamMemory => ({
  id, team_id: 'team-1', run_id, member_id: null, persona_id: null,
  title: id, content: id, category: 'decision', importance: 3, tags: null,
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
});

describe("the 'manual' stats bucket is not a run", () => {
  beforeEach(() => {
    vi.mocked(listTeamMemoriesByRun).mockReset().mockResolvedValue([]);
  });

  it('a team with one run and a hand-written memory has nothing to compare', async () => {
    render(<RunDiffView stats={STATS} onClose={vi.fn()} />);
    expect(screen.getByText(en.pipeline.need_two_runs)).toBeTruthy();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(listTeamMemoriesByRun).not.toHaveBeenCalledWith('manual');
  });

  it('the timeline counts one run, not two', async () => {
    render(
      <MemoryTimeline
        memories={[mem('a', 'run-1'), mem('b', null)]}
        stats={STATS}
        onFilterRun={vi.fn()}
        activeRunFilter={null}
      />,
    );
    await waitFor(() => expect(screen.getByText(en.pipeline.timeline_runs_one)).toBeTruthy());
    expect(screen.queryByText(en.pipeline.timeline_runs_other)).toBeNull();
  });
});
