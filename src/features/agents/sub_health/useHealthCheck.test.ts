import { describe, it, expect } from 'vitest';
import {
  makeIssueId,
  computeHealthScore,
  computeAggregateHealthScore,
  HEALTH_SCORING,
} from './useHealthCheck';
import type { DryRunIssue } from './types';

describe('makeIssueId', () => {
  it('is deterministic for identical inputs', () => {
    const a = makeIssueId('persona-1', 'error', 'Missing credential for slack');
    const b = makeIssueId('persona-1', 'error', 'Missing credential for slack');
    expect(a).toBe(b);
  });

  it('produces a stable hex prefix shape', () => {
    const id = makeIssueId('persona-1', 'warning', 'Cron schedule is undefined');
    expect(id).toMatch(/^hc_[0-9a-f]{16}$/);
  });

  it('isolates IDs across personas with the same issue text', () => {
    const a = makeIssueId('persona-A', 'error', 'auth failed');
    const b = makeIssueId('persona-B', 'error', 'auth failed');
    expect(a).not.toBe(b);
  });

  it('treats severity changes as a new identity', () => {
    const a = makeIssueId('persona-1', 'warning', 'Cron schedule is undefined');
    const b = makeIssueId('persona-1', 'error', 'Cron schedule is undefined');
    expect(a).not.toBe(b);
  });

  it('treats description changes as a new identity', () => {
    const a = makeIssueId('persona-1', 'info', 'Could not fetch config warnings');
    const b = makeIssueId('persona-1', 'info', 'Could not fetch config warning');
    expect(a).not.toBe(b);
  });

  it('survives unicode in the description without throwing', () => {
    const a = makeIssueId('persona-1', 'info', 'スケジュール未定義 ⏰');
    const b = makeIssueId('persona-1', 'info', 'スケジュール未定義 ⏰');
    expect(a).toBe(b);
    expect(a).toMatch(/^hc_[0-9a-f]{16}$/);
  });

  it('keeps the exact hash the NUL-separated input has always produced', () => {
    // Pinned from the tree BEFORE the raw NUL bytes in the template literal were
    // rewritten as `unicode` escapes: the separator's VALUE is part of every id.
    expect(makeIssueId('persona-1', 'error', 'Missing credential for slack')).toBe('hc_8314f1b023d77a13');
  });

  it('separates fields so a space in one field cannot alias a split in another', () => {
    expect(makeIssueId('p', 'a b', 'c')).toBe('hc_fe57c4bbfad02177');
    expect(makeIssueId('p', 'a', 'b c')).toBe('hc_2878c5c7fbe3c377');
  });
});

function issue(severity: DryRunIssue['severity']): DryRunIssue {
  return { id: `${severity}-${Math.random()}`, severity, description: 'x' };
}

describe('computeHealthScore', () => {
  it('scores a clean slate at max with the healthy grade', () => {
    expect(computeHealthScore([])).toEqual({ value: HEALTH_SCORING.maxScore, grade: 'healthy' });
  });

  it('applies per-severity penalties', () => {
    const { value } = computeHealthScore([issue('error'), issue('warning'), issue('info')]);
    expect(value).toBe(
      HEALTH_SCORING.maxScore -
        HEALTH_SCORING.errorPenalty -
        HEALTH_SCORING.warningPenalty -
        HEALTH_SCORING.infoPenalty,
    );
  });

  it('does not score an undetermined sub-check against the persona', () => {
    // `undetermined` means the check could not run. Charging the persona for
    // the prober's own outage is the collapse this verdict exists to prevent,
    // and the type system cannot catch it: nothing switches exhaustively on
    // severity, so this assertion is the only guard.
    const { value, grade } = computeHealthScore([issue('undetermined'), issue('undetermined')]);
    expect(value).toBe(HEALTH_SCORING.maxScore);
    expect(grade).toBe('healthy');
  });

  it('clamps at the minimum score instead of going negative', () => {
    const many = Array.from({ length: 10 }, () => issue('error'));
    const { value, grade } = computeHealthScore(many);
    expect(value).toBe(HEALTH_SCORING.minScore);
    expect(grade).toBe('unhealthy');
  });

  it('grades by the shared cutoffs', () => {
    expect(computeHealthScore([issue('info')]).grade).toBe('healthy');
    const oneError = computeHealthScore([issue('error')]);
    const expectedGrade =
      oneError.value < HEALTH_SCORING.unhealthyCutoff ? 'unhealthy' :
      oneError.value < HEALTH_SCORING.degradedCutoff ? 'degraded' : 'healthy';
    expect(oneError.grade).toBe(expectedGrade);
  });
});

describe('computeAggregateHealthScore', () => {
  function check(...severities: DryRunIssue['severity'][]) {
    return { result: { issues: severities.map((s) => issue(s)) } };
  }

  it('does not let fleet size alone drive the score to zero', () => {
    // 25 agents, each carrying a single info-level note ("no telemetry yet").
    // Flattening every issue into one 100-point budget charged 25 x 2 = 50,
    // so a fleet with nothing wrong graded "unhealthy". The aggregate is a
    // mean of per-agent scores: each agent is at 98, so the fleet is at 98.
    const fleet = Array.from({ length: 25 }, () => check('info'));
    const { value, grade } = computeAggregateHealthScore(fleet);
    expect(value).toBe(HEALTH_SCORING.maxScore - HEALTH_SCORING.infoPenalty);
    expect(grade).toBe('healthy');
  });

  it('is independent of fleet size for an identically-healthy fleet', () => {
    const small = computeAggregateHealthScore(Array.from({ length: 3 }, () => check('warning')));
    const large = computeAggregateHealthScore(Array.from({ length: 60 }, () => check('warning')));
    expect(large).toEqual(small);
  });

  it('still reaches the floor when every agent is broken', () => {
    const fleet = Array.from({ length: 4 }, () => check('error', 'error', 'error', 'error'));
    const { value, grade } = computeAggregateHealthScore(fleet);
    expect(value).toBe(HEALTH_SCORING.minScore);
    expect(grade).toBe('unhealthy');
  });

  it('averages a mixed fleet rather than summing its penalties', () => {
    // one broken agent (4 errors -> 0) and three clean ones (100) -> 75.
    const fleet = [check('error', 'error', 'error', 'error'), check(), check(), check()];
    expect(computeAggregateHealthScore(fleet).value).toBe(75);
  });

  it('grades an empty fleet as healthy at max', () => {
    expect(computeAggregateHealthScore([])).toEqual({ value: HEALTH_SCORING.maxScore, grade: 'healthy' });
  });
});
