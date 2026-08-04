import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DailyGoalsBar } from '../DailyGoalsBar';
import type { DailyGoalsState } from '@/api/companion';

const api = vi.hoisted(() => ({
  state: vi.fn(),
  create: vi.fn(),
  toggle: vi.fn(),
  discard: vi.fn(),
}));

vi.mock('@/api/companion', () => ({
  companionDailyGoalsState: api.state,
  companionDailyGoalsCreate: api.create,
  companionDailyGoalsToggle: api.toggle,
  companionDailyGoalsDiscard: api.discard,
}));

function snap(over: Partial<DailyGoalsState> = {}): DailyGoalsState {
  return {
    goals: [],
    streak: 0,
    completedToday: false,
    justCompleted: false,
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  api.state.mockResolvedValue(snap());
  api.create.mockResolvedValue(snap());
  api.toggle.mockResolvedValue(snap());
  api.discard.mockResolvedValue(snap());
});

describe('DailyGoalsBar', () => {
  it('renders the streak and the set-goals affordance when no set is active', async () => {
    api.state.mockResolvedValue(snap({ streak: 4 }));
    render(<DailyGoalsBar />);
    await waitFor(() => {
      expect(screen.getByTestId('daily-goals-streak')).toHaveTextContent('4');
    });
    expect(screen.getByTestId('daily-goals-open-modal')).toBeInTheDocument();
    expect(screen.queryByTestId('daily-goals-discard')).not.toBeInTheDocument();
  });

  it('renders goal chips and toggles them', async () => {
    api.state.mockResolvedValue(
      snap({
        goals: [
          { id: 'g1', slot: 0, title: 'Ship the fix', done: false },
          { id: 'g2', slot: 1, title: 'Test Athena', done: true },
        ],
      }),
    );
    render(<DailyGoalsBar />);
    await waitFor(() => {
      expect(screen.getByTestId('daily-goal-chip-0')).toHaveTextContent('Ship the fix');
    });
    expect(screen.getByTestId('daily-goal-chip-1')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('daily-goal-chip-0'));
    await waitFor(() => {
      expect(api.toggle).toHaveBeenCalledWith('g1', true);
    });
  });

  it('celebrates when the toggle response closes the set, then clears', async () => {
    vi.useFakeTimers();
    try {
      api.state.mockResolvedValue(
        snap({ goals: [{ id: 'g1', slot: 0, title: 'Only goal', done: false }] }),
      );
      api.toggle.mockResolvedValue(
        snap({ streak: 1, completedToday: true, justCompleted: true }),
      );
      render(<DailyGoalsBar />);
      await act(async () => {
        await vi.runOnlyPendingTimersAsync();
      });
      fireEvent.click(screen.getByTestId('daily-goal-chip-0'));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
      expect(screen.getByTestId('daily-goals-celebration')).toBeInTheDocument();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3000);
      });
      expect(screen.queryByTestId('daily-goals-celebration')).not.toBeInTheDocument();
      expect(screen.getByTestId('daily-goals-streak')).toHaveTextContent('1');
    } finally {
      vi.useRealTimers();
    }
  });

  it('discards the active set', async () => {
    api.state.mockResolvedValue(
      snap({ goals: [{ id: 'g1', slot: 0, title: 'Drop me', done: false }] }),
    );
    render(<DailyGoalsBar />);
    await waitFor(() => {
      expect(screen.getByTestId('daily-goals-discard')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('daily-goals-discard'));
    await waitFor(() => {
      expect(api.discard).toHaveBeenCalled();
    });
  });

  it('opens the modal and requires at least one title before creating', async () => {
    render(<DailyGoalsBar />);
    await waitFor(() => {
      expect(screen.getByTestId('daily-goals-open-modal')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByTestId('daily-goals-open-modal'));
    const createBtn = await screen.findByTestId('daily-goals-create');
    expect(createBtn).toBeDisabled();
    fireEvent.change(screen.getByTestId('daily-goals-input-0'), {
      target: { value: '  Finish the report  ' },
    });
    expect(createBtn).not.toBeDisabled();
    fireEvent.click(createBtn);
    await waitFor(() => {
      expect(api.create).toHaveBeenCalledWith(['Finish the report']);
    });
  });
});
