import { describe, expect, it } from 'vitest';
import type { HealingTimelineEvent } from '@/lib/bindings/HealingTimelineEvent';
import { canResolve, chainMark, groupChains, issueRowStates, issueState, ISSUE_GLYPH } from '../issueModel';
import { quantumFor } from '../quantum';

const base = { is_circuit_breaker: false, status: 'open', auto_fixed: false, severity: 'medium' };

describe('issueState', () => {
  it('ranks the breaker over every other state', () => {
    expect(issueState({ ...base, is_circuit_breaker: true, status: 'auto_fix_pending' })).toBe('breaker');
  });
  it('reads a pending auto-fix as a live retry that cannot be resolved by hand', () => {
    const s = issueState({ ...base, status: 'auto_fix_pending' });
    expect(s).toBe('retrying');
    expect(ISSUE_GLYPH[s].glyph).toBe('live');
    expect(issueRowStates(s, false)).toEqual(['live']);
    expect(canResolve(s)).toBe(false);
  });
  it('separates auto-fixed from manually resolved, both muted', () => {
    expect(issueState({ ...base, status: 'resolved', auto_fixed: true })).toBe('fixed');
    expect(issueState({ ...base, status: 'resolved' })).toBe('resolved');
    expect(issueRowStates('fixed', true)).toEqual(['selected', 'muted']);
  });
  it('falls back to medium for an unknown severity', () => {
    expect(issueState({ ...base, severity: 'weird' })).toBe('medium');
    expect(canResolve('medium')).toBe(true);
  });
});

function ev(id: string, chainId: string, eventType: string, minute: number, status: string | null = null): HealingTimelineEvent {
  return {
    id, chainId, eventType, timestamp: `2026-09-22T10:${String(minute).padStart(2, '0')}:00Z`, title: id, description: id,
    severity: null, category: null, status, executionId: null, issueId: null, knowledgeId: null,
    autoFixed: false, isCircuitBreaker: false, retryCount: null, suggestedFix: null,
  };
}

describe('groupChains', () => {
  it('orders steps within a chain, newest trigger first, knowledge apart', () => {
    const { chains, knowledge } = groupChains([
      ev('a-out', 'a', 'outcome', 5, 'resolved'), ev('a-trig', 'a', 'trigger', 1), ev('a-retry', 'a', 'retry', 3),
      ev('b-trig', 'b', 'trigger', 9), ev('b-retry', 'b', 'retry', 10, 'running'), ev('k', 'k', 'knowledge', 2),
    ]);
    expect(chains.map((c) => c.chainId)).toEqual(['b', 'a']);
    expect(chains[1]!.events.map((e) => e.id)).toEqual(['a-trig', 'a-retry', 'a-out']);
    expect(knowledge.map((e) => e.id)).toEqual(['k']);
    expect(chainMark(chains[0]!)).toEqual({ tone: 'primary', glyph: 'live' });
    expect(chainMark(chains[1]!)).toEqual({ tone: 'success', glyph: 'solid' });
  });
});

describe('quantumFor', () => {
  it('picks the smallest 1-2-5 step that keeps the strip countable', () => {
    expect(quantumFor(44.5, 60, 0.1)).toBe(1);
    expect(quantumFor(1624, 60)).toBe(50);
    expect(quantumFor(6, 60)).toBe(1);
    expect(quantumFor(0, 60)).toBe(1);
  });
});
