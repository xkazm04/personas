// @vitest-environment node
/**
 * THE GUIDANCE MUST NOT BREAK THE INPUT IT RIDES IN.
 *
 * `execute_persona` parses `input_data` as JSON (src-tauri/src/commands/
 * execution/executions.rs): with a use case it rejects anything that is not a
 * JSON object, without one it wraps unparseable text as `{ user_input }`. The
 * validate-stage knowledge middleware appended its guidance as raw text after
 * the JSON string, so a persona with learned knowledge could not run a use case
 * at all, and every other run lost its structured input into one string.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';

const { getKnowledgeInjectionMock } = vi.hoisted(() => ({ getKnowledgeInjectionMock: vi.fn() }));
vi.mock('@/api/overview/intelligence/knowledge', () => ({
  getKnowledgeInjection: getKnowledgeInjectionMock,
}));

import { registerKnowledgeMiddleware } from '../knowledgeMiddleware';
import { createPipelineTrace, runMiddleware } from '../pipeline';

function entry(over: Partial<ExecutionKnowledge>): ExecutionKnowledge {
  return {
    id: 'k1', persona_id: 'p1', use_case_id: null, knowledge_type: 'tool_sequence',
    pattern_key: 'Read -> Write', pattern_data: '{}', success_count: 9, failure_count: 1,
    avg_cost_usd: 0.01, avg_duration_ms: 1200, confidence: 0.9, last_execution_id: null,
    created_at: '', updated_at: '', scope_type: 'persona', scope_id: null,
    annotation_text: null, annotation_source: null, is_verified: false,
    ...over,
  };
}

function validatePayload(inputData: string | null) {
  return {
    personaId: 'p1', personaName: '', triggerId: null, inputData,
    useCaseId: 'uc1', modelUsed: null,
  };
}

beforeEach(() => {
  getKnowledgeInjectionMock.mockReset();
  registerKnowledgeMiddleware();
});

describe('knowledge injection middleware', () => {
  it('keeps a JSON-object input parseable and every caller key intact', async () => {
    getKnowledgeInjectionMock.mockResolvedValue([entry({})]);
    const out = await runMiddleware('validate', validatePayload('{"topic":"q3","n":2}'), createPipelineTrace('e1'));

    const parsed = JSON.parse(out.inputData!) as Record<string, unknown>;
    expect(parsed.topic).toBe('q3');
    expect(parsed.n).toBe(2);
    expect(String(parsed.knowledge_guidance)).toContain('[Knowledge Graph Guidance]');
    expect(String(parsed.knowledge_guidance)).toContain('Read -> Write');
  });

  it('a run with no input still sends a JSON object', async () => {
    getKnowledgeInjectionMock.mockResolvedValue([entry({})]);
    const out = await runMiddleware('validate', validatePayload(null), createPipelineTrace('e2'));

    const parsed = JSON.parse(out.inputData!) as Record<string, unknown>;
    expect(Object.keys(parsed)).toEqual(['knowledge_guidance']);
  });

  it('leaves an input it cannot extend exactly as the caller sent it', async () => {
    getKnowledgeInjectionMock.mockResolvedValue([entry({})]);
    const out = await runMiddleware('validate', validatePayload('[1,2]'), createPipelineTrace('e3'));
    expect(out.inputData).toBe('[1,2]');
  });

  it('does nothing when there is no knowledge', async () => {
    getKnowledgeInjectionMock.mockResolvedValue([]);
    const out = await runMiddleware('validate', validatePayload('{"a":1}'), createPipelineTrace('e4'));
    expect(out.inputData).toBe('{"a":1}');
  });
});
