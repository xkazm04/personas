/**
 * THE EXECUTION LIST REACHES A PIXEL AGAIN.
 *
 * `ExecutionList` — bulk-rerun, two-run comparison, the chains badge, the
 * cost sparkline, ~2,000 lines across 17 files — had ZERO JSX consumers, while
 * three golden paths cited it as their reference implementation and one of them
 * said in so many words that it was "the live one". The persona Activity tab
 * meanwhile ran its own execution feed straight past the store's cache.
 *
 * What is pinned here is the property that was missing, not the markup: the
 * persona Activity tab's runs region IS `ExecutionList`, its bulk-rerun and
 * compare affordances are reachable from the persona page, the tab no longer
 * fires the parallel `list_executions` call while that region is mounted, and
 * the other four feeds still load when the user leaves it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

// The catalog is three deep under `agents` (`t.agents.executions.history`) and
// two elsewhere (`t.common.retry`); leaves must be real strings or React
// refuses to render them.
const leaf = (prefix: string) =>
  new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
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

const listExecutions = vi.fn(async () => []);
const listExecutionsSummary = vi.fn(async () => [] as ExecutionListItem[]);
vi.mock('@/api/agents/executions', () => ({
  listExecutions: (...a: unknown[]) => listExecutions(...(a as [])),
  listExecutionsSummary: (...a: unknown[]) => listExecutionsSummary(...(a as [])),
  getExecution: vi.fn(async () => ({})),
  listActiveChains: vi.fn(async () => []),
  executePersona: vi.fn(),
}));
const listEvents = vi.fn(async () => []);
const listMemories = vi.fn(async () => []);
const listManualReviews = vi.fn(async () => []);
const listReports = vi.fn(async () => []);
vi.mock('@/api/overview/events', () => ({ listEvents: () => listEvents() }));
vi.mock('@/api/overview/memories', () => ({ listMemories: () => listMemories() }));
vi.mock('@/api/overview/reviews', () => ({ listManualReviews: () => listManualReviews() }));
vi.mock('@/api/overview/reports', () => ({ listReports: () => listReports() }));
vi.mock('@/api/overview/healing', () => ({ getRetryChain: vi.fn(async () => []) }));
vi.mock('@/api/agents/annotations', () => ({
  listPersonaAnnotations: vi.fn(async () => []),
  addAnnotation: vi.fn(),
  deleteAnnotation: vi.fn(),
}));
vi.mock('@/lib/personas/templates/templateCatalog', () => ({
  getTemplateCatalog: vi.fn(async () => []),
}));
vi.mock('@/stores/selectors/personaSelectors', () => ({ useSelectedUseCases: () => [] }));

function row(id: string, over: Partial<ExecutionListItem> = {}): ExecutionListItem {
  return {
    id, persona_id: 'p1', use_case_id: null, status: 'failed',
    input_tokens: 10, output_tokens: 10, cost_usd: 0.01, error_message: 'boom',
    duration_ms: 100, retry_of_execution_id: null, retry_count: 0,
    started_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T00:00:01Z',
    created_at: '2026-09-01T00:00:00Z', is_simulation: false, business_outcome: 'none',
    ...over,
  };
}

const agentState = {
  selectedPersona: { id: 'p1', name: 'Ada', color: '#6366f1' },
  executions: [row('e1'), row('e2')] as ExecutionListItem[],
  executionsLoading: false,
  executionsError: false,
  executionsServerCount: { p1: 2 } as Record<string, number>,
  isExecuting: false,
  fetchExecutions: vi.fn(async () => {}),
};
vi.mock('@/stores/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: (s: typeof agentState) => unknown) => (selector ? selector(agentState) : agentState),
    { getState: () => agentState },
  ),
}));
vi.mock('@/stores/systemStore', () => ({
  useSystemStore: Object.assign(
    (selector?: (s: { setRerunInputData: () => void }) => unknown) =>
      (selector ? selector({ setRerunInputData: () => {} }) : { setRerunInputData: () => {} }),
    { getState: () => ({ setRerunInputData: () => {} }) },
  ),
}));
vi.mock('@/stores/toastStore', () => ({
  useToastStore: Object.assign(() => {}, { getState: () => ({ addToast: vi.fn() }) }),
}));

import { ActivityTab } from '../ActivityTab';

describe('persona Activity tab — the runs region', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('serves the default runs tab with ExecutionList, with bulk + compare reachable', async () => {
    render(<ActivityTab />);

    // ExecutionList's own header ("history") is the region marker.
    await waitFor(() => {
      expect(screen.getByText('executions.history')).toBeTruthy();
    });
    // Bulk-rerun-the-failures: the entry affordance is on screen.
    expect(screen.getByText('executions.bulk_rerun_enter')).toBeTruthy();
    // Compare-two-runs: ExecutionListFilters' compare entry point.
    expect(screen.getByText('executions.compare')).toBeTruthy();
  });

  it('does not fire the parallel list_executions fetch while the runs region is mounted', async () => {
    render(<ActivityTab />);
    await waitFor(() => expect(listEvents).toHaveBeenCalled());
    expect(listExecutions).not.toHaveBeenCalled();
    // Paging goes through the store cache instead.
    expect(agentState.fetchExecutions).toHaveBeenCalledWith('p1');
  });

  it('keeps the other four feeds working when the user leaves the runs tab', async () => {
    render(<ActivityTab />);
    await waitFor(() => expect(listEvents).toHaveBeenCalled());
    expect(listMemories).toHaveBeenCalled();
    expect(listManualReviews).toHaveBeenCalled();
    expect(listReports).toHaveBeenCalled();

    fireEvent.click(screen.getByText('All'));
    // The aggregate timeline is allowed its own execution feed — it interleaves
    // five types and needs the full rows.
    await waitFor(() => expect(listExecutions).toHaveBeenCalled());
  });
});
