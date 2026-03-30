import type { SpanType } from '@/lib/bindings/SpanType';
import type { UnifiedSpan, UnifiedSpanType, PipelineStage, SystemOperationType } from '@/lib/execution/pipeline';
import { isPipelineStage, isSystemOperation, STAGE_META } from '@/lib/execution/pipeline';

/** Styling config for backend engine span types. */
export const SPAN_TYPE_CONFIG: Record<SpanType, { label: string; color: string; bg: string; border: string }> = {
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

/** Styling config for pipeline stage span types. */
const PIPELINE_STAGE_CONFIG: Record<PipelineStage, { label: string; color: string; bg: string; border: string }> = {
  initiate:          { label: 'Initiate',          color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25' },
  validate:          { label: 'Validate',          color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  create_record:     { label: 'Create Record',     color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  spawn_engine:      { label: 'Spawn Engine',      color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25' },
  stream_output:     { label: 'Stream Output',     color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25' },
  finalize_status:   { label: 'Finalize Status',   color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  frontend_complete: { label: 'Frontend Complete',  color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25' },
};

/** Styling config for system operation span types. */
export const SYSTEM_OPERATION_CONFIG: Record<SystemOperationType, { label: string; color: string; bg: string; border: string }> = {
  design_conversation:    { label: 'Design Chat',       color: 'text-indigo-400',  bg: 'bg-indigo-500/15',  border: 'border-indigo-500/25' },
  credential_design:      { label: 'Cred Design',       color: 'text-amber-400',   bg: 'bg-amber-500/15',   border: 'border-amber-500/25' },
  credential_negotiation: { label: 'Cred Negotiation',  color: 'text-yellow-400',  bg: 'bg-yellow-500/15',  border: 'border-yellow-500/25' },
  credential_healthcheck: { label: 'Cred Health',       color: 'text-green-400',   bg: 'bg-green-500/15',   border: 'border-green-500/25' },
  template_generation:    { label: 'Template Gen',      color: 'text-purple-400',  bg: 'bg-purple-500/15',  border: 'border-purple-500/25' },
  template_adoption:      { label: 'Template Adopt',    color: 'text-fuchsia-400', bg: 'bg-fuchsia-500/15', border: 'border-fuchsia-500/25' },
  template_review:        { label: 'Template Review',   color: 'text-rose-400',    bg: 'bg-rose-500/15',    border: 'border-rose-500/25' },
  subscription_evaluation:{ label: 'Subscription',      color: 'text-teal-400',    bg: 'bg-teal-500/15',    border: 'border-teal-500/25' },
  automation_design:      { label: 'Automation Design', color: 'text-cyan-400',    bg: 'bg-cyan-500/15',    border: 'border-cyan-500/25' },
  kb_ingest:              { label: 'KB Ingest',         color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/25' },
  recipe_execution:       { label: 'Recipe',            color: 'text-orange-400',  bg: 'bg-orange-500/15',  border: 'border-orange-500/25' },
  recipe_versioning:      { label: 'Recipe Version',    color: 'text-orange-300',  bg: 'bg-orange-400/15',  border: 'border-orange-400/25' },
  schema_proposal:        { label: 'Schema Proposal',   color: 'text-sky-400',     bg: 'bg-sky-500/15',     border: 'border-sky-500/25' },
  query_debug:            { label: 'Query Debug',       color: 'text-slate-400',   bg: 'bg-slate-500/15',   border: 'border-slate-500/25' },
  nl_query:               { label: 'NL Query',          color: 'text-blue-400',    bg: 'bg-blue-500/15',    border: 'border-blue-500/25' },
  setup_install:          { label: 'Setup',             color: 'text-lime-400',    bg: 'bg-lime-500/15',    border: 'border-lime-500/25' },
  context_generation:     { label: 'Context Gen',       color: 'text-violet-400',  bg: 'bg-violet-500/15',  border: 'border-violet-500/25' },
  task_execution:         { label: 'Task Exec',         color: 'text-pink-400',    bg: 'bg-pink-500/15',    border: 'border-pink-500/25' },
};

/** Get styling config for any unified span type (pipeline stage, engine span, or system operation). */
export function getSpanConfig(spanType: UnifiedSpanType): { label: string; color: string; bg: string; border: string } {
  if (isPipelineStage(spanType)) {
    return PIPELINE_STAGE_CONFIG[spanType] ?? { label: STAGE_META[spanType].label, color: 'text-gray-400', bg: 'bg-gray-500/15', border: 'border-gray-500/25' };
  }
  if (isSystemOperation(spanType)) {
    return SYSTEM_OPERATION_CONFIG[spanType];
  }
  return SPAN_TYPE_CONFIG[spanType as SpanType] ?? { label: spanType, color: 'text-gray-400', bg: 'bg-gray-500/15', border: 'border-gray-500/25' };
}

export interface SpanNode {
  span: UnifiedSpan;
  children: SpanNode[];
  depth: number;
}

export function buildSpanTree(spans: UnifiedSpan[]): SpanNode[] {
  const byId = new Map<string, SpanNode>();
  const roots: SpanNode[] = [];

  for (const span of spans) {
    byId.set(span.span_id, { span, children: [], depth: 0 });
  }

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
