/** The peek's key table, and the router's one switch. */
import { describe, expect, it } from 'vitest';

import { item } from '../../__tests__/rosterFixtures';
import type { DecisionKind } from '../../model/decisionModel';
import { surfaceOf } from '../openDecision';
import { peekKeyAction } from '../peekKeys';

const review = item({ id: 'review:1', kind: 'review' });

describe('peekKeyAction', () => {
  it('walks, moves, opens and closes', () => {
    expect(peekKeyAction('ArrowDown', { armed: false, item: review })).toEqual({ type: 'move', step: 1 });
    expect(peekKeyAction('ArrowUp', { armed: false, item: review })).toEqual({ type: 'move', step: -1 });
    expect(peekKeyAction('ArrowRight', { armed: false, item: review })).toEqual({ type: 'walk', step: 1 });
    expect(peekKeyAction('k', { armed: false, item: review })).toEqual({ type: 'walk', step: -1 });
    expect(peekKeyAction('Enter', { armed: false, item: review })).toEqual({ type: 'open' });
    expect(peekKeyAction('Escape', { armed: false, item: review })).toEqual({ type: 'close' });
  });

  it('R arms, Enter rejects, Escape disarms first', () => {
    expect(peekKeyAction('r', { armed: false, item: review })).toEqual({ type: 'arm' });
    expect(peekKeyAction('Enter', { armed: true, item: review })).toEqual({ type: 'decide', verdict: 'reject' });
    expect(peekKeyAction('Escape', { armed: true, item: review })).toEqual({ type: 'disarm' });
  });

  it('never writes a one-key verdict the card would have to qualify', () => {
    const question = item({ id: 'question:1', kind: 'question' });
    const council = item({ id: 'council:1', kind: 'council' });
    expect(peekKeyAction('a', { armed: false, item: question })).toEqual({ type: 'open' });
    expect(peekKeyAction('r', { armed: false, item: question })).toEqual({ type: 'open' });
    expect(peekKeyAction('r', { armed: false, item: council })).toEqual({ type: 'open' });
    expect(peekKeyAction('a', { armed: false, item: council })).toEqual({ type: 'decide', verdict: 'accept' });
  });

  it('D is done for reports and chat only', () => {
    expect(peekKeyAction('d', { armed: false, item: item({ id: 'report:1', kind: 'report' }) }))
      .toEqual({ type: 'decide', verdict: 'accept' });
    expect(peekKeyAction('d', { armed: false, item: item({ id: 'message:1', kind: 'message' }) }))
      .toEqual({ type: 'decide', verdict: 'accept' });
    expect(peekKeyAction('d', { armed: false, item: review })).toBeNull();
  });

  it('acts on nothing when the peek has no rows', () => {
    expect(peekKeyAction('a', { armed: false, item: null })).toBeNull();
    expect(peekKeyAction('Escape', { armed: false, item: null })).toEqual({ type: 'close' });
  });
});

describe('surfaceOf', () => {
  it('routes every kind to its existing surface', () => {
    const table: Record<DecisionKind, ReturnType<typeof surfaceOf>> = {
      review: 'focus', question: 'focus', policy: 'focus', evolution: 'focus', goal: 'focus', approval: 'focus',
      idea: 'backlog', incident: 'incident', report: 'report', council: 'council', message: 'thread',
    };
    for (const [kind, surface] of Object.entries(table)) {
      expect(surfaceOf(kind as DecisionKind)).toBe(surface);
    }
  });
});
