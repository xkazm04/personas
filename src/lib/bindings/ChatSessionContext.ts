export interface ChatSessionContext {
  sessionId: string;
  personaId: string;
  title: string | null;
  summary: string | null;
  systemPromptHash: string | null;
  workingMemory: string | null;
  chatMode: string;
  /** Claude CLI session ID for --resume continuity across chat messages. */
  claudeSessionId: string | null;
  updatedAt: string;
  createdAt: string;
}
