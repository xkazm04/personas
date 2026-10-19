/**
 * What a caller of the healing slice can learn about a failure.
 *
 * - The HEALING_ISSUE_UPDATED subscriber drops an issue only on a definitive
 *   "not found". IPC rejects with a serialized AppError OBJECT, which the old
 *   `String(err)` fallback rendered as "[object Object]", so the matcher never
 *   fired on a real rejection.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const updateHealingStatus = vi.fn();
const getHealingIssue = vi.fn();
let listener: ((payload: { issueId: string; personaId: string }) => Promise<void>) | null = null;

vi.mock('@/api/overview/healing', () => ({
  updateHealingStatus: (...a: unknown[]) => updateHealingStatus(...a),
  getHealingIssue: (...a: unknown[]) => getHealingIssue(...a),
  getHealingTimeline: vi.fn(),
  getRetryChain: vi.fn(),
  listHealingIssues: vi.fn(),
  runHealingAnalysis: vi.fn(),
}));

vi.mock('@/lib/eventRegistry', () => ({
  EventName: { HEALING_ISSUE_UPDATED: 'healing-issue-updated' },
  typedListen: async (_name: string, cb: typeof listener) => {
    listener = cb;
    return () => {};
  },
}));

import { create } from 'zustand';
import { createHealingSlice } from '../healingSlice';
import type { OverviewStore } from '../../../storeTypes';
import type { PersonaHealingIssue } from '@/lib/bindings/PersonaHealingIssue';

function makeStore() {
  return create<OverviewStore>()((...a) => ({
    error: null,
    errorKind: null,
    ...createHealingSlice(...a),
  }) as OverviewStore);
}

const ISSUE: PersonaHealingIssue = {
  id: 'issue-1', persona_id: 'persona-1', execution_id: null, title: 'Timeout', description: '',
  is_circuit_breaker: false, severity: 'medium', category: 'timeout', suggested_fix: null,
  auto_fixed: false, status: 'open', created_at: '2026-10-01T00:00:00Z', resolved_at: null, source: null,
};

beforeEach(() => {
  updateHealingStatus.mockReset();
  getHealingIssue.mockReset();
  listener = null;
});

describe('subscribeHealingEvents', () => {
  it('drops an issue the backend reports as not found (AppError object)', async () => {
    getHealingIssue.mockRejectedValue({ error: 'Not found: healing issue issue-1', kind: 'NotFound' });
    const store = makeStore();
    store.setState({ healingIssues: [ISSUE] });
    await store.getState().subscribeHealingEvents();
    await listener!({ issueId: 'issue-1', personaId: 'persona-1' });
    expect(store.getState().healingIssues).toHaveLength(0);
  });

  it('keeps an issue on a transient failure', async () => {
    getHealingIssue.mockRejectedValue({ error: 'Database error: locked', kind: 'Database' });
    const store = makeStore();
    store.setState({ healingIssues: [ISSUE] });
    await store.getState().subscribeHealingEvents();
    await listener!({ issueId: 'issue-1', personaId: 'persona-1' });
    expect(store.getState().healingIssues).toHaveLength(1);
  });
});
