// The ONE place a test builds a `DevNote` from scratch.
//
// This file lives outside `__tests__` on purpose. `tsconfig.json` excludes
// `src/**/__tests__/**`, so no gate type-checks a test file, and nine tests used
// to hand-build the 17-field literal (four of them through `as DevNote`, which
// would hide a missing field even if the directory were checked). A field added
// to the binding left every one of them stale with every gate green. Here the
// literal is checked against the generated type, so the next field fails `tsc`
// in this file instead of silently in nine.
import type { DevNote } from '@/lib/bindings/DevNote';

/** A draft with nothing set. Tests override what they are about. */
export function makeNote(over: Partial<DevNote> = {}): DevNote {
  return {
    id: 'n1',
    projectId: null,
    milestoneId: null,
    title: 'Note',
    bodyMd: '',
    status: 'draft',
    orderIndex: 0,
    dispatchTarget: null,
    dispatchKey: null,
    fleetSessionId: null,
    agentId: null,
    resultJson: null,
    publishedAt: null,
    startedAt: null,
    completedAt: null,
    archivedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}
