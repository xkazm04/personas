/** Structured output sections parsed from execution output_data (JSON or NDJSON). */
export interface ParsedOutput {
  data: Record<string, unknown>;
  memories: Record<string, unknown>[];
  events: Record<string, unknown>[];
  reviews: Record<string, unknown>[];
  userMessage: { title?: string; content?: string; content_type?: string; priority?: string } | null;
  executionFlow: { flows?: Array<Record<string, unknown>> } | null;
  knowledgeAnnotation: Record<string, unknown> | null;
}

export type OutputSection = 'overview' | 'messages' | 'flow' | 'memories' | 'events' | 'reviews' | 'knowledge' | 'outcome' | 'json';

export function parseOutputData(raw: string | null): ParsedOutput | null {
  if (!raw) return null;

  const result: ParsedOutput = {
    data: {}, memories: [], events: [], reviews: [],
    userMessage: null, executionFlow: null, knowledgeAnnotation: null,
  };

  // Try single JSON first
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      if (data.user_message || data.execution_flow || data.memories || data.events) {
        result.data = data;
        result.memories = Array.isArray(data.memories) ? data.memories : [];
        result.events = Array.isArray(data.events) ? data.events : [];
        result.reviews = Array.isArray(data.reviews) ? data.reviews : Array.isArray(data.manual_reviews) ? data.manual_reviews : [];
        result.userMessage = data.user_message ?? null;
        result.executionFlow = data.execution_flow ?? null;
        result.knowledgeAnnotation = data.knowledge_annotation ?? null;
        return result;
      }
    }
  } catch { /* try NDJSON */ }

  // Parse NDJSON
  let foundAny = false;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) continue;
    try {
      const obj = JSON.parse(trimmed) as Record<string, unknown>;
      if (obj.user_message && typeof obj.user_message === 'object') { result.userMessage = obj.user_message as ParsedOutput['userMessage']; foundAny = true; }
      if (obj.execution_flow && typeof obj.execution_flow === 'object') { result.executionFlow = obj.execution_flow as ParsedOutput['executionFlow']; foundAny = true; }
      if (obj.agent_memory && typeof obj.agent_memory === 'object') { result.memories.push(obj.agent_memory as Record<string, unknown>); foundAny = true; }
      if (obj.emit_event && typeof obj.emit_event === 'object') { result.events.push(obj.emit_event as Record<string, unknown>); foundAny = true; }
      if (obj.manual_review && typeof obj.manual_review === 'object') { result.reviews.push(obj.manual_review as Record<string, unknown>); foundAny = true; }
      if (obj.knowledge_annotation && typeof obj.knowledge_annotation === 'object') { result.knowledgeAnnotation = obj.knowledge_annotation as Record<string, unknown>; foundAny = true; }
      if (obj.outcome_assessment && typeof obj.outcome_assessment === 'object') { (result.data as Record<string, unknown>).outcome_assessment = obj.outcome_assessment; foundAny = true; }
    } catch { /* skip */ }
  }
  return foundAny ? result : null;
}
