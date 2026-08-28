/**
 * The conflict-detection policy had no test of any kind.
 *
 * `detectConflicts` is the only thing standing between the user and a
 * hard-delete: every button on ConflictCard (merge / keep A / keep B) acts on a
 * pair this function decided was in conflict, and a wrong pairing there deletes
 * a memory the user never meant to lose. It also carries three tuned thresholds
 * (`@/lib/memoryLimits`), a hand-rolled similarity blend, and an early-exit
 * fast path whose correctness DEPENDS on the arithmetic relationship between
 * those thresholds and the blend weights — a relationship nothing checked.
 *
 * So these tests pin: the three kinds and what separates them, the
 * newer/older orientation of a `superseded` pair (ConflictCard's keep-A/keep-B
 * labels are read off it), the sort contract, and the fast-path invariant.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import type { PersonaMemory } from '@/lib/bindings/PersonaMemory';
import {
  DUPLICATE_THRESHOLD,
  TEXT_SIM_WORD_WEIGHT,
  TEXT_SIM_BIGRAM_WEIGHT,
  SUPERSEDED_MIN_TIME_DIFF_MS,
} from '@/lib/memoryLimits';
import {
  detectConflicts,
  loadResolvedConflicts,
  saveResolvedConflicts,
  textSimilarity,
  MAX_RESOLVED_CONFLICTS,
} from '../memoryConflicts';
import { mergeMemories } from '../conflictHelpers';

let seq = 0;
function memory(over: Partial<PersonaMemory> = {}): PersonaMemory {
  seq += 1;
  return {
    id: `mem-${seq}`,
    persona_id: 'persona-a',
    title: `title ${seq}`,
    content: `content ${seq}`,
    category: 'fact',
    source_execution_id: null,
    importance: 3,
    tags: null,
    tier: 'active',
    access_count: 0,
    last_accessed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    use_case_id: null,
    home_team_id: null,
    derived_from: null,
    open_claim_count: 0,
    ...over,
  };
}

const HOUR = SUPERSEDED_MIN_TIME_DIFF_MS;

describe('textSimilarity', () => {
  it('scores identical text as a perfect match', () => {
    expect(textSimilarity('deploy on fridays', 'deploy on fridays')).toBeCloseTo(1, 10);
  });

  it('scores unrelated text below the duplicate threshold', () => {
    expect(textSimilarity('deploy on fridays', 'the kitchen sink leaks')).toBeLessThan(DUPLICATE_THRESHOLD);
  });

  it('is symmetric', () => {
    const a = 'always retry the webhook twice';
    const b = 'retry the webhook twice always';
    expect(textSimilarity(a, b)).toBeCloseTo(textSimilarity(b, a), 10);
  });
});

describe('detectConflicts — the fast-path invariant', () => {
  /**
   * `detectConflicts` skips the bigram Jaccard entirely for pairs with zero
   * shared word-tokens, on the reasoning that even a PERFECT bigram score
   * cannot then reach DUPLICATE_THRESHOLD. That is only true while
   * TEXT_SIM_BIGRAM_WEIGHT < DUPLICATE_THRESHOLD. Tuning either constant in
   * memoryLimits.ts without the other silently turns the optimisation into a
   * detector that stops finding duplicates — with no other symptom.
   */
  it('holds for the constants currently configured', () => {
    expect(TEXT_SIM_BIGRAM_WEIGHT).toBeLessThan(DUPLICATE_THRESHOLD);
    expect(TEXT_SIM_WORD_WEIGHT + TEXT_SIM_BIGRAM_WEIGHT).toBeCloseTo(1, 10);
  });
});

