import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/**
 * Initialize the companion-brain disk layout (idempotent).
 * Returns the absolute path to ~/.personas/companion-brain/.
 */
export async function companionInit(): Promise<string> {
  return invoke<string>('companion_init');
}

export interface SendTurnResult {
  userEpisodeId: string;
  assistantEpisodeId: string;
}

/**
 * Send a user message; resolves once Claude finishes the turn. Streaming
 * progress arrives separately on the `companion://stream` Tauri event.
 */
export async function companionSendMessage(message: string): Promise<SendTurnResult> {
  return invoke<SendTurnResult>('companion_send_message', { message });
}

export interface CompanionMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export async function companionListRecentMessages(
  limit?: number,
): Promise<CompanionMessage[]> {
  return invoke<CompanionMessage[]>('companion_list_recent_messages', { limit });
}

/** Tauri event channel for streaming Claude CLI lines into the panel. */
export const COMPANION_STREAM_EVENT = 'companion://stream';

export interface CompanionStreamEvent {
  sessionId: string;
  turnId: string;
  kind: 'started' | 'cli' | 'finished' | 'error';
  /** Raw stream-json line for kind=cli, free-form text otherwise. */
  payload: string;
}
