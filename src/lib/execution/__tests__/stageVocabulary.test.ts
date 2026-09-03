/**
 * The stage vocabulary has ONE label table and ONE category rule.
 *
 * There used to be three tables describing the same seven pipeline stages:
 * `STAGE_META` in `lib/execution/pipeline`, `PIPELINE_STAGE_CONFIG` in
 * `sub_executions/libs/traceHelpers` (its own copy of every label, with a
 * fallback to `STAGE_META` that proved it knew where they lived), and
 * `STAGE_COLORS` in `sub_executions/trace/stageColors` (a hand-written
 * `category` column). The category column had already drifted: it called
 * `create_record` "Backend" though `BACKEND_PIPELINE_STAGES` — the four stages
 * the backend actually opens spans for — does not contain it, and it called
 * `spawn_engine` / `stream_output` "Engine" though it does.
 *
 * These tests pin the fold: labels resolve to `STAGE_META`, and the category
 * badge is derived from `BACKEND_PIPELINE_STAGES` and so cannot disagree with
 * the trace it labels.
 */
import { describe, it, expect } from 'vitest';
import {
  PIPELINE_STAGES,
  BACKEND_PIPELINE_STAGES,
  STAGE_META,
  isBackendPipelineStage,
  stageCategory,
} from '@/lib/execution/pipeline';
import { getSpanConfig } from '@/features/agents/sub_executions/libs/traceHelpers';
import { STAGE_COLORS } from '@/features/agents/sub_executions/trace/stageColors';

describe('stage labels come from exactly one table', () => {
  it('every pipeline stage has a label, and it is STAGE_META’s', () => {
    for (const stage of PIPELINE_STAGES) {
      const label = STAGE_META[stage].label;
      expect(label, `${stage} has no label`).toBeTruthy();
      expect(getSpanConfig(stage).label).toBe(label);
    }
  });

  it('no two stages share a label', () => {
    const labels = PIPELINE_STAGES.map((s) => STAGE_META[s].label);
    expect(new Set(labels).size).toBe(PIPELINE_STAGES.length);
  });

  it('STAGE_META and STAGE_COLORS describe the same seven stages', () => {
    expect(Object.keys(STAGE_META).sort()).toEqual([...PIPELINE_STAGES].sort());
    expect(Object.keys(STAGE_COLORS).sort()).toEqual([...PIPELINE_STAGES].sort());
  });
});

describe('the category badge agrees with BACKEND_PIPELINE_STAGES', () => {
  it('every stage the backend measures reads "Backend", and no other does', () => {
    for (const stage of PIPELINE_STAGES) {
      const expected = (BACKEND_PIPELINE_STAGES as readonly string[]).includes(stage)
        ? 'Backend'
        : 'Frontend';
      expect(stageCategory(stage), stage).toBe(expected);
      expect(STAGE_COLORS[stage].category, stage).toBe(expected);
    }
  });

  it('stageCategory is a total function of isBackendPipelineStage', () => {
    for (const stage of PIPELINE_STAGES) {
      expect(stageCategory(stage) === 'Backend').toBe(isBackendPipelineStage(stage));
    }
  });

  it('create_record is NOT reported as backend-measured', () => {
    // The exact drift this fold removed: the old hand-written column said
    // "Backend" for a stage the backend opens no span for.
    expect(isBackendPipelineStage('create_record')).toBe(false);
    expect(STAGE_COLORS.create_record.category).toBe('Frontend');
  });

  it('spawn_engine and stream_output ARE reported as backend-measured', () => {
    // The old column called both "Engine", a third category no trace carries.
    expect(STAGE_COLORS.spawn_engine.category).toBe('Backend');
    expect(STAGE_COLORS.stream_output.category).toBe('Backend');
  });
});
