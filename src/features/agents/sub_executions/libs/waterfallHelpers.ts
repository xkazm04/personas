import type { DbPersonaExecution } from '@/lib/types/types';
import type { PipelineTrace, PipelineTraceEntry, PipelineStage } from '@/lib/execution/pipeline';

// Stage color scheme

export const STAGE_COLORS: Record<PipelineStage, { bar: string; text: string; bg: string; border: string; category: string }> = {
  initiate:           { bar: 'bg-blue-500/50',    text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    category: 'Frontend' },
  validate:           { bar: 'bg-emerald-500/50', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend' },
  create_record:      { bar: 'bg-emerald-500/50', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend' },
  spawn_engine:       { bar: 'bg-amber-500/50',   text: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25',   category: 'Engine' },
  stream_output:      { bar: 'bg-amber-500/50',   text: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25',   category: 'Engine' },
  finalize_status:    { bar: 'bg-emerald-500/50', text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend' },
  frontend_complete:  { bar: 'bg-blue-500/50',    text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    category: 'Frontend' },
};

// Tool step sub-span type

export interface ToolCallStep {
  step_index: number;
  tool_name: string;
  input_preview: string;
  output_preview: string;
  started_at_ms: number;
  ended_at_ms?: number;
  duration_ms?: number;
}

export function parseToolSteps(raw: string | null): ToolCallStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { // intentional: non-critical -- JSON parse fallback
    return [];
  }
}

// Synthetic trace builder (for historical executions without live trace)

export function buildSyntheticTrace(execution: DbPersonaExecution): PipelineTrace | null {
  if (!execution.started_at && !execution.created_at) return null;

  const startTime = new Date(execution.started_at ?? execution.created_at).getTime();
  const endTime = execution.completed_at
    ? new Date(execution.completed_at).getTime()
    : execution.duration_ms
      ? startTime + execution.duration_ms
      : null;

  if (!endTime) return null;

  const totalDuration = endTime - startTime;
  if (totalDuration <= 0) return null;

  const entries: PipelineTraceEntry[] = [];
  let cursor = startTime;

  // initiate: ~1%
  const initDur = Math.max(totalDuration * 0.01, 5);
  entries.push({ stage: 'initiate', timestamp: cursor, durationMs: initDur, metadata: { personaId: execution.persona_id } });
  cursor += initDur;

  // validate: ~2%
  const validateDur = Math.max(totalDuration * 0.02, 10);
  entries.push({ stage: 'validate', timestamp: cursor, durationMs: validateDur });
  cursor += validateDur;

  // create_record: ~1%
  const createDur = Math.max(totalDuration * 0.01, 5);
  entries.push({ stage: 'create_record', timestamp: cursor, durationMs: createDur, metadata: { executionId: execution.id } });
  cursor += createDur;

  // spawn_engine: ~1%
  const spawnDur = Math.max(totalDuration * 0.01, 10);
  entries.push({ stage: 'spawn_engine', timestamp: cursor, durationMs: spawnDur });
  cursor += spawnDur;

  // stream_output: ~90%
  const streamDur = endTime - cursor - Math.max(totalDuration * 0.03, 20);
  entries.push({ stage: 'stream_output', timestamp: cursor, durationMs: Math.max(streamDur, 50) });
  cursor += Math.max(streamDur, 50);

  // finalize_status: ~2%
  const finalizeDur = Math.max(totalDuration * 0.02, 10);
  entries.push({
    stage: 'finalize_status',
    timestamp: cursor,
    durationMs: finalizeDur,
    error: execution.error_message ?? undefined,
  });
  cursor += finalizeDur;

  // frontend_complete: ~1%
  const feCompleteDur = Math.max(endTime - cursor, 5);
  entries.push({
    stage: 'frontend_complete',
    timestamp: cursor,
    durationMs: feCompleteDur,
    metadata: { status: execution.status },
  });

  return {
    executionId: execution.id,
    entries,
    startedAt: startTime,
    completedAt: endTime,
  };
}
