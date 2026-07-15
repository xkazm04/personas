import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_CONVERSATION_ID, useCompanionStore } from '../companionStore';

// Multiconv P1 — per-conversation live-turn slices + the "keyed slices +
// active mirror" invariant: the flat streaming fields always equal the
// ACTIVE conversation's slice, and background threads never leak into them.

const A = DEFAULT_CONVERSATION_ID;
const B = 'conv_background';

beforeEach(() => {
  useCompanionStore.setState({
    activeConversationId: A,
    liveTurns: {},
    streaming: false,
    streamingText: '',
    streamingPhase: null,
    streamingBeat: null,
    queuedByConversation: {},
    queuedMessages: [],
  });
});

describe('companionStore liveTurns partition', () => {
  it('a background conversation turn never mutates the flat mirror', () => {
    const s = useCompanionStore.getState();
    s.beginLiveTurn(B, 'turn_b1');
    s.appendLiveText(B, 'background text');
    s.patchLiveTurn(B, {
      streamingPhase: { kind: 'responding' },
      streamingBeat: 'Reading the logs…',
    });

    const after = useCompanionStore.getState();
    expect(after.liveTurns[B]).toMatchObject({
      turnId: 'turn_b1',
      streaming: true,
      streamingText: 'background text',
      streamingBeat: 'Reading the logs…',
    });
    // Flat mirror still reflects the (idle) active conversation A.
    expect(after.streaming).toBe(false);
    expect(after.streamingText).toBe('');
    expect(after.streamingPhase).toBeNull();
    expect(after.streamingBeat).toBeNull();
  });

  it('an active-conversation turn mirrors into the flat fields in the same write', () => {
    const s = useCompanionStore.getState();
    s.beginLiveTurn(A, 'turn_a1');
    s.appendLiveText(A, 'hello');

    let after = useCompanionStore.getState();
    expect(after.streaming).toBe(true);
    expect(after.streamingText).toBe('hello');
    expect(after.liveTurns[A]?.turnId).toBe('turn_a1');

    s.endLiveTurn(A);
    after = useCompanionStore.getState();
    expect(after.streaming).toBe(false);
    expect(after.liveTurns[A]?.turnId).toBeNull();
    // endLiveTurn keeps the text until the next begin.
    expect(after.streamingText).toBe('hello');
    expect(after.liveTurns[A]?.streamingText).toBe('hello');
  });

  it('switching the active conversation swaps the mirror to that slice and back', () => {
    const s = useCompanionStore.getState();
    s.beginLiveTurn(B, 'turn_b1');
    s.appendLiveText(B, 'b text');

    s.setActiveConversationId(B);
    let st = useCompanionStore.getState();
    expect(st.streaming).toBe(true);
    expect(st.streamingText).toBe('b text');
    expect(st.liveTurns[B]?.turnId).toBe('turn_b1');

    s.setActiveConversationId(A);
    st = useCompanionStore.getState();
    // A has no slice on record → mirror snaps to the idle default.
    expect(st.streaming).toBe(false);
    expect(st.streamingText).toBe('');
    expect(st.streamingPhase).toBeNull();
    expect(st.streamingBeat).toBeNull();
  });

  it('keeps queues partitioned per conversation and shifts only the named one', () => {
    const s = useCompanionStore.getState();
    s.enqueueMessage(A, 'a1', 'queue');
    s.enqueueMessage(B, 'b1', 'queue');
    s.enqueueMessage(B, 'b2', 'interrupt');

    // Flat mirror shows only the ACTIVE (A) queue.
    expect(useCompanionStore.getState().queuedMessages.map((m) => m.text)).toEqual(['a1']);

    // Draining A's edge shifts A's queue and leaves B's untouched.
    const shifted = useCompanionStore.getState().shiftQueuedMessage(A);
    expect(shifted?.text).toBe('a1');
    const st = useCompanionStore.getState();
    expect(st.queuedByConversation[A]).toEqual([]);
    expect(st.queuedMessages).toEqual([]);
    expect(st.queuedByConversation[B]?.map((m) => m.text)).toEqual(['b1', 'b2']);

    // The queue mirror follows a thread switch.
    st.setActiveConversationId(B);
    expect(useCompanionStore.getState().queuedMessages.map((m) => m.text)).toEqual(['b1', 'b2']);
  });

  it('legacy flat setters delegate to the active conversation slice', () => {
    const s = useCompanionStore.getState();
    s.setActiveConversationId(B);

    s.setStreaming(true);
    s.appendStreamingText('via legacy');
    s.setStreamingPhase({ kind: 'responding' });
    s.setStreamingBeat('beat');

    let st = useCompanionStore.getState();
    expect(st.liveTurns[B]).toMatchObject({
      streaming: true,
      streamingText: 'via legacy',
      streamingBeat: 'beat',
    });
    expect(st.liveTurns[B]?.streamingPhase).toEqual({ kind: 'responding' });
    // Mirror updated in the same writes — B is the active conversation.
    expect(st.streaming).toBe(true);
    expect(st.streamingText).toBe('via legacy');

    s.resetStreamingText();
    st = useCompanionStore.getState();
    expect(st.liveTurns[B]?.streamingText).toBe('');
    expect(st.streamingText).toBe('');
    // The non-active conversation was never touched.
    expect(st.liveTurns[A]).toBeUndefined();
  });
});
