import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TriagePorts } from '@/features/agents/quick-answer/triage/triageDispatch';
import { isDecisionConflict } from '@/lib/decisions/rowWrites';

import {
  isRosterDeferral,
  leavesQueue,
  routeDecisionItem,
  type DecisionPorts,
} from '../roster/decisionDispatch';
import { item, rejectionOf } from './rosterFixtures';

function triagePorts(): TriagePorts {
  return {
    reviewAction: vi.fn().mockResolvedValue(undefined),
    dispatchReviewAction: vi.fn().mockResolvedValue(undefined),
    createTask: vi.fn().mockResolvedValue(undefined),
    acceptIdea: vi.fn().mockResolvedValue(undefined),
    rejectIdea: vi.fn().mockResolvedValue(undefined),
    submitAnswers: vi.fn().mockResolvedValue(undefined),
    applyPolicy: vi.fn().mockResolvedValue(undefined),
    declinePolicy: vi.fn().mockResolvedValue(undefined),
    decideEvolution: vi.fn().mockResolvedValue(undefined),
    refreshProposals: vi.fn(),
    acceptGoal: vi.fn().mockResolvedValue(undefined),
    rejectGoal: vi.fn().mockResolvedValue(undefined),
    reopenIdea: vi.fn().mockResolvedValue(undefined),
  };
}

let ports: DecisionPorts;
beforeEach(() => {
  ports = {
    triage: triagePorts(),
    resolveIncident: vi.fn().mockResolvedValue(undefined),
    markReportRead: vi.fn().mockResolvedValue(undefined),
    decideCouncil: vi.fn().mockResolvedValue(undefined),
    decideApproval: vi.fn().mockResolvedValue(undefined),
    markThreadSeen: vi.fn().mockResolvedValue(undefined),
    openChat: vi.fn(),
  };
});

describe('routeDecisionItem — triage kinds delegate to the deck router', () => {
  it('accepts an idea through the deck port with its seen status', async () => {
    const idea = item({ id: 'idea:1', sourceId: '1', kind: 'idea', payload: { seenStatus: 'pending' } });
    await routeDecisionItem({ item: idea, verdict: 'accept' }, ports);
    expect(ports.triage.acceptIdea).toHaveBeenCalledWith('1', 'pending');
  });

  it('treats a rejected build question as the deck does: a deferral', () => {
    const q = item({ id: 'question:s', kind: 'question', payload: { sessionId: 's' } });
    expect(isRosterDeferral({ item: q, verdict: 'reject' })).toBe(true);
    expect(isRosterDeferral({ item: item({ id: 'report:r', kind: 'report' }), verdict: 'skip' })).toBe(
      true,
    );
    expect(isRosterDeferral({ item: item({ id: 'report:r', kind: 'report' }), verdict: 'accept' })).toBe(
      false,
    );
  });
});

describe('routeDecisionItem — new kinds', () => {
  it('resolves, dismisses and moves incidents', async () => {
    const inc = item({ id: 'incident:i', sourceId: 'i', kind: 'incident' });
    await routeDecisionItem({ item: inc, verdict: 'accept', reason: 'fixed' }, ports);
    expect(ports.resolveIncident).toHaveBeenLastCalledWith('i', 'resolve', 'fixed');
    await routeDecisionItem({ item: inc, verdict: 'reject' }, ports);
    expect(ports.resolveIncident).toHaveBeenLastCalledWith('i', 'dismiss', undefined);
    await routeDecisionItem({ item: inc, verdict: 'accept', branchId: 'start' }, ports);
    expect(ports.resolveIncident).toHaveBeenLastCalledWith('i', 'start');
    await expect(
      routeDecisionItem({ item: inc, verdict: 'accept', branchId: 'reopen' }, ports),
    ).rejects.toThrow();
  });

  it('keeps an acknowledged / started incident in the queue, removes a resolved one', () => {
    const inc = item({ id: 'incident:i', kind: 'incident' });
    expect(leavesQueue({ item: inc, verdict: 'accept', branchId: 'start' })).toBe(false);
    expect(leavesQueue({ item: inc, verdict: 'accept', branchId: 'acknowledge' })).toBe(false);
    expect(leavesQueue({ item: inc, verdict: 'accept' })).toBe(true);
  });

  it('marks a report read, and follows up in chat only with a route', async () => {
    const rep = item({ id: 'report:r', sourceId: 'r', kind: 'report', payload: { personaId: 'p-1' } });
    await routeDecisionItem({ item: rep, verdict: 'reject' }, ports);
    expect(ports.markReportRead).toHaveBeenCalledWith('r');
    await routeDecisionItem({ item: rep, verdict: 'accept', branchId: 'chat' }, ports);
    expect(ports.openChat).toHaveBeenCalledWith('p-1');

    const noRoute = { ...ports, openChat: undefined };
    vi.mocked(ports.markReportRead).mockClear();
    await expect(
      routeDecisionItem({ item: rep, verdict: 'accept', branchId: 'chat' }, noRoute),
    ).rejects.toThrow(/chat route/);
    // The route is checked BEFORE the write: the report was not retired.
    expect(ports.markReportRead).not.toHaveBeenCalled();
  });

  it('decides a council against the digest on screen, enforcing the reason minimum', async () => {
    const council = item({
      id: 'council:c',
      sourceId: 'c',
      kind: 'council',
      payload: { runId: 'run-2', sawDigest: 'dg', isLatest: 'true' },
    });
    await routeDecisionItem({ item: council, verdict: 'accept' }, ports);
    expect(ports.decideCouncil).toHaveBeenLastCalledWith('c', 'run-2', 'approved', 'dg');

    await expect(
      routeDecisionItem({ item: council, verdict: 'reject', reason: 'too short' }, ports),
    ).rejects.toThrow(/12/);
    await routeDecisionItem({ item: council, verdict: 'reject', reason: 'the bus loses ordering' }, ports);
    expect(ports.decideCouncil).toHaveBeenLastCalledWith(
      'c',
      'run-2',
      'rejected',
      'dg',
      'the bus loses ordering',
    );
  });

  it('refuses a council with no digest, and a superseded round as a conflict', async () => {
    const blind = item({ id: 'council:c', sourceId: 'c', kind: 'council', payload: { runId: 'run-2' } });
    await expect(routeDecisionItem({ item: blind, verdict: 'accept' }, ports)).rejects.toThrow();
    const stale = item({
      id: 'council:c',
      sourceId: 'c',
      kind: 'council',
      payload: { runId: 'run-1', sawDigest: 'dg', isLatest: 'false' },
    });
    const err = await rejectionOf(routeDecisionItem({ item: stale, verdict: 'accept' }, ports));
    expect(isDecisionConflict(err)).toBe(true);
    expect(ports.decideCouncil).not.toHaveBeenCalled();
  });

  it('decides approvals and marks chat threads seen', async () => {
    await routeDecisionItem({ item: item({ id: 'approval:a', sourceId: 'a', kind: 'approval' }), verdict: 'reject', reason: 'no' }, ports);
    expect(ports.decideApproval).toHaveBeenCalledWith('a', false, 'no');
    await routeDecisionItem(
      {
        item: item({ id: 'message:team:t', kind: 'message', payload: { channelKey: 'team:t' } }),
        verdict: 'accept',
      },
      ports,
    );
    expect(ports.markThreadSeen).toHaveBeenCalledWith('team:t');
  });
});
