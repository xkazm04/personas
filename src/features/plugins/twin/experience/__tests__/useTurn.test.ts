/**
 * The two rules a turn has to hold, both of which cost real answers when they
 * were missing on the surfaces this variant learned from:
 *
 *  - one verdict per question, even while `busy` is still false;
 *  - a redeal is parked until the session is idle, never fired inline.
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

describe('a parked redeal', () => {
  it('waits for the session to go idle rather than firing mid-turn', () => {
    const busy = fakeSession({ busy: true });
    const { rerender, result } = renderHook((s: SetupSessionApi) => useTurn(s), {
      initialProps: busy,
    });

    act(() => result.current.chooseStage('training'));
    expect(busy.redeal).not.toHaveBeenCalled();

    // The session settles on the new stage; only now is a fresh question asked.
    const idle = fakeSession({ busy: false, stage: 'training', redeal: busy.redeal });
    rerender(idle);
    expect(busy.redeal).toHaveBeenCalledTimes(1);
  });

  it('choosing the stage already live changes nothing', () => {
    const session = fakeSession({ stage: 'setup' });
    const { result } = renderHook(() => useTurn(session));
    act(() => result.current.chooseStage('setup'));
    expect(session.setStage).not.toHaveBeenCalled();
    expect(session.redeal).not.toHaveBeenCalled();
  });

  it('picking the topic already live deals at once — nothing the effect watches would change', () => {
    const session = fakeSession({ topic: 'Ask me about my work.' });
    const { result } = renderHook(() => useTurn(session));
    act(() => result.current.chooseTopic('Ask me about my work.', 'background'));
    expect(session.setTopic).not.toHaveBeenCalled();
    expect(session.redeal).toHaveBeenCalledTimes(1);
  });
});
