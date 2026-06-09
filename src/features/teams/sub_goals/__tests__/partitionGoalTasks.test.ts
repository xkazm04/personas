import { describe, it, expect } from 'vitest';
import type { DevGoalItem } from '@/lib/bindings/DevGoalItem';
import type { TeamAssignmentStep } from '@/lib/bindings/TeamAssignmentStep';
import { partitionGoalTasks } from '../GoalTaskTable';

function step(overrides: Partial<TeamAssignmentStep> = {}): TeamAssignmentStep {
  return {
    id: 's1', assignmentId: 'a1', stepOrder: 0, title: 'Step', description: null,
    status: 'pending', assignedPersonaId: null, assignedUseCaseId: null,
    matchConfidence: null, matchRationale: null, executionId: null, dependsOn: null,
    outputSummary: null, retryCount: 0, errorMessage: null, startedAt: null, completedAt: null,
    ...overrides,
  };
}

function item(overrides: Partial<DevGoalItem> = {}): DevGoalItem {
  return {
    id: 'i1', goal_id: 'g1', title: 'Todo', done: false, order_index: 0,
    created_at: '2026-06-09T00:00:00Z', updated_at: '2026-06-09T00:00:00Z',
    ...overrides,
  };
}

describe('partitionGoalTasks — checklist/step de-dupe', () => {
  it('drops to-dos whose title exactly matches a team step (the mirror)', () => {
    const steps = [step({ id: 's1', title: 'Write tests' })];
    const items = [
      item({ id: 'i1', title: 'Write tests' }), // mirror of the step → dropped
      item({ id: 'i2', title: 'Buy coffee' }),  // genuinely ad-hoc → kept
    ];
    const { orderedSteps, adhoc } = partitionGoalTasks(steps, items);
    expect(orderedSteps).toHaveLength(1);
    expect(adhoc.map((i) => i.id)).toEqual(['i2']);
  });

  it('keeps a near-match (different whitespace) — match is exact, like the backend', () => {
    const steps = [step({ title: 'Write tests' })];
    const items = [item({ id: 'i1', title: 'Write tests ' })]; // trailing space ≠ exact
    const { adhoc } = partitionGoalTasks(steps, items);
    expect(adhoc.map((i) => i.id)).toEqual(['i1']);
  });

  it('orders steps by stepOrder regardless of input order', () => {
    const steps = [
      step({ id: 'b', title: 'B', stepOrder: 2 }),
      step({ id: 'a', title: 'A', stepOrder: 0 }),
      step({ id: 'c', title: 'C', stepOrder: 1 }),
    ];
    const { orderedSteps } = partitionGoalTasks(steps, []);
    expect(orderedSteps.map((s) => s.id)).toEqual(['a', 'c', 'b']);
  });

  it('a goal with only ad-hoc to-dos keeps them all (no steps)', () => {
    const items = [item({ id: 'i1', title: 'One' }), item({ id: 'i2', title: 'Two' })];
    const { orderedSteps, adhoc } = partitionGoalTasks([], items);
    expect(orderedSteps).toHaveLength(0);
    expect(adhoc).toHaveLength(2);
  });
});
