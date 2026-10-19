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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TERMINAL_STATUSES, useAssignmentNotificationDispatcher } from '../useAssignmentNotificationDispatcher';

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

  it('done (the backend success status) produces one success notification naming the assignment', async () => {
    await mount();
    emit('done');
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
    emit('done');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    emit('done');
    emit('done');
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
    emit('done');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
    emit('running');
    emit('done');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(2));
  });

  it('a detail fetch failure notifies nothing and does not permanently suppress', async () => {
    getTeamAssignmentDetail.mockRejectedValueOnce(new Error('ipc down'));
    await mount();
    emit('done');
    await waitFor(() => expect(getTeamAssignmentDetail).toHaveBeenCalledTimes(1));
    expect(notifyProcessComplete).not.toHaveBeenCalled();

    emit('done');
    await waitFor(() => expect(notifyProcessComplete).toHaveBeenCalledTimes(1));
  });
});

describe('TERMINAL_STATUSES speaks the backend vocabulary', () => {
  const root = resolve(__dirname, '../../../../..');
  const migration = readFileSync(resolve(root, 'src-tauri/db/src/migrations/incremental/c02_dev_goals_and_kpis.rs'), 'utf8');
  const orchestrator = readFileSync(resolve(root, 'src-tauri/src/engine/team_assignment_orchestrator.rs'), 'utf8');

  it('every terminal status is one the team_assignments CHECK allows', () => {
    const check = migration.match(/CHECK\(status IN \(('queued'[^)]*)\)\)/);
    expect(check).not.toBeNull();
    const allowed = new Set([...check![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    for (const s of TERMINAL_STATUSES) expect(allowed).toContain(s);
  });

  it('the orchestrator final statuses are all terminal here', () => {
    const finals = orchestrator.match(/let final_status = if [^{]*\{\s*"([a-z_]+)"\s*\} else \{\s*"([a-z_]+)"\s*\}/);
    expect(finals).not.toBeNull();
    expect(TERMINAL_STATUSES.has(finals![1]!)).toBe(true);
    expect(TERMINAL_STATUSES.has(finals![2]!)).toBe(true);
    expect(orchestrator).toContain('emit_progress(&app, &assignment_id, "aborted", None)');
    expect(TERMINAL_STATUSES.has('aborted')).toBe(true);
  });
});
