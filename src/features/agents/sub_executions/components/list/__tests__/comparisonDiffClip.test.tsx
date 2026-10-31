/**
 * The terminal diff reads the first 500 lines of each run. When either side
 * comes back full, the diff is a prefix of the log and must say so; a diff
 * that saw the whole log must not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

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
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: vi.fn() }) }),
}));

import { OutputDiffSection } from '../ComparisonDiff';

const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);

async function open() {
  render(<OutputDiffSection leftId="a" rightId="b" personaId="p1" />);
  fireEvent.click(screen.getByRole('button', { name: /terminal_output_diff/ }));
  await waitFor(() => expect(screen.getByText('line 0')).toBeTruthy());
}

beforeEach(() => vi.clearAllMocks());

describe('OutputDiffSection scope notice', () => {
  it('says the diff is a prefix when a side returns a full page', async () => {
    getExecutionLogLines.mockResolvedValueOnce(lines(500)).mockResolvedValueOnce(lines(10));
    await open();
    expect(screen.getByText('executions.diff_clipped')).toBeTruthy();
  });

  it('stays silent when both logs were read to the end', async () => {
    getExecutionLogLines.mockResolvedValue(lines(300));
    await open();
    expect(screen.queryByText('executions.diff_clipped')).toBeNull();
  });
});
