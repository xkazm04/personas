export interface ChatMessage {
  id: string;
  personaId: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  executionId: string | null;
  metadata: string | null;
  createdAt: string;
}
