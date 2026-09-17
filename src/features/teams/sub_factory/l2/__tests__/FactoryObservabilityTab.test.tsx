import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { FactoryL2Data } from '../factoryL2Data';

// Bypass IPC token wait.
(globalThis as Record<string, unknown>).__IPC_TOKEN = 'test-token';

const fetchLlmPinpoints = vi.fn();
const fetchSentryUnresolvedIssues = vi.fn();

vi.mock('@/features/plugins/dev-tools/sub_llm_overview/llmTracingAdapters', () => ({
  fetchLlmPinpoints: (...a: unknown[]) => fetchLlmPinpoints(...a),
  hasLiveAdapter: () => true,
}));
vi.mock('@/features/plugins/dev-tools/sub_overview/adapters', () => ({
  fetchSentryUnresolvedIssues: (...a: unknown[]) => fetchSentryUnresolvedIssues(...a),
  splitSentrySlug: (s: string | null) => (s ? s.split('/') : [null, null]),
}));
vi.mock('@/stores/vaultStore', () => ({
  useVaultStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ credentials: [{ id: 'c1', serviceType: 'langfuse' }] }),
}));

import en from '@/i18n/locales/en.json';
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t: en, tx: (s: string) => s }),
}));

const data = {
  llmWired: true,
  monitoringWired: true,
  project: {
    llm_tracking_credential_id: 'c1',
    monitoring_credential_id: 'c1',
    monitoring_project_slug: 'org/proj',
  },
} as unknown as FactoryL2Data;

import { FactoryObservabilityTab } from '../FactoryObservabilityTab';

const EMPTY_LLM = 'No traced LLM calls in the last 30 days.';
const CLEAR_SENTRY = 'No unresolved issues';

describe('FactoryObservabilityTab: a throw is not an empty result', () => {
  beforeEach(() => {
    fetchLlmPinpoints.mockReset();
    fetchSentryUnresolvedIssues.mockReset();
  });

  it('a rejecting adapter renders a retry, never the empty-success copy', async () => {
    fetchLlmPinpoints.mockRejectedValue(new Error('adapter down'));
    fetchSentryUnresolvedIssues.mockRejectedValue(new Error('sentry down'));
    render(<FactoryObservabilityTab data={data} />);

    await waitFor(() => expect(screen.getAllByTestId('observability-retry')).toHaveLength(2));
    expect(screen.queryByText(EMPTY_LLM)).toBeNull();
    expect(screen.queryByText(new RegExp(CLEAR_SENTRY))).toBeNull();
  });

  it('a 200 with no rows still renders the empty-success copy', async () => {
    fetchLlmPinpoints.mockResolvedValue([]);
    fetchSentryUnresolvedIssues.mockResolvedValue([]);
    render(<FactoryObservabilityTab data={data} />);

    await waitFor(() => expect(screen.getByText(EMPTY_LLM)).toBeTruthy());
    expect(screen.getByText(new RegExp(CLEAR_SENTRY))).toBeTruthy();
    expect(screen.queryByTestId('observability-retry')).toBeNull();
  });

  it('a 200 with rows renders them', async () => {
    fetchLlmPinpoints.mockResolvedValue([
      { useCaseName: 'triage', model: 'm', totalCostUsd: 3, calls: 2 },
    ]);
    fetchSentryUnresolvedIssues.mockResolvedValue([
      { title: 'TypeError: boom', culprit: 'app.ts', count: 7 },
    ]);
    render(<FactoryObservabilityTab data={data} />);

    await waitFor(() => expect(screen.getByText('triage')).toBeTruthy());
    expect(screen.getByText('TypeError: boom')).toBeTruthy();
    expect(screen.queryByTestId('observability-retry')).toBeNull();
  });

  it('retry re-runs the adapter and recovers', async () => {
    fetchLlmPinpoints.mockRejectedValueOnce(new Error('adapter down')).mockResolvedValue([]);
    fetchSentryUnresolvedIssues.mockResolvedValue([]);
    render(<FactoryObservabilityTab data={data} />);

    await waitFor(() => expect(screen.getAllByTestId('observability-retry')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('observability-retry'));
    await waitFor(() => expect(screen.getByText(EMPTY_LLM)).toBeTruthy());
    expect(fetchLlmPinpoints).toHaveBeenCalledTimes(2);
  });
});
