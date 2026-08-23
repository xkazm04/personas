// Pure-helper tests for the census adherence scorecard model (P4). The
// contract under test is the honesty rule: absence ≠ cleanliness.
import { describe, expect, it } from 'vitest';

import type { HierarchyScorecard } from '@/lib/bindings/HierarchyScorecard';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';

import { subjectScoreMap } from '../scorecardModel';

function score(partial: Partial<SubjectScore> & { slug: string }): SubjectScore {
  return {
    rules: 1,
    sites: 0,
    matchedFiles: 0,
    applicableContexts: 0,
    cleanContexts: 0,
    contexts: [],
    uncontextedSites: 0,
    ...partial,
  };
}

function scorecard(subjects: SubjectScore[], present = true): HierarchyScorecard {
  return {
    generatedAt: present ? '2026-08-18T18:08:03.828Z' : null,
    ruleCount: 7,
    contextCount: 12,
    assignedRules: 7,
    totalSites: subjects.reduce((n, s) => n + s.sites, 0),
    totalMatchedFiles: 0,
    subjects,
    source: {
      root: '/repo',
      present,
      reason: present ? null : 'no artifact',
    },
  };
}

describe('subjectScoreMap', () => {
  it('is null with no scorecard and null when the artifact is absent', () => {
    expect(subjectScoreMap(null)).toBeNull();
    expect(subjectScoreMap(scorecard([score({ slug: 'table' })], false))).toBeNull();
  });

  it('maps a present scorecard by slug (even when empty — a real census)', () => {
    const map = subjectScoreMap(scorecard([score({ slug: 'table', sites: 5 })]));
    expect(map).not.toBeNull();
    expect(map?.get('table')?.sites).toBe(5);
    expect(map?.get('absent-subject')).toBeUndefined();
    expect(subjectScoreMap(scorecard([]))).toEqual(new Map());
  });
});
