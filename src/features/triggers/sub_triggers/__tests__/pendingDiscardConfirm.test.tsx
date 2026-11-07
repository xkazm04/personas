/**
 * A held webhook cannot be asked for again, and the X that drops it sits beside
 * Approve & run. One click used to drop the fire with no confirm and no message:
 * the row just vanished. A discard is now deliberate (a confirm first) and both
 * outcomes say what happened.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import enCommon from '@/i18n/section-locales/en/common.json';
import enTriggers from '@/i18n/section-locales/en/triggers.json';

const api = vi.hoisted(() => ({
  listPendingTriggerFires: vi.fn(),
  listAllTriggers: vi.fn(),
  resolvePendingTriggerFire: vi.fn(),
}));
vi.mock('@/api/pipeline/triggers', () => api);

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: { id: string; name: string }[] }) => unknown) =>
    sel({ personas: [{ id: 'p1', name: 'Scout' }] }),
}));

import { PendingTriggerApprovals } from '../PendingTriggerApprovals';
import { __resetPendingTriggerFiresForTests } from '../../hooks/usePendingTriggerFires';
import { useToastStore } from '@/stores/toastStore';

const p = enTriggers.pending_approval;
const FIRE = {
  id: 'f1', trigger_id: 't1', persona_id: 'p1', event_type: 'stripe_payment_failed',
  payload: null, use_case_id: null, status: 'pending',
  created_at: '2026-10-18T09:00:00Z', resolved_at: null,
};

const openRow = () => screen.findByText(FIRE.event_type);
const pressX = () => fireEvent.click(screen.getByRole('button', { name: p.discard }));
const toasts = (type: string) => useToastStore.getState().toasts.filter((x) => x.type === type);

describe('discarding a held fire', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    api.listPendingTriggerFires.mockReset().mockResolvedValue([FIRE]);
    api.listAllTriggers.mockReset().mockResolvedValue([]);
    api.resolvePendingTriggerFire.mockReset().mockResolvedValue({ ...FIRE, status: 'resolved' });
  });
  // Unmount first: the hook's module state counts subscribers, and a reset before
  // the automatic cleanup leaves the count at -1, so the next mount never polls.
  afterEach(() => { cleanup(); __resetPendingTriggerFiresForTests(); });

  it('pressing the X asks first and resolves nothing', async () => {
    render(<PendingTriggerApprovals />);
    await openRow();
    pressX();

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: p.discard })).toBeInTheDocument();
    expect(within(dialog).getByText(enCommon.confirm_destructive_cannot_undo)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: enCommon.confirm_destructive_discard })).toBeInTheDocument();
    expect(api.resolvePendingTriggerFire).not.toHaveBeenCalled();
    expect(screen.getByText(FIRE.event_type)).toBeInTheDocument();
  });

  it('confirming discards the fire, drops the row and says so', async () => {
    render(<PendingTriggerApprovals />);
    await openRow();
    pressX();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: enCommon.confirm_destructive_discard }));

    await waitFor(() => expect(api.resolvePendingTriggerFire).toHaveBeenCalledWith(FIRE.id, false));
    expect(api.resolvePendingTriggerFire).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText(FIRE.event_type)).toBeNull());
    await waitFor(() => expect(toasts('success').map((x) => x.message)).toEqual([p.discarded]));
  });

  it('cancelling keeps the row and calls nothing', async () => {
    render(<PendingTriggerApprovals />);
    await openRow();
    pressX();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: enCommon.cancel }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(api.resolvePendingTriggerFire).not.toHaveBeenCalled();
    expect(screen.getByText(FIRE.event_type)).toBeInTheDocument();
    expect(toasts('success')).toEqual([]);
  });

  it('a failed discard shows no success message and keeps the row', async () => {
    api.resolvePendingTriggerFire.mockRejectedValue({ error: 'Fire is locked by another resolve', kind: 'Conflict' });
    render(<PendingTriggerApprovals />);
    await openRow();
    pressX();
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: enCommon.confirm_destructive_discard }));

    await waitFor(() => expect(api.resolvePendingTriggerFire).toHaveBeenCalledWith(FIRE.id, false));
    await waitFor(() => expect(toasts('error')).toHaveLength(1));
    expect(toasts('success')).toEqual([]);
    expect(screen.getByText(FIRE.event_type)).toBeInTheDocument();
  });
});

describe('approving a held fire', () => {
  beforeAll(async () => {
    const { preloadSectionsAsync } = await import('@/i18n/useTranslation');
    await preloadSectionsAsync('en', ['triggers']);
  });

  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
    api.listPendingTriggerFires.mockReset().mockResolvedValue([FIRE]);
    api.listAllTriggers.mockReset().mockResolvedValue([]);
    api.resolvePendingTriggerFire.mockReset().mockResolvedValue({ ...FIRE, status: 'resolved' });
  });
  // Unmount first: the hook's module state counts subscribers, and a reset before
  // the automatic cleanup leaves the count at -1, so the next mount never polls.
  afterEach(() => { cleanup(); __resetPendingTriggerFiresForTests(); });

  it('runs without a confirm, drops the row and says so', async () => {
    render(<PendingTriggerApprovals />);
    await openRow();
    fireEvent.click(screen.getByRole('button', { name: p.run_now }));

    await waitFor(() => expect(api.resolvePendingTriggerFire).toHaveBeenCalledWith(FIRE.id, true));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(screen.queryByText(FIRE.event_type)).toBeNull());
    await waitFor(() => expect(toasts('success').map((x) => x.message)).toEqual([p.approved]));
  });

  it('a failed approve shows no success message and keeps the row', async () => {
    api.resolvePendingTriggerFire.mockRejectedValue({ error: 'Fire is locked by another resolve', kind: 'Conflict' });
    render(<PendingTriggerApprovals />);
    await openRow();
    fireEvent.click(screen.getByRole('button', { name: p.run_now }));

    await waitFor(() => expect(toasts('error')).toHaveLength(1));
    expect(toasts('success')).toEqual([]);
    expect(screen.getByText(FIRE.event_type)).toBeInTheDocument();
  });
});
