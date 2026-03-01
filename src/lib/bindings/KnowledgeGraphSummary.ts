import type { ExecutionKnowledge } from './ExecutionKnowledge';

export interface KnowledgeGraphSummary {
  total_entries: number;
  tool_sequence_count: number;
  failure_pattern_count: number;
  model_performance_count: number;
  top_patterns: ExecutionKnowledge[];
  recent_learnings: ExecutionKnowledge[];
}
