import { invoke } from '@tauri-apps/api/core';

import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';
import type { KnowledgeGraphSummary } from '@/lib/bindings/KnowledgeGraphSummary';

export const listExecutionKnowledge = (
  personaId: string,
  knowledgeType?: string,
  limit?: number,
) =>
  invoke<ExecutionKnowledge[]>('list_execution_knowledge', {
    personaId,
    knowledgeType: knowledgeType ?? null,
    limit: limit ?? null,
  });

export const getKnowledgeInjection = (
  personaId: string,
  useCaseId?: string,
) =>
  invoke<ExecutionKnowledge[]>('get_knowledge_injection', {
    personaId,
    useCaseId: useCaseId ?? null,
  });

export const getKnowledgeSummary = (personaId?: string) =>
  invoke<KnowledgeGraphSummary>('get_knowledge_summary', {
    personaId: personaId ?? null,
  });
