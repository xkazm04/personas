import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Store fakes: the hook only reads these slices.
const agentState = {
  personas: [] as Array<{ id: string; name: string; home_team_id: string | null; enabled: boolean }>,
  updatePersona: vi.fn(),
};
const pipelineState = {
  teamMembers: [] as Array<{ id: string; team_id: string; persona_id: string }>,
};
const vaultState = { credentials: [{ id: 'c1', service_type: 'slack' }], fetchCredentials: vi.fn() };

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: typeof agentState) => unknown) => sel(agentState),
}));
vi.mock('@/stores/pipelineStore', () => ({
  usePipelineStore: (sel: (s: typeof pipelineState) => unknown) => sel(pipelineState),
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (sel: (s: typeof vaultState) => unknown) => sel(vaultState),
}));

const getPersonaDetail = vi.fn();
vi.mock('@/api/agents/personas', () => ({
  getPersonaDetail: (id: string) => getPersonaDetail(id),
}));
vi.mock('@/api/credentials/scopedResources', () => ({
  listConnectorResources: vi.fn().mockResolvedValue([]),
}));

import { useTeamSlackBridge } from '../useTeamSlackBridge';
import { upsertTeamBridgeSpec } from '@/lib/channel/teamBridgeSpec';

describe('useTeamSlackBridge carrier candidates', () => {
  beforeEach(() => {
    getPersonaDetail.mockReset();
    getPersonaDetail.mockResolvedValue({ notification_channels: null });
    agentState.personas = [
      { id: 'roster-only', name: 'Added via roster', home_team_id: null, enabled: true },
      { id: 'homed', name: 'Filed under team', home_team_id: 't1', enabled: true },
      { id: 'stranger', name: 'Other team', home_team_id: 't2', enabled: true },
      { id: 'other-roster', name: 'Member of t2', home_team_id: null, enabled: true },
    ];
    pipelineState.teamMembers = [
      { id: 'm1', team_id: 't1', persona_id: 'roster-only' },
      { id: 'm2', team_id: 't2', persona_id: 'other-roster' },
    ];
  });

  it('offers roster members without a home team, plus homed personas, and nobody else', async () => {
    const { result } = renderHook(() => useTeamSlackBridge('t1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.members.map((m) => m.id).sort()).toEqual(['homed', 'roster-only']);
    // Every candidate is hydrated, so a bridge carried by a roster-only member is found.
    expect(getPersonaDetail.mock.calls.map((c) => c[0]).sort()).toEqual(['homed', 'roster-only']);
  });

  it('finds a live bridge carried by a roster member that has no home team', async () => {
    const merged = upsertTeamBridgeSpec(null, {
      teamId: 't1',
      credentialId: 'c1',
      channel: 'C123',
      channelName: 'ops',
      pollInbound: true,
      outboundMessages: true,
      outboundDirectives: true,
      outboundSteps: false,
    });
    if (!merged.ok) throw new Error('fixture blob did not build');
    const blob = merged.json;
    getPersonaDetail.mockImplementation(async (id: string) => ({
      notification_channels: id === 'roster-only' ? blob : null,
    }));
    const { result } = renderHook(() => useTeamSlackBridge('t1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.linkedPersonaId).toBe('roster-only');
    expect(result.current.form.channel).toBe('C123');
  });
});
