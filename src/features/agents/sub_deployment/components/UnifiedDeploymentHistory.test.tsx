import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import type { GitLabDeploymentRecord } from '@/lib/bindings/GitLabDeploymentRecord';
import * as gitlabApi from '@/api/system/gitlab';
import { UnifiedDeploymentHistory } from './UnifiedDeploymentHistory';

vi.mock('@/api/system/gitlab', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/system/gitlab')>()),
  listDeploymentHistoryAll: vi.fn(),
}));

// The audit trail now records every cloud sync, success AND failure (the
// backend's persona_projection::record_sync). A failed sync must be visible as
// failed; a successful one must render exactly as it did before.
function row(id: string, deployResult: string): GitLabDeploymentRecord {
  return {
    id,
    personaId: 'p1',
    personaName: `Persona ${id}`,
    projectId: BigInt(0),
    method: 'auto_sync',
    credentialsProvisioned: 0,
    deployResult,
    agentId: null,
    webUrl: null,
    snapshotPrompt: 'prompt',
    rolledBackFrom: null,
    target: 'cloud',
    createdAt: '2026-09-24T00:00:00Z',
  };
}

function renderOpen(history: GitLabDeploymentRecord[]) {
  // Partial store patch: only the three fields this component reads are set;
  // setState merges, so the rest of the store keeps its real shape.
  useSystemStore.setState({
    unifiedDeploymentHistory: history,
    unifiedDeploymentHistoryLoading: false,
    fetchUnifiedDeploymentHistory: vi.fn().mockResolvedValue(undefined),
  } as never);
  render(<UnifiedDeploymentHistory />);
  fireEvent.click(screen.getByRole('button', { expanded: false }));
}

describe('UnifiedDeploymentHistory deploy result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('[guard] renders a successful row with no failed marker', () => {
    renderOpen([row('ok', 'success')]);
    const li = screen.getByTestId('history-row-ok');
    expect(li.getAttribute('data-result')).not.toBe('failed');
    expect(screen.queryByTestId('history-failed-ok')).toBeNull();
    expect(li.textContent).not.toContain('Failed');
  });

  it('marks a failed row with data-result and the existing failed label', () => {
    renderOpen([row('bad', 'failed')]);
    const li = screen.getByTestId('history-row-bad');
    expect(li.getAttribute('data-result')).toBe('failed');
    expect(screen.getByTestId('history-failed-bad').textContent).toBe('Failed');
  });
});

// A failed history load must read as a failure with a retry, never as the
// "no deployment history" copy (the action never rejects, so the panel reads
// the store's error flag). Driven through the REAL store action.
describe('UnifiedDeploymentHistory failed load', () => {
  async function openWithRealAction() {
    const real = (await vi.importActual<typeof import('@/stores/systemStore')>('@/stores/systemStore'))
      .useSystemStore.getInitialState().fetchUnifiedDeploymentHistory;
    useSystemStore.setState({
      unifiedDeploymentHistory: [],
      unifiedDeploymentHistoryLoading: false,
      unifiedDeploymentHistoryError: false,
      fetchUnifiedDeploymentHistory: real,
    } as never);
    render(<UnifiedDeploymentHistory />);
    fireEvent.click(screen.getByRole('button', { expanded: false }));
  }

  beforeEach(() => vi.clearAllMocks());

  it('shows a failure line with retry, not the empty copy, when the load rejects', async () => {
    vi.mocked(gitlabApi.listDeploymentHistoryAll).mockRejectedValue(new Error('ipc down'));
    await openWithRealAction();
    expect(await screen.findByTestId('unified-deploy-history-error')).toBeTruthy();
    expect(screen.queryByText('No deployment history yet')).toBeNull();
  });

  it('retry re-fetches and renders the rows once the load succeeds', async () => {
    vi.mocked(gitlabApi.listDeploymentHistoryAll)
      .mockRejectedValueOnce(new Error('ipc down'))
      .mockResolvedValueOnce([row('r1', 'success')]);
    await openWithRealAction();
    await screen.findByTestId('unified-deploy-history-error');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('history-row-r1')).toBeTruthy();
    expect(screen.queryByTestId('unified-deploy-history-error')).toBeNull();
  });

  it('an empty successful load still shows the empty copy', async () => {
    vi.mocked(gitlabApi.listDeploymentHistoryAll).mockResolvedValue([]);
    await openWithRealAction();
    expect(await screen.findByText('No deployment history yet')).toBeTruthy();
    expect(screen.queryByTestId('unified-deploy-history-error')).toBeNull();
  });
});
