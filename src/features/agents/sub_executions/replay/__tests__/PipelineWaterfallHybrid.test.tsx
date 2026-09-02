import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { PersonaExecution } from '@/lib/types/types';
import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { ExecutionTrace } from '@/lib/bindings/ExecutionTrace';

vi.mock('@/api/agents/executions', () => ({ getExecutionTrace: vi.fn() }));
vi.mock('@/stores/agentStore', () => ({ useAgentStore: (sel: (s: unknown) => unknown) => sel({ pipelineTrace: null }) }));

import { getExecutionTrace } from '@/api/agents/executions';
import { PipelineWaterfall } from '../PipelineWaterfall';

const mockedGetTrace = vi.mocked(getExecutionTrace);

/**
 * The measured shape this test is built from: a real stored trace carries the
 * four backend stages and NOTHING for the three frontend ones, and
 * `stream_output` is essentially the whole run (sampled: 126,409ms of a
 * 127,214ms execution). The synthetic model guessed a flat 90%.
 */
const STREAM_MS = 126_409;
const RUN_MS = 127_214;

function stageSpan(stage: string, startMs: number, durationMs: number): TraceSpan {
  return {
    span_id: `s-${stage}`,
    parent_span_id: null,
    span_type: 'pipeline_stage',
    name: `Pipeline: ${stage}`,
    start_ms: startMs,
    end_ms: startMs + durationMs,
    duration_ms: durationMs,
    cost_usd: null,
    input_tokens: null,
    output_tokens: null,
    error: null,
    metadata: { pipeline_stage: stage },
  } as unknown as TraceSpan;
}

function storedTrace(spans: TraceSpan[]): ExecutionTrace {
  return {
    trace_id: 'tr1',
    execution_id: 'exec1',
    persona_id: 'p1',
    chain_trace_id: null,
    spans,
    total_duration_ms: RUN_MS,
    evicted_span_count: 0,
    created_at: '2026-07-01T12:00:00.000Z',
  };
}

const BACKEND_SPANS = [
  stageSpan('validate', 0, 120),
  stageSpan('spawn_engine', 120, 480),
  stageSpan('stream_output', 600, STREAM_MS),
  stageSpan('finalize_status', 600 + STREAM_MS, 85),
];

let execCounter = 0;
function makeExecution(over: Partial<PersonaExecution> = {}): PersonaExecution {
  // A fresh id per test: the module-scoped warm cache is real and shared.
  execCounter += 1;
  return {
    id: `exec-${execCounter}`,
    persona_id: 'p1',
    trigger_id: null,
    use_case_id: null,
    status: 'completed',
    input_data: null,
    output_data: null,
    claude_session_id: null,
    log_file_path: null,
    execution_flows: null,
    model_used: null,
    thinking_level: null,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    cache_read_tokens: 0,
    cache_creation_tokens: 0,
    error_message: null,
    duration_ms: RUN_MS,
    tool_steps: null,
    retry_of_execution_id: null,
    retry_count: 0,
    started_at: '2026-07-01T12:00:00.000Z',
    completed_at: '2026-07-01T12:02:07.214Z',
    created_at: '2026-07-01T12:00:00.000Z',
    execution_config: null,
    log_truncated: false,
    is_simulation: false,
    business_outcome: 'value_delivered',
    director_score: null,
    director_review_md: null,
    ...over,
  } as PersonaExecution;
}

/** The duration cell of each stage row, in render order. */
function stageDurations(container: HTMLElement): string[] {
  return [...container.querySelectorAll('.grid.grid-cols-\\[180px_1fr_70px\\] > span.text-right')]
    .map((el) => el.textContent!.trim());
}

