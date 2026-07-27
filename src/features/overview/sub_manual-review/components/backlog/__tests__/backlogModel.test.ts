import { describe, it, expect } from 'vitest';

import type { DevIdea } from '@/lib/bindings/DevIdea';
import {
  backlogGroupPath,
  backlogHaystack,
  compareBacklog,
  isOriginSegment,
  prettyEvidence,
  toBacklogIdea,
  triageValueScore,
  type BacklogIdea,
} from '../backlogModel';

function devIdea(over: Partial<DevIdea> = {}): DevIdea {
  return {
    id: 'i1',
    project_id: 'p1',
    context_id: null,
    scan_type: 'idea_scanner',
    category: 'technical',
    title: 'Cache the config read',
    description: null,
    reasoning: null,
    status: 'pending',
    effort: null,
    impact: null,
    risk: null,
    priority: null,
    provider: null,
    model: null,
    rejection_reason: null,
    origin: null,
    use_case_id: null,
    evidence: null,
    dedup_key: null,
    verify_state: null,
    verify_checked_at: null,
    verify_evidence: null,
    created_at: '2026-07-01T00:00:00Z',
    updated_at: '2026-07-01T00:00:00Z',
    ...over,
  };
}

const names = (id: string | null) => (id === 'p1' ? 'Personas' : '');

function view(over: Partial<BacklogIdea> = {}): BacklogIdea {
  return { ...toBacklogIdea(devIdea(), names), ...over };
}

describe('toBacklogIdea', () => {
  it('applies the midpoint default to unset effort/impact/risk', () => {
    const v = toBacklogIdea(devIdea(), names);
    expect([v.effort, v.impact, v.risk]).toEqual([5, 5, 5]);
  });

  it('keeps real levels and nullable prose as empty strings', () => {
    const v = toBacklogIdea(
      devIdea({ effort: 2, impact: 9, risk: 1, description: 'why', reasoning: null }),
      names,
    );
    expect([v.effort, v.impact, v.risk]).toEqual([2, 9, 1]);
    expect(v.description).toBe('why');
    expect(v.reasoning).toBe('');
  });

  it('resolves the project name through the injected lookup', () => {
    expect(toBacklogIdea(devIdea(), names).projectName).toBe('Personas');
    expect(toBacklogIdea(devIdea({ project_id: null }), names).projectName).toBe('');
  });

  it('falls back to technical for a blank category', () => {
    expect(toBacklogIdea(devIdea({ category: '' }), names).category).toBe('technical');
  });
});

describe('triageValueScore', () => {
  it('rewards impact and charges for effort + risk', () => {
    expect(triageValueScore({ impact: 9, effort: 2, risk: 1 })).toBe(15);
    expect(triageValueScore({ impact: 1, effort: 9, risk: 9 })).toBe(-16);
  });
});

describe('backlogGroupPath', () => {
  it('nests a finding under its origin', () => {
    expect(backlogGroupPath(view({ category: 'technical', origin: 'sentry_spike' })))
      .toBe('technical/sentry_spike');
  });

  it('leaves a scanner idea on the category node', () => {
    expect(backlogGroupPath(view({ category: 'business', origin: null }))).toBe('business');
  });
});

describe('isOriginSegment', () => {
  it('distinguishes a depth-1 origin path from a category path', () => {
    expect(isOriginSegment('technical')).toBe(false);
    expect(isOriginSegment('technical/llm_cost')).toBe(true);
  });
});

describe('backlogHaystack', () => {
  it('searches title, description and reasoning', () => {
    expect(backlogHaystack(view({ title: 't', description: 'd', reasoning: 'r' })))
      .toEqual(['t', 'd', 'r']);
  });
});

describe('compareBacklog', () => {
  const low = view({ id: 'a', impact: 1, effort: 9, risk: 9, createdAt: '2026-01-01' });
  const high = view({ id: 'b', impact: 9, effort: 1, risk: 1, createdAt: '2026-06-01' });

  it('sorts by value score descending by default direction', () => {
    expect([low, high].sort((a, b) => compareBacklog(a, b, 'value', 'desc'))[0]!.id).toBe('b');
  });

  it('sorts by created date', () => {
    expect([low, high].sort((a, b) => compareBacklog(a, b, 'created', 'asc'))[0]!.id).toBe('a');
  });

  it('sorts titles alphabetically', () => {
    const x = view({ id: 'x', title: 'Zebra' });
    const y = view({ id: 'y', title: 'Alpha' });
    expect([x, y].sort((a, b) => compareBacklog(a, b, 'title', 'asc'))[0]!.id).toBe('y');
  });
});

describe('prettyEvidence', () => {
  it('formats valid JSON', () => {
    expect(prettyEvidence('{"a":1}')).toBe('{\n  "a": 1\n}');
  });

  it('returns null for absent or malformed evidence', () => {
    expect(prettyEvidence(null)).toBeNull();
    expect(prettyEvidence('   ')).toBeNull();
    expect(prettyEvidence('{not json')).toBeNull();
  });
});
