import { describe, it, expect } from 'vitest';
import type { UndispatchedIdea } from '@/lib/bindings/UndispatchedIdea';
import { ideaInScope, normalizeName, triageInScope, type RailProjectFilter } from '../railFilter';

/**
 * A filter that hides rows has to be right about which rows, so most of what is
 * pinned here is what must NOT match. The dangerous failure is not "the filter
 * did nothing" — that is visible immediately — it is "the filter quietly kept
 * the wrong things", which looks exactly like a short queue.
 */

const SCOPE: RailProjectFilter = {
  teamId: 'team-1',
  label: 'Ledger',
  projectIds: new Set(['proj-1', 'proj-2']),
  names: new Set(['ledger', 'ledger core', 'dev clone', 'qa guardian']),
};

function idea(over: Partial<UndispatchedIdea>): UndispatchedIdea {
  return {
    id: 'i1', title: 'x', projectId: null, projectName: null, category: null,
    origin: null, priority: null, impact: null, effort: null,
    acceptedAt: '2026-09-01T00:00:00Z', ageHours: null,
    ...over,
  } as UndispatchedIdea;
}

describe('triageInScope', () => {
  it('matches a source label that names the column', () => {
    expect(triageInScope({ label: 'Ledger Core' }, SCOPE)).toBe(true);
  });

  it('matches a persona that belongs to the column', () => {
    // Held questions and evolution proposals put the PERSONA in `source.label`,
    // not a project — so a filter that only knew project names would drop both
    // queues out of every scoped view.
    expect(triageInScope({ label: 'QA Guardian' }, SCOPE)).toBe(true);
  });

  it('matches on the SUBLABEL, where a finished goal puts its project', () => {
    expect(triageInScope({ label: 'Dana', sublabel: 'Ledger Core' }, SCOPE)).toBe(true);
  });

  it('REFUSES a substring — the test is exact, not contains', () => {
    // "Rapid API Review" contains "api"; a contains-test would rescope the queue
    // to something nobody clicked, and it would look like a working filter.
    expect(triageInScope({ label: 'Ledger Core Migration' }, SCOPE)).toBe(false);
    expect(triageInScope({ label: 'Old Ledger' }, SCOPE)).toBe(false);
  });

  it('is case- and whitespace-insensitive, because source labels are prose', () => {
    expect(triageInScope({ label: '  LEDGER  ' }, SCOPE)).toBe(true);
  });

  it('does not match a workspace-level or self-tuning source', () => {
    // Documented limitation, pinned so it is a decision rather than a surprise:
    // these kinds carry no project handle at all and are hidden by ANY scope.
    expect(triageInScope({ label: 'Self-tuning' }, SCOPE)).toBe(false);
  });
});

describe('ideaInScope', () => {
  it('matches on project id', () => {
    expect(ideaInScope(idea({ projectId: 'proj-2' }), SCOPE)).toBe(true);
  });

  it('rejects another project by id even when its NAME would match', () => {
    // The id is the reliable handle and must win. A row whose project is not in
    // the column is not in the column, whatever it happens to be called.
    expect(ideaInScope(idea({ projectId: 'proj-9', projectName: 'Ledger' }), SCOPE)).toBe(false);
  });

  it('falls back to the name only when there is no project id', () => {
    expect(ideaInScope(idea({ projectId: null, projectName: 'Ledger' }), SCOPE)).toBe(true);
  });

  it('a row belonging to NO project belongs to no column', () => {
    // Not "everything" — which is what a truthy guard here would silently mean,
    // and it would put every unassigned idea into every project's scope.
    expect(ideaInScope(idea({ projectId: null, projectName: null }), SCOPE)).toBe(false);
  });
});

describe('normalizeName', () => {
  it('folds null and undefined to the empty string rather than throwing', () => {
    expect(normalizeName(null)).toBe('');
    expect(normalizeName(undefined)).toBe('');
  });
});
