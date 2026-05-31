import { describe, it, expect } from 'vitest';
import { resilienceFacts } from '../../scripts/test/lib/eval/resilience.mjs';

// Mirrors tests/cli/verdict.test.mjs / grounding.test.mjs (the vitest idiom that
// `npm run test:cli` actually runs via vitest.cli.config.ts). Unit-tests the pure
// §6 scorer against synthetic incident/execution/event fixtures.

// --- fixture builders ---
const blocker = (over = {}) => ({
  id: 'INC',
  source_table: 'persona_blocker',
  source_id: 'EXEC_BLOCKED',
  status: 'resolved',
  continued_at: '2026-05-30T00:00:00Z',
  ...over,
});
const exec = (over = {}) => ({ id: 'EXEC', status: 'completed', retry_of_execution_id: null, ...over });
const ev = (over = {}) => ({ id: 'EV', event_type: 'incident_resolved', status: 'delivered', ...over });

describe('resilienceFacts — happy path (escalation closed)', () => {
  it('blocker resolved+continued, retry exec completed, incident_resolved delivered → closed, recovery 100', () => {
    const incidents = [blocker()];
    const executions = [
      exec({ id: 'EXEC_BLOCKED' }),
      exec({ id: 'EXEC_RETRY', retry_of_execution_id: 'EXEC_BLOCKED', status: 'completed' }),
    ];
    const events = [ev()];
    const f = resilienceFacts(incidents, executions, events);
    expect(f.raised).toBe(1);
    expect(f.resolved).toBe(1);
    expect(f.continued).toBe(1);
    expect(f.continuationExecsCompleted).toBe(1);
    expect(f.incidentResolvedEvents).toBe(1);
    expect(f.escalationClosed).toBe(true);
    expect(f.recoveryScore).toBe(100);
  });
});

describe('resilienceFacts — failure modes (escalation NOT closed)', () => {
  it('raised but not resolved → escalationClosed false', () => {
    const f = resilienceFacts([blocker({ status: 'open', continued_at: null })], [], []);
    expect(f.raised).toBe(1);
    expect(f.resolved).toBe(0);
    expect(f.escalationClosed).toBe(false);
  });

  it('resolved but continued_at null (auto-continuation did not fire) → escalationClosed false', () => {
    const incidents = [blocker({ continued_at: null })];
    const executions = [exec({ id: 'EXEC_RETRY', retry_of_execution_id: 'EXEC_BLOCKED', status: 'completed' })];
    const f = resilienceFacts(incidents, executions, []);
    expect(f.resolved).toBe(1);
    expect(f.continued).toBe(0);
    expect(f.escalationClosed).toBe(false);
  });

  it('continued but the retry exec failed → escalationClosed false', () => {
    const incidents = [blocker()];
    const executions = [exec({ id: 'EXEC_RETRY', retry_of_execution_id: 'EXEC_BLOCKED', status: 'failed' })];
    const f = resilienceFacts(incidents, executions, []);
    expect(f.continued).toBe(1);
    expect(f.continuationExecsCompleted).toBe(0);
    expect(f.escalationClosed).toBe(false);
  });
});

describe('resilienceFacts — no incident raised', () => {
  it('raised===0 → recoveryScore null, escalationClosed false', () => {
    const f = resilienceFacts([], [exec()], [ev()]);
    expect(f.raised).toBe(0);
    expect(f.recoveryScore).toBeNull();
    expect(f.escalationClosed).toBe(false);
  });

  it('ignores non-persona_blocker incidents (only counts raise_incident blockers)', () => {
    const f = resilienceFacts([blocker({ source_table: 'audit_stream' })], [], []);
    expect(f.raised).toBe(0);
    expect(f.escalationClosed).toBe(false);
  });
});

describe('resilienceFacts — event counting (§6.4)', () => {
  it('counts review_decision.* delivered events; ignores non-delivered', () => {
    const events = [
      ev({ event_type: 'review_decision.approved', status: 'delivered' }),
      ev({ event_type: 'review_decision.rejected', status: 'delivered' }),
      ev({ event_type: 'review_decision.resolved', status: 'pending' }), // not delivered
      ev({ event_type: 'incident_resolved', status: 'pending' }), // not delivered
    ];
    const f = resilienceFacts([], [], events);
    expect(f.reviewDecisionEvents).toBe(2);
    expect(f.incidentResolvedEvents).toBe(0);
  });
});

describe('resilienceFacts — invariant / purity guards', () => {
  it('default args: empty inputs → all-zero/null facts, escalationClosed false', () => {
    const f = resilienceFacts();
    expect(f).toEqual({
      raised: 0,
      resolved: 0,
      continued: 0,
      continuationExecsCompleted: 0,
      incidentResolvedEvents: 0,
      reviewDecisionEvents: 0,
      escalationClosed: false,
      recoveryScore: null,
    });
  });

  it('is pure / side-effect-free: does not mutate its inputs and is deterministic', () => {
    const incidents = [blocker()];
    const executions = [exec({ id: 'EXEC_RETRY', retry_of_execution_id: 'EXEC_BLOCKED', status: 'completed' })];
    const events = [ev()];
    const incSnap = JSON.stringify(incidents);
    const exSnap = JSON.stringify(executions);
    const evSnap = JSON.stringify(events);
    const a = resilienceFacts(incidents, executions, events);
    const b = resilienceFacts(incidents, executions, events);
    expect(a).toEqual(b);
    expect(JSON.stringify(incidents)).toBe(incSnap);
    expect(JSON.stringify(executions)).toBe(exSnap);
    expect(JSON.stringify(events)).toBe(evSnap);
  });

  it('two blockers, one not continued → escalationClosed false (all-or-nothing)', () => {
    const incidents = [
      blocker({ id: 'INC1', source_id: 'E1' }),
      blocker({ id: 'INC2', source_id: 'E2', continued_at: null }),
    ];
    const executions = [
      exec({ id: 'R1', retry_of_execution_id: 'E1', status: 'completed' }),
      exec({ id: 'R2', retry_of_execution_id: 'E2', status: 'completed' }),
    ];
    const f = resilienceFacts(incidents, executions, []);
    expect(f.raised).toBe(2);
    expect(f.resolved).toBe(2);
    expect(f.continued).toBe(1);
    expect(f.escalationClosed).toBe(false);
  });
});
