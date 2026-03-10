import type { ExecutionKnowledge } from './ExecutionKnowledge';

export interface KnowledgeGraphSummary {
  total_entries: number;
  tool_sequence_count: number;
  failure_pattern_count: number;
  model_performance_count: number;
<<<<<<< HEAD
  annotation_count: number;
=======
>>>>>>> 4922a97724aa56b26b532cfa6695776f4c697989
  top_patterns: ExecutionKnowledge[];
  recent_learnings: ExecutionKnowledge[];
}
