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

/**
 * Knowledge-type presentation, keyed by the backend's discriminator.
 *
 * `labelKey` rather than a label: display copy in a .ts module is copy that
 * cannot be translated, and this app ships 14 locales. The key is resolved
 * against `t.overview.knowledge_graph` at the render site.
 */
export type KnowledgeTypeLabelKey =
  | 'type_tool_sequence'
  | 'type_failure_pattern'
  | 'type_cost_quality'
  | 'type_model_performance'
  | 'type_data_flow'
  | 'type_agent_annotation'
  | 'type_user_annotation';

export const KNOWLEDGE_TYPES: Record<string, { labelKey: KnowledgeTypeLabelKey; color: string; icon: IconComponent }> = {
  tool_sequence: { labelKey: 'type_tool_sequence', color: 'emerald', icon: ToolSequenceIcon },
  failure_pattern: { labelKey: 'type_failure_pattern', color: 'red', icon: FailurePatternIcon },
  cost_quality: { labelKey: 'type_cost_quality', color: 'blue', icon: CostQualityIcon },
  model_performance: { labelKey: 'type_model_performance', color: 'violet', icon: ModelPerformanceIcon },
  data_flow: { labelKey: 'type_data_flow', color: 'amber', icon: DataFlowIcon },
  agent_annotation: { labelKey: 'type_agent_annotation', color: 'cyan', icon: AgentAnnotationIcon },
  user_annotation: { labelKey: 'type_user_annotation', color: 'sky', icon: UserAnnotationIcon },
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
export const formatCost = (usd: number | null | undefined) =>
  _formatCost(usd, { precision: 'auto' });

// Knowledge type/scope pills render via the shared `StatusBadge` (accent variant),
// which is the single source of truth for these accent colors — see
// `StatusBadge` ACCENT_CLASSES. The per-type `color` strings in KNOWLEDGE_TYPES /
// SCOPE_TYPES double as `BadgeAccent` keys, so no local color table is needed.
