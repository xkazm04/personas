import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const dispatchFleetPlan = vi.fn();

vi.mock('@/api/companion', () => ({
  companionDispatchFleetPlan: (...args: unknown[]) => dispatchFleetPlan(...args),
}));

import { AthenaFleetPlanCard } from '../fleet/AthenaFleetPlanCard';
import { useCompanionStore } from '../companionStore';
import { useSystemStore } from '@/stores/systemStore';

function config(rowCount = 2) {
  return {
    operation_intent: 'harden the auth surface',
    rows: Array.from({ length: rowCount }, (_, i) => ({
      cwd: `C:/repo-${i}`,
      objective: `objective ${i}`,
      skill: null,
    })),
  };
}

describe('AthenaFleetPlanCard', () => {
  beforeEach(() => {
    dispatchFleetPlan.mockReset();
    dispatchFleetPlan.mockResolvedValue('Started 2 sessions.');
    useSystemStore.setState({ fleetSessions: [] });
  });

  it('renders one editable row per planned session', () => {
    render(<AthenaFleetPlanCard config={config(3)} />);
    expect(screen.getByTestId('athena-plan-card')).toBeInTheDocument();
    expect(screen.getByTestId('athena-plan-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('athena-plan-row-2')).toBeInTheDocument();
    expect(screen.queryByTestId('athena-plan-row-3')).toBeNull();
  });

  it('sends the EDITED rows, not the proposed ones', async () => {
    render(<AthenaFleetPlanCard config={config(2)} />);
    fireEvent.change(screen.getByTestId('athena-plan-objective-0'), {
      target: { value: 'the objective the user rewrote' },
    });
    fireEvent.change(screen.getByTestId('athena-plan-skill-1'), {
      target: { value: 'scan-sweep' },
    });
    fireEvent.click(screen.getByTestId('athena-plan-confirm'));

    await waitFor(() => expect(dispatchFleetPlan).toHaveBeenCalledTimes(1));
    expect(dispatchFleetPlan).toHaveBeenCalledWith('harden the auth surface', [
      { cwd: 'C:/repo-0', objective: 'the objective the user rewrote', skill: null },
      { cwd: 'C:/repo-1', objective: 'objective 1', skill: 'scan-sweep' },
    ]);
  });

  it('drops a removed row from what is dispatched', async () => {
    render(<AthenaFleetPlanCard config={config(2)} />);
    fireEvent.click(screen.getByTestId('athena-plan-remove-0'));
    expect(screen.queryByTestId('athena-plan-row-1')).toBeNull();
    fireEvent.click(screen.getByTestId('athena-plan-confirm'));

    await waitFor(() => expect(dispatchFleetPlan).toHaveBeenCalledTimes(1));
    const rows = dispatchFleetPlan.mock.calls[0][1] as Array<{ cwd: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].cwd).toBe('C:/repo-1');
  });

  it('cancel dismisses the card without any side effect', () => {
    const { container } = render(<AthenaFleetPlanCard config={config(2)} />);
    fireEvent.click(screen.getByTestId('athena-plan-cancel'));
    expect(container.firstChild).toBeNull();
    expect(dispatchFleetPlan).not.toHaveBeenCalled();
  });

  it('refuses to confirm while any objective is blank', () => {
    render(<AthenaFleetPlanCard config={config(1)} />);
    fireEvent.change(screen.getByTestId('athena-plan-objective-0'), {
      target: { value: '   ' },
    });
    expect(screen.getByTestId('athena-plan-confirm')).toBeDisabled();
  });

  it('surfaces a backend rejection instead of pretending it dispatched', async () => {
    dispatchFleetPlan.mockRejectedValue(
      new Error('row 1: fleet cwd `C:/repo-0` is not within a registered dev project.'),
    );
    render(<AthenaFleetPlanCard config={config(1)} />);
    fireEvent.click(screen.getByTestId('athena-plan-confirm'));
    await waitFor(() => expect(dispatchFleetPlan).toHaveBeenCalled());
    // The registry-translated message renders; what matters is that the card
    // stays in its editable state with an error, rather than claiming success.
    expect(await screen.findByTestId('athena-plan-error')).toBeInTheDocument();
    expect(screen.getByTestId('athena-plan-confirm')).toBeInTheDocument();
  });

  it('renders the dispatch result as markdown instead of raw ** markers', async () => {
    dispatchFleetPlan.mockResolvedValue('**Started 2 sessions.**');
    render(<AthenaFleetPlanCard config={config(2)} />);
    fireEvent.click(screen.getByTestId('athena-plan-confirm'));

    await waitFor(() => {
      expect(screen.getByTestId('athena-plan-card').querySelector('strong')).toBeInTheDocument();
    });
    expect(screen.getByTestId('athena-plan-card').textContent).not.toContain('**');
  });

  it('persists the dispatched outcome into the shared chatCards store on confirm', async () => {
    useCompanionStore.setState({
      chatCards: [{ kind: 'fleet_plan', config: config(2) }],
    });
    render(<AthenaFleetPlanCard config={config(2)} cardIndex={0} />);
    fireEvent.click(screen.getByTestId('athena-plan-confirm'));

    await waitFor(() => expect(dispatchFleetPlan).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const persisted = useCompanionStore.getState().chatCards[0]?.config;
      expect(persisted?.dispatched).toBe(true);
      expect(persisted?.resultMessage).toBe('Started 2 sessions.');
      expect(persisted?.dispatchedRows).toHaveLength(2);
    });
  });

  it('restores the dispatched view (not the editable plan) when remounted from a persisted config', () => {
    // Simulates a panel close/reopen: a fresh AthenaFleetPlanCard instance is
    // mounted with the SAME config a prior instance wrote back on confirm.
    const dispatchedConfig = {
      ...config(2),
      dispatched: true,
      resultMessage: 'Started 2 sessions.',
      dispatchedRows: config(2).rows,
    };
    render(<AthenaFleetPlanCard config={dispatchedConfig} cardIndex={0} />);

    expect(screen.getByTestId('athena-plan-card')).toHaveTextContent('Started 2 sessions.');
    expect(screen.queryByTestId('athena-plan-row-0')).toBeNull();
    expect(screen.queryByTestId('athena-plan-confirm')).toBeNull();
    expect(dispatchFleetPlan).not.toHaveBeenCalled();
  });

  it('shows a live still-running count sourced from the Fleet store after restore', () => {
    const rows = config(2).rows;
    useSystemStore.setState({
      fleetSessions: [
        { id: 's1', cwd: rows[0].cwd, state: 'running' } as never,
        { id: 's2', cwd: rows[1].cwd, state: 'exited' } as never,
      ],
    });
    const dispatchedConfig = {
      ...config(2),
      dispatched: true,
      resultMessage: 'Started 2 sessions.',
      dispatchedRows: rows,
    };
    render(<AthenaFleetPlanCard config={dispatchedConfig} cardIndex={0} />);

    expect(screen.getByTestId('athena-plan-live-status')).toHaveTextContent('1');
  });
});
