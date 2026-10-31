/**
 * A diff's most dangerous output is silence (diff-comparison / diff-honesty).
 *
 * `JsonDiffSection` set `[]` when the off-thread diff failed and rendered
 * "identical" for an empty list - the same word it showed while the job was
 * still pending. `OutputDiffSection` turned a failed line diff into
 * "No log data available". In both, a comparison that never ran read as a
 * comparison that found nothing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) =>
    section === 'agents'
      ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
      : leaf(String(section)),
});
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx: (s: unknown) => String(s), language: 'en' }),
  getActiveTranslations: () => t,
}));
vi.mock('@/lib/silentCatch', () => ({ silentCatch: () => () => {} }));
vi.mock('@/api/agents/executions', () => ({
  getExecutionLogLines: vi.fn(async () => ['a line']),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: vi.fn() }) }),
}));

const jsonJob = vi.fn();
const lineJob = vi.fn();
vi.mock('../../../libs/comparisonDiffWorkerClient', () => ({
  computeJsonDiffOffThread: (...a: unknown[]) => jsonJob(...a),
  computeLineDiffOffThread: (...a: unknown[]) => lineJob(...a),
}));

import { JsonDiffSection, OutputDiffSection } from '../ComparisonDiff';

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => { jsonJob.mockReset(); lineJob.mockReset(); });

describe('comparison diff failure and pending states', () => {
  it('does not call a pending JSON diff identical', async () => {
    jsonJob.mockReturnValue({ promise: new Promise(() => {}), cancel: () => {} });
    render(<JsonDiffSection label="input" leftData='{"a":1}' rightData='{"a":2}' />);
    await flush();
    expect(screen.queryByText('executions.identical')).toBeNull();
  });

  it('does not call a failed JSON diff identical', async () => {
    jsonJob.mockImplementation(() => ({ promise: Promise.reject(new Error('worker crashed')), cancel: () => {} }));
    render(<JsonDiffSection label="input" leftData='{"a":1}' rightData='{"a":2}' />);
    await flush();
    expect(screen.queryByText('executions.identical')).toBeNull();
    expect(screen.getByText('executions.diff_failed')).toBeTruthy();
  });

  it('does not report a failed line diff as missing log data', async () => {
    lineJob.mockImplementation(() => ({ promise: Promise.reject(new Error('worker crashed')), cancel: () => {} }));
    render(<OutputDiffSection leftId="l" rightId="r" personaId="p" />);
    fireEvent.click(screen.getByRole('button', { name: /terminal_output_diff/ }));
    await flush();
    await flush();
    expect(screen.queryByText('executions.no_log_data')).toBeNull();
    expect(screen.getByText('executions.diff_failed')).toBeTruthy();
  });
});
