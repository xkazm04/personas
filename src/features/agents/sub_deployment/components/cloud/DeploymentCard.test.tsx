import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeploymentCard } from './DeploymentCard';
import type { CloudDeployment } from '@/api/system/cloud';

const deployment: CloudDeployment = {
  id: 'd1', projectId: 'p', personaId: 'persona-1', slug: 'demo', label: 'Demo bot',
  status: 'paused', webhookEnabled: false, webhookSecret: null, invocationCount: 0n,
  lastInvokedAt: null, maxMonthlyBudgetUsd: null, currentMonthCostUsd: null, budgetMonth: null,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
};

describe('DeploymentCard status badge', () => {
  it('renders the catalog label for the status, as the unified table does - not the raw wire token', () => {
    const noop = vi.fn(async () => undefined);
    render(<DeploymentCard deployment={deployment} baseUrl="https://cloud.example" personaName="Demo"
      onPause={noop} onResume={noop} onRemove={noop} />);
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.queryByText('paused')).toBeNull();
  });
});