describe('detectConflicts', () => {
  it('returns nothing for a single memory', () => {
    expect(detectConflicts([memory()])).toEqual([]);
  });

  it('returns nothing for unrelated memories', () => {
    const a = memory({ title: 'Deployment window', content: 'Ship on Tuesdays only' });
    const b = memory({ title: 'Coffee order', content: 'Flat white, oat milk' });
    expect(detectConflicts([a, b])).toEqual([]);
  });

  it('flags near-identical memories as duplicates', () => {
    const a = memory({ title: 'Retry policy', content: 'Retry the webhook twice before alerting' });
    const b = memory({ title: 'Retry policy', content: 'Retry the webhook twice before alerting.' });
    const [conflict, ...rest] = detectConflicts([a, b]);
    expect(rest).toEqual([]);
    expect(conflict?.kind).toBe('duplicate');
    expect(conflict?.similarity).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLD);
  });

  it('names the agents in a duplicate reason so a cross-agent pair reads differently', () => {
    const shared = { title: 'Retry policy', content: 'Retry the webhook twice before alerting' };
    const same = detectConflicts([memory(shared), memory(shared)]);
    const cross = detectConflicts([memory(shared), memory({ ...shared, persona_id: 'persona-b' })]);
    expect(same[0]?.reason).toContain('same agent');
    expect(cross[0]?.reason).toContain('different agents');
  });

  it('flags a negated instruction on the same topic as a contradiction', () => {
    const a = memory({ title: 'Deploy policy', content: 'Always deploy to production on friday afternoon' });
    const b = memory({ title: 'Deploy policy', content: 'Never deploy to production on friday afternoon' });
    const [conflict] = detectConflicts([a, b]);
    expect(conflict?.kind).toBe('contradiction');
  });

  /**
   * Regression pin. Every NEGATION_PAIRS entry is a ONE-WORD swap, so the two
   * sides of a real contradiction are nearly always textually near-identical —
   * which is exactly what the duplicate branch matches. While the duplicate
   * check ran first this pair came back as `duplicate`, and `duplicate` is the
   * ONLY kind for which ConflictCard renders a Merge button, whose merge
   * concatenates both bodies into one memory asserting both halves.
   */
  it('never labels a negation pair a duplicate, however similar the two texts are', () => {
    const cases: Array<[string, string]> = [
      ['Always deploy to production on friday afternoon', 'Never deploy to production on friday afternoon'],
      ['Enable the nightly backup job for the reporting database', 'Disable the nightly backup job for the reporting database'],
      ['Allow outbound requests from the scraper worker', 'Deny outbound requests from the scraper worker'],
      ['You should escalate a paging incident to the duty lead', 'You should not escalate a paging incident to the duty lead'],
    ];
    for (const [left, right] of cases) {
      const conflicts = detectConflicts([
        memory({ title: 'Policy', content: left }),
        memory({ title: 'Policy', content: right }),
      ]);
      expect(conflicts[0]?.kind, `${left} / ${right}`).toBe('contradiction');
    }
  });

  it('does NOT call overlapping-but-agreeing memories a contradiction', () => {
    const a = memory({ title: 'Deploy policy', content: 'Always deploy to production on friday afternoon' });
    const b = memory({ title: 'Deploy policy', content: 'Always deploy to production after the friday review' });
    const kinds = detectConflicts([a, b]).map((c) => c.kind);
    expect(kinds).not.toContain('contradiction');
  });

  it('orients a superseded pair newest-first, which is what the keep buttons read', () => {
    const older = memory({
      title: 'Escalation path',
      content: 'Escalate paging incidents to the on call engineer directly',
      created_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
    });
    const newer = memory({
      title: 'Escalation path',
      content: 'Escalate paging incidents to the on call engineer and the duty lead',
      created_at: new Date(Date.UTC(2026, 0, 1) + 5 * HOUR).toISOString(),
    });
    // Pass them oldest-first so a correct result cannot come from input order.
    const [conflict] = detectConflicts([older, newer]);
    expect(conflict?.kind).toBe('superseded');
    expect(conflict?.memoryA.id).toBe(newer.id);
    expect(conflict?.memoryB.id).toBe(older.id);
  });

  it('does not call two memories written in the same batch a supersession', () => {
    const base = {
      title: 'Escalation path',
      content: 'Escalate paging incidents to the on call engineer directly today',
    };
    const a = memory({ ...base, created_at: new Date(Date.UTC(2026, 0, 1)).toISOString() });
    const b = memory({
      ...base,
      content: 'Escalate paging incidents to the on call engineer and the duty lead today',
      created_at: new Date(Date.UTC(2026, 0, 1) + HOUR / 2).toISOString(),
    });
    const kinds = detectConflicts([a, b]).map((c) => c.kind);
    expect(kinds).not.toContain('superseded');
  });

  it('reports each pair exactly once', () => {
    const shared = { title: 'Retry policy', content: 'Retry the webhook twice before alerting' };
    const conflicts = detectConflicts([memory(shared), memory(shared), memory(shared)]);
    const ids = conflicts.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(3); // 3 memories -> 3 unordered pairs
  });

  it('sorts contradictions ahead of duplicates ahead of supersessions', () => {
    const dupe = { title: 'Retry policy', content: 'Retry the webhook twice before alerting' };
    const contra = { title: 'Deploy policy', content: 'Always deploy to production on friday afternoon' };
    const conflicts = detectConflicts([
      memory(dupe),
      memory(dupe),
      memory(contra),
      memory({ ...contra, content: 'Never deploy to production on friday afternoon' }),
    ]);
    const kinds = conflicts.map((c) => c.kind);
    expect(kinds.indexOf('contradiction')).toBeLessThan(kinds.indexOf('duplicate'));
  });
});

