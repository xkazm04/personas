/**
 * The plan layer renders the persisted plan and every move the person has over
 * it goes out as ONE steer (or a rebuild) — nothing is decided here.
 *
 * The i18n layer is deliberately NOT mocked: the real catalog fails the moment
 * a key the layer reads does not exist.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';
import type { SetupPlanView } from '../../setup/setupContract';
import { PlanLayer } from '../layers/PlanLayer';

function goal(over: Partial<SetupGoal> = {}): SetupGoal {
  return {
    id: 'g1',
    slot: 'identity',
    title: 'What people come to them for',
    intent: '',
    criteria: [],
    state: 'open',
    pinned: false,
    coverage: 0.4,
    position: 0,
    answered: 1,
    ...over,
  };
}

function queued(id: string, question: string): SetupStep {
  return {
    id,
    goalId: null,
    stage: 'setup',
    origin: 'plan',
    kind: 'opinion',
    question,
    answerMode: 'pick',
    incoming: null,
    toneChannel: null,
    suggestions: [],
    status: 'queued',
    answer: null,
    position: 1,
    askedAt: null,
    answeredAt: null,
    reconciled: false,
  };
}

function plan(over: Partial<SetupPlanView> = {}): SetupPlanView {
  return {
    status: 'ready',
    version: 2,
    error: null,
    changeNote: 'Moved voice ahead of channels.',
    goals: [
      goal({ id: 'gt', slot: 'training:opinions', title: 'Their opinions', position: 0 }),
      goal({ id: 'g2', slot: 'tone', title: 'How they write', position: 1, coverage: 0.9 }),
      goal({ id: 'gd', slot: 'identity', title: 'Dropped one', state: 'dropped', position: 0 }),
      goal({ id: 'g1', slot: 'identity', title: 'What people come to them for', position: 2 }),
    ],
    upcoming: [queued('q1', 'First?'), queued('q2', 'Second?'), queued('q3', 'Third?'), queued('q4', 'Fourth?')],
    observations: [{ id: 'ob1', text: 'Answers in short lines.', evidence: 2, updatedAt: '' }],
    ...over,
  };
}

const steer = vi.fn().mockResolvedValue(undefined);
const rebuild = vi.fn().mockResolvedValue(undefined);

function renderLayer(p: SetupPlanView | null, planning = false) {
  return render(<PlanLayer open onClose={vi.fn()} session={{ plan: p, planning, steer, rebuild }} />);
}

beforeEach(() => vi.clearAllMocks());

describe('the plan layer', () => {
  it('groups goals by phase — setup slots in order, dropped last — then training', () => {
    renderLayer(plan());
    const setupIds = within(screen.getByTestId('mr-plan-phase-setup'))
      .getAllByTestId(/^mr-plan-goal-/)
      .map((el) => el.dataset.testid);
    expect(setupIds).toEqual(['mr-plan-goal-g1', 'mr-plan-goal-g2', 'mr-plan-goal-gd']);
    const trainingIds = within(screen.getByTestId('mr-plan-phase-training'))
      .getAllByTestId(/^mr-plan-goal-/)
      .map((el) => el.dataset.testid);
    expect(trainingIds).toEqual(['mr-plan-goal-gt']);
    expect(screen.getByTestId('mr-plan-change')).toHaveTextContent('Moved voice ahead of channels.');
    expect(screen.getByTestId('mr-plan-noticed')).toHaveTextContent('Answers in short lines.');
  });

  it('draws coverage as a scale, never as a pasted percentage', () => {
    renderLayer(plan());
    expect(screen.getByTestId('mr-plan-coverage-g2').style.transform).toBe('scaleX(0.9)');
    expect(screen.getByTestId('mr-plan-coverage-g1').style.transform).toBe('scaleX(0.4)');
    // A dropped goal shows no bar.
    expect(screen.queryByTestId('mr-plan-coverage-gd')).not.toBeInTheDocument();
  });

  it('pin, drop and restore each send one steer', async () => {
    renderLayer(plan());
    fireEvent.click(screen.getByTestId('mr-plan-pin-g1'));
    fireEvent.click(screen.getByTestId('mr-plan-drop-g2'));
    fireEvent.click(screen.getByTestId('mr-plan-restore-gd'));
    await waitFor(() => expect(steer).toHaveBeenCalledTimes(3));
    expect(steer.mock.calls.map((c) => c[0])).toEqual([
      { action: 'pinGoal', goalId: 'g1', pinned: true },
      { action: 'dropGoal', goalId: 'g2' },
      { action: 'restoreGoal', goalId: 'gd' },
    ]);
  });

  it('shows the next three questions, each of which can be asked next', async () => {
    renderLayer(plan());
    expect(within(screen.getByTestId('mr-plan-upnext')).getAllByRole('listitem')).toHaveLength(3);
    expect(screen.queryByTestId('mr-plan-asknext-q4')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('mr-plan-asknext-q2'));
    await waitFor(() => expect(steer).toHaveBeenCalledWith({ action: 'askNext', stepId: 'q2' }));
  });

  it('rebuild calls rebuild; a failed plan offers a retry that rebuilds too', async () => {
    renderLayer(plan({ status: 'failed', error: 'boom' }));
    expect(screen.getByTestId('mr-plan-status')).toHaveAttribute('data-status', 'failed');
    fireEvent.click(screen.getByTestId('mr-plan-retry'));
    await waitFor(() => expect(rebuild).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId('mr-plan-rebuild'));
    await waitFor(() => expect(rebuild).toHaveBeenCalledTimes(2));
    expect(steer).not.toHaveBeenCalled();
  });

  it('while the plan is drawn up with no goals, a ghost sits under the header', () => {
    renderLayer(plan({ status: 'building', goals: [], upcoming: [], changeNote: null }), true);
    expect(screen.getByTestId('mr-plan-ghost')).toBeInTheDocument();
    expect(screen.getByTestId('mr-plan-status')).toHaveAttribute('data-status', 'building');
    expect(screen.queryByTestId('mr-plan-empty')).not.toBeInTheDocument();
  });

  it('a settled plan with no goals says so', () => {
    renderLayer(plan({ goals: [], upcoming: [] }));
    expect(screen.getByTestId('mr-plan-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('mr-plan-ghost')).not.toBeInTheDocument();
  });
});
