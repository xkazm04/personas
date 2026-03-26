import { Network, Globe, Wrench, Plug } from 'lucide-react';
import type { ComponentType, SVGProps } from 'react';
import {
  ToolSequenceIcon,
  FailurePatternIcon,
  CostQualityIcon,
  ModelPerformanceIcon,
  DataFlowIcon,
  AgentAnnotationIcon,
  UserAnnotationIcon,
} from './KnowledgeTypeIcons';

type IconComponent = ComponentType<SVGProps<SVGSVGElement>>;

export const KNOWLEDGE_TYPES: Record<string, { label: string; color: string; icon: IconComponent }> = {
  tool_sequence: { label: 'Tool Sequences', color: 'emerald', icon: ToolSequenceIcon },
  failure_pattern: { label: 'Failure Patterns', color: 'red', icon: FailurePatternIcon },
  cost_quality: { label: 'Cost / Quality', color: 'blue', icon: CostQualityIcon },
  model_performance: { label: 'Model Performance', color: 'violet', icon: ModelPerformanceIcon },
  data_flow: { label: 'Data Flows', color: 'amber', icon: DataFlowIcon },
  agent_annotation: { label: 'Agent Annotation', color: 'cyan', icon: AgentAnnotationIcon },
  user_annotation: { label: 'User Annotation', color: 'sky', icon: UserAnnotationIcon },
};

export const SCOPE_TYPES: Record<string, { label: string; icon: IconComponent; color: string }> = {
  persona: { label: 'Persona', icon: Network, color: 'violet' },
  tool: { label: 'Tool', icon: Wrench, color: 'emerald' },
  connector: { label: 'Connector', icon: Plug, color: 'blue' },
  global: { label: 'Global', icon: Globe, color: 'amber' },
};

import { formatDuration as _formatDuration } from '@/lib/utils/formatters';
export const formatDuration = (ms: number) => _formatDuration(ms, { precision: 'decimal' });

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export const COLOR_MAP: Record<string, { text: string; bg: string; border: string }> = {
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  red: { text: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20' },
  blue: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  amber: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  sky: { text: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
};
