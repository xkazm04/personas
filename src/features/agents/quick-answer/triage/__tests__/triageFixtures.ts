/** Shared builders for the triage tests. Not a test file — no assertions here. */
import type { TriageItem, TriageKind } from '../triageTypes';

let seq = 0;

export function makeItem(kind: TriageKind, overrides: Partial<TriageItem> = {}): TriageItem {
  seq += 1;
  const sourceId = overrides.sourceId ?? `src-${seq}`;
  return {
    id: `${kind}:${sourceId}`,
    sourceId,
    kind,
    title: `${kind} ${seq}`,
    body: 'body',
    tags: [],
    facts: [],
    source: { label: 'somewhere' },
    createdAt: `2026-01-0${(seq % 9) + 1}T00:00:00.000Z`,
    weight: 50,
    branches: [],
    verdictLabels: { accept: 'Accept', reject: 'Reject', skip: 'Skip' },
    ...overrides,
  };
}

/** A build question item, shaped the way `questionToTriage` shapes one. */
export function makeQuestion(overrides: Partial<TriageItem> = {}): TriageItem {
  return makeItem('question', {
    payload: { sessionId: 'sess-1', personaId: 'persona-1' },
    verdictLabels: { accept: 'Submit', reject: 'Skip', skip: 'Later' },
    ...overrides,
  });
}

export const ALL_KINDS = new Set<TriageKind>(['review', 'idea', 'practice', 'question']);
