import type { SpanType } from '@/lib/bindings/SpanType';
import { SYSTEM_OPERATION_CONFIG } from '../../libs/traceHelpers';

// Re-export the canonical UnifiedSpan-based tree helpers + SpanNode type
// from libs/traceHelpers so the inspector and SystemTraceViewer share one
// implementation. (Earlier, this file shipped a parallel TraceSpan-based
// copy of buildSpanTree/flattenTree/SpanNode that drifted.)
export type { SpanNode } from '../../libs/traceHelpers';
export { buildSpanTree, flattenTree } from '../../libs/traceHelpers';

// ============================================================================
// Span type config
// ============================================================================

const ENGINE_SPAN_CONFIG: Record<SpanType, { label: string; color: string; bg: string; border: string }> = {
  execution:             { label: 'Execution',      color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25' },
  prompt_assembly:       { label: 'Prompt',          color: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25' },
  credential_resolution: { label: 'Credentials',     color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25' },
  cli_spawn:             { label: 'CLI Spawn',       color: 'text-cyan-400',    bg: 'bg-cyan-500/15',    border: 'border-cyan-500/25' },
  tool_call:             { label: 'Tool Call',       color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  protocol_dispatch:     { label: 'Protocol',        color: 'text-pink-400',    bg: 'bg-pink-500/15',    border: 'border-pink-500/25' },
  chain_evaluation:      { label: 'Chain Eval',      color: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/25' },
  stream_processing:     { label: 'Stream',          color: 'text-sky-400',     bg: 'bg-sky-500/15',     border: 'border-sky-500/25' },
  outcome_assessment:    { label: 'Outcome',         color: 'text-lime-400',    bg: 'bg-lime-500/15',    border: 'border-lime-500/25' },
  healing_analysis:      { label: 'Healing',         color: 'text-red-400',     bg: 'bg-red-500/15',     border: 'border-red-500/25' },
  pipeline_stage:        { label: 'Pipeline Stage',  color: 'text-teal-400',    bg: 'bg-teal-500/15',    border: 'border-teal-500/25' },
};

/** Merged config covering engine spans and system operations. */
export const SPAN_TYPE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ...ENGINE_SPAN_CONFIG,
  ...SYSTEM_OPERATION_CONFIG,
};

const FALLBACK_CONFIG = { label: 'Unknown', color: 'text-gray-400', bg: 'bg-gray-500/15', border: 'border-gray-500/25' };

/** Get config for any span type (engine, pipeline, or system operation). */
export function getSpanTypeConfig(spanType: string): { label: string; color: string; bg: string; border: string } {
  return SPAN_TYPE_CONFIG[spanType] ?? FALLBACK_CONFIG;
}
