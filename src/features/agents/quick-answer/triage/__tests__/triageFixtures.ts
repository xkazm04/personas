/** Shared builders for the triage tests. Not a test file — no assertions here. */
import type { BuildQuestion } from '@/lib/types/buildTypes';

import { TRIAGE_KINDS, type TriageItem, type TriageKind } from '../triageTypes';

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

/** A build-session card, shaped the way `questionGroupToTriage` shapes one. */
export function makeQuestion(overrides: Partial<TriageItem> = {}): TriageItem {
  return makeItem('question', {
    sourceId: 'sess-1',
    payload: { sessionId: 'sess-1', personaId: 'persona-1' },
    verdictLabels: { accept: 'Submit', reject: 'Skip', skip: 'Later' },
    input: { fields: [{ key: 'tools', prompt: 'Which tools?', kind: 'text' }], deferred: false },
    ...overrides,
  });
}

/** A raw pending build question, as the CLI reports it. */
export function makeBuildQuestion(overrides: Partial<BuildQuestion> = {}): BuildQuestion {
  return {
    cellKey: 'tools',
    question: 'Which tools should it use?',
    options: null,
    ...overrides,
  };
}

/** Derived, not listed: a new kind must not silently skip the queue tests. */
export const ALL_KINDS = new Set<TriageKind>(TRIAGE_KINDS);
