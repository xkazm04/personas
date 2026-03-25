import type { TraceSpan } from '@/lib/bindings/TraceSpan';
import type { SpanType } from '@/lib/bindings/SpanType';
import { SYSTEM_OPERATION_CONFIG } from '../../libs/traceHelpers';

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

// ============================================================================
// Tree node type
// ============================================================================

export interface SpanNode {
  span: TraceSpan;
  children: SpanNode[];
  depth: number;
}

export function buildSpanTree(spans: TraceSpan[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  // Create nodes
  for (const span of spans) {
    byId.set(span.span_id, { span, children: [], depth: 0 });
  }

  // Wire parent-child
  for (const span of spans) {
    const node = byId.get(span.span_id)!;
    if (span.parent_span_id) {
      const parent = byId.get(span.parent_span_id);
      if (parent) {
        node.depth = parent.depth + 1;
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  // Sort children by start_ms
  const sortChildren = (node: SpanNode) => {
    node.children.sort((a, b) => a.span.start_ms - b.span.start_ms);
    node.children.forEach(sortChildren);
  };
  roots.forEach(sortChildren);

  return roots;
}

export function flattenTree(nodes: SpanNode[]): SpanNode[] {
  const result: SpanNode[] = [];
  const walk = (node: SpanNode) => {
    result.push(node);
    node.children.forEach(walk);
  };
  nodes.forEach(walk);
  return result;
}
