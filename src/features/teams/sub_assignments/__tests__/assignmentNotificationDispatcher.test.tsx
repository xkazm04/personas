import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

type Handler = (e: { payload: { assignment_id: string; status: string; step_id: string | null } }) => void;
let handler: Handler | null = null;

vi.mock('@tauri-apps/api/event', () => ({
  listen: (_name: string, h: Handler) => {
    handler = h;
    return Promise.resolve(() => { handler = null; });
  },
}));

const notifyProcessComplete = vi.fn();
vi.mock('@/lib/notifications/notifyProcessComplete', () => ({
  notifyProcessComplete: (...a: unknown[]) => notifyProcessComplete(...a),
}));

const getTeamAssignmentDetail = vi.fn();
vi.mock('@/api/pipeline/assignments', () => ({
  getTeamAssignmentDetail: (...a: unknown[]) => getTeamAssignmentDetail(...a),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

import { useAssignmentNotificationDispatcher } from '../useAssignmentNotificationDispatcher';

const detail = {
  assignment: { id: 'a1', title: 'Ship the loader' },
  steps: [{ id: 's1', title: 'Write the ghost', status: 'failed', errorMessage: null }],
};

function emit(status: string, assignment_id = 'a1') {
  handler?.({ payload: { assignment_id, status, step_id: null } });
}

async function mount() {
  const hook = renderHook(() => useAssignmentNotificationDispatcher());
  await waitFor(() => expect(handler).not.toBeNull());
  return hook;
}

describe('useAssignmentNotificationDispatcher: terminal statuses are news too', () => {
  beforeEach(() => {
    handler = null;
    notifyProcessComplete.mockClear();
    getTeamAssignmentDetail.mockReset().mockResolvedValue(detail);
  });

  it('completed produces one success notification naming the assignment', async () => {
    await mount();
    emit('completed');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));

    const opts = notifyProcessComplete.mock.calls[0][0];
    expect(opts.success).toBe(true);
    expect(opts.processType).toBe('team-assignment-completed');
    expect(opts.summary).toContain('Ship the loader');
  });

  it('failed produces one failure notification naming the failed step', async () => {
    await mount();
    emit('failed');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));

    const opts = notifyProcessComplete.mock.calls[0][0];
    expect(opts.success).toBe(false);
    expect(opts.processType).toBe('team-assignment-failed');
    expect(opts.summary).toContain('Write the ghost');
  });

  it('aborted produces one failure notification', async () => {
    await mount();
    emit('aborted');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    expect(notifyProcessComplete.mock.calls[0][0].success).toBe(false);
  });

  it('a duplicate tick for the same terminal status is suppressed', async () => {
    await mount();
    emit('completed');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    emit('completed');
    emit('completed');
    await waitFor(() => expect(getTeamAssignmentDetail).toHaveBeenCalledTimes(1));
    expect(notifyProcessComplete).toHaveBeenCalledTimes(1);
  });

  it('awaiting_review still notifies exactly once, as before', async () => {
    await mount();
    emit('awaiting_review');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    emit('awaiting_review');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    expect(notifyProcessComplete.mock.calls[0][0].processType).toBe('team-assignment-failed');
  });

  it('an in-flight status re-arms both buckets', async () => {
    await mount();
    emit('completed');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    emit('running');
    emit('completed');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(2));
  });

  it('a detail fetch failure notifies nothing and does not permanently suppress', async () => {
    getTeamAssignmentDetail.mockRejectedValueOnce(new Error('ipc down'));
    await mount();
    emit('completed');
    await waitFor(() => expect(getTeamAssignmentDetail).toHaveBeenCalledTimes(1));
    expect(notifyProcessComplete).not.toHaveBeenCalled();

    emit('completed');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
  });
});
