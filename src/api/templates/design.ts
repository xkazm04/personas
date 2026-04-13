import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import type { DesignStartResult } from "@/lib/bindings/DesignStartResult";
import type { FeasibilityResult } from "@/lib/bindings/FeasibilityResult";

export type { DesignStartResult } from "@/lib/bindings/DesignStartResult";
export type { FeasibilityResult } from "@/lib/bindings/FeasibilityResult";

export const startDesignAnalysis = (instruction: string, personaId: string, designId?: string) =>
  invoke<DesignStartResult>("start_design_analysis", { instruction, personaId, designId: designId });

export const refineDesign = (personaId: string, feedback: string, currentResult?: string | null, designId?: string, conversationId?: string | null) =>
  invoke<DesignStartResult>("refine_design", { personaId, feedback, currentResult: currentResult, designId: designId, conversationId: conversationId });

export const testDesignFeasibility = (designResult: string) =>
  invoke<FeasibilityResult>("test_design_feasibility", { designResult });

export const cancelDesignAnalysis = (designId?: string) =>
  invoke<void>("cancel_design_analysis", { designId: designId });

export const compileFromIntent = (personaId: string, intent: string, designId?: string) =>
  invoke<DesignStartResult>("compile_from_intent", { personaId, intent, designId: designId });

/** Assemble the full runtime prompt via the Rust engine.
 *  Pass `structuredPromptJson` to preview an unsaved draft without persisting. */
export const previewPrompt = (personaId: string, structuredPromptJson?: string | null) =>
  invoke<string>("preview_prompt", { personaId, structuredPromptJson: structuredPromptJson });

// ============================================================================
// Design Conversations
// ============================================================================

import type { AppendMessageResult, DesignConversation } from "@/lib/types/designTypes";

export const listDesignConversations = (personaId: string) =>
  invoke<DesignConversation[]>("list_design_conversations", { personaId });

export const getDesignConversation = (id: string) =>
  invoke<DesignConversation>("get_design_conversation", { id });

export const getActiveDesignConversation = (personaId: string) =>
  invoke<DesignConversation | null>("get_active_design_conversation", { personaId });

export const createDesignConversation = (personaId: string, title: string, messages: string) =>
  invoke<DesignConversation>("create_design_conversation", { personaId, title, messages });

export const appendDesignConversationMessage = (id: string, messages: string, lastResult?: string | null) =>
  invoke<DesignConversation>("append_design_conversation_message", { id, messages, lastResult: lastResult });

/** Append a single message server-side (O(1) IPC payload). */
export const appendSingleDesignMessage = (id: string, messageJson: string, lastResult?: string | null) =>
  invoke<AppendMessageResult>("append_single_design_message", { id, messageJson, lastResult: lastResult });

export const updateDesignConversationStatus = (id: string, status: string) =>
  invoke<void>("update_design_conversation_status", { id, status });

export const deleteDesignConversation = (id: string) =>
  invoke<void>("delete_design_conversation", { id });
