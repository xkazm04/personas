import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

/**
 * Gate for the mutation telemetry in `useTeamMemories`.
 *
 * Every one of the five mutation handlers used to finish with a success toast
 * and nothing else, so the data layer could not distinguish "teams do not
 * curate memories" from "teams curate memories and nobody measured it". This
 * pins that each handler emits exactly one `team_memory` interaction carrying
 * the operation and its outcome — and, just as importantly, that no memory id,
 * title, content or team id rides along (see `lib/analytics/sink.ts`).
 */
vi.mock('@/api/pipeline/teamMemories', () => ({
  listTeamMemories: vi.fn().mockResolvedValue([]),
  getTeamMemoryCount: vi.fn().mockResolvedValue(0),
  getTeamMemoryStats: vi.fn().mockResolvedValue(null),
  createTeamMemory: vi.fn().mockResolvedValue(undefined),
  deleteTeamMemory: vi.fn().mockResolvedValue(undefined),
  updateTeamMemory: vi.fn().mockResolvedValue(undefined),
  updateTeamMemoryImportance: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/analytics', () => ({ trackInteraction: vi.fn() }));

import * as api from '@/api/pipeline/teamMemories';
import { trackInteraction } from '@/lib/analytics';
import { useTeamMemories } from '../useTeamMemories';

const track = vi.mocked(trackInteraction);

const SECRETS = ['mem-1', 'team-1', 'a secret title', 'a secret body'];

function mountHook() {
  return renderHook(() => useTeamMemories('team-1'));
}

describe('useTeamMemories — mutation telemetry', () => {
  beforeEach(() => {
    track.mockClear();
    vi.mocked(api.createTeamMemory).mockResolvedValue(undefined);
    vi.mocked(api.deleteTeamMemory).mockResolvedValue(undefined);
    vi.mocked(api.updateTeamMemory).mockResolvedValue(undefined);
    vi.mocked(api.updateTeamMemoryImportance).mockResolvedValue(undefined);
  });

  it('records a successful create', async () => {
    const { result } = mountHook();
    await act(async () => {
      result.current.onCreate({
        team_id: 'team-1', run_id: null, member_id: null, persona_id: null,
        title: 'a secret title', content: 'a secret body', category: 'observation',
        importance: 3, tags: 'manual',
      });
    });
    await waitFor(() => expect(track).toHaveBeenCalledWith('team_memory', 'create', 'ok'));
  });

  it('records a successful delete, edit and importance change', async () => {
    const { result } = mountHook();
    await act(async () => {
      result.current.onDelete('mem-1');
      result.current.onEdit('mem-1', 'a secret title', 'a secret body', 'decision', 7);
      result.current.onImportanceChange('mem-1', 7);
    });
    await waitFor(() => {
      expect(track).toHaveBeenCalledWith('team_memory', 'delete', 'ok');
      expect(track).toHaveBeenCalledWith('team_memory', 'edit', 'ok');
      expect(track).toHaveBeenCalledWith('team_memory', 'importance', 'ok');
    });
  });

  it('records both sides of the run filter', async () => {
    const { result } = mountHook();
    await act(async () => {
      result.current.onFilterByRun('run-9');
      result.current.onFilterByRun(null);
    });
    expect(track).toHaveBeenCalledWith('team_memory', 'filter_run', 'set');
    expect(track).toHaveBeenCalledWith('team_memory', 'filter_run', 'cleared');
  });

  it('records the failed outcome when the write rejects', async () => {
    vi.mocked(api.deleteTeamMemory).mockRejectedValue(new Error('boom'));
    const { result } = mountHook();
    await act(async () => {
      result.current.onDelete('mem-1');
    });
    await waitFor(() => expect(track).toHaveBeenCalledWith('team_memory', 'delete', 'failed'));
    expect(track).not.toHaveBeenCalledWith('team_memory', 'delete', 'ok');
  });

  it('never puts an id or user-authored content on the wire', async () => {
    const { result } = mountHook();
    await act(async () => {
      result.current.onDelete('mem-1');
      result.current.onEdit('mem-1', 'a secret title', 'a secret body', 'decision', 7);
      result.current.onFilterByRun('run-9');
    });
    await waitFor(() => expect(track).toHaveBeenCalled());
    const emitted = track.mock.calls.flat().join('|');
    SECRETS.forEach((secret) => expect(emitted).not.toContain(secret));
    expect(emitted).not.toContain('run-9');
  });
});
