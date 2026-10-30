import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DeploymentFilters } from './DeploymentFilters';
import { mapCloudStatus, mapGitlabStatus } from './deploymentTypes';

function open(onStatusFilterChange = vi.fn()) {
  render(
    <DeploymentFilters
      search="" onSearchChange={vi.fn()}
      targetFilter="all" onTargetFilterChange={vi.fn()}
      statusFilter="all" onStatusFilterChange={onStatusFilterChange}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
  return onStatusFilterChange;
}

describe('DeploymentFilters status choices', () => {
  // Ground truth is what the mappers can actually put in the Status column,
  // not a second hand-written list: every status a row can carry must be
  // filterable, or that row can be counted but never isolated.
  const reachable = new Set([
    ...['active', 'paused', 'failed', 'deploying', null].map(mapCloudStatus),
    ...['active', 'file-based', 'failed', 'unknown', 'bogus'].map(mapGitlabStatus),
  ]);

  it('offers every status the table can show', () => {
    const onChange = open();
    for (const status of reachable) {
      onChange.mockClear();
      const label = status === 'file-based' ? 'File-based' : status[0]!.toUpperCase() + status.slice(1);
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(onChange).toHaveBeenCalledWith(status);
    }
  });
});
