// The orb's standing unread-message indicator.
//
// Athena's reply reaction is a one-shot (an avatar clip + a border glow for a
// single loop), so a user who wasn't looking at that second got no trace that
// she had answered. `unreadReplies` is the durable half. These pin the two
// rules that make it trustworthy: it never counts what the user is already
// reading, and opening the chat is the ONLY thing that clears it.
import { beforeEach, describe, expect, it } from 'vitest';

import { useCompanionStore } from '../companionStore';
import type { ProactiveMessage } from '../types';

const store = () => useCompanionStore.getState();

const proactive = (id: string): ProactiveMessage =>
  ({ id, body: 'Something came up.' }) as unknown as ProactiveMessage;

beforeEach(() => {
  useCompanionStore.setState({ unreadReplies: 0, state: 'minimized', proactive: [] });
});

describe('orb unread indicator', () => {
  it('counts replies that land while the chat is not open', () => {
    store().noteIncomingReply();
    store().noteIncomingReply();
    expect(store().unreadReplies).toBe(2);
  });

  it('counts them while Athena is fully dismissed too', () => {
    useCompanionStore.setState({ state: 'collapsed' });
    store().noteIncomingReply();
    // Dismissed is not "read" — the badge must be waiting when she returns.
    expect(store().unreadReplies).toBe(1);
  });

  it('does NOT count a reply the user is already watching arrive', () => {
    useCompanionStore.setState({ state: 'open' });
    store().noteIncomingReply();
    expect(store().unreadReplies).toBe(0);
  });

  it('clears when the chat panel opens — opening IS reading', () => {
    store().noteIncomingReply();
    store().noteIncomingReply();
    expect(store().unreadReplies).toBe(2);
    store().setState('open');
    expect(store().unreadReplies).toBe(0);
  });

  it('survives every state change that is not opening the chat', () => {
    store().noteIncomingReply();
    store().setState('collapsed');
    expect(store().unreadReplies).toBe(1);
    store().setState('minimized');
    expect(store().unreadReplies).toBe(1);
  });

  it('badges a proactive nudge — she reached out unprompted', () => {
    store().appendProactive(proactive('p1'));
    expect(store().unreadReplies).toBe(1);
    expect(store().proactive).toHaveLength(1);
  });

  it('does not double-count a re-delivered proactive message', () => {
    store().appendProactive(proactive('p1'));
    // The scheduler re-fires the same id when the app is reopened mid-flight;
    // the dedupe must cover the badge as well as the list.
    store().appendProactive(proactive('p1'));
    expect(store().proactive).toHaveLength(1);
    expect(store().unreadReplies).toBe(1);
  });

  it('does not badge a proactive message delivered into an open chat', () => {
    useCompanionStore.setState({ state: 'open' });
    store().appendProactive(proactive('p1'));
    expect(store().proactive).toHaveLength(1);
    expect(store().unreadReplies).toBe(0);
  });
});
