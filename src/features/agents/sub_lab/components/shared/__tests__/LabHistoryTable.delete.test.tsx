import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { LabHistoryTable } from '../LabHistoryTable';

const runs = [{ id: 'r1', status: 'running', createdAt: '2026-01-01T00:00:00Z' }];

function setup() {
  const onDelete = vi.fn();
  render(
    <LabHistoryTable
      runs={runs}
      columns={[]}
      activeRunId={null}
      onRowClick={vi.fn()}
      onDelete={onDelete}
      emptyTitle="none"
      emptySubtitle="none"
      title="History"
    />,
  );
  return onDelete;
}

describe('LabHistoryTable delete', () => {
  it('regression: the trash icon asks before deleting a run', () => {
    const onDelete = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onDelete).toHaveBeenCalledWith('r1');
  });

  it('cancel keeps the run', () => {
    const onDelete = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Delete run' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDelete).not.toHaveBeenCalled();
  });
});
