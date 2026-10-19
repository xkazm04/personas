import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import type { TeamMemory } from '@/lib/bindings/TeamMemory';

// Bypass IPC token wait.
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

const pt = en.pipeline;

const MEMORY: TeamMemory = {
  id: 'tm-1', team_id: 't1', run_id: null, member_id: null, persona_id: null,
  title: 'old title', content: 'old body', category: 'decision', importance: 3, tags: 'manual',
  created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
};

/**
 * Both editors closed BEFORE the write answered: the add form cleared and
 * collapsed, and the row editor returned to the old text. On a failed save the
 * typed memory was gone, with only a toast saying it had not been kept.
 */
describe('TeamMemoryPane: a failed save keeps the draft', () => {
  beforeEach(() => {
    vi.mocked(api.listTeamMemories).mockReset().mockResolvedValue([MEMORY]);
  });

  it('add form: keeps the typed title and body when the create rejects', async () => {
    vi.mocked(api.createTeamMemory).mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);
    await screen.findByText('old title');

    fireEvent.click(screen.getByText(pt.add_memory));
    fireEvent.change(screen.getByPlaceholderText(pt.title_placeholder), { target: { value: 'my draft' } });
    fireEvent.change(screen.getByPlaceholderText(pt.content_placeholder), { target: { value: 'typed body' } });
    fireEvent.click(screen.getByText(pt.save_memory));

    await waitFor(() => expect(api.createTeamMemory).toHaveBeenCalledTimes(1));
    await new Promise((r) => { setTimeout(r, 0); });
    expect((screen.getByPlaceholderText(pt.title_placeholder) as HTMLInputElement).value).toBe('my draft');
    expect((screen.getByPlaceholderText(pt.content_placeholder) as HTMLTextAreaElement).value).toBe('typed body');
  });

  it('add form: clears and collapses once the create lands', async () => {
    vi.mocked(api.createTeamMemory).mockResolvedValue(undefined as never);
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);
    await screen.findByText('old title');

    fireEvent.click(screen.getByText(pt.add_memory));
    fireEvent.change(screen.getByPlaceholderText(pt.title_placeholder), { target: { value: 'kept' } });
    fireEvent.change(screen.getByPlaceholderText(pt.content_placeholder), { target: { value: 'body' } });
    fireEvent.click(screen.getByText(pt.save_memory));

    await waitFor(() => expect(screen.queryByPlaceholderText(pt.title_placeholder)).toBeNull());
  });

  it('row editor: stays open with the edit when the update rejects', async () => {
    vi.mocked(api.updateTeamMemory).mockRejectedValue({ error: 'database is locked', kind: 'Database' });
    render(<TeamMemoryPane teamId="t1" onClose={vi.fn()} />);
    await screen.findByText('old title');

    fireEvent.click(screen.getByLabelText(pt.edit_memory));
    const input = await screen.findByDisplayValue('old title');
    fireEvent.change(input, { target: { value: 'new title' } });
    fireEvent.click(screen.getByLabelText(en.common.save));

    await waitFor(() => expect(api.updateTeamMemory).toHaveBeenCalledTimes(1));
    await new Promise((r) => { setTimeout(r, 0); });
    expect(screen.getByDisplayValue('new title')).toBeTruthy();
  });
});
