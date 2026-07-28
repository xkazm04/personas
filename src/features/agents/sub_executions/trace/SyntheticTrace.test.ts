import { describe, it, expect } from 'vitest';
import { buildSyntheticTrace } from './SyntheticTrace';
import type { PersonaExecution } from '@/lib/bindings/PersonaExecution';

function makeExecution(overrides: Partial<PersonaExecution>): PersonaExecution {
  return {
    id: 'exec1',
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
    duration_ms: 5000,
    tool_steps: null,
    retry_of_execution_id: null,
    retry_count: 0,
    started_at: '2026-07-01T12:00:00.000Z',
    completed_at: '2026-07-01T12:00:05.000Z',
    created_at: '2026-07-01T12:00:00.000Z',
    execution_config: null,
    log_truncated: false,
    is_simulation: false,
    business_outcome: 'value_delivered',
    director_score: null,
    director_review_md: null,
    ...overrides,
  };
}

describe('buildSyntheticTrace — flags reconstructed traces as synthetic', () => {
  it('regression: sets isSynthetic: true so a renderer can distinguish it from a captured trace', () => {
    const trace = buildSyntheticTrace(makeExecution({}));
    expect(trace).not.toBeNull();
    expect(trace!.isSynthetic).toBe(true);
  });

  it('still produces the expected span shape (proportional-estimate spans, just flagged)', () => {
    const trace = buildSyntheticTrace(makeExecution({}));
    expect(trace!.spans.length).toBeGreaterThan(0);
    expect(trace!.spans.map((s) => s.span_type)).toContain('stream_output');
  });

  it('returns null when there is nothing to reconstruct a duration from', () => {
    expect(buildSyntheticTrace(makeExecution({ started_at: null, created_at: '' }))).toBeNull();
  });
});
