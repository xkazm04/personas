import { invoke } from "@tauri-apps/api/core";

// ============================================================================
// Design Analysis
// ============================================================================

export interface DesignStartResult {
  design_id: string;
}

export interface FeasibilityResult {
  confirmed_capabilities: string[];
  issues: string[];
  overall: string;
}

export const startDesignAnalysis = (instruction: string, personaId: string, designId?: string) =>
  invoke<DesignStartResult>("start_design_analysis", { instruction, personaId, designId: designId ?? null });

export const refineDesign = (personaId: string, feedback: string, currentResult?: string | null, designId?: string, conversationId?: string | null) =>
  invoke<DesignStartResult>("refine_design", { personaId, feedback, currentResult: currentResult ?? null, designId: designId ?? null, conversationId: conversationId ?? null });

export const testDesignFeasibility = (designResult: string) =>
  invoke<FeasibilityResult>("test_design_feasibility", { designResult });

export const cancelDesignAnalysis = () =>
  invoke<void>("cancel_design_analysis");

// ============================================================================
// Design Conversations
// ============================================================================

import type { DesignConversation } from "@/lib/types/designTypes";

export const listDesignConversations = (personaId: string) =>
  invoke<DesignConversation[]>("list_design_conversations", { personaId });

export const getDesignConversation = (id: string) =>
  invoke<DesignConversation>("get_design_conversation", { id });

export const getActiveDesignConversation = (personaId: string) =>
  invoke<DesignConversation | null>("get_active_design_conversation", { personaId });

export const createDesignConversation = (personaId: string, title: string, messages: string) =>
  invoke<DesignConversation>("create_design_conversation", { personaId, title, messages });

export const appendDesignConversationMessage = (id: string, messages: string, lastResult?: string | null) =>
  invoke<DesignConversation>("append_design_conversation_message", { id, messages, lastResult: lastResult ?? null });

export const updateDesignConversationStatus = (id: string, status: string) =>
  invoke<void>("update_design_conversation_status", { id, status });

export const deleteDesignConversation = (id: string) =>
  invoke<void>("delete_design_conversation", { id });
