/**
 * First-run "Try it" must seed the runner with the persona's own declared
 * sample input, not an unconditional "{}". Drives the real ExecutionList empty
 * state and reads what reaches systemStore.setRerunInputData.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

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

vi.mock('@/api/agents/executions', () => ({
  listExecutionsSummary: vi.fn(async () => [] as ExecutionListItem[]),
  getExecution: vi.fn(async () => ({})),
  listActiveChains: vi.fn(async () => []),
  executePersona: vi.fn(),
}));
vi.mock('@/api/overview/healing', () => ({ getRetryChain: vi.fn(async () => []) }));
vi.mock('@/api/agents/annotations', () => ({
  listPersonaAnnotations: vi.fn(async () => []),
  addAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));
vi.mock('@/stores/selectors/personaSelectors', () => ({
  useSelectedUseCases: () => [
    { id: 'u1', title: 'Digest', description: '', sample_input: { topic: 'weekly sales' } },
  ],
}));

const agentState = {
  selectedPersona: { id: 'p1', name: 'Ada', color: '#6366f1' },
  executions: [] as ExecutionListItem[],
  executionsLoading: false,
  executionsError: false,
  executionsServerCount: {} as Record<string, number>,
  isExecuting: false,
  fetchExecutions: vi.fn(async () => {}),
};
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: (s: typeof agentState) => unknown) => (selector ? selector(agentState) : agentState),
    { getState: () => agentState },
  ),
}));

const setRerunInputData = vi.fn();
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: { setRerunInputData: typeof setRerunInputData }) => unknown) =>
      (selector ? selector({ setRerunInputData }) : { setRerunInputData }),
    { getState: () => ({ setRerunInputData }) },
  ),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: vi.fn() }) }),
}));

import { ExecutionList } from '../ExecutionList';

beforeEach(() => vi.clearAllMocks());

describe('ExecutionList first-run Try it', () => {
  it("prefills the runner with the persona's sample input, not {}", () => {
    render(<ExecutionList />);
    fireEvent.click(screen.getByText('executions.try_it_now'));
    expect(setRerunInputData).toHaveBeenCalledTimes(1);
    const seeded = setRerunInputData.mock.calls[0]![0] as string;
    expect(seeded).not.toBe('{}');
    expect(JSON.parse(seeded)).toEqual({ topic: 'weekly sales' });
  });
});
