import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const createTeam = vi.fn();
const fetchTeams = vi.fn();
const selectTeam = vi.fn();
const storeState = { createTeam, fetchTeams, selectTeam, teams: [] as Array<{ id: string }> };
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: Object.assign(
    (sel: (s: typeof storeState) => unknown) => sel(storeState),
    { getState: () => storeState },
  ),
}));

const api = {
  addTeamMember: vi.fn(),
  createTeamConnection: vi.fn(),
  deleteTeam: vi.fn(),
  listTeamMembers: vi.fn(),
  suggestTopology: vi.fn(),
  suggestTopologyLlm: vi.fn(),
};
vi.mock('@/api/pipeline/teams', () => ({
  addTeamMember: (...a: unknown[]) => api.addTeamMember(...a),
  createTeamConnection: (...a: unknown[]) => api.createTeamConnection(...a),
  deleteTeam: (...a: unknown[]) => api.deleteTeam(...a),
  listTeamMembers: (...a: unknown[]) => api.listTeamMembers(...a),
  suggestTopology: (...a: unknown[]) => api.suggestTopology(...a),
  suggestTopologyLlm: (...a: unknown[]) => api.suggestTopologyLlm(...a),
}));
vi.mock('@/api/pipeline/teamMemories', () => ({
  createTeamMemory: vi.fn(),
  listTeamMemories: vi.fn().mockResolvedValue([]),
}));

import { useAutoTeam } from '../useAutoTeam';

const BLUEPRINT = {
  description: 'Review and test',
  members: [
    { persona_id: 'p1', persona_name: 'Reviewer', role: 'reviewer', position_x: 0, position_y: 0 },
    { persona_id: 'p2', persona_name: 'Tester', role: 'tester', position_x: 0, position_y: 0 },
  ],
  connections: [{ source_index: 0, target_index: 1, connection_type: 'sequential' }],
};

describe('useAutoTeam apply', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.suggestTopologyLlm.mockResolvedValue(BLUEPRINT);
    createTeam.mockResolvedValue({ id: 'team-new', name: 'Review and test' });
    api.createTeamConnection.mockResolvedValue({ id: 'c1' });
    fetchTeams.mockResolvedValue(undefined);
  });

  it('finishes the build when the modal is closed mid-apply (no half-built team)', async () => {
    let releaseFirstMember: (v: unknown) => void = () => {};
    api.addTeamMember
      .mockImplementationOnce(() => new Promise((r) => { releaseFirstMember = r; }))
      .mockResolvedValueOnce({ id: 'm2' });

    const { result } = renderHook(() => useAutoTeam());
    act(() => result.current.setQuery('Review this PR and run tests'));
    await act(async () => { result.current.suggest(); });
    await waitFor(() => expect(result.current.phase).toBe('previewing'));

    act(() => { result.current.apply(); });
    await waitFor(() => expect(api.addTeamMember).toHaveBeenCalledTimes(1));

    // The user closes the modal while the first member is being added.
    act(() => result.current.reset());
    await act(async () => { releaseFirstMember({ id: 'm1' }); });

    await waitFor(() => expect(fetchTeams).toHaveBeenCalledTimes(1));
    expect(api.addTeamMember).toHaveBeenCalledTimes(2);
    expect(api.createTeamConnection).toHaveBeenCalledWith('team-new', 'm1', 'm2', 'sequential');
    expect(api.deleteTeam).not.toHaveBeenCalled();
    // The closed modal stays idle: no 'done' screen waiting on the next open,
    // and no surprise navigation.
    expect(result.current.phase).toBe('idle');
    expect(selectTeam).not.toHaveBeenCalled();
  });

  it('a normal apply still ends in done with the persisted counts', async () => {
    api.addTeamMember.mockResolvedValueOnce({ id: 'm1' }).mockResolvedValueOnce({ id: 'm2' });
    const { result } = renderHook(() => useAutoTeam());
    act(() => result.current.setQuery('Review this PR and run tests'));
    await act(async () => { result.current.suggest(); });
    await waitFor(() => expect(result.current.phase).toBe('previewing'));

    await act(async () => { result.current.apply(); });
    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(result.current.memberCount).toBe(2);
    expect(result.current.connectionCount).toBe(1);
  });
});
