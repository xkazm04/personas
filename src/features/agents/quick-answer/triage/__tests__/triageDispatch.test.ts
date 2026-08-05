/**
 * Verdict routing. The property under test throughout: a decision either
 * DEFERS, or WRITES, or THROWS — it is never silently nothing.
 */
import { describe, it, expect, vi } from 'vitest';

import {
  isDeferral,
  reversibleStatus,
  routeDecision,
  undoDecision,
  type TriagePorts,
} from '../triageDispatch';
import {
  TRIAGE_KINDS,
  type TriageDecision,
  type TriageItem,
  type TriageKind,
} from '../triageTypes';
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
    applyPolicy: vi.fn().mockResolvedValue(undefined),
    declinePolicy: vi.fn().mockResolvedValue(undefined),
    decideEvolution: vi.fn().mockResolvedValue(undefined),
    refreshProposals: vi.fn(),
    acceptGoal: vi.fn().mockResolvedValue(undefined),
    rejectGoal: vi.fn().mockResolvedValue(undefined),
    reopenIdea: vi.fn().mockResolvedValue(undefined),
    reopenPractice: vi.fn().mockResolvedValue(undefined),
    openBuilder: vi.fn(),
    openGoalBoard: vi.fn(),
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
    // Derived from `TRIAGE_KINDS`, so a sixth queue cannot be added without
    // this property being asserted about it.
    for (const kind of TRIAGE_KINDS) {
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

/**
 * A genuinely DECIDABLE decision for a kind — one `isDeferral` will not send
 * back to the queue.
 *
 * `question` is the only kind that needs more than a bare item: a session card
 * is a deferral unless it has both a session and something filled in, so it gets
 * both. Every other kind is decidable as it stands.
 */
function decidable(kind: TriageKind): { item: TriageItem; answers?: Record<string, string> } {
  if (kind === 'question') return { item: makeQuestion(), answers: { tools: 'gmail' } };
  return { item: makeItem(kind) };
}

describe('routeDecision — no kind may fall through the switch', () => {
  it('WRITES or THROWS for every kind in TRIAGE_KINDS, never resolves having done nothing', async () => {
    // `routeDecision` returns Promise<void> and its `switch (item.kind)` has no
    // `default`, so widening `TriageKind` produces NO compile error — a new kind
    // falls straight through and returns, and the queue reads that silence as a
    // successful write and drops the card. This file's header records being
    // bitten by exactly that twice, on paths that DID exist.
    //
    // Derived from `TRIAGE_KINDS`, so a seventh kind is covered the moment it is
    // added rather than when someone remembers to extend a list here.
    const decided = new Map<TriageKind, number>();

    for (const kind of TRIAGE_KINDS) {
      for (const verdict of ['accept', 'reject'] as const) {
        const { item, answers } = decidable(kind);
        const decision: TriageDecision = { item, verdict, answers };
        // Deferrals are excluded exactly as `routeDecision`'s own contract
        // excludes them — a bare reject on a question is "not me, not now", not
        // a write that went missing.
        if (isDeferral(decision)) continue;

        const ports = makePorts();
        let threw = false;
        try {
          await routeDecision(decision, ports);
        } catch {
          threw = true;
        }

        // Reported as an object so a failure NAMES the kind that fell through
        // instead of just saying `false !== true`.
        expect({ kind, verdict, honoured: threw || writeCount(ports) > 0 }).toEqual({
          kind,
          verdict,
          honoured: true,
        });
        decided.set(kind, (decided.get(kind) ?? 0) + 1);
      }
    }

    // Guards the guard: a kind whose every decision happened to be a deferral
    // would sail through the loop above having asserted nothing at all.
    for (const kind of TRIAGE_KINDS) {
      expect({ kind, decidable: (decided.get(kind) ?? 0) > 0 }).toEqual({ kind, decidable: true });
    }
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

describe('routeDecision — policy proposals', () => {
  const policy = () =>
    makeItem('policy', { sourceId: 'pol-1', payload: { seenStatus: 'pending', policyKind: 'routing_rule' } });

  it('applies, declines with a reason, and re-reads the ledger either way', async () => {
    const ports = makePorts();

    await routeDecision({ item: policy(), verdict: 'accept' }, ports);
    expect(ports.applyPolicy).toHaveBeenCalledWith('pol-1', 'pending');

    await routeDecision({ item: policy(), verdict: 'reject', reason: 'Quality risk' }, ports);
    expect(ports.declinePolicy).toHaveBeenCalledWith('pol-1', 'Quality risk', 'pending');

    expect(ports.refreshProposals).toHaveBeenCalledTimes(2);
  });

  it('never routes an apply through the decline door, whatever reason rides along', async () => {
    // `policy_tuning_apply` is the ONLY policy writer by contract; a decline
    // that reached it would write a rule nobody approved.
    const ports = makePorts();
    await routeDecision({ item: policy(), verdict: 'accept', reason: 'stale' }, ports);
    expect(ports.declinePolicy).not.toHaveBeenCalled();
  });

  it('propagates a failed apply instead of swallowing it', async () => {
    const ports = makePorts({ applyPolicy: vi.fn().mockRejectedValue(new Error('db is locked')) });
    await expect(routeDecision({ item: policy(), verdict: 'accept' }, ports)).rejects.toThrow(
      'db is locked',
    );
  });
});

describe('routeDecision — evolution promotions', () => {
  const promotion = () =>
    makeItem('evolution', {
      sourceId: 'prop-1',
      payload: { seenStatus: 'pending', personaId: 'p-1', baseUpdatedAt: '2026-02-01T00:00:00.000Z' },
    });

  it('approves and rejects through ONE port, carrying the note and the expectation', async () => {
    const ports = makePorts();

    await routeDecision({ item: promotion(), verdict: 'accept' }, ports);
    expect(ports.decideEvolution).toHaveBeenCalledWith('prop-1', true, undefined, 'pending');

    await routeDecision({ item: promotion(), verdict: 'reject', reason: 'Gain too small' }, ports);
    expect(ports.decideEvolution).toHaveBeenLastCalledWith(
      'prop-1',
      false,
      'Gain too small',
      'pending',
    );
    expect(ports.refreshProposals).toHaveBeenCalledTimes(2);
  });

  it('propagates the persona optimistic-lock failure rather than resolving', async () => {
    // The exact wording `engine::evolution::apply_promotion` emits when the
    // persona moved under the proposal. The queue turns this into a conflict,
    // which it can only do if the router lets it out.
    const ports = makePorts({
      decideEvolution: vi
        .fn()
        .mockRejectedValue(
          new Error(
            'Persona changed after this proposal was filed — promotion abandoned to avoid overwriting the newer state. Reject the proposal and run a fresh cycle.',
          ),
        ),
    });
    await expect(routeDecision({ item: promotion(), verdict: 'accept' }, ports)).rejects.toThrow(
      /changed after this proposal was filed/,
    );
  });
});

describe('routeDecision — goal acceptance', () => {
  const goal = () =>
    makeItem('goal', {
      sourceId: 'goal-1',
      payload: { goalId: 'goal-1', projectId: 'proj-1', kpiId: 'kpi-1' },
    });

  it('signs a goal off, and sends one back carrying the reason', async () => {
    const ports = makePorts();

    await routeDecision({ item: goal(), verdict: 'accept' }, ports);
    expect(ports.acceptGoal).toHaveBeenCalledWith('goal-1');

    // The comment becomes the goal's `goal_rejected` signal — the only thing the
    // team is ever told about why their finished work came back.
    await routeDecision({ item: goal(), verdict: 'reject', reason: 'Needs rework' }, ports);
    expect(ports.rejectGoal).toHaveBeenCalledWith('goal-1', 'Needs rework');
  });

  it('still sends back when the reviewer skipped the reason', async () => {
    const ports = makePorts();
    await routeDecision({ item: goal(), verdict: 'reject' }, ports);
    // `resolveGoalAcceptance` types the comment as required, so the empty case is
    // an empty string rather than a dropped argument.
    expect(ports.rejectGoal).toHaveBeenCalledWith('goal-1', '');
  });

  it('accepts every sibling on the KPI CONCURRENTLY on the batch branch', async () => {
    const item = makeItem('goal', {
      sourceId: 'goal-1',
      payload: { goalId: 'goal-1', batchGoalIds: 'goal-1,goal-2,goal-3' },
    });
    const ports = makePorts();
    await routeDecision({ item, verdict: 'accept', branchId: 'accept-kpi-batch' }, ports);

    expect(ports.acceptGoal).toHaveBeenCalledTimes(3);
    expect(ports.acceptGoal).toHaveBeenCalledWith('goal-1');
    expect(ports.acceptGoal).toHaveBeenCalledWith('goal-2');
    expect(ports.acceptGoal).toHaveBeenCalledWith('goal-3');
  });

  it('propagates a partial batch failure rather than reporting N accepts', async () => {
    const item = makeItem('goal', {
      sourceId: 'goal-1',
      payload: { batchGoalIds: 'goal-1,goal-2' },
    });
    const ports = makePorts({
      acceptGoal: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('db is locked')),
    });
    await expect(
      routeDecision({ item, verdict: 'accept', branchId: 'accept-kpi-batch' }, ports),
    ).rejects.toThrow('db is locked');
  });

  it('throws rather than resolving a card for free when the batch carries no ids', async () => {
    const ports = makePorts();
    await expect(
      routeDecision({ item: goal(), verdict: 'accept', branchId: 'accept-kpi-batch' }, ports),
    ).rejects.toThrow(/batch/i);
    expect(ports.acceptGoal).not.toHaveBeenCalled();
  });

  it('deep-links the goals board WITHOUT writing anything', async () => {
    const ports = makePorts();
    await routeDecision({ item: goal(), verdict: 'accept', branchId: 'open-board' }, ports);
    expect(ports.openGoalBoard).toHaveBeenCalledWith('proj-1');
    expect(ports.acceptGoal).not.toHaveBeenCalled();
    expect(ports.rejectGoal).not.toHaveBeenCalled();
  });

  it('throws rather than quietly dropping the card when there is no board route', async () => {
    // A deep-link that silently does nothing is a card resolved for free.
    const ports = makePorts({ openGoalBoard: undefined });
    await expect(
      routeDecision({ item: goal(), verdict: 'accept', branchId: 'open-board' }, ports),
    ).rejects.toThrow(/board route/i);
  });

  it('propagates a failed acceptance instead of swallowing it', async () => {
    const ports = makePorts({ acceptGoal: vi.fn().mockRejectedValue(new Error('db is locked')) });
    await expect(routeDecision({ item: goal(), verdict: 'accept' }, ports)).rejects.toThrow(
      'db is locked',
    );
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

describe('reversibleStatus — which verdicts may be offered back, and as what', () => {
  it('names the status an idea verdict PRODUCED, which is the undo expectation', () => {
    const item = makeItem('idea');
    expect(reversibleStatus({ item, verdict: 'accept' })).toBe('accepted');
    expect(reversibleStatus({ item, verdict: 'reject' })).toBe('rejected');
    // `build` accepts and queues a task; the accept is what gets undone.
    expect(reversibleStatus({ item, verdict: 'accept', branchId: 'build' })).toBe('accepted');
  });

  it('names the status a practice verdict produced, deprecate included', () => {
    const item = makeItem('practice');
    expect(reversibleStatus({ item, verdict: 'accept' })).toBe('adopted');
    expect(reversibleStatus({ item, verdict: 'reject' })).toBe('rejected');
    expect(reversibleStatus({ item, verdict: 'accept', branchId: 'deprecate' })).toBe('deprecated');
  });

  it('refuses the five kinds whose act is already out in the world', () => {
    // A review has no backend path from decided back to pending; a question has
    // already resumed the CLI; a policy apply is the ONLY policy writer and has
    // no un-apply; a promotion has installed a genome on a live persona; an
    // accepted goal is `done` and there is no reopen command for it.
    for (const kind of ['review', 'question', 'policy', 'evolution', 'goal'] as const) {
      expect(reversibleStatus({ item: makeItem(kind), verdict: 'accept' })).toBeNull();
      expect(reversibleStatus({ item: makeItem(kind), verdict: 'reject' })).toBeNull();
    }
  });
});

describe('undoDecision — the reverse is a write against an expectation', () => {
  it('reopens an idea against the status its own verdict produced', async () => {
    const item = makeItem('idea', { sourceId: 'idea-3' });
    const ports = makePorts();
    await undoDecision(
      { decision: { item, verdict: 'accept' }, producedStatus: 'accepted', at: Date.now() },
      ports,
    );
    expect(ports.reopenIdea).toHaveBeenCalledWith('idea-3', 'accepted');
  });

  it('reopens a practice and re-reads the workspace centre', async () => {
    const item = makeItem('practice', { sourceId: 'k-3' });
    const ports = makePorts();
    await undoDecision(
      { decision: { item, verdict: 'accept' }, producedStatus: 'adopted', at: Date.now() },
      ports,
    );
    expect(ports.reopenPractice).toHaveBeenCalledWith('k-3', 'adopted');
    expect(ports.refreshKnowledge).toHaveBeenCalledTimes(1);
  });

  it('THROWS rather than silently doing nothing for a kind with no reverse door', async () => {
    // A quiet no-op would tell a reviewer their approve was taken back while
    // the row is still approved — the exact class of lie `routeDecision` exists
    // to make impossible.
    const ports = makePorts();
    await expect(
      undoDecision(
        { decision: { item: makeItem('review'), verdict: 'accept' }, producedStatus: 'approved', at: 0 },
        ports,
      ),
    ).rejects.toThrow(/cannot be undone/);
    expect(writeCount(ports)).toBe(0);
  });

  it('propagates a lost swap so the queue can surface it as a conflict', async () => {
    const ports = makePorts({
      reopenIdea: vi
        .fn()
        .mockRejectedValue(
          new Error("Backlog idea idea-3 was already decided as 'rejected' by a concurrent action"),
        ),
    });
    await expect(
      undoDecision(
        { decision: { item: makeItem('idea', { sourceId: 'idea-3' }), verdict: 'accept' }, producedStatus: 'accepted', at: 0 },
        ports,
      ),
    ).rejects.toThrow(/by a concurrent action/);
  });
});
