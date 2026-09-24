import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useSystemStore } from '@/stores/systemStore';
import type { GitLabDeploymentRecord } from '@/lib/bindings/GitLabDeploymentRecord';
import { UnifiedDeploymentHistory } from './UnifiedDeploymentHistory';

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
