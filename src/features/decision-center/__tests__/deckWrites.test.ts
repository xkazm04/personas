/**
 * deckWrites — the one mapping from a deck verdict to the real writes:
 * a chat reply goes through the channel's own door BEFORE the thread is marked
 * seen, to the team or persona channel its key names; done is accept; skip
 * writes nothing; question answers ride as one batch.
 */
import { describe, expect, it, vi } from 'vitest';

import { ReplyRouteError, writeDeckVerdict, type DeckWriteDoors } from '../deck/deckWrites';
import type { DecisionItem } from '../model/decisionModel';
import { item, rejectionOf } from './rosterFixtures';

function doors(): DeckWriteDoors & { order: string[] } {
  const order: string[] = [];
  return {
    order,
    decide: vi.fn(async (d) => { order.push(`decide:${d.verdict}`); }),
    sendTeamReply: vi.fn(async () => { order.push('team'); }),
    sendPersonaReply: vi.fn(async () => { order.push('persona'); }),
  };
}

const thread = (channelKey: string, canReply = true): DecisionItem => item({
  id: `message:${channelKey}`,
  kind: 'message',
  thread: {
    channelKey,
    canReply,
    messages: [
      { id: 'm-1', author: 'persona', name: 'Scout', body: 'First', at: '2026-10-01T10:00:00Z' },
      { id: 'm-2', author: 'persona', name: 'Scout', body: 'Approve the plan?', at: '2026-10-01T10:05:00Z' },
    ],
  },
  payload: { channelKey },
});

describe('writeDeckVerdict', () => {
  it('a team reply is a directive threaded under the latest line, then the thread is seen', async () => {
    const d = doors();
    const msg = thread('team:t-1');
    await writeDeckVerdict({ item: msg, verdict: 'reply', text: '  Go ahead  ' }, d);
    expect(d.sendTeamReply).toHaveBeenCalledWith('t-1', 'Go ahead', 'm-2');
    expect(d.sendPersonaReply).not.toHaveBeenCalled();
    expect(d.decide).toHaveBeenCalledWith({ item: msg, verdict: 'accept' });
    expect(d.order).toEqual(['team', 'decide:accept']);
  });

  it('a persona reply goes to the persona channel', async () => {
    const d = doors();
    await writeDeckVerdict({ item: thread('persona:p-7'), verdict: 'reply', text: 'Thanks' }, d);
    expect(d.sendPersonaReply).toHaveBeenCalledWith('p-7', 'Thanks');
    expect(d.order).toEqual(['persona', 'decide:accept']);
  });

  it('a failed send never marks the thread seen', async () => {
    const d = doors();
    d.sendTeamReply = vi.fn(() => Promise.reject(new Error('offline')));
    await rejectionOf(writeDeckVerdict({ item: thread('team:t-1'), verdict: 'reply', text: 'Hi' }, d));
    expect(d.decide).not.toHaveBeenCalled();
  });

  it('a channel that cannot take a reply here refuses instead of writing', async () => {
    const d = doors();
    const err = await rejectionOf(writeDeckVerdict({ item: thread('team:t-1', false), verdict: 'reply', text: 'Hi' }, d));
    expect(err).toBeInstanceOf(ReplyRouteError);
    expect(d.decide).not.toHaveBeenCalled();
  });

  it('done is accept, with its branch; skip writes nothing', async () => {
    const d = doors();
    const report = item({ id: 'report:r-1', kind: 'report' });
    await writeDeckVerdict({ item: report, verdict: 'done', branchId: 'chat' }, d);
    expect(d.decide).toHaveBeenCalledWith(expect.objectContaining({ item: report, verdict: 'accept', branchId: 'chat' }));
    await writeDeckVerdict({ item: report, verdict: 'skip' }, d);
    expect(d.decide).toHaveBeenCalledTimes(1);
  });

  it('question answers and a reject reason pass through', async () => {
    const d = doors();
    const q = item({ id: 'question:s-1', kind: 'question' });
    await writeDeckVerdict({ item: q, verdict: 'accept', answers: { a: '1' } }, d);
    expect(d.decide).toHaveBeenCalledWith(expect.objectContaining({ verdict: 'accept', answers: { a: '1' } }));
    await writeDeckVerdict({ item: q, verdict: 'reject', reason: 'out of scope' }, d);
    expect(d.decide).toHaveBeenLastCalledWith(expect.objectContaining({ verdict: 'reject', reason: 'out of scope' }));
  });
});
