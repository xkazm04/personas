import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';

import en from '@/i18n/locales/en.json';
import { useSystemStore } from '@/stores/systemStore';

// One page, one data hook: the assignment matrix takes its credential list from
// the page's useLlmPinpoints instead of mounting a second copy, which re-ran
// listCredentials and the paged tool fetch (external HTTP) per tab open.

const listCredentials = vi.hoisted(() => vi.fn());
const fetchLlmPinpointsPaged = vi.hoisted(() => vi.fn());
vi.mock('@/api/vault/credentials', () => ({ listCredentials }));
vi.mock('@/api/devTools/useCases', () => ({ listUseCases: vi.fn(async () => []), createUseCase: vi.fn() }));
vi.mock('@/api/devTools/devTools', () => ({ updateProject: vi.fn() }));
vi.mock('../llmTracingAdapters', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../llmTracingAdapters')>()),
  fetchLlmPinpointsPaged,
}));
vi.mock('@/i18n/useTranslation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/i18n/useTranslation')>();
  return { ...actual, useTranslation: () => ({ t: en, tx: actual.interpolate, language: 'en' }) };
});

import LlmOverviewPage from '../LlmOverviewPage';

const cred = { id: 'c-llm', name: 'Tracklight', serviceType: 'tracklight' };
const project = { id: 'p-llm-mounts', name: 'Alpha', root_path: 'C:/alpha', llm_tracking_credential_id: 'c-llm' };

beforeEach(() => {
  vi.clearAllMocks();
  listCredentials.mockResolvedValue([cred]);
  fetchLlmPinpointsPaged.mockResolvedValue({ rows: [], truncated: false });
  useSystemStore.setState({
    projects: [project] as unknown as ReturnType<typeof useSystemStore.getState>['projects'],
    activeProjectId: project.id,
  });
});

describe('LLM Overview mounts its data hook once', () => {
  it('reads the vault and the tool once per page open', async () => {
    render(<LlmOverviewPage />);
    await waitFor(() => expect(fetchLlmPinpointsPaged).toHaveBeenCalled());
    // Let any second instance catch up before counting.
    await new Promise((r) => setTimeout(r, 50));
    expect(listCredentials).toHaveBeenCalledTimes(1);
    expect(fetchLlmPinpointsPaged).toHaveBeenCalledTimes(1);
  });
});
