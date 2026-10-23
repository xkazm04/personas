/**
 * A failed nudge write keeps the orb decision pending.
 *
 * `runDecisionOption` keeps a decision up (with `decisionError`) only when the
 * option REJECTS. The orb-only nudges (an attention message, a revoked
 * credential) used to swallow a failed `companionDismissProactive` /
 * `companionEngageProactive` into silentCatch, so the bubble cleared as
 * "resolved" while the proactive row stayed pending - and the next pump
 * re-surfaced it with no error ever shown. The credential "Reconnect" path
 * already rethrew; these are its siblings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProactiveMessage } from '@/api/companion';

const proactive: ProactiveMessage[] = [];

vi.mock('@/api/companion', async (orig) => ({
  ...(await orig<typeof import('@/api/companion')>()),
  companionListProactiveMessages: vi.fn(async () => proactive),
  companionDismissProactive: vi.fn(async () => {
    throw new Error('database is locked');
  }),
  companionEngageProactive: vi.fn(async () => {
    throw new Error('database is locked');
  }),
  companionRecordUxSignal: vi.fn(),
}));
vi.mock('@/api/overview/reports', () => ({ markReportRead: vi.fn(async () => undefined) }));
vi.mock('@/api/fleet/claudeAccounts', () => ({
  listClaudeAccounts: vi.fn(async () => ({ accounts: [] })),
  reloginClaudeAccount: vi.fn(),
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => undefined) }));
vi.mock('@/lib/eventRegistry', async (orig) => ({
  ...(await orig<typeof import('@/lib/eventRegistry')>()),
  typedListen: vi.fn(async () => () => undefined),
}));

import { useAthenaStore } from '../../athenaStore';
import { resetDecisionDeferrals } from '../decisionDeferral';
import { runDecisionOption } from '../resolveDecision';
import { buildDecisionQueueForTest } from '../useDecisionQueue';

function nudge(id: string, triggerKind: string): ProactiveMessage {
  return {
    id,
    triggerKind,
    triggerRef: `ref-${id}`,
    message: `nudge ${id}`,
    status: 'delivered',
    createdAt: '2026-10-18T10:00:00Z',
    deliveredAt: null,
    resolvedAt: null,
  } as ProactiveMessage;
}

async function pickOn(decisionId: string, optionKey: string) {
  const queue = await buildDecisionQueueForTest({ items: [], decide: vi.fn() });
  const d = queue.find((q) => q.id === decisionId)!;
  useAthenaStore.getState().setPendingDecision(d);
  await runDecisionOption(d.options.find((o) => o.key === optionKey)!);
  return useAthenaStore.getState();
}

beforeEach(() => {
  resetDecisionDeferrals();
  useAthenaStore.getState().clearPendingDecision();
  proactive.length = 0;
  proactive.push(nudge('m-1', 'message_attention'), nudge('c-1', 'credential_reauth'));
});

describe('orb nudge options reject on a failed write', () => {
  it.each([
    ['message:m-1', 'dismiss'],
    ['message:m-1', 'open'],
    ['message:m-1', 'mark_read'],
    ['credential:c-1', 'later'],
  ])('%s -> %s keeps the decision pending with its error', async (id, key) => {
    const s = await pickOn(id, key);
    expect(s.pendingDecision?.id).toBe(id);
    expect(s.decisionError).toBe('run-failed');
  });
});
