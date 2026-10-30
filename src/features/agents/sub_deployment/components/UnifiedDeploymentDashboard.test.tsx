import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';

const state = vi.hoisted(() => ({
  s: {} as Record<string, unknown>,
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (sel: (s: Record<string, unknown>) => unknown) => sel(state.s),
}));
vi.mock('@/hooks/usePersonaNameMap', () => ({ usePersonaNameMap: () => (id: string) => id }));
vi.mock('../hooks/useDeploymentHealth', () => ({ useDeploymentHealth: () => ({ healthMap: {}, isLoading: false }) }));
vi.mock('../hooks/useDeploymentTest', () => ({ useDeploymentTest: () => ({ tests: {}, runTest: vi.fn(), dismissResult: vi.fn() }) }));
vi.mock('../hooks/useConfirmedRemoteAction', () => ({ useConfirmedRemoteAction: () => ({ modal: {}, confirmThen: vi.fn() }) }));
vi.mock('@/features/shared/components/overlays/ConfirmDestructiveModal', () => ({ ConfirmDestructiveModal: () => null }));
vi.mock('./DeploymentTable', () => ({ DeploymentTable: () => <div data-testid="table" /> }));
vi.mock('./DeploymentFilters', () => ({ DeploymentFilters: () => null }));
vi.mock('./UnifiedDeploymentHistory', () => ({ UnifiedDeploymentHistory: () => null }));
vi.mock('./BulkActionsToolbar', () => ({ BulkActionsToolbar: () => null }));
vi.mock('./DeploymentSubComponents', () => ({ SummaryCard: () => null }));

import { UnifiedDeploymentDashboard } from './UnifiedDeploymentDashboard';

const fetchCloud = vi.fn();

beforeEach(() => {
  fetchCloud.mockReset();
  state.s = {
    cloudDeployments: [], cloudBaseUrl: null, cloudConfig: { is_connected: true },
    gitlabConfig: null, gitlabAgents: [], gitlabDeploymentStatuses: [], gitlabSelectedProjectId: null,
    cloudError: 'Cloud orchestrator is unreachable.', gitlabError: null,
    cloudFetchDeployments: fetchCloud, gitlabFetchAgents: vi.fn(),
    cloudPauseDeploy: vi.fn(), cloudResumeDeploy: vi.fn(), cloudRemoveDeploy: vi.fn(),
    cloudBulkPause: vi.fn(), cloudBulkResume: vi.fn(), cloudBulkRemove: vi.fn(),
    gitlabUndeployAgent: vi.fn(), setCloudTab: vi.fn(),
  };
});

describe('UnifiedDeploymentDashboard: header refresh is the Button primitive', () => {
  it('marks the Refresh control busy while the reload runs, like the retry control', async () => {
    fetchCloud.mockResolvedValue(true);
    await act(async () => { render(<UnifiedDeploymentDashboard />); });
    let settle!: (v: boolean) => void;
    fetchCloud.mockImplementation(() => new Promise<boolean>((resolve) => { settle = resolve; }));
    const refresh = screen.getByRole('button', { name: /Refresh/ });
    expect(refresh.getAttribute('aria-busy')).not.toBe('true');
    await act(async () => { fireEvent.click(refresh); });
    expect(screen.getByRole('button', { name: /Refresh/ }).getAttribute('aria-busy')).toBe('true');
    await act(async () => { settle(true); });
    expect(screen.getByRole('button', { name: /Refresh/ }).getAttribute('aria-busy')).not.toBe('true');
    expect(screen.getByRole('button', { name: /Refresh/ }).querySelector('.animate-spin')).toBeNull();
  });
});

describe('UnifiedDeploymentDashboard: a failed fetch is not an empty fleet', () => {
  it('shows the failure with a retry instead of "No deployments yet"', async () => {
    fetchCloud.mockResolvedValue(false);
    await act(async () => { render(<UnifiedDeploymentDashboard />); });

    expect(screen.getByTestId('deployments-load-failed').textContent).toContain('Cloud orchestrator is unreachable.');
    expect(screen.queryByText('No deployments yet')).toBeNull();

    fetchCloud.mockResolvedValue(true);
    await act(async () => { fireEvent.click(screen.getByTestId('deployments-load-retry')); });
    expect(fetchCloud).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('deployments-load-failed')).toBeNull();
    expect(screen.getByText('No deployments yet')).toBeTruthy();
  });
});
