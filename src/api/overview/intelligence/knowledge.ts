import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { ExecutionKnowledge } from '@/lib/bindings/ExecutionKnowledge';

export const getKnowledgeInjection = (
  personaId: string,
  useCaseId?: string,
) =>
  invoke<ExecutionKnowledge[]>('get_knowledge_injection', {
    personaId,
    useCaseId: useCaseId,
  });
