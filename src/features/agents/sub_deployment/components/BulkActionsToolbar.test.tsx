import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { BulkActionsToolbar } from './BulkActionsToolbar';
import type { UnifiedDeployment } from './deploymentTypes';

const row = (id: string) => ({
  id, status: 'active', _cloud: { id: `c-${id}` },
}) as unknown as UnifiedDeployment;

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
