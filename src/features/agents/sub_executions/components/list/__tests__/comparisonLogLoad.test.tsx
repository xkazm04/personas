/**
 * The terminal-output diff must not re-fetch in a loop when the logs fail.
 *
 * `OutputDiffSection` fetched when `expanded && logLeft === null && logRight
 * === null && !loading`. A failed fetch leaves both logs null and flips
 * `loading` back to false, which re-arms that exact condition: the effect fired
 * again, the IPC failed again and another error toast was raised, for as long
 * as the section stayed open. A failure now settles into an inline error with
 * a retry, and only the retry fetches again.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) =>
    section === 'agents'
      ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
      : leaf(String(section)),
});
const tx = (s: unknown) => String(s);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx, language: 'en' }),
  getActiveTranslations: () => t,
}));

const getExecutionLogLines = vi.fn<(...a: unknown[]) => Promise<string[]>>();
vi.mock('@/api/agents/executions', () => ({
  getExecutionLogLines: (...a: unknown[]) => getExecutionLogLines(...a),
}));

const addToast = vi.fn();
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast }) }),
}));

import { OutputDiffSection } from '../ComparisonDiff';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OutputDiffSection log load failure', () => {
  it('fetches once and shows an inline retry instead of looping', async () => {
    getExecutionLogLines.mockRejectedValue(new Error('ipc down'));
    render(<OutputDiffSection leftId="a" rightId="b" personaId="p1" />);

    fireEvent.click(screen.getByRole('button', { name: /terminal_output_diff/ }));

    await waitFor(() => expect(addToast).toHaveBeenCalledTimes(1));
    // Let any re-armed effect run; a loop would keep calling the IPC.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(getExecutionLogLines).toHaveBeenCalledTimes(2); // left + right, once
    expect(addToast).toHaveBeenCalledTimes(1);
    expect(screen.getByText('executions.failed_to_load_logs')).toBeTruthy();

    getExecutionLogLines.mockResolvedValue(['line one']);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(getExecutionLogLines).toHaveBeenCalledTimes(4));
    await waitFor(() => expect(screen.getByText('line one')).toBeTruthy());
  });
});
