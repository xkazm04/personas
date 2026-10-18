/**
 * Rows are rebuilt from the previous rows by connector NAME, and a previous
 * row's credential wins over the link. That is right for an optimistic link in
 * flight, and wrong in two cases these tests pin:
 *  - a persona switch: the hook stays mounted (the Connectors sub-tab is not
 *    keyed by persona), so persona B's `github` row inherited persona A's
 *    credential, name and result;
 *  - a credential deleted from the vault: the row kept pointing at it.
 * Real agent + vault stores; only the IPC-backed edges are mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAgentStore } from '@/stores/agentStore';
import { useVaultStore } from '@/stores/vaultStore';
import type { CredentialMetadata } from '@/lib/types/types';

vi.mock('@/api/system/system', () => ({ sendAppNotification: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@/hooks/design/core/useDesignContextMutator', () => ({
  mutateCredentialLink: vi.fn().mockResolvedValue({ applied: true }),
}));

import { useConnectorStatuses } from '../useConnectorStatuses';

function cred(id: string, name: string): CredentialMetadata {
  // Only the fields the hook reads. A probed credential restores its result,
  // so no auto-test fires and healthcheckCredential stays untouched.
  const fields: Partial<CredentialMetadata> = {
    id, name, service_type: 'github',
    healthcheck_last_success: true, healthcheck_last_message: 'ok',
    healthcheck_last_state: 'verified', healthcheck_last_tested_at: '2026-10-18T00:00:00Z',
  };
  return fields as CredentialMetadata;
}

function persona(id: string, linkedCredId: string) {
  return {
    id, name: id, color: '#fff',
    design_context: JSON.stringify({ credentialLinks: { github: linkedCredId } }),
    tools: [{ id: `t-${id}`, name: 'repo', description: null, requires_credential_type: 'github' }],
  } as never;
}

const healthcheckCredential = vi.fn();

beforeEach(() => {
  healthcheckCredential.mockReset();
  act(() => {
    useVaultStore.setState({
      credentials: [cred('cred-a', 'Work GitHub'), cred('cred-b', 'Personal GitHub')],
      fetchCredentials: vi.fn().mockResolvedValue(undefined),
      healthcheckCredential,
    } as never);
    useAgentStore.setState({ selectedPersona: persona('persona-a', 'cred-a') } as never);
  });
});

describe('useConnectorStatuses row identity', () => {
  it('a persona switch does not carry the previous persona\'s credential over', () => {
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.credentialId).toBe('cred-a');

    act(() => { useAgentStore.setState({ selectedPersona: persona('persona-b', 'cred-b') } as never); });

    expect(result.current.statuses[0]?.credentialId).toBe('cred-b');
    expect(result.current.statuses[0]?.credentialName).toBe('Personal GitHub');
  });

  it('a row whose credential was deleted from the vault falls back to what still exists', () => {
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.credentialId).toBe('cred-a');

    act(() => { useVaultStore.setState({ credentials: [cred('cred-b', 'Personal GitHub')] } as never); });

    expect(result.current.statuses[0]?.credentialId).toBe('cred-b');
    expect(result.current.statuses[0]?.credentialName).toBe('Personal GitHub');
  });

  it('the same persona keeps its row across an unrelated credentials refresh', () => {
    const { result } = renderHook(() => useConnectorStatuses());
    act(() => {
      useVaultStore.setState({
        credentials: [cred('cred-a', 'Work GitHub'), cred('cred-b', 'Personal GitHub'), cred('cred-c', 'Third')],
      } as never);
    });
    expect(result.current.statuses[0]?.credentialId).toBe('cred-a');
    expect(healthcheckCredential).not.toHaveBeenCalled();
  });
});
