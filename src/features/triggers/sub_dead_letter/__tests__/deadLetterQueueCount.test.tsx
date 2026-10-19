/**
 * The dead-letter header states the queue's real size.
 *
 * The list read is a 100-row window, and its length was printed as the queue's
 * count: a 4,000-event backlog read "(100 events)" (in English, in every
 * locale). The tab now reads count_dead_letter_events beside the window and
 * says "Showing 100 of 4000" when the window is full.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import csTriggers from '@/i18n/section-locales/cs/triggers.json';
import enCommon from '@/i18n/section-locales/en/common.json';
import enEmptyStates from '@/i18n/section-locales/en/empty_states.json';

vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({
    t: { triggers: csTriggers, common: enCommon, empty_states: enEmptyStates },
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

describe('DeadLetterTab queue size', () => {
  beforeEach(() => { invoke.mockReset(); });

  it('says the queue holds 4,000 when the 100-row window is full, not "(100 events)"', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_dead_letter_events') return Promise.resolve(Array.from({ length: 100 }, (_, i) => evt(i)));
      if (cmd === 'count_dead_letter_events') return Promise.resolve(4000);
      if (cmd === 'get_dead_letter_config') return Promise.resolve({ maxManualRetries: 5 });
      return Promise.resolve(null);
    });
    render(<DeadLetterTab />);
    await screen.findByText(`(${csTriggers.dead_letter_group_plural.replace('{count}', '4000')})`);
    expect(screen.getByText(`· ${csTriggers.dead_letter_filtered_summary.replace('{visible}', '100').replace('{total}', '4000')}`)).toBeTruthy();
  });

  it('a refused count falls back to the rows on screen', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_dead_letter_events') return Promise.resolve([evt(1), evt(2)]);
      if (cmd === 'count_dead_letter_events') return Promise.reject({ error: 'x', kind: 'database' });
      if (cmd === 'get_dead_letter_config') return Promise.resolve({ maxManualRetries: 5 });
      return Promise.resolve(null);
    });
    render(<DeadLetterTab />);
    await screen.findByText(`(${csTriggers.dead_letter_group_plural.replace('{count}', '2')})`);
    await waitFor(() => expect(screen.queryByText(csTriggers.dead_letter_load_failed_title)).toBeNull());
  });
});
