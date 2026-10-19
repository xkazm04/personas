/**
 * The header badge and the approvals panel read ONE held-fire queue.
 *
 * Each used to call its own usePendingTriggerFires, so the Triggers page ran
 * two 20 s pollers and held two copies of the queue: resolving a fire in the
 * panel dropped it there while the badge kept counting it until its own next
 * poll. The hook's doc claimed the two "can never disagree about the count".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import csTriggers from '@/i18n/section-locales/cs/triggers.json';
import enCommon from '@/i18n/section-locales/en/common.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { triggers: csTriggers, common: enCommon },
    tx: (s: string, vars?: Record<string, unknown>) =>
      s.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars?.[k] ?? '')),
    language: 'cs',
  }),
}));

const invoke = vi.fn();
vi.mock('@/lib/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauriInvoke')>()),
  invokeWithTimeout: (cmd: string, args?: unknown) => invoke(cmd, args),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: { id: string; name: string }[] }) => unknown) =>
    sel({ personas: [{ id: 'p1', name: 'Scout' }] }),
}));

const { PendingApprovalsBadge } = await import('../../sub_triggers/PendingApprovalsBadge');
const { PendingTriggerApprovals } = await import('../../sub_triggers/PendingTriggerApprovals');
const { __resetPendingTriggerFiresForTests } = await import('../usePendingTriggerFires');

const fire = (id: string, triggerId: string) => ({
  id, trigger_id: triggerId, persona_id: 'p1', event_type: 'schedule_fired',
  payload: null, use_case_id: null, status: 'pending',
  created_at: '2026-10-18T09:00:00Z', resolved_at: null,
});

function calls(cmd: string) {
  return invoke.mock.calls.filter(([c]) => c === cmd).length;
}

describe('held trigger fires: one queue for badge and panel', () => {
  let queue: ReturnType<typeof fire>[];
  beforeEach(() => {
    __resetPendingTriggerFiresForTests();
    invoke.mockReset();
    queue = [fire('f1', 't1'), fire('f2', 't-gone')];
    invoke.mockImplementation((cmd: string, args?: { id?: string }) => {
      if (cmd === 'list_pending_trigger_fires') return Promise.resolve(queue);
      // t-gone is deliberately absent from the roster (deleted mid-poll).
      if (cmd === 'list_all_triggers') return Promise.resolve([{ id: 't1', trigger_type: 'schedule' }]);
      if (cmd === 'resolve_pending_trigger_fire') {
        queue = queue.filter((f) => f.id !== args?.id);
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
  });
  afterEach(() => { __resetPendingTriggerFiresForTests(); });

  it('polls once for both readers and the badge drops a resolved fire at once', async () => {
    render(
      <>
        <PendingApprovalsBadge />
        <PendingTriggerApprovals />
      </>,
    );
    const badge = await screen.findByTestId('pending-approvals-badge');
    await waitFor(() => expect(badge.textContent).toContain('2'));
    expect(calls('list_pending_trigger_fires')).toBe(1);

    fireEvent.click(screen.getAllByRole('button', { name: csTriggers.pending_approval.discard })[0]!);
    await waitFor(() => expect(screen.getByTestId('pending-approvals-badge').textContent).toContain('1'));
    // No second poll was needed to bring the badge in line.
    expect(calls('list_pending_trigger_fires')).toBe(1);
  });

  it('a fire whose trigger the roster lacks does not loop the roster fetch', async () => {
    render(<PendingTriggerApprovals />);
    await screen.findByTestId('pending-trigger-approvals');
    await new Promise((r) => setTimeout(r, 50));
    expect(calls('list_all_triggers')).toBe(1);
  });
});
