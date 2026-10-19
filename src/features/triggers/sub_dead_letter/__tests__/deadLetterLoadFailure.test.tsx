/**
 * A refused dead-letter read is not an empty queue.
 *
 * The tab used to swallow a failed `list_dead_letter_events` into an English
 * toast and then render the empty state over it: "No dead-lettered events /
 * All events processed successfully" - a clean bill of health for a queue
 * nobody had looked at. It now renders a load-failed state with a retry, and
 * the failure toast goes through toastCatch instead of an English literal.
 * Rendered against the Czech catalog so an English literal cannot pass.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

const toastCatch = vi.fn(() => () => {});
vi.mock('@/lib/silentCatch', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/silentCatch')>()),
  toastCatch: (...a: unknown[]) => toastCatch(...a),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: (sel: (s: { addToast: typeof addToast }) => unknown) => sel({ addToast }),
}));

const { DeadLetterTab } = await import('../DeadLetterTab');

const appError = { error: 'Database error: disk I/O error', kind: 'database' };

describe('DeadLetterTab load failure', () => {
  beforeEach(() => {
    invoke.mockReset();
    toastCatch.mockClear();
    addToast.mockClear();
  });

  it('renders a load-failed state, not "all events processed", when the read is refused', async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_dead_letter_events') return Promise.reject(appError);
      if (cmd === 'get_dead_letter_config') return Promise.resolve({ maxManualRetries: 5 });
      return Promise.resolve(null);
    });
    render(<DeadLetterTab />);
    await screen.findByText(csTriggers.dead_letter_load_failed_title);
    expect(screen.queryByText(csTriggers.no_dead_letters)).toBeNull();
    expect(screen.queryByText(csTriggers.all_events_processed)).toBeNull();
    expect(toastCatch).toHaveBeenCalledWith('DeadLetterTab:listDeadLetterEvents');
    expect(addToast).not.toHaveBeenCalled();
  });

  it('retry re-reads the queue and an empty answer then reads as empty', async () => {
    let fail = true;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === 'list_dead_letter_events') return fail ? Promise.reject(appError) : Promise.resolve([]);
      if (cmd === 'get_dead_letter_config') return Promise.resolve({ maxManualRetries: 5 });
      return Promise.resolve(null);
    });
    render(<DeadLetterTab />);
    await screen.findByText(csTriggers.dead_letter_load_failed_title);
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: enCommon.retry }));
    await screen.findByText(csTriggers.no_dead_letters);
    await waitFor(() => expect(screen.queryByText(csTriggers.dead_letter_load_failed_title)).toBeNull());
  });
});
