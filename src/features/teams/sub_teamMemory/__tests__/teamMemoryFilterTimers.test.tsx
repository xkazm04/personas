import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { TeamMemory } from '@/lib/bindings/TeamMemory';

(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

vi.mock('@/api/pipeline/teamMemories', () => ({
  listTeamMemories: vi.fn(),
  getTeamMemoryCount: vi.fn().mockResolvedValue(1),
  getTeamMemoryStats: vi.fn().mockResolvedValue(null),
  createTeamMemory: vi.fn(),
  deleteTeamMemory: vi.fn(),
  updateTeamMemory: vi.fn(),
  updateTeamMemoryImportance: vi.fn(),
}));
vi.mock('@/lib/analytics', () => ({ trackInteraction: vi.fn() }));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import * as api from '@/api/pipeline/teamMemories';
import { TeamMemoryPane } from '../TeamMemoryPane';

const MEMORY: TeamMemory = {
  id: 'tm-1', team_id: 't1', run_id: null, member_id: null, persona_id: null,
  title: 'old title', content: 'old body', category: 'decision', importance: 3, tags: 'manual',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

const chip = (re: RegExp) =>
  screen.getAllByRole('button').find((b) => b.hasAttribute('aria-pressed') && re.test(b.textContent ?? ''))!;

describe('TeamMemoryPanel: filter chips and the search debounce', () => {
  beforeEach(() => {
    vi.mocked(api.listTeamMemories).mockReset().mockResolvedValue([MEMORY]);
  });

  it('marks the active category chip pressed', async () => {
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);
    await screen.findByText('old title');
    expect(chip(/decision/i).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(chip(/decision/i));
    await waitFor(() => expect(chip(/decision/i).getAttribute('aria-pressed')).toBe('true'));
  });

  it('a category click cancels the pending search debounce (no stale category refetch)', async () => {
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);
    await screen.findByText('old title');
    fireEvent.change(screen.getByPlaceholderText(en.pipeline.search_memories), { target: { value: 'foo' } });
    fireEvent.click(chip(/decision/i));
    await new Promise((r) => { setTimeout(r, 450); });
    const calls = vi.mocked(api.listTeamMemories).mock.calls;
    // args: teamId, runId, category, search, limit, offset
    expect(calls[calls.length - 1]![2]).toBe('decision');
    expect(calls.some((c) => c[2] === undefined && c[3] === 'foo')).toBe(false);
  });
});
