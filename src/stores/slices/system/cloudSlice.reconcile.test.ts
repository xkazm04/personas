import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — declared before the slice is imported.
// ---------------------------------------------------------------------------
const cloudListDeployments = vi.fn();
const cloudAdoptDeployment = vi.fn(async (_id: string) => {});
const cloudUndeploy = vi.fn(async (_id: string) => {});
const listDeploymentHistoryAll = vi.fn(async () => [] as Array<{ target: string; agentId: string | null }>);

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
  cloudListDeployments: () => cloudListDeployments(),
  cloudPauseDeployment: vi.fn(),
  cloudResumeDeployment: vi.fn(),
  cloudUndeploy: (id: string) => cloudUndeploy(id),
  cloudAdoptDeployment: (id: string) => cloudAdoptDeployment(id),
  cloudGetBaseUrl: vi.fn(),
}));
vi.mock('@/api/system/gitlab', () => ({
  listDeploymentHistoryAll: () => listDeploymentHistoryAll(),
}));

// Driven through the real store rather than the slice creator: `cloudSlice`
// imports `storeTypes`, which imports `systemStore`, so importing the creator
// alone initialises the store first and the binding is still uninitialised.
import { useSystemStore } from '@/stores/systemStore';

const cloud = () => useSystemStore.getState();

const deployment = (id: string) => ({ id, personaId: `p-${id}`, slug: id, label: id });

beforeEach(() => {
  vi.clearAllMocks();
  listDeploymentHistoryAll.mockResolvedValue([]);
});

/**
 * `cloudDismissReconcile` used to `set({ cloudOrphanDeployments: [] })`. The
 * orphans it dropped are deployments still RUNNING and still BILLING on the
 * orchestrator with no local record — so one dismissal made "N remote
 * deployments are costing you money" and "you have none" the same state, and
 * nothing brought it back.
 */
describe('cloudSlice — dismissing reconcile is not resolving it', () => {
  it('keeps the orphans after a dismiss, and only folds the banner', async () => {
    cloudListDeployments.mockResolvedValue([deployment('a'), deployment('b')]);
    await cloud().cloudReconcileDeployments();
    expect(cloud().cloudOrphanDeployments).toHaveLength(2);

    cloud().cloudDismissReconcile();
    expect(cloud().cloudReconcileDismissed).toBe(true);
    // The count survives — it is what the badge renders.
    expect(cloud().cloudOrphanDeployments).toHaveLength(2);
  });

  it('a re-reconcile after a dismiss (what a relaunch does) still reports the count', async () => {
    cloudListDeployments.mockResolvedValue([deployment('a'), deployment('b')]);
    await cloud().cloudReconcileDeployments();
    cloud().cloudDismissReconcile();

    // `cloudInitialize` re-runs this on every reconnect.
    await cloud().cloudReconcileDeployments();
    expect(cloud().cloudOrphanDeployments).toHaveLength(2);
    // Still folded — the dismissal is sticky, the warning is not gone.
    expect(cloud().cloudReconcileDismissed).toBe(true);
  });

  it('dismissed-with-orphans and no-orphans are different states', async () => {
    cloudListDeployments.mockResolvedValue([deployment('a')]);
    await cloud().cloudReconcileDeployments();
    cloud().cloudDismissReconcile();
    expect(cloud().cloudOrphanDeployments.length > 0 && cloud().cloudReconcileDismissed).toBe(true);

    // A later scan that genuinely finds nothing: no count, and the dismissal
    // is re-armed so the NEXT orphan opens the banner rather than landing
    // silently behind a months-old dismissal.
    cloudListDeployments.mockResolvedValue([]);
    await cloud().cloudReconcileDeployments();
    expect(cloud().cloudOrphanDeployments).toHaveLength(0);
    expect(cloud().cloudReconcileDismissed).toBe(false);
  });

  it('adopting the last orphan clears the count and re-arms the banner', async () => {
    cloudListDeployments.mockResolvedValue([deployment('a')]);
    await cloud().cloudReconcileDeployments();
    cloud().cloudDismissReconcile();

    await cloud().cloudAdoptOrphan('a');
    expect(cloudAdoptDeployment).toHaveBeenCalledWith('a');
    expect(cloud().cloudOrphanDeployments).toHaveLength(0);
    expect(cloud().cloudReconcileDismissed).toBe(false);
  });

  it('undeploying one of two keeps the badge for the other', async () => {
    cloudListDeployments.mockResolvedValue([deployment('a'), deployment('b')]);
    await cloud().cloudReconcileDeployments();
    cloud().cloudDismissReconcile();

    await cloud().cloudUndeployOrphan('a');
    expect(cloud().cloudOrphanDeployments.map((d) => d.id)).toEqual(['b']);
    expect(cloud().cloudReconcileDismissed).toBe(true);
  });

  it('the badge can re-open the banner', async () => {
    cloudListDeployments.mockResolvedValue([deployment('a')]);
    await cloud().cloudReconcileDeployments();
    cloud().cloudDismissReconcile();

    cloud().cloudShowReconcile();
    expect(cloud().cloudReconcileDismissed).toBe(false);
    expect(cloud().cloudOrphanDeployments).toHaveLength(1);
  });
});
