/**
 * Discarding one dead-lettered event asks in the user's language.
 *
 * The single-row confirm was authored as English literals ("Discard Event",
 * "This dead-letter event will be permanently discarded.", "Discard", "Type")
 * while common.confirm_destructive_discard_event / _warning / _discard sat
 * translated in 14 locales with zero readers.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import csTriggers from '@/i18n/section-locales/cs/triggers.json';
import csCommon from '@/i18n/section-locales/cs/common.json';
import enCommon from '@/i18n/section-locales/en/common.json';
import enEmptyStates from '@/i18n/section-locales/en/empty_states.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { triggers: csTriggers, common: { ...enCommon, ...csCommon }, empty_states: enEmptyStates },
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

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

const { DeadLetterTab } = await import('../DeadLetterTab');


const evt = (i: number) => ({
  id: `e${i}`, project_id: 'default', event_type: 'webhook_received', source_type: 'webhook',
  source_id: null, target_persona_id: null, payload: null, status: 'dead_letter',
  error_message: 'boom', processed_at: '2026-10-18T09:00:00Z', created_at: '2026-10-18T09:00:00Z',
  use_case_id: null, retry_count: 0,
});

describe('DeadLetterTab single discard confirm', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('reads its copy from the catalog', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_dead_letter_events') return Promise.resolve([evt(1)]);
      if (cmd === 'count_dead_letter_events') return Promise.resolve(1);
      if (cmd === 'get_dead_letter_config') return Promise.resolve({ maxManualRetries: 5 });
      return Promise.resolve(null);
    });
    render(<DeadLetterTab />);
    const discard = await screen.findAllByRole('button', { name: csTriggers.dead_letter_discard });
    fireEvent.click(discard[0]!);
    await screen.findByText(csCommon.confirm_destructive_discard_event);
    expect(screen.getByText(csCommon.confirm_destructive_discard_event_warning)).toBeTruthy();
    expect(screen.queryByText('Discard Event')).toBeNull();
    expect(screen.queryByText('This dead-letter event will be permanently discarded.')).toBeNull();
  });
});
