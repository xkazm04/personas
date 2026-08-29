import { describe, it, expect } from 'vitest';
import {
  severityRank,
  severityBadgeClass,
  severityShapeStatus,
} from '../incidentTaxonomy';

// incident-promotion: "a healer that keeps failing must get louder over time,
// not quieter." An incident whose severity the promoter could not classify is
// the healer's least-understood output; it must not sort below a `low`.
describe('unclassified incident severity', () => {
  const UNKNOWN = ['', 'sev1', 'unknown', 'blocker'];

  it('ranks above every classified rung', () => {
    for (const s of UNKNOWN) {
      expect(severityRank(s)).toBeGreaterThan(severityRank('low'));
      expect(severityRank(s)).toBeGreaterThanOrEqual(severityRank('critical'));
    }
  });

  it('is painted and shaped consistently with that rank', () => {
    for (const s of UNKNOWN) {
      expect(severityBadgeClass(s)).toBe(severityBadgeClass('critical'));
      expect(severityShapeStatus(s)).toBe(severityShapeStatus('critical'));
    }
  });

  it('leaves the classified rungs alone', () => {
    expect(severityRank('critical')).toBeGreaterThan(severityRank('high'));
    expect(severityRank('high')).toBeGreaterThan(severityRank('medium'));
    expect(severityRank('medium')).toBeGreaterThan(severityRank('low'));
    expect(severityShapeStatus('medium')).toBe('warning');
  });
});
