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
const reported = vi.fn();
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  silentCatch: (context: string) => (err: unknown) => reported(context, err),
}));

import { mutateCredentialLink } from '@/hooks/design/core/useDesignContextMutator';
import { useConnectorStatuses } from '../useConnectorStatuses';

function cred(id: string, name: string, created_at?: string): CredentialMetadata {
  // Only the fields the hook reads. A probed credential restores its result,
  // so no auto-test fires and healthcheckCredential stays untouched.
  const fields: Partial<CredentialMetadata> = {
    id, name, service_type: 'github', created_at,
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

describe('useConnectorStatuses unlinked auto-match', () => {
  it('names the newest credential, the one the runner injects, whatever the list order', () => {
    act(() => {
      useVaultStore.setState({
        // Oldest first: the opposite of the backend's `ORDER BY created_at DESC`.
        credentials: [
          cred('cred-old', 'Old GitHub', '2026-01-01T00:00:00Z'),
          cred('cred-new', 'New GitHub', '2026-09-01T00:00:00Z'),
        ],
      } as never);
      useAgentStore.setState({ selectedPersona: persona('persona-u', 'nothing-linked') } as never);
    });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.credentialId).toBe('cred-new');
  });
});

describe('useConnectorStatuses explicit link written elsewhere', () => {
  // AgentCredentialDemands' "reuse" writes design_context.credentialLinks
  // through mutateCredentialLink, never through this hook. The row it lands on
  // already holds the auto-matched (newest) credential, and a carried row's
  // credential used to outrank the link, so the panel kept naming and testing
  // a credential the persona was no longer bound to.
  it('a link that changes under a carried auto-matched row wins, with that credential\'s own result', () => {
    act(() => {
      useVaultStore.setState({
        credentials: [
          cred('cred-old', 'Old GitHub', '2026-01-01T00:00:00Z'),
          cred('cred-new', 'New GitHub', '2026-09-01T00:00:00Z'),
        ],
      } as never);
      useAgentStore.setState({ selectedPersona: persona('persona-r', 'nothing-linked') } as never);
    });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.credentialId).toBe('cred-new');

    act(() => { useAgentStore.setState({ selectedPersona: persona('persona-r', 'cred-old') } as never); });

    expect(result.current.statuses[0]?.credentialId).toBe('cred-old');
    expect(result.current.statuses[0]?.credentialName).toBe('Old GitHub');
    expect(result.current.statuses[0]?.result?.cached).toBe(true);
  });

  it('an optimistic link in flight is not overridden while the persisted link is unchanged', async () => {
    let resolveLink!: (v: { applied: boolean }) => void;
    vi.mocked(mutateCredentialLink).mockReturnValueOnce(new Promise((r) => { resolveLink = r; }) as never);
    healthcheckCredential.mockResolvedValue({ success: true, message: 'ok', state: 'verified' });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.credentialId).toBe('cred-a');

    let pending!: Promise<unknown>;
    act(() => { pending = result.current.handleLinkCredential('github', 'cred-b', 'Personal GitHub'); });
    // An unrelated vault refresh re-runs the row build while the write is in flight.
    act(() => {
      useVaultStore.setState({
        credentials: [cred('cred-a', 'Work GitHub'), cred('cred-b', 'Personal GitHub'), cred('cred-c', 'Third')],
      } as never);
    });
    expect(result.current.statuses[0]?.credentialId).toBe('cred-b');
    await act(async () => { resolveLink({ applied: true }); await pending; });
  });
});

describe('useConnectorStatuses link failure', () => {
  it('a link write the queue reports as not applied reaches telemetry, not only the row', async () => {
    reported.mockReset();
    vi.mocked(mutateCredentialLink).mockResolvedValueOnce({ applied: false, reason: 'persona gone' });
    const { result } = renderHook(() => useConnectorStatuses());

    let ok: boolean | undefined;
    await act(async () => { ok = await result.current.handleLinkCredential('github', 'cred-b', 'Personal GitHub'); });

    expect(ok).toBe(false);
    expect(result.current.statuses[0]?.linkError).toContain('persona gone');
    expect(reported).toHaveBeenCalledWith('useConnectorStatuses:linkCredential', expect.objectContaining({ message: 'persona gone' }));
  });

  it('a link that never persisted restores the row it replaced, not an unlinked one', async () => {
    // The persisted link is still cred-a and the runner still injects it, so
    // the row must not claim "No credential" (and count toward the amber
    // "execution blocked" banner) because a different link failed to save.
    vi.mocked(mutateCredentialLink).mockResolvedValueOnce({ applied: false, reason: 'persona gone' });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.credentialId).toBe('cred-a');

    await act(async () => { await result.current.handleLinkCredential('github', 'cred-b', 'Personal GitHub'); });

    const row = result.current.statuses[0];
    expect(row?.credentialId).toBe('cred-a');
    expect(row?.credentialName).toBe('Work GitHub');
    expect(row?.result?.state).toBe('verified');
    expect(row?.linkError).toContain('persona gone');
    expect(result.current.readinessCounts.unlinked).toBe(0);
  });
});

