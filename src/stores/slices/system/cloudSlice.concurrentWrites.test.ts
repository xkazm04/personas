import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before the slice is imported.
// ---------------------------------------------------------------------------
const cloudPauseDeployment = vi.fn();
const cloudAdoptDeployment = vi.fn();
const cloudUndeploy = vi.fn();

vi.mock('@/api/system/cloud', () => ({
  cloudConnect: vi.fn(),
  cloudReconnectFromKeyring: vi.fn(),
  cloudDisconnect: vi.fn(),
  cloudGetConfig: vi.fn(),
  cloudStatus: vi.fn(),
  cloudExecutePersona: vi.fn(),
  cloudCancelExecution: vi.fn(),
  cloudOAuthAuthorize: vi.fn(),
  cloudOAuthCallback: vi.fn(),
  cloudOAuthStatus: vi.fn(),
  cloudOAuthRefresh: vi.fn(),
  cloudOAuthDisconnect: vi.fn(),
  cloudDeployPersona: vi.fn(),
  cloudListDeployments: vi.fn(),
  cloudPauseDeployment: (id: string) => cloudPauseDeployment(id),
  cloudResumeDeployment: vi.fn(),
  cloudUndeploy: (id: string) => cloudUndeploy(id),
  cloudAdoptDeployment: (id: string) => cloudAdoptDeployment(id),
  cloudGetBaseUrl: vi.fn(),
}));
vi.mock('@/api/system/gitlab', () => ({
  listDeploymentHistoryAll: vi.fn(async () => []),
}));

// Driven through the real store (see cloudSlice.reconcile.test.ts for why).
import { useSystemStore } from '@/stores/systemStore';
import type { CloudDeployment } from '@/api/system/cloud';

const cloud = () => useSystemStore.getState();

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const dep = (id: string, status: string): CloudDeployment => ({
  id, projectId: 'proj', personaId: `p-${id}`, slug: id, label: id, status,
  webhookEnabled: false, webhookSecret: null, invocationCount: 0n, lastInvokedAt: null,
  maxMonthlyBudgetUsd: null, currentMonthCostUsd: 0, budgetMonth: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The per-deployment actions are NOT optimistic: they write only after the
 * server answers. Their failure path used to restore a snapshot of the list
 * taken when the action STARTED, so a sibling action that succeeded in between
 * was rolled back on screen while the server kept it.
 */
describe('cloudSlice — a failed action does not undo a sibling that succeeded', () => {
  it('pause A succeeds, pause B fails: A stays paused', async () => {
    useSystemStore.setState({ cloudDeployments: [dep('a', 'active'), dep('b', 'active')] });
    const a = deferred<CloudDeployment>();
    const b = deferred<CloudDeployment>();
    cloudPauseDeployment.mockImplementation((id: string) => (id === 'a' ? a.promise : b.promise));

    const pa = cloud().cloudPauseDeploy('a');
    const pb = cloud().cloudPauseDeploy('b');
    a.resolve(dep('a', 'paused'));
    await pa;
    b.reject({ error: 'Cloud error: 503 service unavailable', kind: 'network' });
    await pb;

    const byId = Object.fromEntries(cloud().cloudDeployments.map((d) => [d.id, d.status]));
    expect(byId).toEqual({ a: 'paused', b: 'active' });
    expect(cloud().cloudError).toBeTruthy();
  });

  it('adopt orphan A succeeds, undeploy orphan B fails: A stays adopted', async () => {
    useSystemStore.setState({
      cloudOrphanDeployments: [dep('a', 'active'), dep('b', 'active')],
      cloudReconcileDismissed: false,
    });
    const a = deferred<void>();
    const b = deferred<void>();
    cloudAdoptDeployment.mockImplementation(() => a.promise);
    cloudUndeploy.mockImplementation(() => b.promise);

    const pa = cloud().cloudAdoptOrphan('a');
    const pb = cloud().cloudUndeployOrphan('b');
    a.resolve();
    await pa;
    b.reject({ error: 'Cloud error: 503 service unavailable', kind: 'network' });
    await pb;

    expect(cloud().cloudOrphanDeployments.map((d) => d.id)).toEqual(['b']);
  });
});
