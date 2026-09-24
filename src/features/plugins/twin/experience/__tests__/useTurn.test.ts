/**
 * The two rules a turn has to hold, both of which cost real answers when they
 * were missing on the surfaces this variant learned from:
 *
 *  - one verdict per question, even while `busy` is still false;
 *  - a stage or topic change is ONE instruction to the session, which owns
 *    the queue now — no parked redeal, no second request.
 */
import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTurn } from '../table/useTurn';
import type { SetupSessionApi } from '../../setup/setupContract';

function fakeSession(over: Partial<SetupSessionApi> = {}): SetupSessionApi {
  return {
    stage: 'setup',
    values: {},
    focus: 'identity',
    checklist: [],
    score: 0,
    question: 'How do you open a message?',
    answerMode: 'pick',
    incoming: null,
    toneChannel: null,
    suggestions: [],
    proposals: [],
    history: [],
    busy: false,
    generatorError: null,
    toneChannels: ['generic'],
    answer: vi.fn(async () => {}),
    accept: vi.fn(async () => {}),
    dismiss: vi.fn(),
    edit: vi.fn(async () => {}),
    skip: vi.fn(async () => {}),
    redeal: vi.fn(),
    focusOn: vi.fn(),
    setStage: vi.fn(),
    topic: null,
    topicPreset: null,
    setTopic: vi.fn(),
    plan: null,
    planning: false,
    reconciling: false,
    lastAnswerOfferIds: [],
    offerRecord: [],
    editOffer: vi.fn(async () => {}),
    steer: vi.fn(async () => {}),
    rebuild: vi.fn(async () => {}),
    ...over,
  };
}

describe('one verdict per question', () => {
  it('a second play of the same question is dropped, even while busy is false', () => {
    const session = fakeSession();
    const { result } = renderHook(() => useTurn(session));

    act(() => result.current.play('first'));
    act(() => result.current.play('second'));

    expect(session.answer).toHaveBeenCalledTimes(1);
    expect(session.answer).toHaveBeenCalledWith('first');
  });

  it('a skip after a play is dropped too — they are the same claim', () => {
    const session = fakeSession();
    const { result } = renderHook(() => useTurn(session));

    act(() => result.current.play('answer'));
    act(() => result.current.skip());

    expect(session.skip).not.toHaveBeenCalled();
  });

  it('an empty answer is not a verdict, so the question is still answerable', () => {
    const session = fakeSession();
    const { result } = renderHook(() => useTurn(session));

    act(() => result.current.play('   '));
    act(() => result.current.play('real'));

    expect(session.answer).toHaveBeenCalledTimes(1);
    expect(session.answer).toHaveBeenCalledWith('real');
  });

  it('a failed turn keeps the same question answerable', () => {
    const session = fakeSession();
    const { rerender, result } = renderHook((s: SetupSessionApi) => useTurn(s), {
      initialProps: session,
    });

    act(() => result.current.play('first'));
    // The guide went down: the question stays, and so must the way to answer it.
    const failed = { ...session, generatorError: 'boom' };
    rerender(failed);
    act(() => result.current.play('again'));

    expect(session.answer).toHaveBeenCalledTimes(2);
  });
});

describe('stage and topic are one instruction each', () => {
  it('choosing a stage hands it to the session once and never redeals', () => {
    const session = fakeSession({ busy: true });
    const { result } = renderHook(() => useTurn(session));

    act(() => result.current.chooseStage('training'));
    expect(session.setStage).toHaveBeenCalledTimes(1);
    expect(session.setStage).toHaveBeenCalledWith('training');
    expect(session.redeal).not.toHaveBeenCalled();
  });

  it('the same stage is still handed over — the session compares it with the STORED stage', () => {
    // Before the first snapshot the rendered stage is only a default, so the
    // turn cannot know whether "setup" is where the session already is.
    const session = fakeSession({ stage: 'setup' });
    const { result } = renderHook(() => useTurn(session));
    act(() => result.current.chooseStage('setup'));
    expect(session.setStage).toHaveBeenCalledWith('setup');
    expect(session.redeal).not.toHaveBeenCalled();
  });

  it('picking a topic sets it with its preset and deals nothing itself', () => {
    const session = fakeSession({ stage: 'training' });
    const { result } = renderHook(() => useTurn(session));
    act(() => result.current.chooseTopic('Ask me about my work.', 'background'));
    expect(session.setTopic).toHaveBeenCalledWith('Ask me about my work.', 'background');
    expect(session.redeal).not.toHaveBeenCalled();
  });
});
