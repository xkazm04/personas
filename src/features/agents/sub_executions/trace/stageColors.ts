import type { PipelineStage, StageCategory } from '@/lib/execution/pipeline';
import { PIPELINE_STAGES, stageCategory } from '@/lib/execution/pipeline';

// ---------------------------------------------------------------------------
// Stage color scheme
// ---------------------------------------------------------------------------

export interface StageColor {
  bar: string;
  barGradient: string;
  barShadow: string;
  text: string;
  bg: string;
  border: string;
  /** Derived, never hand-written — see `stageCategory` in `lib/execution/pipeline`. */
  category: StageCategory;
  haloColor: string;
}

/**
 * The colour classes only. `category` is NOT a column here on purpose: it used
 * to be a hand-written eighth field and it disagreed with the trace it labels —
 * `create_record` was tagged "Backend" though the backend opens no span for it,
 * and `spawn_engine` / `stream_output` were tagged "Engine" though the backend
 * measures both. It is composed in below from `BACKEND_PIPELINE_STAGES` via
 * `stageCategory`, so the badge cannot drift from the waterfall again.
 */
const STAGE_PALETTE: Record<PipelineStage, Omit<StageColor, 'category'>> = {
  initiate:           { bar: 'bg-blue-500/50',    barGradient: 'bg-gradient-to-r from-blue-500/60 to-cyan-500/50',       barShadow: 'shadow-[inset_0_1px_2px_rgba(59,130,246,0.3)]',   text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25', haloColor: 'shadow-[0_0_4px_rgba(59,130,246,0.5)]' },
  validate:           { bar: 'bg-emerald-500/50', barGradient: 'bg-gradient-to-r from-emerald-500/60 to-teal-500/50',    barShadow: 'shadow-[inset_0_1px_2px_rgba(16,185,129,0.3)]',   text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25',  haloColor: 'shadow-[0_0_4px_rgba(16,185,129,0.5)]' },
  create_record:      { bar: 'bg-emerald-500/50', barGradient: 'bg-gradient-to-r from-emerald-500/60 to-teal-500/50',    barShadow: 'shadow-[inset_0_1px_2px_rgba(16,185,129,0.3)]',   text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25',  haloColor: 'shadow-[0_0_4px_rgba(16,185,129,0.5)]' },
  spawn_engine:       { bar: 'bg-violet-500/50',  barGradient: 'bg-gradient-to-r from-violet-500/60 to-indigo-500/50',   barShadow: 'shadow-[inset_0_1px_2px_rgba(139,92,246,0.3)]',   text: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25',   haloColor: 'shadow-[0_0_4px_rgba(139,92,246,0.5)]' },
  stream_output:      { bar: 'bg-violet-500/50',  barGradient: 'bg-gradient-to-r from-violet-500/60 to-indigo-500/50',   barShadow: 'shadow-[inset_0_1px_2px_rgba(139,92,246,0.3)]',   text: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25',   haloColor: 'shadow-[0_0_4px_rgba(139,92,246,0.5)]' },
  finalize_status:    { bar: 'bg-emerald-500/50', barGradient: 'bg-gradient-to-r from-emerald-500/60 to-teal-500/50',    barShadow: 'shadow-[inset_0_1px_2px_rgba(16,185,129,0.3)]',   text: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25',  haloColor: 'shadow-[0_0_4px_rgba(16,185,129,0.5)]' },
  frontend_complete:  { bar: 'bg-blue-500/50',    barGradient: 'bg-gradient-to-r from-blue-500/60 to-cyan-500/50',       barShadow: 'shadow-[inset_0_1px_2px_rgba(59,130,246,0.3)]',   text: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25', haloColor: 'shadow-[0_0_4px_rgba(59,130,246,0.5)]' },
};

/**
 * Waterfall styling per pipeline stage, with the category derived rather than
 * declared. `Object.fromEntries` over `PIPELINE_STAGES` also makes the map
 * total by construction: a new stage cannot be added to the union and silently
 * omitted here.
 */
export const STAGE_COLORS: Record<PipelineStage, StageColor> = Object.fromEntries(
  PIPELINE_STAGES.map((stage) => [
    stage,
    { ...STAGE_PALETTE[stage], category: stageCategory(stage) },
  ]),
) as Record<PipelineStage, StageColor>;

// ---------------------------------------------------------------------------
// Tool step sub-span type
// ---------------------------------------------------------------------------

import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';

export type { ToolCallStep };

// Re-exported, not re-implemented: this file carried a byte-identical second
// copy of the hook's `parseToolSteps`, and only the hook's is under test.
export { parseToolSteps } from '@/hooks/execution/useReplayTimeline';
