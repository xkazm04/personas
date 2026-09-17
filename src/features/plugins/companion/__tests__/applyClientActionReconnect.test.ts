import { describe, it, expect, beforeEach, vi } from 'vitest';

import { applyClientAction } from '../applyClientAction';
import { buildDecisionQueueForTest } from '../decision/useDecisionQueue';
import { useSystemStore } from '@/stores/systemStore';
import { useVaultStore } from '@/stores/vaultStore';

const approvedOutcome = {
  id: 'appr_1',
  status: 'approved' as const,
  message: 'Opening the Vault.',
  clientAction: {
    type: 'reconnect_credential' as const,
    credentialId: 'cred_7',
    accountEmail: 'michal@example.com',
  },
};

// Mocked at module scope, not through `vi.resetModules()` + a dynamic import:
// a reset registry hands the module under test a SECOND copy of the Zustand
// stores, so the assertions read a store the code never wrote to and the test
// fails for a reason that has nothing to do with the behaviour.
vi.mock('@/api/companion', async () => {
  const actual =
    await vi.importActual<typeof import('@/api/companion')>('@/api/companion');
  return {
    ...actual,
    companionListPendingApprovals: vi.fn(async () => [
      {
        id: 'appr_1',
        action: 'reconnect_credential',
        rationale: 'Google access was revoked',
        paramsJson: '{"credential_id":"cred_7"}',
        humanReviewId: null,
        createdAt: '2026-09-16T10:00:00Z',
      },
    ]),
    companionListProactiveMessages: vi.fn(async () => []),
    companionApproveAction: vi.fn(async () => approvedOutcome),
    companionRejectAction: vi.fn(async () => approvedOutcome),
    companionEngageProactive: vi.fn(async () => undefined),
    companionDismissProactive: vi.fn(async () => undefined),
  };
});

vi.mock('@/api/overview/reviews', () => ({
  listManualReviews: vi.fn(async () => []),
}));

/**
 * Two things are under test here, and the second one is the regression that
 * motivated the change:
 *
 *  1. `reconnect_credential` lands on the right screen state — Vault route,
 *     the credential focused, AND `autoReconnectCredentialId` armed. Setting
 *     only the focus flag would show the banner and make the operator press
 *     Reconnect a second time, having already said yes on the orb.
 *
 *  2. The orb's hands-free decision queue applies NON-navigate client actions
 *     at all. It used to carry a private copy of this dispatcher that handled
 *     `navigate` and silently dropped everything else, so an approval the orb
 *     surfaced would execute, report success, and move nothing on screen.
 */
describe('applyClientAction — reconnect_credential', () => {
  beforeEach(() => {
    useVaultStore.setState({
      focusCredentialId: null,
      autoReconnectCredentialId: null,
    });
    useSystemStore.getState().setSidebarSection('home');
  });

  it('opens the Vault with the credential focused and the reconnect armed', () => {
    applyClientAction({ type: 'reconnect_credential', credentialId: 'cred_9' });

    expect(useVaultStore.getState().focusCredentialId).toBe('cred_9');
    expect(useVaultStore.getState().autoReconnectCredentialId).toBe('cred_9');
    expect(useSystemStore.getState().sidebarSection).toBe('credentials');
  });

  it('carries the bound account without it changing where it lands', () => {
    applyClientAction({
      type: 'reconnect_credential',
      credentialId: 'cred_9',
      accountEmail: 'michal@example.com',
    });

    expect(useVaultStore.getState().autoReconnectCredentialId).toBe('cred_9');
    expect(useSystemStore.getState().sidebarSection).toBe('credentials');
  });

  it('leaves navigate behaviour exactly as it was', () => {
    applyClientAction({ type: 'navigate', route: 'overview' });
    expect(useSystemStore.getState().sidebarSection).toBe('overview');

    // An unknown route is still dropped rather than thrown at the sidebar.
    applyClientAction({ type: 'navigate', route: 'not-a-route' });
    expect(useSystemStore.getState().sidebarSection).toBe('overview');

    // And it does not touch the vault flags.
    expect(useVaultStore.getState().autoReconnectCredentialId).toBeNull();
  });
});

describe('the orb decision queue applies non-navigate client actions', () => {
  beforeEach(() => {
    useVaultStore.setState({
      focusCredentialId: null,
      autoReconnectCredentialId: null,
    });
    useSystemStore.getState().setSidebarSection('home');
  });

  it('runs the shared dispatcher on an approved reconnect_credential', async () => {
    const queue = await buildDecisionQueueForTest();
    const approve = queue[0]?.options.find((o) => o.key === 'approve');
    expect(approve).toBeDefined();

    await approve!.run();

    // The whole point: a non-navigate action reached the screen from the orb.
    expect(useVaultStore.getState().focusCredentialId).toBe('cred_7');
    expect(useVaultStore.getState().autoReconnectCredentialId).toBe('cred_7');
    expect(useSystemStore.getState().sidebarSection).toBe('credentials');
  });
});
