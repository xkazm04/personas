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

import { formatCost as _formatCost } from '@/lib/utils/formatters';
export const formatCost = (usd: number) => _formatCost(usd, { precision: 'auto' });

// Knowledge type/scope pills render via the shared `StatusBadge` (accent variant),
// which is the single source of truth for these accent colors — see
// `StatusBadge` ACCENT_CLASSES. The per-type `color` strings in KNOWLEDGE_TYPES /
// SCOPE_TYPES double as `BadgeAccent` keys, so no local color table is needed.
