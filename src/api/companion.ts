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

/**
 * Reset the companion conversation.
 * - Always clears the persistent Claude CLI session id (next turn starts fresh).
 * - If `wipeTranscript` is true, also clears the SQL transcript so Athena
 *   sees an empty history. Markdown episodes on disk are preserved either way.
 */
export async function companionResetConversation(
  wipeTranscript?: boolean,
): Promise<void> {
  return invoke<void>('companion_reset_conversation', { wipeTranscript });
}

export interface DoctrineIngestSummary {
  filesSeen: number;
  filesMissing: number;
  chunksInserted: number;
  chunksUpdated: number;
  chunksUnchanged: number;
  chunksDeleted: number;
  errors: string[];
}

/**
 * Re-run doctrine ingestion. Idempotent — unchanged chunks are skipped.
 * Useful when curated docs change and Athena should pick up the latest
 * without an app restart.
 */
export async function companionReingestDoctrine(): Promise<DoctrineIngestSummary> {
  return invoke<DoctrineIngestSummary>('companion_reingest_doctrine');
}

// ── Phase 3: actions + approvals ───────────────────────────────────────

export interface PendingApproval {
  id: string;
  action: string;
  rationale: string;
  paramsJson: string;
  humanReviewId: string | null;
  createdAt: string;
}

export interface ApprovalOutcome {
  id: string;
  status: 'approved' | 'rejected';
  message: string;
}

export async function companionListPendingApprovals(): Promise<PendingApproval[]> {
  return invoke<PendingApproval[]>('companion_list_pending_approvals');
}

export async function companionApproveAction(
  approvalId: string,
): Promise<ApprovalOutcome> {
  return invoke<ApprovalOutcome>('companion_approve_action', { approvalId });
}

export async function companionRejectAction(
  approvalId: string,
  reason?: string,
): Promise<ApprovalOutcome> {
  return invoke<ApprovalOutcome>('companion_reject_action', { approvalId, reason });
}

/** Tauri event channel emitted when a turn produces new approval rows. */
export const COMPANION_APPROVALS_EVENT = 'companion://approvals';

/** Payload for COMPANION_APPROVALS_EVENT — array of newly-created approvals. */
export interface CreatedApproval {
  id: string;
  action: string;
  paramsJson: string;
  rationale: string;
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
