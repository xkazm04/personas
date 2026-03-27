import type { ChatRole } from "./ChatRole";

export interface ChatMessage {
  id: string;
  personaId: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  executionId: string | null;
  metadata: string | null;
  createdAt: string;
}
