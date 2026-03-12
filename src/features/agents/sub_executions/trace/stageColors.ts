import type { PipelineStage } from '@/lib/execution/pipeline';

// ---------------------------------------------------------------------------
// Stage color scheme
// ---------------------------------------------------------------------------

export const STAGE_COLORS: Record<PipelineStage, { bar: string; barGradient: string; barShadow: string; text: string; bg: string; border: string; category: string; haloColor: string }> = {
  initiate:           { bar: 'bg-blue-500/50',    barGradient: 'bg-gradient-to-r from-blue-500/60 to-cyan-500/50',       barShadow: 'shadow-[inset_0_1px_2px_rgba(59,130,246,0.3)]',   text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    category: 'Frontend', haloColor: 'shadow-[0_0_4px_rgba(59,130,246,0.5)]' },
  validate:           { bar: 'bg-emerald-500/50', barGradient: 'bg-gradient-to-r from-emerald-500/60 to-teal-500/50',    barShadow: 'shadow-[inset_0_1px_2px_rgba(16,185,129,0.3)]',   text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend',  haloColor: 'shadow-[0_0_4px_rgba(16,185,129,0.5)]' },
  create_record:      { bar: 'bg-emerald-500/50', barGradient: 'bg-gradient-to-r from-emerald-500/60 to-teal-500/50',    barShadow: 'shadow-[inset_0_1px_2px_rgba(16,185,129,0.3)]',   text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend',  haloColor: 'shadow-[0_0_4px_rgba(16,185,129,0.5)]' },
  spawn_engine:       { bar: 'bg-violet-500/50',  barGradient: 'bg-gradient-to-r from-violet-500/60 to-indigo-500/50',   barShadow: 'shadow-[inset_0_1px_2px_rgba(139,92,246,0.3)]',   text: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25',  category: 'Engine',   haloColor: 'shadow-[0_0_4px_rgba(139,92,246,0.5)]' },
  stream_output:      { bar: 'bg-violet-500/50',  barGradient: 'bg-gradient-to-r from-violet-500/60 to-indigo-500/50',   barShadow: 'shadow-[inset_0_1px_2px_rgba(139,92,246,0.3)]',   text: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25',  category: 'Engine',   haloColor: 'shadow-[0_0_4px_rgba(139,92,246,0.5)]' },
  finalize_status:    { bar: 'bg-emerald-500/50', barGradient: 'bg-gradient-to-r from-emerald-500/60 to-teal-500/50',    barShadow: 'shadow-[inset_0_1px_2px_rgba(16,185,129,0.3)]',   text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25', category: 'Backend',  haloColor: 'shadow-[0_0_4px_rgba(16,185,129,0.5)]' },
  frontend_complete:  { bar: 'bg-blue-500/50',    barGradient: 'bg-gradient-to-r from-blue-500/60 to-cyan-500/50',       barShadow: 'shadow-[inset_0_1px_2px_rgba(59,130,246,0.3)]',   text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25',    category: 'Frontend', haloColor: 'shadow-[0_0_4px_rgba(59,130,246,0.5)]' },
};

// ---------------------------------------------------------------------------
// Tool step sub-span type
// ---------------------------------------------------------------------------

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
