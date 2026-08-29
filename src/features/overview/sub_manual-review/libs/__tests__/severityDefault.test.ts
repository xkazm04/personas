import { describe, it, expect } from 'vitest';
import { severityBucket } from '@/features/fleet/monitor/monitorModel';
import { resolveReviewSeverity } from '../reviewHelpers';

// fail-loud-classification-default: a severity the consumer cannot read must
// not be spelled the same way as a readable low-severity one. The review
// producer prompt (design/reviews.rs) asks for info|warning|error|critical and
// another producer writes "high"; the consumer vocabulary is info|warning|
// critical, so `error` is a live, in-tree unreadable token.
describe('review severity fall-through', () => {
  it('does not put an unreadable severity in the mildest bucket', () => {
    for (const token of ['error', 'sev1', '', 'CRITICAL ']) {
      expect(severityBucket(token)).not.toBe('info');
    }
  });
});

describe('resolveReviewSeverity', () => {
  it('reads the producer vocabulary and marks what it cannot read', () => {
    expect(resolveReviewSeverity('error')).toEqual({ label: 'Error', defaulted: false });
    expect(resolveReviewSeverity('high')).toEqual({ label: 'High', defaulted: false });
    expect(resolveReviewSeverity('sev1')).toEqual({ label: 'Unclassified', defaulted: true });
    expect(resolveReviewSeverity(null)).toEqual({ label: 'Unclassified', defaulted: true });
  });
});
