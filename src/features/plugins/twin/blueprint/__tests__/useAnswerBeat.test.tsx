/**
 * The answer beat: an answer lifts the hand and holds the next card for about
 * two seconds while the blueprint plays what the answer changed; any key deals
 * early; reduced motion shortens the beat; the reconcile pass lands in place
 * and is replayed at the start of the next lift; a step the snapshot read had
 * not caught up with is resolved from the transcript when it arrives.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, renderHook } from '@testing-library/react';

import type { SetupGoal } from '@/lib/bindings/SetupGoal';
import type { SetupStep } from '@/lib/bindings/SetupStep';

import { BEAT_MS, BEAT_REDUCED_MS, REPLAY_MS, useAnswerBeat, type AnswerBeatInput } from '../useAnswerBeat';

function goal(over: Partial<SetupGoal> = {}): SetupGoal {
  return { id: 'g5', slot: 'training:opinions', title: 'Opinions', intent: '', criteria: [], state: 'open', pinned: false, coverage: 0.3, position: 0, answered: 1, lastWhy: null, ...over };
}

function step(id: string, question: string, over: Partial<SetupStep> = {}): SetupStep {
  return { id, goalId: 'g5', stage: 'training', origin: 'plan', kind: 'opinion', question, answerMode: 'pick', incoming: null, toneChannel: null, suggestions: [], status: 'live', answer: null, position: 0, askedAt: null, answeredAt: null, reconciled: false, coverageGain: null, ...over };
}

const GOALS = [goal()];
const S1 = step('s1', 'First?');
const S2 = step('s2', 'Second?');

function base(over: Partial<AnswerBeatInput> = {}): AnswerBeatInput {
  return { question: 'First?', verdict: null, liveStep: S1, goals: GOALS, transcript: [], reduced: false, ...over };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('useAnswerBeat', () => {
  it('holds the next card for the beat, then deals it', () => {
    const { result, rerender } = renderHook((p: AnswerBeatInput) => useAnswerBeat(p), { initialProps: base() });
    expect(result.current.holding).toBe(false);
    expect(result.current.delta).toBeNull();

    rerender(base({ verdict: 'played' }));
    expect(result.current.holding).toBe(true);
    expect(result.current.delta).toMatchObject({ answeredStepId: 's1', phase: 'instant', topicId: 'opinions', kind: 'opinion', goalId: 'g5' });

    // The next question is already here; the beat still holds it.
    rerender(base({ question: 'Second?', verdict: null, liveStep: S2 }));
    act(() => vi.advanceTimersByTime(BEAT_MS - 1));
    expect(result.current.holding).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.holding).toBe(false);
    // The delta stays on the blueprint after the beat.
    expect(result.current.delta?.answeredStepId).toBe('s1');
  });

  it('any key during the beat deals early; leaving keys do not', () => {
    const { result, rerender } = renderHook((p: AnswerBeatInput) => useAnswerBeat(p), { initialProps: base() });
    rerender(base({ verdict: 'played' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.keyDown(window, { key: 'Shift' });
    expect(result.current.holding).toBe(true);
    fireEvent.keyDown(window, { key: 'a' });
    expect(result.current.holding).toBe(false);
  });

  it('a skip is not a beat', () => {
    const { result, rerender } = renderHook((p: AnswerBeatInput) => useAnswerBeat(p), { initialProps: base() });
    rerender(base({ verdict: 'skipped' }));
    expect(result.current.holding).toBe(false);
    expect(result.current.delta).toBeNull();
  });

  it('reduced motion shortens the beat', () => {
    const { result, rerender } = renderHook((p: AnswerBeatInput) => useAnswerBeat(p), { initialProps: base({ reduced: true }) });
    rerender(base({ reduced: true, verdict: 'played' }));
    act(() => vi.advanceTimersByTime(BEAT_REDUCED_MS));
    expect(result.current.holding).toBe(false);
  });

  it('the reconcile lands in place and is replayed on the next lift, before the new delta', () => {
    const { result, rerender } = renderHook((p: AnswerBeatInput) => useAnswerBeat(p), { initialProps: base() });
    rerender(base({ verdict: 'played' }));
    rerender(base({ question: 'Second?', liveStep: S2 }));
    act(() => vi.advanceTimersByTime(BEAT_MS));
    expect(result.current.holding).toBe(false);

    // The reconcile pass scores the first answer while the second card is up.
    const scored = [step('s1', 'First?', { status: 'answered', reconciled: true, coverageGain: 0.12 })];
    const why = [goal({ lastWhy: 'Took a side.' })];
    rerender(base({ question: 'Second?', liveStep: S2, transcript: scored, goals: why }));
    const reconciled = result.current.delta;
    expect(reconciled).toMatchObject({ answeredStepId: 's1', phase: 'reconciled', coverageGain: 0.12, why: 'Took a side.' });

    // Next answer: the reconciled delta replays first (a fresh object), then the new one.
    rerender(base({ question: 'Second?', liveStep: S2, transcript: scored, goals: why, verdict: 'played' }));
    expect(result.current.holding).toBe(true);
    expect(result.current.delta).toEqual(reconciled);
    expect(result.current.delta).not.toBe(reconciled);
    act(() => vi.advanceTimersByTime(REPLAY_MS));
    expect(result.current.delta).toMatchObject({ answeredStepId: 's2', phase: 'instant' });
    act(() => vi.advanceTimersByTime(BEAT_MS - 1));
    expect(result.current.holding).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.holding).toBe(false);
  });

  it('a step the snapshot read had not caught up with resolves from the transcript', () => {
    // The read still shows the previous live step when the answer goes out.
    const stale = step('s0', 'Earlier?');
    const { result, rerender } = renderHook((p: AnswerBeatInput) => useAnswerBeat(p), { initialProps: base({ liveStep: stale }) });
    rerender(base({ liveStep: stale, verdict: 'played' }));
    expect(result.current.delta).toBeNull();
    rerender(base({ liveStep: S2, question: 'Second?', transcript: [step('s1', 'First?', { status: 'answered' })] }));
    expect(result.current.delta).toMatchObject({ answeredStepId: 's1', phase: 'instant' });
  });
});
