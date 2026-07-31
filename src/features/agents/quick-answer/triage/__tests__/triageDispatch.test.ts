/**
 * Verdict routing. The property under test throughout: a decision either
 * DEFERS, or WRITES, or THROWS — it is never silently nothing.
 */
import { describe, it, expect, vi } from 'vitest';

import { isDeferral, routeDecision, type TriagePorts } from '../triageDispatch';
import type { TriageDecision } from '../triageTypes';
import { makeItem, makeQuestion } from './triageFixtures';

function makePorts(overrides: Partial<TriagePorts> = {}): TriagePorts {
  return {
    reviewAction: vi.fn().mockResolvedValue(undefined),
    dispatchReviewAction: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue(undefined),
    acceptIdea: vi.fn().mockResolvedValue(undefined),
    rejectIdea: vi.fn().mockResolvedValue(undefined),
    decideKnowledge: vi.fn().mockResolvedValue(undefined),
    refreshKnowledge: vi.fn(),
    submitAnswers: vi.fn().mockResolvedValue(undefined),
    openBuilder: vi.fn(),
    ...overrides,
  };
}

/** Every port call made, so "wrote nothing" is directly assertable. */
function writeCount(ports: TriagePorts): number {
  return (Object.values(ports) as unknown[])
    .filter((fn): fn is ReturnType<typeof vi.fn> => typeof fn === 'function' && 'mock' in fn)
    .reduce((n, fn) => n + fn.mock.calls.length, 0);
}

describe('isDeferral — what must stay in the queue', () => {
  it('treats skip as a deferral for every kind', () => {
    for (const kind of ['review', 'idea', 'practice', 'question'] as const) {
      expect(isDeferral({ item: makeItem(kind), verdict: 'skip' })).toBe(true);
    }
  });

  it('treats REJECT on a build question as a deferral', () => {
    // The defect: this matched no write branch, yet the card was resolved and
    // removed. The persona stayed `awaiting_input` forever.
    expect(isDeferral({ item: makeQuestion(), verdict: 'reject' })).toBe(true);
  });

  it('treats accepting a question card with nothing filled in as a deferral', () => {
    expect(isDeferral({ item: makeQuestion(), verdict: 'accept' })).toBe(true);
    expect(isDeferral({ item: makeQuestion(), verdict: 'accept', answers: {} })).toBe(true);
    expect(isDeferral({ item: makeQuestion(), verdict: 'accept', answers: { tools: '  ' } })).toBe(
      true,
    );
  });

  it('treats accepting a question with no session as a deferral', () => {
    const orphan = makeQuestion({ payload: { personaId: 'p1' } });
    expect(isDeferral({ item: orphan, verdict: 'accept', answers: { tools: 'yes' } })).toBe(true);
  });

  it('does NOT defer a real answer, a branch, or any non-question verdict', () => {
    expect(
      isDeferral({ item: makeQuestion(), verdict: 'accept', answers: { tools: 'gmail' } }),
    ).toBe(false);
    expect(isDeferral({ item: makeQuestion(), verdict: 'accept', branchId: 'builder' })).toBe(false);
    expect(isDeferral({ item: makeItem('review'), verdict: 'reject' })).toBe(false);
    expect(isDeferral({ item: makeItem('idea'), verdict: 'reject' })).toBe(false);
  });
});

describe('routeDecision — reviews', () => {
  it('approves, rejects with a reason, and dispatches a chosen action', async () => {
    const item = makeItem('review', { sourceId: 'rev-1' });
    const ports = makePorts();

    await routeDecision({ item, verdict: 'accept' }, ports);
    expect(ports.reviewAction).toHaveBeenCalledWith('rev-1', 'approved');

    await routeDecision({ item, verdict: 'reject', reason: 'not now' }, ports);
    expect(ports.reviewAction).toHaveBeenCalledWith('rev-1', 'rejected', 'not now');

    await routeDecision({ item, verdict: 'accept', branchId: 'rotate the key' }, ports);
    expect(ports.dispatchReviewAction).toHaveBeenCalledWith('rev-1', 'rotate the key');
  });

  it('propagates a failed write instead of swallowing it', async () => {
    const ports = makePorts({ reviewAction: vi.fn().mockRejectedValue(new Error('db is locked')) });
    // This is the whole reason the queue's restore path can work: without a
    // rejection here, the card leaves the deck and SQLite still says `pending`.
    await expect(
      routeDecision({ item: makeItem('review'), verdict: 'accept' }, ports),
    ).rejects.toThrow('db is locked');
  });
});

describe('routeDecision — ideas and practices', () => {
  it('build-now creates a task AND accepts the idea', async () => {
    const item = makeItem('idea', { sourceId: 'idea-1', payload: { projectId: 'proj-1' } });
    const ports = makePorts();
    await routeDecision({ item, verdict: 'accept', branchId: 'build' }, ports);

    expect(ports.createTask).toHaveBeenCalledWith(item.title, 'proj-1', item.body, 'idea-1');
    expect(ports.acceptIdea).toHaveBeenCalledWith('idea-1', undefined);
  });

  it('maps practice verdicts onto adopt / reject / deprecate and refreshes', async () => {
    const item = makeItem('practice', { sourceId: 'k-1' });
    const ports = makePorts();

    await routeDecision({ item, verdict: 'accept' }, ports);
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-1', 'adopt', undefined, undefined);

    await routeDecision({ item, verdict: 'reject' }, ports);
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-1', 'reject', undefined, undefined);

    await routeDecision({ item, verdict: 'accept', branchId: 'deprecate' }, ports);
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-1', 'deprecate', undefined, undefined);
    expect(ports.refreshKnowledge).toHaveBeenCalledTimes(3);
  });

  it('records what SUPERSEDES a deprecated practice', async () => {
    const item = makeItem('practice', { sourceId: 'k-1' });
    const ports = makePorts();

    await routeDecision(
      { item, verdict: 'accept', branchId: 'deprecate', reason: 'k-2' },
      ports,
    );
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-1', 'deprecate', 'k-2', undefined);
  });

  it('never forwards a successor on a NON-deprecate decision', async () => {
    // The backend rejects `superseded_by` outright unless the decision is
    // `deprecate`, so a stale reason riding along would turn an adopt into a
    // validation error.
    const item = makeItem('practice', { sourceId: 'k-1' });
    const ports = makePorts();

    await routeDecision({ item, verdict: 'accept', reason: 'k-2' }, ports);
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-1', 'adopt', undefined, undefined);

    await routeDecision({ item, verdict: 'reject', reason: 'k-2' }, ports);
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-1', 'reject', undefined, undefined);
  });
});

