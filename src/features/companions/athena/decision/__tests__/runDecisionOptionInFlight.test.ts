/**
 * One pick per decision while its write is in flight.
 *
 * Five doors answer the pending decision (bubble chip, chat card, the chat
 * variant body, the `;` leader key, a spoken digit) and all of them call
 * `runDecisionOption`. None of them disables itself while the option's write
 * is awaited, so a double click on "Approve" - or Approve then Reject - fired
 * two roster writes for one decision, and the loser's rejection could land
 * `decisionError` on whatever decision the queue surfaced next.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/api/companion', async (orig) => ({
  ...(await orig<typeof import('@/api/companion')>()),
  companionRecordUxSignal: vi.fn(),
  companionSendMessage: vi.fn(async () => undefined),
}));

import { useAthenaStore } from '../../athenaStore';
import { runDecisionOption } from '../resolveDecision';
import type { DecisionOption, PendingDecision } from '../types';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function decision(id: string, options: DecisionOption[]): PendingDecision {
  return { id, prompt: 'Approve the write?', options, source: 'approval' };
}

beforeEach(() => {
  useAthenaStore.getState().clearPendingDecision();
});

describe('runDecisionOption in-flight guard', () => {
  it('runs the write once when the same option is picked twice before it settles', async () => {
    const gate = deferred();
    const run = vi.fn(() => gate.promise);
    const approve: DecisionOption = { key: 'approve', label: 'Approve', run };
    useAthenaStore.getState().setPendingDecision(decision('approval:a-1', [approve]));

    const first = runDecisionOption(approve);
    const second = runDecisionOption(approve);
    gate.resolve();
    await Promise.all([first, second]);

    expect(run).toHaveBeenCalledTimes(1);
    expect(useAthenaStore.getState().pendingDecision).toBeNull();
  });

  it('ignores a second, different option while the first is still writing', async () => {
    const gate = deferred();
    const approve: DecisionOption = { key: 'approve', label: 'Approve', run: vi.fn(() => gate.promise) };
    const reject: DecisionOption = { key: 'reject', label: 'Reject', run: vi.fn(async () => undefined) };
    useAthenaStore.getState().setPendingDecision(decision('approval:a-2', [approve, reject]));

    const first = runDecisionOption(approve);
    await runDecisionOption(reject);
    gate.resolve();
    await first;

    expect(reject.run).not.toHaveBeenCalled();
    expect(approve.run).toHaveBeenCalledTimes(1);
  });

  it('lets a retry through after a failed write (the guard is released)', async () => {
    const run = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('pool busy'))
      .mockResolvedValueOnce(undefined);
    const approve: DecisionOption = { key: 'approve', label: 'Approve', run };
    useAthenaStore.getState().setPendingDecision(decision('approval:a-3', [approve]));

    await runDecisionOption(approve);
    expect(useAthenaStore.getState().decisionError).toBe('run-failed');
    expect(useAthenaStore.getState().pendingDecision?.id).toBe('approval:a-3');

    await runDecisionOption(approve);
    expect(run).toHaveBeenCalledTimes(2);
    expect(useAthenaStore.getState().pendingDecision).toBeNull();
  });
});
