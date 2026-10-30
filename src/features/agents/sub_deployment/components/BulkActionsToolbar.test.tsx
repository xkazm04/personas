import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BulkActionsToolbar } from './BulkActionsToolbar';
import type { UnifiedDeployment } from './deploymentTypes';

const row = (id: string) => ({
  id, status: 'active', _cloud: { id: `c-${id}` },
}) as unknown as UnifiedDeployment;

const gitlabRow = (id: string) => ({
  id, status: 'active', target: 'gitlab', _gitlab: { id: `g-${id}` },
}) as unknown as UnifiedDeployment;

const renderToolbar = (rows: UnifiedDeployment[]) => render(
  <BulkActionsToolbar
    selectedRows={rows}
    onClearSelection={vi.fn()}
    cloudBulkPause={vi.fn()}
    cloudBulkResume={vi.fn()}
    cloudBulkRemove={vi.fn()}
  />,
);

describe('BulkActionsToolbar scope', () => {
  it('says why GitLab-only selections have no bulk actions', () => {
    renderToolbar([gitlabRow('a'), gitlabRow('b')]);
    expect(screen.getByTestId('bulk-cloud-only-note').textContent)
      .toBe('Bulk actions apply to Cloud only: 2 GitLab deployments are not affected');
    expect(screen.queryByRole('button', { name: /^Pause|^Delete/ })).toBeNull();
  });

  it('names the skipped rows of a mixed selection, singular', () => {
    renderToolbar([row('a'), gitlabRow('b')]);
    expect(screen.getByTestId('bulk-cloud-only-note').textContent)
      .toBe('Bulk actions apply to Cloud only: 1 GitLab deployment is not affected');
    expect(screen.getByRole('button', { name: 'Pause (1)' })).toBeTruthy();
  });

  it('adds no note when every selected row is a cloud row', () => {
    renderToolbar([row('a'), row('b')]);
    expect(screen.queryByTestId('bulk-cloud-only-note')).toBeNull();
  });
});

describe('BulkActionsToolbar delete', () => {
  it('keeps the Confirm button mounted and aria-busy while the bulk undeploy is pending', async () => {
    let settle!: (v: never[]) => void;
    const cloudBulkRemove = vi.fn(() => new Promise<never[]>((resolve) => { settle = resolve; }));
    const onClearSelection = vi.fn();
    render(
      <BulkActionsToolbar
        selectedRows={[row('a'), row('b')]}
        onClearSelection={onClearSelection}
        cloudBulkPause={vi.fn()}
        cloudBulkResume={vi.fn()}
        cloudBulkRemove={cloudBulkRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Delete/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(cloudBulkRemove).toHaveBeenCalledTimes(1);
    const busy = screen.getByRole('button', { name: /Confirm/ });
    expect(busy.getAttribute('aria-busy')).toBe('true');
    await act(async () => { settle([]); });
    expect(onClearSelection).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Confirm/ })).toBeNull();
  });
});