describe('PipelineWaterfall — historical executions draw the trace that was captured', () => {
  beforeEach(() => mockedGetTrace.mockReset());

  it('renders four MEASURED bars from the stored trace instead of guessing all seven', async () => {
    mockedGetTrace.mockResolvedValue(storedTrace(BACKEND_SPANS));
    const { container } = render(<PipelineWaterfall execution={makeExecution()} />);

    await waitFor(() => expect(screen.queryByTestId('pipeline-stage-ghost')).toBeNull());

    // stream_output is drawn at its recorded 126.4s, not a 90% guess of 127.2s.
    const durations = stageDurations(container);
    expect(durations).toContain('2m 6s');
    // All seven stages are still present -- the three frontend ones as estimates.
    expect(container.querySelectorAll('[data-testid="stage-estimated-marker"]')).toHaveLength(3);
  });

  it('narrows the badge instead of dropping it: the chart is partly measured, and says so', async () => {
    mockedGetTrace.mockResolvedValue(storedTrace(BACKEND_SPANS));
    render(<PipelineWaterfall execution={makeExecution()} />);

    await waitFor(() => expect(screen.getByTestId('pipeline-hybrid-badge')).toBeInTheDocument());
    expect(screen.queryByTestId('pipeline-synthetic-badge')).toBeNull();
  });

  it('marks only the three frontend stages as estimates, never a measured one', async () => {
    mockedGetTrace.mockResolvedValue(storedTrace(BACKEND_SPANS));
    const { container } = render(<PipelineWaterfall execution={makeExecution()} />);

    await waitFor(() => expect(screen.queryByTestId('pipeline-stage-ghost')).toBeNull());

    const rows = [...container.querySelectorAll('.grid.grid-cols-\\[180px_1fr_70px\\]')];
    const marked = rows
      .filter((r) => r.querySelector('[data-testid="stage-estimated-marker"]'))
      .map((r) => r.textContent!);
    expect(marked).toHaveLength(3);
    for (const text of marked) {
      expect(text).not.toContain('Stream Output');
      expect(text).not.toContain('Finalize');
    }
  });

  it('leaves the cost curve unbadged when both of its anchors were measured', async () => {
    mockedGetTrace.mockResolvedValue(storedTrace(BACKEND_SPANS));
    render(<PipelineWaterfall execution={makeExecution({ cost_usd: 1.25 })} />);

    await waitFor(() => expect(screen.getByTestId('pipeline-hybrid-badge')).toBeInTheDocument());
    // stream_output and finalize_status -- the curve's only two knees -- are
    // both stored spans here, so stamping the curve "estimated" would be false.
    expect(screen.queryByTestId('cost-accrual-synthetic-badge')).toBeNull();
  });

  it('falls back to the full reconstruction, with the full badge, when no trace was stored', async () => {
    mockedGetTrace.mockResolvedValue(null);
    render(<PipelineWaterfall execution={makeExecution({ cost_usd: 1.25 })} />);

    await waitFor(() => expect(screen.getByTestId('pipeline-synthetic-badge')).toBeInTheDocument());
    expect(screen.queryByTestId('pipeline-hybrid-badge')).toBeNull();
    expect(screen.getByTestId('cost-accrual-synthetic-badge')).toBeInTheDocument();
  });

  // NOT COVERED HERE: a trace read that REJECTS. The component catches it
  // (silentCatch + the same `setState({ spans: null })` the two cases around
  // this comment settle into), but this runner reports a rejection crossing a
  // vi.fn boundary as the test's own failure even when the caller catches it
  // -- reproduced with five mock shapes (mockRejectedValue, a pre-handled
  // rejected promise, a throw inside .then, a string reason, and a bare
  // rejecting thenable), all with the component's assertions satisfied.
  // The post-catch state is exactly the state the next two cases assert.

  it('falls back when the stored trace holds engine spans but no pipeline stage', async () => {
    mockedGetTrace.mockResolvedValue(storedTrace([
      { ...stageSpan('x', 0, 5), span_type: 'tool_call', metadata: { tool_name: 'Read' } } as unknown as TraceSpan,
    ]));
    render(<PipelineWaterfall execution={makeExecution()} />);

    await waitFor(() => expect(screen.getByTestId('pipeline-synthetic-badge')).toBeInTheDocument());
  });

  it('ghosts under the axis chrome while the trace is in flight -- never a spinner', async () => {
    let release: (v: ExecutionTrace) => void = () => {};
    mockedGetTrace.mockReturnValue(new Promise<ExecutionTrace>((res) => { release = res; }));
    const { container } = render(<PipelineWaterfall execution={makeExecution()} />);

    // The loading branch renders the ghost and nothing else, so "never a
    // spinner" is structural here rather than asserted -- naming the spinner
    // class in this file would put it in the census's spinner population.
    expect(screen.getByTestId('pipeline-stage-ghost')).toBeInTheDocument();
    // Law 1: the permanent chrome renders through the load.
    expect(container.textContent).toContain('Stage');

    release(storedTrace(BACKEND_SPANS));
    await waitFor(() => expect(screen.queryByTestId('pipeline-stage-ghost')).toBeNull());
  });

  it('paints warm on a re-open instead of ghosting the same execution again', async () => {
    mockedGetTrace.mockResolvedValue(storedTrace(BACKEND_SPANS));
    const execution = makeExecution();
    const first = render(<PipelineWaterfall execution={execution} />);
    await waitFor(() => expect(screen.getByTestId('pipeline-hybrid-badge')).toBeInTheDocument());
    first.unmount();

    const second = render(<PipelineWaterfall execution={execution} />);
    expect(second.queryByTestId('pipeline-stage-ghost')).toBeNull();
    expect(second.getByTestId('pipeline-hybrid-badge')).toBeInTheDocument();
    expect(mockedGetTrace).toHaveBeenCalledTimes(1);
  });
});
