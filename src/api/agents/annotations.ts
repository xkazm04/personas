import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { ExecutionAnnotation } from "@/lib/bindings/ExecutionAnnotation";

export const addAnnotation = (
  executionId: string,
  callerPersonaId: string,
  tags: string[],
  note: string | null,
  starred: boolean,
  author?: string,
) =>
  invoke<ExecutionAnnotation>("add_annotation", {
    executionId,
    callerPersonaId,
    tags,
    note,
    starred,
    author: author ?? null,
  });

export const listExecutionAnnotations = (executionId: string, callerPersonaId: string) =>
  invoke<ExecutionAnnotation[]>("list_execution_annotations", {
    executionId,
    callerPersonaId,
  });

export const listPersonaAnnotations = (
  personaId: string,
  opts?: { limit?: number; executionIds?: string[] },
) =>
  invoke<ExecutionAnnotation[]>("list_persona_annotations", {
    personaId,
    limit: opts?.limit ?? null,
    executionIds: opts?.executionIds ?? null,
  });

export const deleteAnnotation = (id: string) =>
  invoke<void>("delete_annotation", { id });