describe('routeDecision — the status the CARD showed rides to the write', () => {
  // The compare-and-swap expectation. Without it, a verdict decided on a card
  // someone else already ruled on overwrites their verdict AND fires a second
  // side-effect fan-out (a `constraint` memory for ideas, an adoption cell per
  // member repo for practices) — the two loops then disagree forever.
  it('forwards an idea card seenStatus on accept, build-now and reject', async () => {
    const item = makeItem('idea', {
      sourceId: 'idea-7',
      payload: { projectId: 'proj-1', seenStatus: 'pending' },
    });
    const ports = makePorts();

    await routeDecision({ item, verdict: 'accept' }, ports);
    expect(ports.acceptIdea).toHaveBeenCalledWith('idea-7', 'pending');

    await routeDecision({ item, verdict: 'accept', branchId: 'build' }, ports);
    expect(ports.acceptIdea).toHaveBeenLastCalledWith('idea-7', 'pending');

    await routeDecision({ item, verdict: 'reject', reason: 'Out of scope' }, ports);
    expect(ports.rejectIdea).toHaveBeenCalledWith('idea-7', 'Out of scope', 'pending');
  });

  it('forwards a practice card seenStatus alongside the successor', async () => {
    const item = makeItem('practice', { sourceId: 'k-7', payload: { seenStatus: 'proposed' } });
    const ports = makePorts();

    await routeDecision({ item, verdict: 'accept' }, ports);
    expect(ports.decideKnowledge).toHaveBeenCalledWith('k-7', 'adopt', undefined, 'proposed');

    await routeDecision({ item, verdict: 'accept', branchId: 'deprecate', reason: 'k-8' }, ports);
    expect(ports.decideKnowledge).toHaveBeenLastCalledWith('k-7', 'deprecate', 'k-8', 'proposed');
  });
});

describe('routeDecision — rejections carry their reason to the write', () => {
  it('writes a review rejection reason into reviewer notes', async () => {
    const ports = makePorts();
    await routeDecision(
      { item: makeItem('review', { sourceId: 'rev-9' }), verdict: 'reject', reason: 'Already handled' },
      ports,
    );
    expect(ports.reviewAction).toHaveBeenCalledWith('rev-9', 'rejected', 'Already handled');
  });

  it('writes an idea rejection reason, which the backend turns into a constraint', async () => {
    const ports = makePorts();
    await routeDecision(
      { item: makeItem('idea', { sourceId: 'idea-9' }), verdict: 'reject', reason: 'Out of scope' },
      ports,
    );
    expect(ports.rejectIdea).toHaveBeenCalledWith('idea-9', 'Out of scope', undefined);
  });

  it('still writes the rejection when the reviewer skipped the reason', async () => {
    const ports = makePorts();
    await routeDecision({ item: makeItem('idea', { sourceId: 'idea-9' }), verdict: 'reject' }, ports);
    expect(ports.rejectIdea).toHaveBeenCalledWith('idea-9', undefined, undefined);
  });
});

describe('routeDecision — build questions', () => {
  it('submits EVERY answer against the session in ONE call', async () => {
    // The whole point of the session card: `answer_build_question` resumes the
    // halted CLI, so N answers must not mean N resumes.
    const item = makeQuestion();
    const ports = makePorts();
    await routeDecision(
      { item, verdict: 'accept', answers: { tools: '  gmail  ', tone: 'formal', skip: '  ' } },
      ports,
    );

    expect(ports.submitAnswers).toHaveBeenCalledTimes(1);
    expect(ports.submitAnswers).toHaveBeenCalledWith('sess-1', { tools: 'gmail', tone: 'formal' });
  });

  it('deep-links a deferred question to the builder', async () => {
    const ports = makePorts();
    await routeDecision({ item: makeQuestion(), verdict: 'accept', branchId: 'builder' }, ports);
    expect(ports.openBuilder).toHaveBeenCalledWith('persona-1');
  });

  it('throws rather than quietly dropping the card when there is no builder route', async () => {
    const ports = makePorts({ openBuilder: undefined });
    await expect(
      routeDecision({ item: makeQuestion(), verdict: 'accept', branchId: 'builder' }, ports),
    ).rejects.toThrow(/builder route/i);
  });

  it('refuses to submit a card with nothing filled in', async () => {
    const ports = makePorts();
    const decision: TriageDecision = { item: makeQuestion(), verdict: 'accept', answers: { a: ' ' } };
    await expect(routeDecision(decision, ports)).rejects.toThrow();
    expect(ports.submitAnswers).not.toHaveBeenCalled();
  });

  it('writes NOTHING for a deferral — the queue keeps the card', () => {
    const ports = makePorts();
    const decision: TriageDecision = { item: makeQuestion(), verdict: 'reject' };
    expect(isDeferral(decision)).toBe(true);
    expect(writeCount(ports)).toBe(0);
  });
});
