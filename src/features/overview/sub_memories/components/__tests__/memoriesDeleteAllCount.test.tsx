import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { preloadSectionsAsync } from '@/i18n/useTranslation';

// Global per-tier counts: 5 active + 3 working + 2 archive + 1 hidden working/context = 11.
const COUNTS: Record<string, number> = { active: 5, working: 3, archive: 2, 'working-context': 1 };
const memory = {
  id: 'm1', persona_id: 'p1', title: 'T', content: 'c', category: 'fact', importance: 3,
  tags: null, tier: 'active', access_count: 0, created_at: '2026-01-01', updated_at: '2026-01-01',
};

vi.mock('@/lib/tauriInvoke', () => ({
  invokeWithTimeout: vi.fn((cmd: string, args?: { tier?: string; category?: string }) => {
    if (cmd === 'list_memories_with_stats') {
      // The filtered view: 2 rows.
      return Promise.resolve({
        memories: [memory], total: 2,
        stats: { total: 2, avg_importance: 3, category_counts: [], agent_counts: [] },
      });
    }
    if (cmd === 'get_memory_count') {
      const key = args?.category === 'context' ? 'working-context' : (args?.tier ?? '');
      return Promise.resolve(COUNTS[key] ?? 0);
    }
    return Promise.resolve([]);
  }),
}));

import { useOverviewStore } from '@/stores/overviewStore';
import MemoriesPageDense from '../MemoriesPageDense';

describe('delete-all confirm states the real blast radius', () => {
  beforeAll(async () => {
    await preloadSectionsAsync('en', ['overview', 'debt']);
  });

  it('counts every non-core memory, not the filtered view total', async () => {
    useOverviewStore.setState({ memories: [memory as never], memoriesTotal: 2, memoriesLoading: false, memoriesError: null });
    render(<MemoriesPageDense />);
    const trigger = await screen.findByTitle('Delete all');
    fireEvent.click(trigger);
    await waitFor(() => expect(screen.getByText(/permanently deletes all/)).toBeTruthy());
    expect(screen.getByText(/permanently deletes all 11 memories/)).toBeTruthy();
    expect(screen.queryByText(/all 2 memories/)).toBeNull();
  });
});
