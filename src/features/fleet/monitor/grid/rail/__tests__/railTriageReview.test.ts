import { describe, it, expect } from 'vitest';
import { parseDecisions } from '@/features/overview/sub_manual-review/components/reviewFocusHelpers';
import { parseSuggestedActions } from '@/lib/reviews/suggestedActions';
import type { TriageItem } from '@/features/agents/quick-answer/triage/triageTypes';
import {
  railBranchIdFor,
  suggestedActionsOf,
  triageItemToReview,
  triageItemsToReviews,
} from '../railTriageReview';

/**
 * The rail -> Approvals translation. What is pinned here is mostly the LOSSY
 * half: a rail item that is not a review has no severity, no persona and no
 * item-level media, and the restored `ReviewFocusFlow` has to degrade rather
 * than throw. A test that only proved the happy path would miss the five kinds
 * that make up most of the unified queue.
 */

function item(over: Partial<TriageItem> = {}): TriageItem {
  return {
    id: 'review:r1',
    sourceId: 'r1',
    kind: 'review',
    title: 'Scout: ship the thing',
    body: 'the case',
    tags: [],
    facts: [{ id: 'severity', label: 'Severity', value: 'critical' }],
    source: { label: 'Scout', color: '#ff0000' },
    createdAt: '2026-10-01T00:00:00Z',
    weight: 50,
    branches: [],
    verdictLabels: { accept: 'Approve', reject: 'Reject', skip: 'Later' },
    personaIcon: 'rocket',
    personaId: 'p1',
    ...over,
  };
}

describe('triageItemToReview', () => {
  it('keys the review by the UNIFIED item id, not the source id', () => {
    // The modal resolves a verdict's id back through `itemById`, which is
    // keyed `${kind}:${sourceId}`. Using `sourceId` here would collide across
    // the six kinds the one queue mixes.
    expect(triageItemToReview(item()).id).toBe('review:r1');
  });

  it('carries persona identity through for the swatch and the icon', () => {
    const r = triageItemToReview(item());
    expect(r.persona_id).toBe('p1');
    expect(r.persona_name).toBe('Scout');
    expect(r.persona_icon).toBe('rocket');
    expect(r.persona_color).toBe('#ff0000');
  });

  it('reads severity from the FACT, and yields "" when the kind has none', () => {
    expect(triageItemToReview(item()).severity).toBe('critical');
    // An idea, question, policy, evolution or goal carries no severity fact.
    expect(triageItemToReview(item({ kind: 'idea', facts: [] })).severity).toBe('');
  });

  it('degrades to no persona rather than inventing one', () => {
    const r = triageItemToReview(item({ personaId: null, personaIcon: null, source: { label: 'Ledger', color: null } }));
    expect(r.persona_id).toBeUndefined();
    expect(r.persona_icon).toBeUndefined();
    expect(r.persona_color).toBeUndefined();
    expect(r.persona_name).toBe('Ledger');
  });

  it('is always pending, which is what the focus flow filters on', () => {
    expect(triageItemToReview(item()).status).toBe('pending');
  });
});

describe('context_data round-trip', () => {
  it('rebuilds a blob parseDecisions reads back, options and prose intact', () => {
    const r = triageItemToReview(item({
      decisions: [
        { id: 'd1', label: 'Keep it' },
        { id: 'd2', label: 'Drop it', category: 'security' },
      ],
      reasoning: 'Two ways to go.',
    }));
    const parsed = parseDecisions(r.context_data);
    expect(parsed.decisions.map((d) => d.id)).toEqual(['d1', 'd2']);
    expect(parsed.decisions[1]?.category).toBe('security');
    expect(parsed.contextText).toBe('Two ways to go.');
  });

  it('hands the raw evidence through when there is nothing structured', () => {
    // `ContextDataPreview` is the fallback for exactly this case; wrapping an
    // opaque payload in a JSON envelope would hide it behind an empty parse.
    const r = triageItemToReview(item({ evidence: '{"anything":1}' }));
    expect(r.context_data).toBe('{"anything":1}');
    expect(parseDecisions(r.context_data).decisions).toEqual([]);
  });

  it('is null when the item carries neither decisions, prose nor evidence', () => {
    expect(triageItemToReview(item({ evidence: null })).context_data).toBeNull();
  });
});

describe('branches', () => {
  const withBranches = item({
    branches: [
      { id: 'carry_out', label: 'Rotate the key', tone: 'accent' },
      { id: 'build_now', label: 'Build it now', tone: 'accent' },
    ],
  });

  it('surfaces branch LABELS, because the flow renders what it hands back', () => {
    expect(parseSuggestedActions(suggestedActionsOf(withBranches))).toEqual([
      'Rotate the key', 'Build it now',
    ]);
  });

  it('maps a chosen label back to the id the dispatcher routes on', () => {
    expect(railBranchIdFor(withBranches, 'Build it now')).toBe('build_now');
    expect(railBranchIdFor(withBranches, 'Not a branch')).toBeUndefined();
  });

  it('is null with no branches, so the quick-actions block never renders empty', () => {
    expect(suggestedActionsOf(item())).toBeNull();
  });
});

describe('triageItemsToReviews', () => {
  it('preserves the rail\'s own order', () => {
    const rows = triageItemsToReviews([
      item({ id: 'review:a', sourceId: 'a' }),
      item({ id: 'idea:b', sourceId: 'b', kind: 'idea' }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(['review:a', 'idea:b']);
  });
});
