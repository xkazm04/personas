/**
 * useInboxActions — Defer and Dismiss must change state.
 *
 * Both slots shipped as empty async lambdas: the buttons existed, clicking
 * them looked like success and did nothing. These cases pin the three-slot
 * contract (every advertised slot mutates something) and the snooze semantics
 * behind Defer/Dismiss.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { useInboxActions } from './useInboxActions';
import { useUnifiedInboxSnapshot } from './useUnifiedInbox';
import {
  DEFER_DURATION_MS,
  DISMISS_UNTIL_MS,
  getSnoozeSnapshot,
  isInboxItemSnoozed,
  resetInboxSnoozes,
} from '../snooze';
import type { UnifiedInboxItem } from '../types';
import { useAgentStore } from '@/stores/agentStore';
import { useOverviewStore } from '@/stores/overviewStore';

function approvalItem(o: Partial<UnifiedInboxItem> = {}): UnifiedInboxItem {
  return {
    kind: 'approval',
    id: 'approval:rev-1',
    source: 'rev-1',
    personaId: 'p-1',
    personaName: 'Weather Bot',
    personaIcon: null,
    personaColor: null,
    createdAt: '2026-04-20T10:00:00.000Z',
    severity: 'warning',
    title: 'Approve deployment?',
    body: 'Body',
    data: {
      executionId: 'exec-1',
      reviewType: 'build_output',
      contextData: null,
      suggestedActions: null,
      reviewerNotes: null,
      origin: 'local',
    },
    ...o,
  } as UnifiedInboxItem;
}

function healthItem(): UnifiedInboxItem {
  return {
    kind: 'health',
    id: 'health:heal-1',
    source: 'heal-1',
    personaId: 'p-1',
    personaName: 'Weather Bot',
    personaIcon: null,
    personaColor: null,
    createdAt: '2026-04-20T09:00:00.000Z',
    severity: 'critical',
    title: 'Circuit breaker open',
    body: 'Body',
    data: {
      executionId: null,
      category: 'timeout',
      suggestedFix: null,
      isCircuitBreaker: true,
    },
  };
}

describe('useInboxActions — Defer / Dismiss', () => {
  beforeEach(() => {
    resetInboxSnoozes();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetInboxSnoozes();
  });

  it('Defer snoozes the approval for an hour', async () => {
    const start = Date.parse('2026-04-20T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);

    const item = approvalItem();
    const { result } = renderHook(() => useInboxActions(item));
    expect(result.current.secondary?.labelKey).toBe('action_defer');

    await act(async () => {
      await result.current.secondary?.run();
    });

    expect(getSnoozeSnapshot()[item.id]).toBe(start + DEFER_DURATION_MS);
    expect(isInboxItemSnoozed(item.id, start + 1_000)).toBe(true);
    expect(isInboxItemSnoozed(item.id, start + DEFER_DURATION_MS + 1)).toBe(false);
  });

  it('Dismiss snoozes the health item indefinitely', async () => {
    const item = healthItem();
    const { result } = renderHook(() => useInboxActions(item));
    expect(result.current.tertiary?.labelKey).toBe('action_dismiss');

    await act(async () => {
      await result.current.tertiary?.run();
    });

    expect(getSnoozeSnapshot()[item.id]).toBe(DISMISS_UNTIL_MS);
    expect(isInboxItemSnoozed(item.id)).toBe(true);
  });

  it('every advertised slot mutates something (no empty lambdas)', () => {
    const { result } = renderHook(() => useInboxActions(approvalItem()));
    const slots = [result.current.primary, result.current.secondary, result.current.tertiary];
    for (const slot of slots) {
      expect(slot).not.toBeNull();
      // An empty `async () => {}` stringifies to exactly this.
      expect(slot?.run.toString().replace(/\s/g, '')).not.toBe('async()=>{}');
    }
  });
});

describe('useUnifiedInboxSnapshot — snoozed items leave the inbox', () => {
  beforeEach(() => {
    resetInboxSnoozes();
    useAgentStore.setState({ personas: [] });
    useOverviewStore.setState({
      manualReviews: [
        {
          id: 'rev-1',
          persona_id: 'p-1',
          execution_id: 'exec-1',
          review_type: 'build_output',
          content: 'Body of the approval',
          severity: 'warning',
          status: 'pending',
          reviewer_notes: null,
          context_data: null,
          suggested_actions: null,
          title: 'Approve deployment?',
          created_at: '2026-04-20T10:00:00.000Z',
          resolved_at: null,
          source: 'local',
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
      reports: [],
      healingIssues: [],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    resetInboxSnoozes();
  });

  it('a deferred approval drops out and returns after the clock', async () => {
    const start = Date.parse('2026-04-20T12:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(start);

    const inbox = renderHook(() => useUnifiedInboxSnapshot());
    expect(inbox.result.current.items).toHaveLength(1);
    expect(inbox.result.current.needsMeTotal).toBe(1);

    const actions = renderHook(() => useInboxActions(approvalItem()));
    await act(async () => {
      await actions.result.current.secondary?.run();
    });

    inbox.rerender();
    expect(inbox.result.current.items).toHaveLength(0);
    expect(inbox.result.current.total).toBe(0);
    expect(inbox.result.current.needsMeTotal).toBe(0);

    await act(async () => {
      vi.setSystemTime(start + DEFER_DURATION_MS + 1);
      await vi.advanceTimersByTimeAsync(DEFER_DURATION_MS + 1);
    });
    inbox.rerender();
    expect(inbox.result.current.items).toHaveLength(1);
  });
});
