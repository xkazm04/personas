/**
 * Probe: how many select cells (one per rendered row) repaint on ONE bulk
 * selection toggle. UnifiedTableRow is memoized on `columns` / `onRowClick`
 * identity; ExecutionList rebuilt both from the whole `bulk` / `compare` hook
 * objects, which are new literals each render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ExecutionListItem } from '@/lib/bindings/ExecutionListItem';

// Stable per-key proxies, as the real translation object is: a fresh object per
// access would change `e` every render and defeat every memo downstream.
const stableLeaves = new Map<string, unknown>();
const leaf = (prefix: string): unknown => {
  if (!stableLeaves.has(prefix)) {
    stableLeaves.set(prefix, new Proxy({}, { get: (_o, k) => `${prefix}.${String(k)}` }));
  }
  return stableLeaves.get(prefix);
};
const agentsSub = new Map<string, unknown>();
const t = new Proxy({}, {
  get: (_o, section) => {
    if (section !== 'agents') return leaf(String(section));
    return new Proxy({}, {
      get: (_s, sub) => {
        const k = String(sub);
        if (!agentsSub.has(k)) agentsSub.set(k, leaf(k));
        return agentsSub.get(k);
      },
    });
  },
});
const tx = (s: unknown, vars?: Record<string, unknown>) =>
  vars ? `${String(s)}|${JSON.stringify(vars)}` : String(s);
vi.mock('@/i18n/useTranslation', () => ({
  useTranslation: () => ({ t, tx, language: 'en' }),
  getActiveTranslations: () => t,
}));
vi.mock('@/api/agents/executions', () => ({
  listExecutionsSummary: vi.fn(async () => []),
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
const NO_USE_CASES: never[] = [];
vi.mock('@/stores/selectors/personaSelectors', () => ({ useSelectedUseCases: () => NO_USE_CASES }));
vi.mock('../../../libs/useBulkRerun', () => ({
  useBulkRerun: () => ({
    phase: 'idle', items: [], start: vi.fn(), cancel: vi.fn(), reset: vi.fn(),
    cohort: {
      total: 0, finished: 0, successCount: 0, failedCount: 0, regressionCount: 0,
      recoveredCount: 0, meanCostDelta: 0, meanDurationDeltaMs: 0,
      landedCount: 0, totalCostOriginal: 0, totalCostNew: 0, unpricedOriginalCount: 0, unpricedNewCount: 0,
    },
  }),
}));

// Count every select-cell render by row id: a memoized row that bails never calls it.
const cellRenders: string[] = [];
vi.mock('../ExecutionSelectCell', async (orig) => {
  const real = await orig<typeof import('../ExecutionSelectCell')>();
  return {
    ExecutionSelectCell: (props: Parameters<typeof real.ExecutionSelectCell>[0]) => {
      cellRenders.push(props.row.id);
      return real.ExecutionSelectCell(props);
    },
  };
});

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

function row(id: string): ExecutionListItem {
  return {
    id, persona_id: 'p1', use_case_id: null, status: 'failed',
    input_tokens: 10, output_tokens: 10, cost_usd: 0.01, error_message: 'boom',
    duration_ms: 100, retry_of_execution_id: null, retry_count: 0,
    started_at: '2026-09-01T00:00:00Z', completed_at: '2026-09-01T00:00:01Z',
    created_at: '2026-09-01T00:00:00Z', is_simulation: false, business_outcome: 'none',
  };
}

beforeEach(() => {
  cellRenders.length = 0;
  agentState.executions = Array.from({ length: 30 }, (_, i) => row(`r${i}`));
  agentState.executionsServerCount = { p1: 30 };
});

describe('execution list row repaint', () => {
  it('one bulk selection toggle repaints only the toggled row', async () => {
    render(<ExecutionList />);
    fireEvent.click(await screen.findByText('executions.bulk_rerun_enter'));
    const boxes = await screen.findAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThanOrEqual(10);

    cellRenders.length = 0;
    fireEvent.click(boxes[0]!);
    const repainted = new Set(cellRenders).size;
    console.info(`PROBE rows=${boxes.length} cells repainted on one toggle=${repainted}`);
    expect(repainted).toBeLessThanOrEqual(2);
    expect((boxes[0] as HTMLInputElement).checked).toBe(true);
  });

  it('compare mode still paints the A slot on the picked row only', async () => {
    render(<ExecutionList />);
    fireEvent.click(await screen.findByText('executions.compare'));
    fireEvent.click(await screen.findByText('executions.cancel').then(() => screen.getAllByRole('row')[1]!));
    expect((await screen.findAllByText('A')).length).toBe(1);
  });
});
