export interface ExecutionKnowledge {
  id: string;
  persona_id: string;
  use_case_id: string | null;
  knowledge_type: string;
  pattern_key: string;
  pattern_data: string;
  success_count: number;
  failure_count: number;
  avg_cost_usd: number;
  avg_duration_ms: number;
  confidence: number;
  last_execution_id: string | null;
  created_at: string;
  updated_at: string;
}
