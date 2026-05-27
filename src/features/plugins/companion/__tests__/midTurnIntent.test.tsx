import { describe, expect, it, beforeEach } from 'vitest';
import { classifyMidTurnIntent } from '../midTurnIntent';
import { useCompanionStore } from '../companionStore';

describe('classifyMidTurnIntent', () => {
  it('interrupts on clear redirect / stop openers', () => {
    for (const t of [
      'stop',
      'Stop that',
      'wait',
      'hold on',
      'cancel',
      'abort it',
      'nvm',
      'never mind',
      'actually, do the other repo instead',
      'instead, summarize the PR',
      'forget it',
      'scratch that',
      'no, not that one',
      "don't bother",
    ]) {
      expect(classifyMidTurnIntent(t)).toBe('interrupt');
    }
  });

  it('queues additive or ambiguous messages', () => {
    for (const t of [
      'and also check the tests',
      'also pull the latest issues',
      "when you're done, open the PR",
      'after that, run the scan',
      'one more thing',
      'summarize the architecture',
      'what about the auth flow?',
      '',
    ]) {
      expect(classifyMidTurnIntent(t)).toBe('queue');
    }
  });

  it('does not mistake words that merely contain a keyword as openers', () => {
    // Word-boundary anchored: "waitlist" / "stopping" / "instead" mid-
    // sentence must NOT be read as a redirect.
    expect(classifyMidTurnIntent('waitlist signups look healthy')).toBe('queue');
    expect(classifyMidTurnIntent('stopping by the office later?')).toBe('queue');
    expect(classifyMidTurnIntent('the report says X instead of Y')).toBe('queue');
  });
});

describe('companionStore message queue', () => {
  beforeEach(() => {
    useCompanionStore.getState().clearQueuedMessages();
  });

  it('enqueues and shifts FIFO with mode preserved', () => {
    const s = useCompanionStore.getState();
    s.enqueueMessage('first', 'queue');
    s.enqueueMessage('second', 'interrupt');
    expect(useCompanionStore.getState().queuedMessages).toHaveLength(2);

    const a = useCompanionStore.getState().shiftQueuedMessage();
    expect(a?.text).toBe('first');
    expect(a?.mode).toBe('queue');
    const b = useCompanionStore.getState().shiftQueuedMessage();
    expect(b?.text).toBe('second');
    expect(b?.mode).toBe('interrupt');
    expect(useCompanionStore.getState().shiftQueuedMessage()).toBeNull();
  });

  it('removes a specific queued message by id', () => {
    const s = useCompanionStore.getState();
    s.enqueueMessage('keep', 'queue');
    s.enqueueMessage('drop', 'queue');
    const drop = useCompanionStore.getState().queuedMessages.find((m) => m.text === 'drop')!;
    s.removeQueuedMessage(drop.id);
    const left = useCompanionStore.getState().queuedMessages;
    expect(left).toHaveLength(1);
    expect(left[0].text).toBe('keep');
  });
});
