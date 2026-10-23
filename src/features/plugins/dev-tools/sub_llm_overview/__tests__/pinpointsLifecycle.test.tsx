import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import type { Translations } from '@/i18n/useTranslation';
import { resolveErrorTranslated } from '@/i18n/useTranslatedError';
import { useSystemStore } from '@/stores/systemStore';

import type { LlmPinpoint } from '../llmTracingAdapters';

// The Observability hooks against the real order of events: a reply for an
// earlier window or project lands late, a project switch lands on a project
// whose read fails, and an IPC failure arrives as an AppError object.

const listCredentials = vi.hoisted(() => vi.fn());
const fetchLlmPinpointsPaged = vi.hoisted(() => vi.fn());
const fetchSentryStats = vi.hoisted(() => vi.fn());
vi.mock('@/api/vault/credentials', () => ({ listCredentials }));
vi.mock('@/api/devTools/useCases', () => ({ listUseCases: vi.fn(async () => []), createUseCase: vi.fn() }));
vi.mock('@/api/devTools/devTools', () => ({ updateProject: vi.fn() }));
vi.mock('../llmTracingAdapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llmTracingAdapters')>()),
  fetchLlmPinpointsPaged,
}));
vi.mock('../../sub_overview/adapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../sub_overview/adapters')>()),
  fetchSentryStats,
  fetchSentryOrgs: vi.fn(async () => []),
}));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import LlmOverviewPage from '../LlmOverviewPage';
import { useLlmPinpoints } from '../useLlmPinpoints';
import { useMonitoringPinpoints } from '../useMonitoringPinpoints';

type Projects = ReturnType<typeof useSystemStore.getState>['projects'];
const llmCred = { id: 'c-llm', name: 'Tracklight', serviceType: 'tracklight' };
const monCred = { id: 'c-mon', name: 'Sentry', serviceType: 'sentry' };
const proj = (id: string) => ({
  id, name: id, root_path: `C:/${id}`,
  llm_tracking_credential_id: 'c-llm', monitoring_credential_id: 'c-mon', monitoring_project_slug: `org/${id}`,
});
const row = (useCaseName: string): LlmPinpoint => ({
  useCaseName, provider: 'anthropic', model: 'm', calls: 1, inputTokens: 1, outputTokens: 1, totalCostUsd: 1, costIsEstimate: false,
});
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
const appError = { error: 'Request timed out after 30s', kind: 'timeout' };

beforeEach(() => {
  vi.clearAllMocks();
  listCredentials.mockResolvedValue([llmCred, monCred]);
  useSystemStore.setState({ projects: [proj('p-a'), proj('p-b')] as unknown as Projects, activeProjectId: 'p-a' });
});

describe('useLlmPinpoints', () => {
  it('keeps the newest window when an older reply lands last', async () => {
    const slow = deferred<{ rows: LlmPinpoint[]; truncated: boolean }>();
    fetchLlmPinpointsPaged.mockImplementation(async (_s: string, _c: string, w: string) =>
      (w === '30d' ? slow.promise : { rows: [row('seven-day')], truncated: false }));
    const { result } = renderHook(() => useLlmPinpoints());
    await waitFor(() => expect(fetchLlmPinpointsPaged).toHaveBeenCalledTimes(1));

    act(() => result.current.setTimeWindow('7d'));
    await waitFor(() => expect(result.current.pinpoints.map((p) => p.useCaseName)).toEqual(['seven-day']));
    await act(async () => { slow.resolve({ rows: [row('thirty-day')], truncated: false }); });
    expect(result.current.pinpoints.map((p) => p.useCaseName)).toEqual(['seven-day']);
    expect(result.current.timeWindow).toBe('7d');
  });

  it('never shows the previous project rows as the new project', async () => {
    fetchLlmPinpointsPaged.mockImplementation(async (_s: string, _c: string, _w: string) => {
      if (useSystemStore.getState().activeProjectId === 'p-a') return { rows: [row('alpha-only')], truncated: false };
      throw appError;
    });
    const { result } = renderHook(() => useLlmPinpoints());
    await waitFor(() => expect(result.current.pinpoints).toHaveLength(1));

    act(() => { useSystemStore.setState({ activeProjectId: 'p-b' }); });
    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.pinpoints).toEqual([]);
  });
});

describe('useMonitoringPinpoints', () => {
  it('drops a stale project reply and clears the previous tiles', async () => {
    const slowA = deferred<unknown>();
    fetchSentryStats.mockImplementation((_c: string, _o: string, p: string) =>
      (p === 'p-a' ? slowA.promise : Promise.reject(appError)));
    const { result } = renderHook(() => useMonitoringPinpoints());
    await waitFor(() => expect(fetchSentryStats).toHaveBeenCalledTimes(1));

    act(() => { useSystemStore.setState({ activeProjectId: 'p-b' }); });
    await waitFor(() => expect(result.current.state).toBe('error'));
    await act(async () => { slowA.resolve({ unresolvedIssues: 9 }); });
    expect(result.current.state).toBe('error');
    expect(result.current.stats).toBeNull();
  });
});

describe('LLM Overview error state', () => {
  it('reads the AppError envelope instead of printing [object Object]', async () => {
    fetchLlmPinpointsPaged.mockRejectedValue(appError);
    useSystemStore.setState({ activeProjectId: 'p-b' });
    render(<LlmOverviewPage />);
    await screen.findByText(en.plugins.dev_tools.llm_error_title);
    expect(screen.queryByText('[object Object]')).toBeNull();
    expect(screen.getByText(resolveErrorTranslated(en as unknown as Translations, appError.error).message)).toBeTruthy();
  });
});
