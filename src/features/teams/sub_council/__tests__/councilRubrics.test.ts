import { describe, expect, it } from 'vitest';

import type { CouncilVerdict } from '@/lib/bindings/CouncilVerdict';

import { ARCHITECTURE_V1, FEATURE_V1, RUBRICS, resolveRubric } from '../table/rubrics';
import { parsePayload, seatsOf, weakestFinding } from '../table/runModel';

function verdict(over: Partial<CouncilVerdict>): CouncilVerdict {
  return {
    id: 'v1',
    runId: 'r1',
    dimension: 'value',
    kind: 'judged',
    state: 'measured',
    score: 0.8,
    confidence: 'med',
    floor: 0.4,
    floorHit: false,
    advisory: true,
    payloadJson: '{}',
    ...over,
  };
}

describe('the rubrics the rose is drawn from', () => {
  // The rose's wedges close the circle only if the weights sum to exactly 1.
  // A drifted mirror of the skill's rubric JSON fails HERE, where it is one
  // line to fix, rather than as a rose with a gap nobody reads as a bug.
  it.each(Object.entries(RUBRICS))('%s weights sum to 1.0', (_version, rubric) => {
    const sum = Object.values(rubric.dimensions).reduce((n, d) => n + d.weight, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('carries the frozen feature-v1 shape', () => {
    expect(FEATURE_V1.threshold).toBe(0.7);
    expect(FEATURE_V1.coverageFloor).toBe(0.6);
    expect(Object.keys(FEATURE_V1.dimensions)).toEqual([
      'value',
      'craft',
      'rivalry',
      'robustness',
      'economics',
    ]);
    expect(FEATURE_V1.dimensions.value.floor).toBe(0.4);
    expect(FEATURE_V1.dimensions.robustness.floor).toBe(0.5);
  });

  it('carries the frozen architecture-v1 shape: no value, no rivalry', () => {
    expect(Object.keys(ARCHITECTURE_V1.dimensions)).toEqual([
      'craft',
      'robustness',
      'reversibility',
      'economics',
    ]);
    expect(ARCHITECTURE_V1.dimensions.reversibility.floor).toBe(0.5);
  });

  it('falls back by subject kind and SAYS it did not match', () => {
    expect(resolveRubric('feature-v1', 'use_case')).toEqual({ rubric: FEATURE_V1, matched: true });
    expect(resolveRubric('feature-v9', 'architecture')).toEqual({
      rubric: ARCHITECTURE_V1,
      matched: false,
    });
    expect(resolveRubric(null, null).matched).toBe(false);
  });
});

describe('seats', () => {
  it('seats every member the rubric names, even one the run never reached', () => {
    const seats = seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', [verdict({})]);
    expect(seats.map((s) => s.name)).toEqual([
      'value',
      'craft',
      'rivalry',
      'robustness',
      'economics',
    ]);
    // The four the run never reached are NOT MEASURED, not zero.
    expect(seats.slice(1).every((s) => s.score === null && s.state === 'not_run')).toBe(true);
  });

  it('never coerces a null score to zero', () => {
    const seats = seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', [
      verdict({ dimension: 'value', state: 'unmeasured', score: null }),
    ]);
    expect(seats[0].score).toBeNull();
  });

  it('keeps a measured dimension the rubric does not name', () => {
    const seats = seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', [
      verdict({ dimension: 'reversibility', score: 0.6 }),
    ]);
    expect(seats.map((s) => s.name)).toContain('reversibility');
  });
});

describe('payloads', () => {
  it('degrades a malformed payload to an empty member rather than inventing one', () => {
    expect(parsePayload('not json')).toEqual({
      findings: [],
      evidence: [],
      techniques: [],
      delta: null,
    });
    expect(parsePayload('{"findings":"nope","evidence":[{"kind":"bogus"}]}')).toEqual({
      findings: [],
      evidence: [],
      techniques: [],
      delta: null,
    });
  });

  it('keeps the fields it recognises and defaults the ones it does not', () => {
    const p = parsePayload(
      JSON.stringify({
        findings: [{ id: 'f1', severity: 'sideways', title: 'T', detail: 'D', recurrence: 2 }],
        evidence: [{ kind: 'metric', ref: 'r', caption: 'c' }],
        techniques: [{ subject: 's', technique: 't', proof: 'guessing' }],
        delta: '+0.10 since round 1',
      }),
    );
    expect(p.findings[0].severity).toBe('low');
    expect(p.findings[0].recurrence).toBe(2);
    expect(p.evidence).toHaveLength(1);
    expect(p.techniques[0].proof).toBe('claim');
    expect(p.delta).toBe('+0.10 since round 1');
  });
});

describe('the one weakness worth reading', () => {
  it('picks the severest finding on the weakest member', () => {
    const seats = seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', [
      verdict({
        dimension: 'value',
        score: 0.9,
        payloadJson: JSON.stringify({
          findings: [{ id: 'a', severity: 'low', title: 'small', detail: '', recurrence: 0 }],
        }),
      }),
      verdict({
        dimension: 'rivalry',
        score: 0.4,
        payloadJson: JSON.stringify({
          findings: [{ id: 'b', severity: 'high', title: 'big', detail: '', recurrence: 3 }],
        }),
      }),
    ]);
    expect(weakestFinding(seats)?.finding.id).toBe('b');
  });

  it('is null when nobody found anything', () => {
    expect(weakestFinding(seatsOf({ rubricVersion: 'feature-v1' }, 'use_case', []))).toBeNull();
  });
});
