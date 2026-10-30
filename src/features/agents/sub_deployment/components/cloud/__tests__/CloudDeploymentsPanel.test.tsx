import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { CloudDeployment } from '@/api/system/cloud';
import { CloudDeploymentsPanel } from '../CloudDeploymentsPanel';

// The panel only needs persona names; keep the stores out of the test.
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: unknown[] }) => unknown) => sel({ personas: [] }),
}));
vi.mock('@/hooks/usePersonaNameMap', () => ({
  usePersonaNameMap: () => (id: string) => `Persona-${id}`,
}));

function dep(id: string, label: string | null): CloudDeployment {
  return {
    id, projectId: 'p', personaId: `pid-${id}`, slug: id, label,
    status: 'active', webhookEnabled: false, webhookSecret: null, invocationCount: 0n,
    lastInvokedAt: null, maxMonthlyBudgetUsd: null, currentMonthCostUsd: null, budgetMonth: null,
    createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
  };
}

function setup(deployments: CloudDeployment[]) {
  const onRemove = vi.fn(async () => undefined);
  const noop = vi.fn(async () => undefined);
  render(
    <CloudDeploymentsPanel
      deployments={deployments}
      baseUrl="https://cloud.example"
      isDeploying={false}
      onDeploy={vi.fn(async () => deployments[0]!)}
      onPause={noop}
      onResume={noop}
      onRemove={onRemove}
      onRefresh={noop}
    />,
  );
  return { onRemove };
}

describe('CloudDeploymentsPanel undeploy confirmation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not remove on the first click; it opens a confirmation naming the deployment', () => {
    const { onRemove } = setup([dep('d1', 'Billing bot')]);
    fireEvent.click(screen.getByTitle('Remove deployment'));
    expect(onRemove).not.toHaveBeenCalled();
    expect(within(screen.getByRole('dialog')).getByText('Billing bot')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Undeploy' })).toBeTruthy();
  });

  it('removes exactly the confirmed deployment after the user confirms', async () => {
    const { onRemove } = setup([dep('d1', 'Billing bot'), dep('d2', 'Other bot')]);
    fireEvent.click(screen.getAllByTitle('Remove deployment')[0]!);
    fireEvent.click(screen.getByRole('button', { name: 'Undeploy' }));
    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
    expect(onRemove).toHaveBeenCalledWith('d1');
  });

  it('cancelling the confirmation never removes the deployment', async () => {
    const { onRemove } = setup([dep('d1', 'Billing bot')]);
    fireEvent.click(screen.getByTitle('Remove deployment'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undeploy' })).toBeNull());
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('falls back to the persona name when the deployment has no label', () => {
    setup([dep('d1', null)]);
    fireEvent.click(screen.getByTitle('Remove deployment'));
    expect(within(screen.getByRole('dialog')).getByText('Persona-pid-d1')).toBeTruthy();
  });

  it('renders the empty copy with no deployments', () => {
    setup([]);
    expect(screen.getByText(/^No deployments yet/)).toBeTruthy();
  });
});
