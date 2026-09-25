import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/silentCatch', () => ({
  silentCatchNull: () => () => null,
}));

import { kpRequirementsFromDesignContext, parseKpRequirements } from '../kpRequirements';

const REQUIREMENTS = {
  kind: 'kp.agent-requirements.v1',
  role: 'Freelance specialist - web development',
  arena: 'freelance',
  niche: 'web development',
  purpose: 'Deliver small web gigs end to end.',
  responsibilities: ['Read the brief', '  ', 'Verify the deliverable runs'],
  craft: [{ recipe: 'freelance-brief-delivery@0.1.0', title: 'Brief to delivery', successCriteria: ['Answered'], lessons: [] }],
  research: { gigsResearched: 12, categories: ['Web development · Landing page'], typicalEffortHours: null, asOf: '2026-09-25' },
  inputs: { assignment: 'kp.gig.v1', fields: ['gigId', 'bodyUntrusted'] },
  outputs: { contract: 'kp-deliverable.v1', handoffFile: 'kp-deliverable.json', clientFilesDir: 'deliverable/', processLog: 'NOTES.md', reviewChecklist: ['brief_answered'] },
  constraints: ['Never send anything; the operator sends.', 'Disclose AI assistance in what goes out.'],
  tools: [{ connector: 'research', why: 'check vendor facts' }, { connector: '', why: 'dropped' }],
  budgetUsdPerAttempt: 3,
  futureKey: { anything: true },
};

function designContext(requirements: unknown): string {
  return JSON.stringify({
    kpLink: { jobId: 'gig-1', jobTitle: 't', baseUrl: 'http://x', reportToken: 'tok', requirements },
  });
}

describe('kpRequirementsFromDesignContext', () => {
  it('reads the requirements off a kpLink-only envelope', () => {
    const r = kpRequirementsFromDesignContext(designContext(REQUIREMENTS));
    expect(r).not.toBeNull();
    expect(r!.role).toBe('Freelance specialist - web development');
    expect(r!.constraints).toEqual([
      'Never send anything; the operator sends.',
      'Disclose AI assistance in what goes out.',
    ]);
    // Blank entries are dropped, nameless tools too.
    expect(r!.responsibilities).toEqual(['Read the brief', 'Verify the deliverable runs']);
    expect(r!.tools).toEqual([{ connector: 'research', why: 'check vendor facts' }]);
    // A null effort is absent, never zero.
    expect(r!.research?.effortMin).toBeNull();
    expect(r!.research?.effortMax).toBeNull();
    expect(r!.budgetUsdPerAttempt).toBe(3);
  });

  it('is null for every persona that was not hired from kp requirements', () => {
    expect(kpRequirementsFromDesignContext(null)).toBeNull();
    expect(kpRequirementsFromDesignContext('')).toBeNull();
    expect(kpRequirementsFromDesignContext('{"summary":"old row"}')).toBeNull();
    expect(kpRequirementsFromDesignContext(designContext(undefined))).toBeNull();
    expect(kpRequirementsFromDesignContext('not json')).toBeNull();
  });

  it('refuses another kind rather than half-rendering it', () => {
    expect(parseKpRequirements({ ...REQUIREMENTS, kind: 'kp.agent-requirements.v2' })).toBeNull();
    expect(parseKpRequirements(['kp.agent-requirements.v1'])).toBeNull();
  });

  it('reads a wrong-shaped field as absent', () => {
    const r = parseKpRequirements({ kind: 'kp.agent-requirements.v1', constraints: 'Never send.', research: 'lots' });
    expect(r).not.toBeNull();
    expect(r!.constraints).toEqual([]);
    expect(r!.research).toBeNull();
    expect(r!.budgetUsdPerAttempt).toBeNull();
  });
});
