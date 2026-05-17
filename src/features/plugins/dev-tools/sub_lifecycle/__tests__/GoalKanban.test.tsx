import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DevGoal } from '@/lib/bindings/DevGoal';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const updateGoal = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      goals: testGoals,
      updateGoal,
    }),
}));

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: {
      plugins: {
        dev_tools: {
          your_turn: 'Your turn',
          agents_turn: "Agent's turn",
          done: 'Done',
          no_goals_kanban: 'No goals yet',
          no_goals_here: 'Empty',
        },
        dev_lifecycle: {
          kanban_nudge_decrease: 'Decrease 5%',
          kanban_nudge_increase: 'Increase 5%',
          kanban_drop_here: 'Drop here',
        },
      },
    },
    tx: (s: string) => s,
  }),
}));

// tokenMaps is referenced by StatusChip; stub minimally.
vi.mock('@/i18n/tokenMaps', () => ({
  tokenLabel: (_: unknown, __: string, status: string) => status,
}));

vi.mock('@/lib/silentCatch', () => ({
  toastCatch: () => (_: unknown) => {},
  silentCatch: () => (_: unknown) => {},
}));

let testGoals: DevGoal[] = [];

function makeGoal(overrides: Partial<DevGoal> = {}): DevGoal {
  return {
    id: 'g1',
    project_id: 'p1',
    parent_goal_id: null,
    context_id: null,
    order_index: 0,
    title: 'Test goal',
    description: null,
    status: 'pending',
    progress: 50,
    target_date: null,
    started_at: null,
    completed_at: null,
    created_at: '2026-05-16T00:00:00Z',
    updated_at: '2026-05-16T00:00:00Z',
    ...overrides,
  };
}

import GoalKanban from '../GoalKanban';

describe('GoalKanban — drag-and-drop + progress nudge', () => {
  beforeEach(() => {
    updateGoal.mockClear();
    testGoals = [
      makeGoal({ id: 'g-yt', title: 'Pending goal', status: 'pending', progress: 50 }),
      makeGoal({ id: 'g-ag', title: 'Running goal', status: 'in_progress', progress: 30 }),
      makeGoal({ id: 'g-dn', title: 'Done goal', status: 'completed', progress: 100 }),
    ];
  });

  it('renders each goal in its bucketed lane', () => {
    render(<GoalKanban />);
    expect(screen.getByText('Pending goal')).toBeInTheDocument();
    expect(screen.getByText('Running goal')).toBeInTheDocument();
    expect(screen.getByText('Done goal')).toBeInTheDocument();
    // Lane labels visible
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText("Agent's turn")).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('clicking +5% nudge calls updateGoal with progress + 5 clamped at 100', () => {
    testGoals = [makeGoal({ id: 'g1', title: 'Pending goal', status: 'pending', progress: 50 })];
    render(<GoalKanban />);
    const card = screen.getByText('Pending goal').closest('div[class*="cursor-grab"]')!;
    fireEvent.mouseEnter(card);
    const inc = screen.getByLabelText('Increase 5%');
    fireEvent.click(inc);
    expect(updateGoal).toHaveBeenCalledWith('g1', { progress: 55 });
  });

  it('clicking -5% nudge calls updateGoal with progress - 5 clamped at 0', () => {
    testGoals = [makeGoal({ id: 'g1', title: 'Pending goal', status: 'pending', progress: 50 })];
    render(<GoalKanban />);
    const card = screen.getByText('Pending goal').closest('div[class*="cursor-grab"]')!;
    fireEvent.mouseEnter(card);
    const dec = screen.getByLabelText('Decrease 5%');
    fireEvent.click(dec);
    expect(updateGoal).toHaveBeenCalledWith('g1', { progress: 45 });
  });

  it('the -5% nudge is disabled when progress is 0', () => {
    testGoals = [makeGoal({ id: 'g0', title: 'Zero goal', status: 'pending', progress: 0 })];
    render(<GoalKanban />);
    const card = screen.getByText('Zero goal').closest('div[class*="cursor-grab"]')!;
    fireEvent.mouseEnter(card);
    expect(screen.getByLabelText('Decrease 5%')).toBeDisabled();
  });

  it('the +5% nudge is disabled when progress is 100', () => {
    testGoals = [makeGoal({ id: 'g100', title: 'Full goal', status: 'pending', progress: 100 })];
    render(<GoalKanban />);
    const card = screen.getByText('Full goal').closest('div[class*="cursor-grab"]')!;
    fireEvent.mouseEnter(card);
    expect(screen.getByLabelText('Increase 5%')).toBeDisabled();
  });

  it('goal cards expose the draggable attribute for native HTML5 drag', () => {
    testGoals = [makeGoal({ id: 'g1', title: 'Pending goal' })];
    render(<GoalKanban />);
    const card = screen.getByText('Pending goal').closest('div[draggable="true"]');
    expect(card).not.toBeNull();
  });

  it('dropping a goal onto the Done lane calls updateGoal with status=completed', () => {
    testGoals = [makeGoal({ id: 'g-move', title: 'Mover', status: 'pending', progress: 40 })];
    render(<GoalKanban />);
    const card = screen.getByText('Mover').closest('div[draggable="true"]')!;
    const doneLane = screen.getByText('Done').closest('div[class*="rounded-card"]')!;

    // Simulate the drag flow. testing-library does not synthesize a real
    // DataTransfer, so we stage one and reflect it across the events.
    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => data.set(k, v),
      getData: (k: string) => data.get(k) ?? '',
      types: [] as string[],
      effectAllowed: 'none',
      dropEffect: 'none',
    };
    // Patch types after setData so the lane's dragOver predicate passes.
    const origSet = dataTransfer.setData.bind(dataTransfer);
    dataTransfer.setData = (k: string, v: string) => {
      origSet(k, v);
      if (!dataTransfer.types.includes(k)) dataTransfer.types.push(k);
    };

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(doneLane, { dataTransfer });
    fireEvent.drop(doneLane, { dataTransfer });

    expect(updateGoal).toHaveBeenCalledWith('g-move', { status: 'completed' });
  });

  it('drop on the same lane the goal is already in is a no-op', () => {
    testGoals = [makeGoal({ id: 'g-stay', title: 'Stayer', status: 'pending', progress: 40 })];
    render(<GoalKanban />);
    const card = screen.getByText('Stayer').closest('div[draggable="true"]')!;
    const sameLane = screen.getByText('Your turn').closest('div[class*="rounded-card"]')!;

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => { data.set(k, v); },
      getData: (k: string) => data.get(k) ?? '',
      types: ['application/x-personas-goal-id'],
      effectAllowed: 'none',
      dropEffect: 'none',
    };
    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(sameLane, { dataTransfer });
    fireEvent.drop(sameLane, { dataTransfer });

    expect(updateGoal).not.toHaveBeenCalled();
  });
});
