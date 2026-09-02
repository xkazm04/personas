/**
 * THREE DEFECTS THE REVIVED LIST BROUGHT WITH IT.
 *
 * (a) Start had `disabled={selectedCount === 0}` and nothing else, and the
 *     handler had no re-entry check — a second click minted a new latest-wins
 *     token and ABANDONED the running cohort while its executePersona calls
 *     kept running, and kept billing. The rows were guarded; the button wasn't.
 * (b) The next page's offset was `rawRows.length` — a client-side union the
 *     store PREPENDS locally-finished runs into, and which (unlike `extraRows`)
 *     survives a persona switch. Paging off it asks the server to skip rows it
 *     never handed over.
 * (d) The toolbar counted `bulkSelected.size` while the handler acted on
 *     `executions.filter(...)` — the button said N, the rerun did M < N, and
 *     nobody was told (bulk-selection-actions.md §7 D3).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

const leaf = (prefix: string) => new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` });
const t = new Proxy({}, {
  get: (_o, section) =>
    section === 'agents'
      ? new Proxy({}, { get: (_s, sub) => leaf(String(sub)) })
      : leaf(String(section)),
});
// Interpolation is preserved so the assertions can read the COUNT the button
// promises — the whole point of (d).
const tx = (s: unknown, vars?: Record<string, unknown>) =>
  vars ? `${String(s)}|${JSON.stringify(vars)}` : String(s);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx, language: 'en' }),
  getActiveTranslations: () => t,
}));

const listExecutionsSummary = vi.fn(async () => [] as ExecutionListItem[]);
vi.mock('@/api/agents/executions', () => ({
  listExecutionsSummary: (...a: unknown[]) => listExecutionsSummary(...(a as [])),
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
vi.mock('@/lib/personas/templates/templateCatalog', () => ({ getTemplateCatalog: vi.fn(async () => []) }));
vi.mock('@/stores/selectors/personaSelectors', () => ({ useSelectedUseCases: () => [] }));

// The cohort's phase is owned by the hook, so drive it from the test.
const bulkStart = vi.fn(() => new Promise<void>(() => {})); // never settles
const bulkRerun = {
  phase: 'idle' as 'idle' | 'running' | 'completed',
  items: [] as unknown[],
  cohort: {
    total: 0, finished: 0, successCount: 0, failedCount: 0, regressionCount: 0,
    recoveredCount: 0, meanCostDelta: 0, meanDurationDeltaMs: 0,
    totalCostOriginal: 0, totalCostNew: 0,
  },
  start: bulkStart,
  cancel: vi.fn(),
  reset: vi.fn(),
};
vi.mock('../../../libs/useBulkRerun', () => ({ useBulkRerun: () => bulkRerun }));

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

import { ExecutionList } from '../ExecutionList';

const startsWith = (prefix: string) => (content: string) => content.startsWith(prefix);

beforeEach(() => {
  vi.clearAllMocks();
  bulkRerun.phase = 'idle';
  agentState.executions = [];
  agentState.executionsServerCount = {};
});

describe('(b) the next page is anchored on what the SERVER returned', () => {
  it('a locally-prepended finished run does not push the window past an older one', async () => {
    // 50 rows came from the server; one more was PREPENDED locally when a run
    // finished mid-session. The union is 51 — the server has handed over 50.
    const server = Array.from({ length: 50 }, (_, i) => row(`s${i}`));
    agentState.executions = [row('just-finished'), ...server];
    agentState.executionsServerCount = { p1: 50 };
    listExecutionsSummary.mockResolvedValue([]);

    render(<ExecutionList />);
    const more = await screen.findByText(startsWith('executions.load_more'));
    fireEvent.click(more);

    await waitFor(() => expect(listExecutionsSummary).toHaveBeenCalled());
    // 50, not 51: server position 50 is the next unseen row.
    expect(listExecutionsSummary).toHaveBeenCalledWith('p1', 50, 50);
  });
});

describe('(a) + (d) the bulk-rerun toolbar', () => {
  it('counts the rows it will actually rerun, not the ones it has forgotten about', async () => {
    agentState.executions = [row('a'), row('b', { is_simulation: true }), row('c')];
    agentState.executionsServerCount = { p1: 3 };
    render(<ExecutionList />);

    // Show simulations, enter bulk mode, select every failed row (3 of them).
    fireEvent.click(await screen.findByText('executions.show_simulations'));
    fireEvent.click(screen.getByText('executions.bulk_rerun_enter'));
    fireEvent.click(screen.getByText(startsWith('executions.bulk_rerun_select_all_failed')));
    expect(screen.getByText(startsWith('executions.bulk_rerun_start')).textContent)
      .toContain('"n":3');

    // Hide simulations again: the simulation row leaves `executions` but stays
    // in `bulkSelected`. The count must follow the action, not the stale set.
    fireEvent.click(screen.getByText('executions.hide_simulations'));
    expect(screen.getByText(startsWith('executions.bulk_rerun_start')).textContent)
      .toContain('"n":2');
    expect(screen.getByText(startsWith('executions.bulk_rerun_selected_count')).textContent)
      .toContain('"n":2');
  });

  it('refuses a second Start while a cohort is running', async () => {
    agentState.executions = [row('a'), row('c')];
    agentState.executionsServerCount = { p1: 2 };
    const { rerender } = render(<ExecutionList />);

    fireEvent.click(await screen.findByText('executions.bulk_rerun_enter'));
    fireEvent.click(screen.getByText(startsWith('executions.bulk_rerun_select_all_failed')));
    const startBtn = screen.getByText(startsWith('executions.bulk_rerun_start')).closest('button')!;
    fireEvent.click(startBtn);
    expect(bulkStart).toHaveBeenCalledTimes(1);

    // The cohort is now in flight. The button must be busy AND disabled, and a
    // second click must not mint a second cohort.
    bulkRerun.phase = 'running';
    rerender(<ExecutionList />);
    const busyBtn = screen.getByText(startsWith('executions.bulk_rerun_start')).closest('button')!;
    expect(busyBtn.getAttribute('aria-busy')).toBe('true');
    expect(busyBtn.hasAttribute('disabled')).toBe(true);
    fireEvent.click(busyBtn);
    expect(bulkStart).toHaveBeenCalledTimes(1);
  });
});