describe('mergeMemories', () => {
  it('keeps the newer memory as the surviving identity and unions the tags', () => {
    const older = memory({
      title: 'Old title',
      content: 'Older body',
      category: 'fact',
      importance: 2,
      tags: ['a', 'b'],
      persona_id: 'persona-a',
      created_at: '2026-01-01T00:00:00Z',
    });
    const newer = memory({
      title: 'New title',
      content: 'Newer body',
      category: 'instruction',
      importance: 5,
      tags: ['b', 'c'],
      persona_id: 'persona-a',
      created_at: '2026-02-01T00:00:00Z',
    });

    const merged = mergeMemories(older, newer);
    expect(merged.title).toBe('New title');
    expect(merged.category).toBe('instruction');
    expect(merged.importance).toBe(5); // the MAX, not the newer one's
    expect(merged.tags.sort()).toEqual(['a', 'b', 'c']);
    expect(merged.content).toContain('Older body');
    expect(merged.content).toContain('Newer body');
  });

  it('does not duplicate a body that is identical on both sides', () => {
    const body = 'Retry the webhook twice before alerting';
    const merged = mergeMemories(memory({ content: body }), memory({ content: body }));
    expect(merged.content).toBe(body);
  });

  it('carries neither side of a null tags column into the result', () => {
    const merged = mergeMemories(memory({ tags: null }), memory({ tags: ['keep'] }));
    expect(merged.tags).toEqual(['keep']);
  });
});

/**
 * Recall of the user's verdicts. Component state used to hold these, and the
 * Conflicts tab unmounts on every switch back to Memories — so a dismissed
 * pair (which, detection being heuristic, is by definition one of the
 * detector's false positives) came back on the next visit, forever.
 */
describe('resolved-conflict recall', () => {
  const KEY = 'dolla:memory-conflicts-resolved';

  beforeEach(() => {
    localStorage.clear();
  });

  it('reads back the verdicts a previous mount wrote', () => {
    saveResolvedConflicts(new Set(['a:b', 'c:d']));
    expect([...loadResolvedConflicts()].sort()).toEqual(['a:b', 'c:d']);
  });

  it('returns an empty set when nothing has been stored', () => {
    expect(loadResolvedConflicts().size).toBe(0);
  });

  it('survives a blob that is not an array of strings', () => {
    // Whatever a previous build or a hand edit left behind must degrade to
    // "show the conflicts again", never to a poisoned id set.
    localStorage.setItem(KEY, JSON.stringify({ not: 'an array' }));
    expect(loadResolvedConflicts().size).toBe(0);

    localStorage.setItem(KEY, JSON.stringify(['ok', 42, null, { x: 1 }]));
    expect([...loadResolvedConflicts()]).toEqual(['ok']);

    localStorage.setItem(KEY, '{ truncated');
    expect(loadResolvedConflicts().size).toBe(0);
  });

  it('caps the stored set, keeping the most recently resolved ids', () => {
    const ids = Array.from({ length: MAX_RESOLVED_CONFLICTS + 5 }, (_, i) => `pair_${i}`);
    saveResolvedConflicts(new Set(ids));

    const stored = loadResolvedConflicts();
    expect(stored.size).toBe(MAX_RESOLVED_CONFLICTS);
    // Insertion order is oldest-first, so the tail is what must survive.
    expect(stored.has(`pair_${MAX_RESOLVED_CONFLICTS + 4}`)).toBe(true);
    expect(stored.has('pair_0')).toBe(false);
  });
});
