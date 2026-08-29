import { describe, it, expect } from 'vitest';
import { classifyEmbeddedAnomaly } from '../useRemediationEvaluator';

/**
 * The remediation ladder's first decision: which credentials the evaluator
 * skips without asking the backend anything. A could-not-verify outcome must
 * weigh ZERO — it is neither evidence of health nor evidence of breakage — so
 * a metadata blob that will not parse may not be classed with a blob that
 * says "Healthy" or with no blob at all.
 */
describe('classifyEmbeddedAnomaly', () => {
  it('reads a well-formed blob', () => {
    expect(classifyEmbeddedAnomaly(null)).toBe('absent');
    expect(classifyEmbeddedAnomaly('{}')).toBe('absent');
    expect(classifyEmbeddedAnomaly('{"anomaly_score":{"remediation":"Healthy"}}')).toBe('healthy');
    expect(classifyEmbeddedAnomaly('{"anomaly_score":{"remediation":"RotateThenAlert"}}')).toBe('actionable');
  });

  it('does not read an unparseable blob as an absent one', () => {
    // The backend added RotationStatus.healthcheck_corrupted for exactly this
    // case. Collapsing it into 'absent' scores a corrupted credential healthy
    // and skips the whole ladder for it.
    expect(classifyEmbeddedAnomaly('{"anomaly_score":')).toBe('corrupt');
    expect(classifyEmbeddedAnomaly('not json at all')).toBe('corrupt');
  });
});
