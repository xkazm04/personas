/**
 * A held fire names its trigger in the user's language.
 *
 * The approvals row printed the raw `trigger_type` token under a CSS
 * `capitalize`, so a held file-watcher fire read "File_watcher" in every
 * locale while triggers.type_* sat translated. It now resolves through
 * getTriggerTypeLabel, the same door the add-trigger picker uses.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

const invoke = vi.fn((cmd: string) => {
  if (cmd === 'list_pending_trigger_fires') {
    return Promise.resolve([{
      id: 'f1', trigger_id: 't1', persona_id: 'p1', event_type: 'file_changed',
      payload: null, use_case_id: null, status: 'pending',
      created_at: '2026-10-18T09:00:00Z', resolved_at: null,
    }]);
  }
  if (cmd === 'list_all_triggers') return Promise.resolve([{ id: 't1', trigger_type: 'file_watcher' }]);
  return Promise.resolve(null);
});
vi.mock('@/lib/tauriInvoke', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauriInvoke')>()),
  invokeWithTimeout: (cmd: string) => invoke(cmd),
}));

vi.mock('@/stores/agentStore', () => ({
  useAgentStore: (sel: (s: { personas: { id: string; name: string }[] }) => unknown) =>
    sel({ personas: [{ id: 'p1', name: 'Scout' }] }),
}));

const { PendingTriggerApprovals } = await import('../PendingTriggerApprovals');
const { __resetPendingTriggerFiresForTests } = await import('../../hooks/usePendingTriggerFires');

describe('held fire trigger type label', () => {
  afterEach(() => { __resetPendingTriggerFiresForTests(); });

  it('renders the translated type, never the raw token', async () => {
    render(<PendingTriggerApprovals />);
    await screen.findByText(csTriggers.type_file_watcher);
    expect(screen.queryByText('file_watcher')).toBeNull();
  });
});
