// Pure-helper tests for the census adherence scorecard model (P4). The
// contract under test is the honesty rules: absence ≠ cleanliness, the
// denominator comes from the artifact (never derived from the dirty-context
// array), and the context lens union counts every subject's sites.
import { describe, expect, it } from 'vitest';

import type { HierarchyScorecard } from '@/lib/bindings/HierarchyScorecard';
import type { SubjectScore } from '@/lib/bindings/SubjectScore';

import {
  adherenceRatio,
  buildContextLensEntries,
  sitesBySubjectForContext,
  subjectScoreMap,
} from '../scorecardModel';

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

describe('adherenceRatio', () => {
  it('is cleanContexts / applicableContexts', () => {
    expect(adherenceRatio(score({ slug: 's', applicableContexts: 10, cleanContexts: 4 }))).toBe(0.4);
  });

  it('renders zero applicable contexts as 0, never 1 — no denominator is no evidence', () => {
    expect(adherenceRatio(score({ slug: 's', applicableContexts: 0, cleanContexts: 0 }))).toBe(0);
  });

  it('clamps to 1', () => {
    expect(adherenceRatio(score({ slug: 's', applicableContexts: 2, cleanContexts: 3 }))).toBe(1);
  });
});

const ctx = (id: string, name: string, group: string, sites: number) => ({
  id,
  name,
  group,
  sites,
  matchedFiles: 1,
  ruleCount: 1,
  topRules: [{ id: 'r1', sites }],
});

describe('context lens helpers', () => {
  const scores = new Map<string, SubjectScore>([
    [
      'table',
      score({
        slug: 'table',
        sites: 70,
        contexts: [ctx('c1', 'agents', 'Agent Platform', 60), ctx('c2', 'vault', 'Security', 10)],
      }),
    ],
    [
      'feed',
      score({
        slug: 'feed',
        sites: 15,
        contexts: [ctx('c1', 'agents', 'Agent Platform', 15)],
      }),
    ],
  ]);

  it('unions contexts across subjects with summed sites, grouped/sorted', () => {
    const entries = buildContextLensEntries(scores);
    expect(entries).toEqual([
      { id: 'c1', name: 'agents', group: 'Agent Platform', totalSites: 75 },
      { id: 'c2', name: 'vault', group: 'Security', totalSites: 10 },
    ]);
  });

  it('maps per-subject sites for one context, omitting clean subjects', () => {
    const sites = sitesBySubjectForContext(scores, 'c2');
    expect(sites.get('table')).toBe(10);
    expect(sites.has('feed')).toBe(false);
  });
});
