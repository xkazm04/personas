import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  makeIssueId,
  computeHealthScore,
  mapOverallStatus,
  coerceIssueText,
  parseFeasibilityToHealthResult,
  HEALTH_SCORING,
} from './useHealthCheck';
import type { DryRunIssue } from './types';
import type { Persona } from '@/lib/bindings/Persona';

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

describe('source hygiene', () => {
  it('useHealthCheck.ts carries no raw control bytes', () => {
    // A literal NUL inside the template literal made grep report the file as
    // binary (every `grep -n` over it returned zero lines) and made git render
    // it as `Bin` in every diff stat, so a change to this file had no reviewable
    // hunk. Escapes carry the same value; raw control bytes carry none of that.
    // vitest's import.meta.url is not a file: URL, so resolve from the repo root.
    const src = readFileSync(resolve(process.cwd(), 'src/features/agents/sub_health/useHealthCheck.ts'));
    const control = [...src].filter((b) => b < 0x09 || (b > 0x0d && b < 0x20));
    expect(control).toEqual([]);
  });
});

function issue(severity: DryRunIssue['severity'], resolved = false): DryRunIssue {
  return { id: `${severity}-${Math.random()}`, severity, description: 'x', proposal: null, resolved };
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

  it('ignores resolved issues', () => {
    const { value, grade } = computeHealthScore([issue('error', true), issue('warning', true)]);
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

describe('mapOverallStatus', () => {
  it('maps ready/pass/success wordings to ready, case-insensitively', () => {
    expect(mapOverallStatus('Ready')).toBe('ready');
    expect(mapOverallStatus('all checks PASSED')).toBe('ready');
    expect(mapOverallStatus('success')).toBe('ready');
  });

  it('maps block/fail wordings to blocked', () => {
    expect(mapOverallStatus('Blocked')).toBe('blocked');
    expect(mapOverallStatus('2 checks failing')).toBe('blocked');
  });

  it('falls back to partial for anything else', () => {
    expect(mapOverallStatus('needs attention')).toBe('partial');
    expect(mapOverallStatus('')).toBe('partial');
  });
});

describe('coerceIssueText', () => {
  it('passes through non-empty strings, trimmed', () => {
    expect(coerceIssueText('  missing credential  ')).toBe('missing credential');
  });

  it('rejects empty / whitespace-only strings', () => {
    expect(coerceIssueText('')).toBeNull();
    expect(coerceIssueText('   ')).toBeNull();
  });

  it('extracts the first non-empty description-like field from objects', () => {
    expect(coerceIssueText({ description: 'from description' })).toBe('from description');
    expect(coerceIssueText({ message: 'from message' })).toBe('from message');
    expect(coerceIssueText({ description: '', text: 'from text' })).toBe('from text');
    expect(coerceIssueText({ detail: ' from detail ' })).toBe('from detail');
  });

  it('drops null, undefined, numbers, and unrenderable objects', () => {
    expect(coerceIssueText(null)).toBeNull();
    expect(coerceIssueText(undefined)).toBeNull();
    expect(coerceIssueText(42)).toBeNull();
    expect(coerceIssueText({ foo: 'bar' })).toBeNull();
  });
});

describe('parseFeasibilityToHealthResult', () => {
  const persona = { id: 'persona-1', name: 'Test', design_context: null } as unknown as Persona;

  it('produces deterministic issue IDs and drops unrenderable entries', () => {
    const raw = {
      overall: 'partial',
      confirmed_capabilities: ['send messages'],
      issues: ['Missing credential for slack', null, '', { foo: 'bar' }] as unknown as string[],
    };
    const a = parseFeasibilityToHealthResult(raw, persona, []);
    const b = parseFeasibilityToHealthResult(raw, persona, []);
    expect(a.status).toBe('partial');
    expect(a.capabilities).toEqual(['send messages']);
    expect(a.issues).toHaveLength(1);
    expect(a.issues[0]!.id).toBe(b.issues[0]!.id);
  });

  it('suffixes duplicate (severity, description) pairs deterministically', () => {
    const raw = {
      overall: 'partial',
      confirmed_capabilities: [],
      issues: ['Missing credential for slack', 'Missing credential for slack'],
    };
    const { issues } = parseFeasibilityToHealthResult(raw, persona, []);
    expect(issues).toHaveLength(2);
    expect(issues[1]!.id).toBe(`${issues[0]!.id}_1`);
  });

  it('skips proposal generation when withProposals is false', () => {
    const raw = {
      overall: 'partial',
      confirmed_capabilities: [],
      issues: ['Missing credential for slack'],
    };
    const withOn = parseFeasibilityToHealthResult(raw, persona, [{ id: 'c1', service_type: 'slack' }]);
    const withOff = parseFeasibilityToHealthResult(raw, persona, [{ id: 'c1', service_type: 'slack' }], { withProposals: false });
    expect(withOn.issues[0]!.proposal).not.toBeNull();
    expect(withOff.issues[0]!.proposal).toBeNull();
  });

  it('tolerates a non-array issues payload', () => {
    const raw = {
      overall: 'ready',
      confirmed_capabilities: [],
      issues: 'oops' as unknown as string[],
    };
    const result = parseFeasibilityToHealthResult(raw, persona, []);
    expect(result.status).toBe('ready');
    expect(result.issues).toEqual([]);
  });
});