describe('useConnectorStatuses persona-scoped probes', () => {
  it("a probe in flight across a persona switch does not paint the new persona's row", async () => {
    let resolveProbe!: (r: { success: boolean; message: string }) => void;
    healthcheckCredential.mockReturnValueOnce(new Promise((r) => { resolveProbe = r; }));
    const { result } = renderHook(() => useConnectorStatuses());

    let pending!: Promise<unknown>;
    act(() => { pending = result.current.testConnector('github', 'cred-a'); });
    act(() => { useAgentStore.setState({ selectedPersona: persona('persona-b', 'cred-b') } as never); });
    await act(async () => { resolveProbe({ success: false, message: 'persona A probe' }); await pending; });

    expect(result.current.statuses[0]?.result?.message).not.toBe('persona A probe');
  });
});

describe('useConnectorStatuses unreachable re-test', () => {
  it('keeps the restored verdict beside an unreachable attempt', async () => {
    healthcheckCredential.mockResolvedValueOnce({ success: false, message: 'dns failure', state: 'unreachable' });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses[0]?.result?.state).toBe('verified');

    await act(async () => { await result.current.testConnector('github', 'cred-a'); });

    const row = result.current.statuses[0];
    expect(row?.result?.state).toBe('unreachable');
    // The attempt and the last real verdict are two facts: the row holds both.
    expect(row?.lastVerdict?.state).toBe('verified');
    expect(row?.lastVerdict?.testedAt).toBe('2026-10-18T00:00:00Z');
  });

  it('a probe that throws is no verdict either: unreachable, verdict kept', async () => {
    // The store maps a transport failure to `unreachable`; the hook's own
    // catch must agree rather than paint a red failure nothing judged.
    healthcheckCredential.mockRejectedValueOnce(new Error('ipc timeout'));
    const { result } = renderHook(() => useConnectorStatuses());
    await act(async () => { await result.current.testConnector('github', 'cred-a'); });
    const row = result.current.statuses[0];
    expect(row?.result?.state).toBe('unreachable');
    expect(result.current.readinessCounts.unhealthy).toBe(0);
    expect(row?.lastVerdict?.state).toBe('verified');
  });

  it('a later real verdict replaces the kept one', async () => {
    healthcheckCredential.mockResolvedValueOnce({ success: false, message: 'dns failure', state: 'unreachable' });
    healthcheckCredential.mockResolvedValueOnce({ success: false, message: 'bad token', state: 'failed' });
    const { result } = renderHook(() => useConnectorStatuses());
    await act(async () => { await result.current.testConnector('github', 'cred-a'); });
    await act(async () => { await result.current.testConnector('github', 'cred-a'); });
    expect(result.current.statuses[0]?.result?.state).toBe('failed');
    expect(result.current.statuses[0]?.lastVerdict).toBeNull();
  });
});

describe('useConnectorStatuses cold vault', () => {
  it('does not count rows as missing before the first credentials fetch resolves', async () => {
    let resolveFetch!: () => void;
    act(() => {
      useVaultStore.setState({
        credentials: [],
        fetchCredentials: vi.fn().mockReturnValue(new Promise<void>((r) => { resolveFetch = r; })),
      } as never);
      useAgentStore.setState({ selectedPersona: persona('persona-cold', 'cred-a') } as never);
    });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.credentialsLoaded).toBe(false);
    expect(result.current.readinessCounts.unlinked).toBe(0);

    await act(async () => {
      useVaultStore.setState({ credentials: [] } as never);
      resolveFetch();
    });
    expect(result.current.credentialsLoaded).toBe(true);
    expect(result.current.readinessCounts.unlinked).toBe(1);
  });
});

describe('useConnectorStatuses Test all fan-out', () => {
  // Personas share credentials per provider, so an unbounded batch of probes is
  // how a provider rate limit gets read back as "unreachable". The instrument
  // is the peak number of healthchecks in flight at once for a 12-connector run.
  const CONNECTORS = 12;
  const PROBE_CAP = 4;

  it(`never has more than ${PROBE_CAP} healthchecks in flight across ${CONNECTORS} connectors`, async () => {
    const types = Array.from({ length: CONNECTORS }, (_, i) => `svc${i}`);
    const creds = types.map((type, i) => ({ ...cred(`c${i}`, `Cred ${i}`), service_type: type }) as CredentialMetadata);
    let inFlight = 0;
    let peak = 0;
    healthcheckCredential.mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return { success: true, message: 'ok', state: 'verified' };
    });
    act(() => {
      useVaultStore.setState({ credentials: creds } as never);
      useAgentStore.setState({
        selectedPersona: {
          id: 'persona-many', name: 'many', color: '#fff', design_context: JSON.stringify({ credentialLinks: {} }),
          tools: types.map((type, i) => ({ id: `t${i}`, name: `tool${i}`, description: null, requires_credential_type: type })),
        } as never,
      } as never);
    });
    const { result } = renderHook(() => useConnectorStatuses());
    expect(result.current.statuses).toHaveLength(CONNECTORS);

    await act(async () => { await result.current.handleTestAll(); });

    expect(healthcheckCredential).toHaveBeenCalledTimes(CONNECTORS);
    expect(peak).toBeLessThanOrEqual(PROBE_CAP);
    expect(peak).toBeGreaterThan(1);
  });
});
