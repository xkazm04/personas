import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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

const STATS: TeamMemoryStats = {
  total: 4n,
  auto_generated: 4n,
  max_memories: 100n,
  avg_importance: 3,
  category_counts: [['decision', 4n]],
  run_counts: [['run-1', 2n], ['run-2', 2n]],
};

/**
 * `invokeWithTimeout` rejects with a serialized AppError OBJECT, never an
 * `Error`. The comparison's catch stored `String(err)` -- "[object Object]" --
 * which no error-registry rule can match, so every failed comparison read as
 * the generic "Something went wrong." whatever the backend actually said.
 */
describe('RunDiffView: a failed comparison names its real cause', () => {
  it('resolves an IPC AppError object through the registry, not as [object Object]', async () => {
    vi.mocked(listTeamMemoriesByRun).mockRejectedValue({ error: 'IPC call timed out after 30s', kind: 'Timeout' });
    render(<RunDiffView stats={STATS} onClose={vi.fn()} />);
    expect(await screen.findByText(en.error_registry.timed_out_message)).toBeTruthy();
    expect(screen.queryByText(en.error_registry.generic_message)).toBeNull();
  });
});
