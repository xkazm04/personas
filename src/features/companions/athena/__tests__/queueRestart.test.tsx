import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { DEFAULT_CONVERSATION_ID, useAthenaStore } from '../athenaStore';
import { useAthenaChatQueue } from '../chat/athenaChatQueue';
import { _resetDedupCacheForTests } from '@/stores/util/dedupedStorage';

// A message typed while a turn is streaming is queued and the composer's draft
// is cleared (Composer.submit). This file pins what an app restart does to
// that message, from two opposite directions on the same build:
//   - it must not be lost (the user pressed Enter; the text was theirs), and
//   - it must not be delivered without a fresh gesture after the restart (the
//     turn it was written against is gone, so sending it would start a model
//     call nobody asked for in this session).

const CONV = DEFAULT_CONVERSATION_ID;

/** Simulate a process restart: JS memory is gone, the on-disk profile is not. */
async function restart(): Promise<void> {
  // Snapshot the disk first: resetting in-memory state is itself a set(), and
  // persist would write the reset state over the profile a real restart keeps.
  const disk = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)!] as const);
  act(() => {
    useAthenaStore.setState(useAthenaStore.getInitialState(), true);
  });
  localStorage.clear();
  for (const [k, v] of disk) localStorage.setItem(k, v);
  _resetDedupCacheForTests();
  await act(async () => {
    await useAthenaStore.persist.rehydrate();
  });
}

/** What the composer's submit does mid-turn: enqueue, then clear the draft. */
function typeAndSubmitMidTurn(sendOrQueue: (text: string, nonce: string) => void, text: string) {
  act(() => {
    useAthenaStore.getState().setDraft(CONV, text);
    sendOrQueue(text, `nonce-${text}`);
    useAthenaStore.getState().clearDraft(CONV);
  });
}

function mountQueue(streaming: boolean, send: (text: string, nonce?: string) => void) {
  return renderHook(
    ({ streaming: s }: { streaming: boolean }) =>
      useAthenaChatQueue({
        streaming: s,
        activeConversationId: CONV,
        send,
        isSending: () => false,
        interrupt: () => {},
      }),
    { initialProps: { streaming } },
  );
}

beforeEach(() => {
  localStorage.clear();
  _resetDedupCacheForTests();
  useAthenaStore.setState({
    activeConversationId: CONV,
    draftsByConversation: {},
    queuedByConversation: {},
    queuedMessages: [],
    streaming: false,
  });
});

afterEach(() => {
  localStorage.clear();
});

describe('queued message across an app restart', () => {
  it('C0 (control): without a restart, the completion edge delivers the queued text', () => {
    const send = vi.fn();
    useAthenaStore.setState({ streaming: true });
    const { result, rerender } = mountQueue(true, send);
    typeAndSubmitMidTurn(result.current, 'and also check the tests');
    act(() => useAthenaStore.setState({ streaming: false }));
    rerender({ streaming: false });
    expect(send.mock.calls.map((c) => c[0])).toContain('and also check the tests');
  });

  it('T1: text queued mid-turn is still recoverable by the user after a restart', async () => {
    const send = vi.fn();
    useAthenaStore.setState({ streaming: true });
    const { result, unmount } = mountQueue(true, send);
    typeAndSubmitMidTurn(result.current, 'and also check the tests');
    expect(useAthenaStore.getState().queuedMessages).toHaveLength(1);
    unmount();

    await restart();

    const s = useAthenaStore.getState();
    const visible = [
      s.draftsByConversation[CONV] ?? '',
      ...(s.queuedByConversation[CONV] ?? []).map((m) => m.text),
    ].join('\n');
    expect(visible).toContain('and also check the tests');
  });

  it('T2: no pre-restart queued text is sent without a fresh gesture', async () => {
    const before = vi.fn();
    useAthenaStore.setState({ streaming: true });
    const first = mountQueue(true, before);
    typeAndSubmitMidTurn(first.result.current, 'and also check the tests');
    first.unmount();

    await restart();

    // App comes back idle. Mount, then the user starts an unrelated new turn
    // and it completes: the drain's completion edge fires.
    const send = vi.fn();
    const { rerender } = mountQueue(false, send);
    expect(send).not.toHaveBeenCalled();
    act(() => useAthenaStore.setState({ streaming: true }));
    rerender({ streaming: true });
    act(() => useAthenaStore.setState({ streaming: false }));
    rerender({ streaming: false });

    const sentTexts = send.mock.calls.map((c) => c[0]);
    expect(sentTexts).not.toContain('and also check the tests');
  });

  it('migration: a profile written before the queue was persisted keeps its drafts', async () => {
    localStorage.setItem(
      'companion-drafts',
      JSON.stringify({ state: { draftsByConversation: { [CONV]: 'old draft' } }, version: 0 }),
    );
    await act(async () => {
      await useAthenaStore.persist.rehydrate();
    });
    const s = useAthenaStore.getState();
    expect(s.draftsByConversation[CONV]).toBe('old draft');
    expect(s.queuedByConversation[CONV] ?? []).toHaveLength(0);
  });

  it('T3: restored text keeps arrival order and precedes any existing draft', async () => {
    const send = vi.fn();
    useAthenaStore.setState({ streaming: true });
    const { result, unmount } = mountQueue(true, send);
    typeAndSubmitMidTurn(result.current, 'first follow-up');
    typeAndSubmitMidTurn(result.current, 'second follow-up');
    act(() => useAthenaStore.getState().setDraft(CONV, 'still typing'));
    unmount();

    await restart();

    const s = useAthenaStore.getState();
    const visible = [
      ...(s.queuedByConversation[CONV] ?? []).map((m) => m.text),
      s.draftsByConversation[CONV] ?? '',
    ].join('\n');
    const i1 = visible.indexOf('first follow-up');
    const i2 = visible.indexOf('second follow-up');
    const i3 = visible.indexOf('still typing');
    expect(i1).toBeGreaterThanOrEqual(0);
    expect(i2).toBeGreaterThan(i1);
    expect(i3).toBeGreaterThan(i2);
  });
});
