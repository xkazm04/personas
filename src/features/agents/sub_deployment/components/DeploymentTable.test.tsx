import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeploymentTable } from './DeploymentTable';
import { DeploymentFilters } from './DeploymentFilters';
import { DeploymentCard } from './cloud/DeploymentCard';
import type { UnifiedDeployment } from './deploymentTypes';
import { SummaryCard } from './DeploymentSubComponents';
import { Cloud } from 'lucide-react';
import { formatNumeric } from '@/lib/utils/formatters';

const row: UnifiedDeployment = {
  id: 'deployment-1', target: 'cloud', personaName: 'Payroll API', personaId: null,
  name: 'Payroll API', status: 'active', invocations: 2,
  lastActivity: null, createdAt: null, webUrl: null,
};

describe('deployment controls have accessible state and names', () => {
  it('names the select-all, row selection, and test-result dismiss controls', () => {
    render(<DeploymentTable
      displayRows={[row]} busyId={null} sortKey="name" sortDir="asc" toggleSort={vi.fn()}
      handleAction={vi.fn()} cloudPauseDeploy={vi.fn()} cloudResumeDeploy={vi.fn()}
      cloudRemoveDeploy={vi.fn()} gitlabUndeployAgent={vi.fn()}
      selectedIds={new Set()} onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()}
      testStates={{ [row.id]: { running: false, result: { status: 'pass', durationMs: 10, costUsd: null } } }}
      onDismissTest={vi.fn()}
    />);

    expect(screen.getByRole('checkbox', { name: 'Select all deployments' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Select Payroll API' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });

  it('exposes whether the filter popover is expanded', () => {
    render(<DeploymentFilters
      search="" onSearchChange={vi.fn()} targetFilter="all" onTargetFilterChange={vi.fn()}
      statusFilter="all" onStatusFilterChange={vi.fn()}
    />);
    const button = screen.getByRole('button', { name: 'Filter' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('names the cloud card test-result dismiss control', () => {
    render(<DeploymentCard
      deployment={{ id: 'deployment-1', slug: 'payroll', personaId: 'persona-1', status: 'paused',
        label: 'Payroll API', maxMonthlyBudgetUsd: null, invocationCount: 0 } as never}
      baseUrl={null} personaName="Payroll API" onPause={vi.fn()} onResume={vi.fn()} onRemove={vi.fn()}
      testResult={{ status: 'pass', durationMs: null, costUsd: null }} onDismissTest={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
  });
});

describe('summary card connection state is not colour alone', () => {
  it('announces connected and disconnected as text', () => {
    const { rerender } = render(<SummaryCard icon={Cloud} label="Cloud" value={2} connected />);
    expect(screen.getByText('Connected')).toHaveClass('sr-only');
    rerender(<SummaryCard icon={Cloud} label="Cloud" value={2} connected={false} />);
    expect(screen.getByText('Disconnected')).toHaveClass('sr-only');
  });

  it('adds no state text to a card that has no connection', () => {
    render(<SummaryCard icon={Cloud} label="Total" value={2} />);
    expect(screen.queryByText('Connected')).toBeNull();
    expect(screen.queryByText('Disconnected')).toBeNull();
  });
});

describe('table test-result summary uses the shared formatters', () => {
  it('formats duration and cost exactly as the card does', () => {
    render(<DeploymentTable
      displayRows={[row]} busyId={null} sortKey="name" sortDir="asc" toggleSort={vi.fn()}
      handleAction={vi.fn()} cloudPauseDeploy={vi.fn()} cloudResumeDeploy={vi.fn()}
      cloudRemoveDeploy={vi.fn()} gitlabUndeployAgent={vi.fn()}
      selectedIds={new Set()} onToggleSelect={vi.fn()} onToggleSelectAll={vi.fn()}
      testStates={{ [row.id]: { running: false, result: { status: 'pass', durationMs: 1500, costUsd: 0.0123 } } }}
    />);
    const chip = screen.getByText('PASS').closest('span')!;
    expect(chip.getAttribute('title'))
      .toBe(`Passed - ${formatNumeric(1500, 'ms', { language: 'en' })} - ${formatNumeric(0.0123, 'usd', { language: 'en' })}`);
    expect(chip.getAttribute('title')).not.toContain('1500ms');
  });
});
