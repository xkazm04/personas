import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

export interface NlQuerySnapshot {
  job_id: string;
  status: string;
  error: string | null;
  lines: string[];
  generated_sql: string | null;
  explanation: string | null;
}

export const startNlQuery = (
  queryId: string,
  credentialId: string,
  question: string,
  conversationHistory?: ConversationTurn[],
  databaseType?: string,
) =>
  invoke<void>("start_nl_query", {
    queryId,
    credentialId,
    question,
    conversationHistory,
    databaseType,
  });

export const getNlQuerySnapshot = (queryId: string) =>
  invoke<NlQuerySnapshot>("get_nl_query_snapshot", { queryId });

export const cancelNlQuery = (queryId: string) =>
  invoke<void>("cancel_nl_query", { queryId });
