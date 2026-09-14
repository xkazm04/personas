/**
 * The demands banner and the connectors list must agree on what "linked"
 * means. Uses the REAL agent store (selected-persona subscription) and mocks
 * only the vault store's two slices this hook reads.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentStore } from '@/stores/agentStore';
import type { CredentialMetadata } from '@/lib/types/types';

const githubCred = { id: 'cred-gh', name: 'GitHub PAT', service_type: 'github', serviceType: 'github' } as unknown as CredentialMetadata;

vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (selector: (s: { credentials: CredentialMetadata[]; connectorDefinitions: never[] }) => unknown) =>
    selector({ credentials: [githubCred], connectorDefinitions: [] }),
}));

import { useUnfulfilledCredentials } from '../useUnfulfilledCredentials';

function selectPersona(design_context: string | null) {
  act(() => {
    useAgentStore.setState({
      selectedPersona: {
        id: 'persona-1', name: 'P', color: '#fff', design_context,
        tools: [{ id: 't1', name: 'repo', description: null, requires_credential_type: 'github' }],
      } as never,
    });
  });
}

beforeEach(() => selectPersona(null));

describe('useUnfulfilledCredentials reads links the way the connectors list does', () => {
  it('a link in the current camelCase envelope fulfils the demand', () => {
    selectPersona(JSON.stringify({ credentialLinks: { github: 'cred-gh' } }));
    const { result } = renderHook(() => useUnfulfilledCredentials());
    expect(result.current.unfulfilledCount).toBe(0);
    expect(result.current.fulfilledCount).toBe(1);
  });

  it('a link in the legacy snake_case envelope fulfils it too (parseDesignContext migrates it)', () => {
    // Before: the hand parser read only `credentialLinks`, so this persona
    // was "linked" in the connectors list and "needs a credential" here.
    selectPersona(JSON.stringify({ credential_links: { github: 'cred-gh' } }));
    const { result } = renderHook(() => useUnfulfilledCredentials());
    expect(result.current.unfulfilledCount).toBe(0);
  });

  it('a link to a credential that no longer exists is still a demand, with the auto-match offered', () => {
    selectPersona(JSON.stringify({ credentialLinks: { github: 'cred-deleted' } }));
    const { result } = renderHook(() => useUnfulfilledCredentials());
    expect(result.current.unfulfilledCount).toBe(1);
    expect(result.current.demands[0]?.matchingCredentials.map((c) => c.id)).toEqual(['cred-gh']);
  });

  it('a corrupt design_context reads as no links, not as a crash', () => {
    selectPersona('{not json');
    const { result } = renderHook(() => useUnfulfilledCredentials());
    expect(result.current.unfulfilledCount).toBe(1);
  });
});
