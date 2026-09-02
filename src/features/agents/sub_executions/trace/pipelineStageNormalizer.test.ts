import { describe, it, expect } from 'vitest';
import type { UnifiedSpan } from '@/lib/execution/pipeline';
import {
  pipelineStageOf,
  normalizePipelineStageSpans,
  isBackendPipelineStage,
  BACKEND_PIPELINE_STAGES,
} from '@/lib/execution/pipeline';

/**
 * The backend opens all four of its pipeline stages as the SAME `SpanType`
 * variant -- `"pipeline_stage"` -- and puts the stage itself in
 * `metadata.pipeline_stage` (src-tauri/src/engine/runner/stages.rs). Nothing on
 * the frontend remapped that, so `isPipelineStage` rejected every stored stage
 * span and the waterfall could not draw a single measured bar.
 */
function storedStage(stage: string, over: Partial<UnifiedSpan> = {}): UnifiedSpan {
  return {
    span_id: `s-${stage}`,
    parent_span_id: null,
    span_type: 'pipeline_stage',
    name: `Pipeline: ${stage}`,
    start_ms: 0,
    end_ms: 10,
    duration_ms: 10,
    cost_usd: null,
    error: null,
    metadata: { pipeline_stage: stage },
    ...over,
  } as UnifiedSpan;
}

describe('pipelineStageOf', () => {
  it('reads the stage out of a stored pipeline_stage span', () => {
    for (const stage of BACKEND_PIPELINE_STAGES) {
      expect(pipelineStageOf(storedStage(stage))).toBe(stage);
    }
  });

  it('passes a span that already names its stage straight through', () => {
    expect(pipelineStageOf(storedStage('stream_output', { span_type: 'stream_output', metadata: null })))
      .toBe('stream_output');
  });

  it('names no stage for an engine span', () => {
    expect(pipelineStageOf(storedStage('x', { span_type: 'tool_call', metadata: { tool_name: 'Read' } })))
      .toBeNull();
  });

  it('names no stage when the metadata key is missing, wrong-typed, or unknown', () => {
    expect(pipelineStageOf(storedStage('x', { metadata: null }))).toBeNull();
    expect(pipelineStageOf(storedStage('x', { metadata: { pipeline_stage: 7 } }))).toBeNull();
    expect(pipelineStageOf(storedStage('x', { metadata: { pipeline_stage: 'teleport' } }))).toBeNull();
  });
});

describe('isBackendPipelineStage', () => {
  it('separates the four measured stages from the three frontend-only ones', () => {
    expect(isBackendPipelineStage('stream_output')).toBe(true);
    expect(isBackendPipelineStage('finalize_status')).toBe(true);
    expect(isBackendPipelineStage('initiate')).toBe(false);
    expect(isBackendPipelineStage('create_record')).toBe(false);
    expect(isBackendPipelineStage('frontend_complete')).toBe(false);
  });
});

describe('normalizePipelineStageSpans', () => {
  it('remaps stored stage spans onto the pipeline-stage union', () => {
    const out = normalizePipelineStageSpans([
      storedStage('validate'),
      storedStage('stream_output'),
    ]);
    expect(out.map((s) => s.span_type)).toEqual(['validate', 'stream_output']);
  });

  it('is a remap, not a filter -- engine spans survive untouched', () => {
    const tool = storedStage('x', { span_id: 't1', span_type: 'tool_call', metadata: null });
    const out = normalizePipelineStageSpans([storedStage('validate'), tool]);
    expect(out).toHaveLength(2);
    expect(out[1]).toBe(tool);
  });

  it('returns the same array when nothing needed remapping (no needless re-render)', () => {
    const spans = [storedStage('x', { span_type: 'tool_call', metadata: null })];
    expect(normalizePipelineStageSpans(spans)).toBe(spans);
  });
});
