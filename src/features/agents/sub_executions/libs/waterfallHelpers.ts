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

import type { ToolCallStep } from '@/lib/bindings/ToolCallStep';

export type { ToolCallStep };

export function parseToolSteps(raw: ToolCallStep[] | null): ToolCallStep[] {
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [];
}
