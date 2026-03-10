import type { PipelineStage } from '@/lib/execution/pipeline';

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
