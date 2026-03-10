import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

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

export const listScopedKnowledge = (
  scopeType: string,
  scopeId?: string,
  limit?: number,
) =>
  invoke<ExecutionKnowledge[]>('list_scoped_knowledge', {
    scopeType,
    scopeId: scopeId ?? null,
    limit: limit ?? null,
  });

export const upsertKnowledgeAnnotation = (
  personaId: string,
  scopeType: string,
  scopeId: string | null,
  annotationText: string,
  annotationSource?: string,
) =>
  invoke<ExecutionKnowledge>('upsert_knowledge_annotation', {
    personaId,
    scopeType,
    scopeId,
    annotationText,
    annotationSource: annotationSource ?? null,
  });

export const verifyKnowledgeAnnotation = (knowledgeId: string) =>
  invoke<void>('verify_knowledge_annotation', { knowledgeId });

export const dismissKnowledgeAnnotation = (knowledgeId: string) =>
  invoke<void>('dismiss_knowledge_annotation', { knowledgeId });

export const getSharedKnowledgeInjection = (
  toolNames: string[],
  connectorTypes: string[],
) =>
  invoke<ExecutionKnowledge[]>('get_shared_knowledge_injection', {
    toolNames,
    connectorTypes,
  });
