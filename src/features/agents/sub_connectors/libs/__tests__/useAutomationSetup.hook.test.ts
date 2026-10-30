/**
 * Round-2 cards on the automation setup hook (real agent + vault stores; the
 * design task, capabilities and IPC edges are mocked):
 *  - 16: a deploy failure reaches the banner as its own message (the store used
 *        to collapse every failure to null -> "check your platform credentials").
 *  - 17: the custom platform (no credential type) can deploy as a draft.
 *  - 24: a repo / zap listing failure is flagged, distinct from an empty account.
 *  - 28: a persona refresh mid-edit does not reset the user's edits.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import { preloadSectionsAsync } from '@/i18n/useTranslation';
import type { CredentialMetadata } from '@/lib/types/types';

beforeAll(() => preloadSectionsAsync('en', ['vault', 'agents', 'overview']));

const design = {
  phase: 'idle', result: null, outputLines: [] as string[], error: null,
  start: vi.fn(), reset: vi.fn(), cancel: vi.fn(),
};
vi.mock('@/hooks/design/core/useAutomationDesign', () => ({ useAutomationDesign: () => design }));
vi.mock('@/hooks/personas/usePersonaCapabilities', () => ({ usePersonaCapabilities: () => ({ capabilities: [] }) }));
vi.mock('@/api/agents/automations', () => ({
  githubListRepos: vi.fn(), githubCheckPermissions: vi.fn(), zapierListZaps: vi.fn(),
}));

import { githubListRepos, githubCheckPermissions, zapierListZaps } from '@/api/agents/automations';
import { useAutomationSetup } from '../useAutomationSetup';

const deployAutomation = vi.fn();
const cred = (id: string, service_type: string) => ({ id, name: id, service_type } as unknown as CredentialMetadata);

function editRow(name: string) {
  return {
    id: 'auto-1', personaId: 'p1', platform: 'n8n', name, description: 'd', fallbackMode: 'connector',
    timeoutMs: 30000, inputSchema: null, platformCredentialId: 'n8n-1', useCaseId: null,
  };
}

beforeEach(() => {
  deployAutomation.mockReset();
  vi.mocked(githubListRepos).mockReset();
  vi.mocked(githubCheckPermissions).mockReset().mockResolvedValue({ hasRepo: true, hasWorkflow: true } as never);
  vi.mocked(zapierListZaps).mockReset();
  act(() => {
    useVaultStore.setState({
      automations: [], credentials: [cred('n8n-1', 'n8n'), cred('gh-1', 'github_actions'), cred('zap-1', 'zapier')],
      connectorDefinitions: [], deployAutomation, fetchAutomations: vi.fn().mockResolvedValue(undefined),
    } as never);
    useAgentStore.setState({ personas: [], selectedPersona: { id: 'p1', automations: [editRow('Original')] } } as never);
  });
});

describe('useAutomationSetup', () => {
  it('16: a failed deploy shows the backend message, not "check your credentials"', async () => {
    deployAutomation.mockRejectedValue({ error: 'n8n answered 500 Internal Server Error', kind: 'Internal' });
    const { result } = renderHook(() => useAutomationSetup('p1'));
    act(() => { result.current.setName('Nightly'); });
    await waitFor(() => expect(result.current.platformCredentialId).toBe('n8n-1'));
    await act(async () => { await result.current.handleDeploy(); });
    expect(result.current.deployError).toBe('n8n answered 500 Internal Server Error');
  });

  it('17: a custom automation can deploy without a platform credential', async () => {
    deployAutomation.mockResolvedValue({ automation: { id: 'x', personaId: 'p1' }, platformUrl: null, webhookUrl: null, deploymentMessage: 'ok' });
    const { result } = renderHook(() => useAutomationSetup('p1'));
    act(() => { result.current.setPlatform('custom'); result.current.setName('Draft'); });
    expect(result.current.canDeploy).toBe(true);
    await act(async () => { await result.current.handleDeploy(); });
    expect(deployAutomation).toHaveBeenCalledWith(expect.objectContaining({ credentialId: null }));
    expect(result.current.phase).toBe('success');
  });

  it('24: a repo listing failure is flagged, and retry refetches', async () => {
    vi.mocked(githubListRepos).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useAutomationSetup('p1'));
    act(() => { result.current.setPlatform('github_actions'); });
    await waitFor(() => expect(result.current.reposFailed).toBe(true));
    const calls = vi.mocked(githubListRepos).mock.calls.length;
    vi.mocked(githubListRepos).mockResolvedValue([]);
    act(() => { result.current.retryListings(); });
    await waitFor(() => expect(result.current.reposFailed).toBe(false));
    expect(vi.mocked(githubListRepos).mock.calls.length).toBe(calls + 1);
  });

  it('24: a zap listing failure is flagged', async () => {
    vi.mocked(zapierListZaps).mockRejectedValue(new Error('network down'));
    const { result } = renderHook(() => useAutomationSetup('p1'));
    act(() => { result.current.setPlatform('zapier'); });
    await waitFor(() => expect(result.current.zapsFailed).toBe(true));
  });

  it('28: a persona refresh mid-edit keeps the edited name', async () => {
    const { result } = renderHook(() => useAutomationSetup('p1', 'auto-1'));
    await waitFor(() => expect(result.current.name).toBe('Original'));
    act(() => { result.current.setName('Edited by user'); });
    // A background refresh replaces the row with a fresh object of the same id.
    act(() => { useAgentStore.setState({ selectedPersona: { id: 'p1', automations: [editRow('Original')] } } as never); });
    expect(result.current.name).toBe('Edited by user');
  });
});
