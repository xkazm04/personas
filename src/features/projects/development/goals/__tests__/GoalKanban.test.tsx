import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DevGoal } from '@/lib/bindings/DevGoal';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const updateGoal = vi.fn().mockResolvedValue(undefined);
const acceptGoal = vi.fn().mockResolvedValue(undefined);
const rejectGoal = vi.fn().mockResolvedValue(undefined);

vi.mock('@/stores/systemStore', () => ({
  useSystemStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      goals: testGoals,
      projects: [],
      updateGoal,
      acceptGoal,
      rejectGoal,
      // The board resolves every goal's `kpi_id` to paint the outcome chip.
      // These fixtures carry no KPI link, so an empty list is the real shape.
      kpis: [],
      fetchAllKpis: vi.fn().mockResolvedValue(undefined),
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
          accept_accept: 'Accept',
          accept_send_back: 'Send back',
          accept_send_back_placeholder: 'What needs rework?',
          accept_cancel: 'Cancel',
        },
      },
      // The shared KanbanBoard announces keyboard moves through these.
      shared: {
        kanban: {
          card_roledescription: 'Movable card',
          picked_up: 'Picked up.',
          targeting: 'Lane: {column}',
          dropped: 'Moved to {column}. {count} in this lane.',
          cancelled: 'Move cancelled.',
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

  it('renders each goal in its bucketed lane (Done shown via toggle)', () => {
    render(<GoalKanban showDone />);
    expect(screen.getByText('Pending goal')).toBeInTheDocument();
    expect(screen.getByText('Running goal')).toBeInTheDocument();
    expect(screen.getByText('Done goal')).toBeInTheDocument();
    // Lane labels visible
    expect(screen.getByText('Your turn')).toBeInTheDocument();
    expect(screen.getByText("Agent's turn")).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('hides the Done lane (and done goals) by default', () => {
    render(<GoalKanban />);
    // Done lane + its goals are absent…
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.queryByText('Done goal')).not.toBeInTheDocument();
    // …and done goals do NOT leak into the fallback "Your turn" lane.
    expect(screen.getByText('Pending goal')).toBeInTheDocument();
    expect(screen.getByText('Running goal')).toBeInTheDocument();
  });

  // The ±5% hover nudger was deliberately dropped when GoalCardFill was promoted
  // to the sole GoalCard (3795ab8ea) — the card is a single-line completion
  // gauge now, and its own header says "No inline checklist, manual nudger".
  // Progress is moved from the goal drawer instead, so there is nothing to test
  // here. The drag-and-drop status change below is still the card's live
  // write-path.

  it('goal cards expose the draggable attribute for native HTML5 drag', () => {
    testGoals = [makeGoal({ id: 'g1', title: 'Pending goal' })];
    render(<GoalKanban />);
    const card = screen.getByText('Pending goal').closest('div[draggable="true"]');
    expect(card).not.toBeNull();
  });

  it('dropping a goal onto the Done lane calls updateGoal with status=completed', () => {
    testGoals = [makeGoal({ id: 'g-move', title: 'Mover', status: 'pending', progress: 40 })];
    render(<GoalKanban showDone />);
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

    // v2: the Done lane writes the canonical `done` status (was `completed`).
    expect(updateGoal).toHaveBeenCalledWith('g-move', { status: 'done' });
  });

  it('a dropped card does not stay stuck at drag opacity (dragend never fires on unmounted elements)', () => {
    testGoals = [makeGoal({ id: 'g-op', title: 'Opacity goal', status: 'pending', progress: 40 })];
    render(<GoalKanban showDone />);
    const card = screen.getByText('Opacity goal').closest('div[draggable="true"]')!;
    const doneLane = screen.getByText('Done').closest('div[class*="rounded-card"]')!;

    const data = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => { data.set(k, v); },
      getData: (k: string) => data.get(k) ?? '',
      types: ['application/x-personas-goal-id'],
      effectAllowed: 'none',
      dropEffect: 'none',
    };
    fireEvent.dragStart(card, { dataTransfer });
    expect(card.className).toContain('opacity-40');
    // Drop WITHOUT a dragend (what happens when the element unmounts mid-drag).
    fireEvent.dragOver(doneLane, { dataTransfer });
    fireEvent.drop(doneLane, { dataTransfer });
    expect(card.className).not.toContain('opacity-40');
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

// ---------------------------------------------------------------------------
// Acceptance on the board (sweep #340). `awaiting_acceptance` sat in the
// Your-turn lane looking like ordinary work, and drag-to-done — the fastest
// gesture on the default hub view — wrote `done` with no accept record.
// ---------------------------------------------------------------------------

function stageDataTransfer() {
  const data = new Map<string, string>();
  return {
    setData: (k: string, v: string) => { data.set(k, v); },
    getData: (k: string) => data.get(k) ?? '',
    types: ['application/x-personas-goal-id'],
    effectAllowed: 'none',
    dropEffect: 'none',
  };
}

describe('GoalKanban — acceptance gate on the board', () => {
  beforeEach(() => {
    updateGoal.mockClear();
    acceptGoal.mockClear();
    rejectGoal.mockClear();
    testGoals = [makeGoal({ id: 'g-await', title: 'Awaiting goal', status: 'awaiting_acceptance', progress: 100 })];
  });

  it('renders accept / send-back on an awaiting card', () => {
    render(<GoalKanban />);
    expect(screen.getByTestId('goal-card-acceptance')).toBeInTheDocument();
    expect(screen.getByText('Accept')).toBeInTheDocument();
  });

  it('accepts from the card instead of writing a bare status', () => {
    render(<GoalKanban />);
    fireEvent.click(screen.getByText('Accept'));
    expect(acceptGoal).toHaveBeenCalledWith('g-await');
    expect(updateGoal).not.toHaveBeenCalled();
  });

  it('send-back carries the rework comment', () => {
    render(<GoalKanban />);
    fireEvent.click(screen.getByLabelText('Send back'));
    fireEvent.change(screen.getByPlaceholderText('What needs rework?'), { target: { value: 'missing tests' } });
    fireEvent.click(screen.getByText('Send back'));
    expect(rejectGoal).toHaveBeenCalledWith('g-await', 'missing tests');
    expect(updateGoal).not.toHaveBeenCalled();
  });

  it('dropping an awaiting card on Done routes through accept, not a status write', () => {
    render(<GoalKanban showDone />);
    const card = screen.getByText('Awaiting goal').closest('div[draggable="true"]')!;
    const doneLane = screen.getByText('Done').closest('div[class*="rounded-card"]')!;
    const dataTransfer = stageDataTransfer();

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(doneLane, { dataTransfer });
    fireEvent.drop(doneLane, { dataTransfer });

    expect(acceptGoal).toHaveBeenCalledWith('g-await');
    expect(updateGoal).not.toHaveBeenCalled();
  });

  it('an ordinary goal dropped on Done still writes the status directly', () => {
    testGoals = [makeGoal({ id: 'g-plain', title: 'Plain goal', status: 'pending', progress: 40 })];
    render(<GoalKanban showDone />);
    const card = screen.getByText('Plain goal').closest('div[draggable="true"]')!;
    const doneLane = screen.getByText('Done').closest('div[class*="rounded-card"]')!;
    const dataTransfer = stageDataTransfer();

    fireEvent.dragStart(card, { dataTransfer });
    fireEvent.dragOver(doneLane, { dataTransfer });
    fireEvent.drop(doneLane, { dataTransfer });

    expect(updateGoal).toHaveBeenCalledWith('g-plain', { status: 'done' });
    expect(acceptGoal).not.toHaveBeenCalled();
  });

  it('clicking the accept control does not also open the goal drawer', () => {
    const onOpenGoal = vi.fn();
    render(<GoalKanban onOpenGoal={onOpenGoal} />);
    fireEvent.click(screen.getByText('Accept'));
    expect(onOpenGoal).not.toHaveBeenCalled();
  });
});
