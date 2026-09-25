import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const createShipMilestone = vi.fn();

vi.mock('@/api/companion', () => ({
  companionCreateShipMilestone: (...args: unknown[]) => createShipMilestone(...args),
}));

import { AthenaShipMilestoneCard } from '../ship/AthenaShipMilestoneCard';

function config(rowCount = 2) {
  return {
    project_id: 'proj_1',
    name: 'M1',
    goal: 'first believable cut',
    rows: Array.from({ length: rowCount }, (_, i) => ({
      item_kind: i === 0 ? 'use_case' : 'goal',
      item_id: `item_${i}`,
      description: `reason ${i}`,
    })),
  };
}

describe('AthenaShipMilestoneCard', () => {
  beforeEach(() => {
    createShipMilestone.mockReset();
    createShipMilestone.mockResolvedValue({
      milestoneId: 'ms_1',
      name: 'M1',
      status: 'planned',
      itemsCreated: 2,
    });
  });

  it('renders one editable row per proposed scope member', () => {
    render(<AthenaShipMilestoneCard config={config(3)} />);
    expect(screen.getByTestId('athena-ship-card')).toBeInTheDocument();
    expect(screen.getByTestId('athena-ship-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('athena-ship-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('athena-ship-row-3')).toBeNull();
  });

  it('creates the EDITED milestone, not the proposed one', async () => {
    render(<AthenaShipMilestoneCard config={config(2)} />);
    fireEvent.change(screen.getByTestId('athena-ship-name'), {
      target: { value: 'M1 renamed by the operator' },
    });
    fireEvent.change(screen.getByTestId('athena-ship-goal'), {
      target: { value: 'the goal he actually meant' },
    });
    fireEvent.change(screen.getByTestId('athena-ship-description-1'), {
      target: { value: 'his reason, not hers' },
    });
    // The milestone's own prose is a SEPARATE field from the per-row reasons —
    // that split is the whole point of the 2026-08-24 change, so the test
    // exercises both and asserts they arrive in different arguments.
    fireEvent.change(screen.getByTestId('athena-ship-prose'), {
      target: { value: 'what shipping it actually means' },
    });
    fireEvent.click(screen.getByTestId('athena-ship-confirm'));

    await waitFor(() => expect(createShipMilestone).toHaveBeenCalledTimes(1));
    expect(createShipMilestone).toHaveBeenCalledWith(
      'proj_1',
      'M1 renamed by the operator',
      'the goal he actually meant',
      'what shipping it actually means',
      [
        { itemKind: 'use_case', itemId: 'item_0', description: 'reason 0' },
        { itemKind: 'goal', itemId: 'item_1', description: 'his reason, not hers' },
      ],
    );
  });

  it('drops a removed item from what gets created', async () => {
    render(<AthenaShipMilestoneCard config={config(2)} />);
    fireEvent.click(screen.getByTestId('athena-ship-remove-0'));
    expect(screen.queryByTestId('athena-ship-row-1')).toBeNull();
    fireEvent.click(screen.getByTestId('athena-ship-confirm'));

    await waitFor(() => expect(createShipMilestone).toHaveBeenCalledTimes(1));
    // Argument 4 now, not 3 — `description` sits between `goal` and `rows`.
    const rows = createShipMilestone.mock.calls[0][4] as Array<{ itemId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].itemId).toBe('item_1');
  });

  it('cancel dismisses the card without writing anything', () => {
    const { container } = render(<AthenaShipMilestoneCard config={config(2)} />);
    fireEvent.click(screen.getByTestId('athena-ship-cancel'));
    expect(container.firstChild).toBeNull();
    expect(createShipMilestone).not.toHaveBeenCalled();
  });

  it('refuses to confirm an empty scope or a nameless milestone', () => {
    render(<AthenaShipMilestoneCard config={config(1)} />);
    fireEvent.change(screen.getByTestId('athena-ship-name'), { target: { value: '  ' } });
    expect(screen.getByTestId('athena-ship-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('athena-ship-name'), { target: { value: 'M1' } });
    fireEvent.click(screen.getByTestId('athena-ship-remove-0'));
    expect(screen.getByTestId('athena-ship-confirm')).toBeDisabled();
  });

  it('surfaces a backend rejection instead of pretending it created', async () => {
    createShipMilestone.mockRejectedValue(
      new Error('row 1: no use case `uc_x` exists in this project.'),
    );
    render(<AthenaShipMilestoneCard config={config(1)} />);
    fireEvent.click(screen.getByTestId('athena-ship-confirm'));
    await waitFor(() => expect(createShipMilestone).toHaveBeenCalled());
    expect(await screen.findByTestId('athena-ship-error')).toBeInTheDocument();
    // The card stays editable rather than claiming a milestone appeared.
    expect(screen.getByTestId('athena-ship-confirm')).toBeInTheDocument();
  });
});
