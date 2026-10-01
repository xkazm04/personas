/**
 * The answer delta, both phases: what is known the moment an answer is given
 * (topic from the goal slot, kind, goal, channel), and what the reconcile pass
 * adds once the snapshot carries it (the step's gain, the goal's reason). The
 * late phase must not fire before the gain is on the wire, and an unchanged
 * delta must come back as the same object.
 */
import { describe, expect, it } from 'vitest';

import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';

import { instantDelta, reconciledDelta, stepKindOf, topicOfSlot } from '../blueprintDelta';

function goal(over: Partial<SetupGoal> = {}): SetupGoal {
  return {
    id: 'g5',
    slot: 'training:opinions',
    title: 'Where she disagrees with the sales playbook',
    intent: '',
    criteria: [],
    state: 'open',
    pinned: false,
    coverage: 0.3,
    position: 0,
    answered: 4,
    lastWhy: null,
    ...over,
  };
}

function step(over: Partial<SetupStep> = {}): SetupStep {
  return {
    id: 's-41',
    goalId: 'g5',
    stage: 'training',
    origin: 'plan',
    kind: 'opinion',
    question: 'What would you change in the playbook?',
    answerMode: 'pick',
    incoming: null,
    toneChannel: null,
    suggestions: [],
    status: 'live',
    answer: null,
    position: 3,
    askedAt: null,
    answeredAt: null,
    reconciled: false,
    coverageGain: null,
    ...over,
  };
}

describe('instantDelta', () => {
  it('reads topic, kind, goal and channel off the answered step', () => {
    const delta = instantDelta(step({ toneChannel: 'email' }), [goal()]);
    expect(delta).toEqual({
      answeredStepId: 's-41',
      phase: 'instant',
      topicId: 'opinions',
      kind: 'opinion',
      goalId: 'g5',
      coverageGain: null,
      why: null,
      channel: 'email',
    });
  });

  it('a setup goal carries no topic, and an unknown kind is no kind', () => {
    const delta = instantDelta(step({ goalId: 'g1', kind: 'monologue' }), [goal({ id: 'g1', slot: 'identity' })]);
    expect(delta?.topicId).toBeNull();
    expect(delta?.kind).toBeNull();
    expect(delta?.goalId).toBe('g1');
  });

  it('a step that is not an answer plays nothing', () => {
    expect(instantDelta(step({ status: 'skipped' }), [goal()])).toBeNull();
    expect(instantDelta(step({ status: 'queued' }), [goal()])).toBeNull();
    expect(instantDelta(step({ status: 'obsolete' }), [goal()])).toBeNull();
    expect(instantDelta(step({ status: 'answered' }), [goal()])).not.toBeNull();
  });
});

describe('reconciledDelta', () => {
  const instant = instantDelta(step(), [goal()])!;

  it('stays instant, as the same object, until the step carries its gain', () => {
    const transcript = [step({ status: 'answered', reconciled: true, coverageGain: null })];
    expect(reconciledDelta(instant, transcript, [goal({ lastWhy: 'A reason' })])).toBe(instant);
    expect(reconciledDelta(instant, [], [goal()])).toBe(instant);
  });

  it('merges the gain and the goal reason once the reconcile snapshot has them', () => {
    const transcript = [step({ status: 'answered', reconciled: true, coverageGain: 0.12 })];
    const merged = reconciledDelta(instant, transcript, [goal({ lastWhy: 'Took a clear side.' })]);
    expect(merged).toEqual({ ...instant, phase: 'reconciled', coverageGain: 0.12, why: 'Took a clear side.' });
  });

  it('a delta already reconciled comes back untouched', () => {
    const transcript = [step({ status: 'answered', coverageGain: 0.12 })];
    const merged = reconciledDelta(instant, transcript, [goal()]);
    expect(reconciledDelta(merged, transcript, [goal({ lastWhy: 'later' })])).toBe(merged);
  });
});

describe('slot and kind readers', () => {
  it('only names topics that exist', () => {
    expect(topicOfSlot('training:values')).toBe('values');
    expect(topicOfSlot('training:astrology')).toBeNull();
    expect(topicOfSlot('tone')).toBeNull();
    expect(topicOfSlot(null)).toBeNull();
    expect(stepKindOf('reply_drill')).toBe('reply_drill');
  });
});
