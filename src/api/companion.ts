import { invokeWithTimeout as invoke } from '@/lib/tauriInvoke';

/**
 * Initialize the companion-brain disk layout (idempotent).
 * Returns the absolute path to ~/.personas/companion-brain/.
 *
 * Singleton dedupe via `globalThis`: callers from StrictMode double-effects,
 * HMR re-evaluations (which reset module-level state!), or component
 * remounts all share the same promise instead of firing parallel
 * `companion_init` invocations (each of which spawns its own background
 * doctrine ingest). The cache is keyed on globalThis so it survives Vite
 * HMR replacing this module — module-level `let` would NOT survive.
 *
 * This matches the project's "globalThis for HMR-surviving singletons"
 * convention (see CLAUDE.md). Manual re-ingest goes through
 * `companionReingestDoctrine` rather than re-running init.
 */
const COMPANION_INIT_KEY = '__personas_companion_init__';
type GlobalSlot = { promise: Promise<string> | null };
function initSlot(): GlobalSlot {
  const g = globalThis as unknown as Record<string, GlobalSlot>;
  if (!g[COMPANION_INIT_KEY]) {
    g[COMPANION_INIT_KEY] = { promise: null };
  }
  return g[COMPANION_INIT_KEY];
}

export async function companionInit(): Promise<string> {
  const slot = initSlot();
  if (slot.promise) return slot.promise;
  slot.promise = invoke<string>('companion_init').catch((err) => {
    // Allow retry on failure so the user can recover by closing/reopening
    // the panel after fixing the underlying issue. Successful inits stay
    // cached for the lifetime of the page.
    slot.promise = null;
    throw err;
  });
  return slot.promise;
}

export interface SendTurnResult {
  userEpisodeId: string;
  assistantEpisodeId: string;
  /**
   * Preset quick-reply labels Athena offered for this turn. Each entry
   * is the literal user message that gets sent on click. Empty when
   * Athena didn't offer any. UI renders these as a chip row under the
   * latest assistant bubble until the next send fires.
   */
  quickReplies: string[];
  /**
   * Spoken-version of the reply (1-3 sentences, conversational) for
   * ElevenLabs playback. Present when voice is enabled AND Athena emitted
   * a `TTS:` line. Null otherwise. Frontend stashes this as the latest
   * unread playback and either auto-plays (if user is on the panel) or
   * makes it available via the footer Play button.
   */
  ttsText: string | null;
}

/**
 * Send a user message; resolves once Claude finishes the turn. Streaming
 * progress arrives separately on the `companion://stream` Tauri event.
 *
 * `voiceEnabled` tells Athena to emit a `TTS:` line in addition to her
 * normal markdown reply. When false (default), no spoken summary is
 * generated and `ttsText` in the result is null.
 */
export async function companionSendMessage(
  message: string,
  voiceEnabled: boolean = false,
): Promise<SendTurnResult> {
  return invoke<SendTurnResult>('companion_send_message', {
    message,
    voiceEnabled,
  });
}

/**
 * ElevenLabs TTS proxy. Backend reads the decrypted API key from the
 * vault, calls ElevenLabs, and returns the audio bytes as base64 (which
 * crosses the Tauri IPC boundary cleanly). Frontend wraps the bytes in a
 * Blob and plays via an `<audio>` element.
 *
 * `credentialId` is the vault row id for an ElevenLabs credential. The
 * backend rejects anything else.
 */
export interface TtsAudio {
  audioBase64: string;
  mimeType: string;
  byteSize: number;
}

export async function companionTts(
  text: string,
  credentialId: string,
  voiceId: string,
): Promise<TtsAudio> {
  return invoke<TtsAudio>('companion_tts', { text, credentialId, voiceId });
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
  /**
   * UI-only follow-up the frontend should run after a successful
   * approve. Currently the only kind is `navigate` (sidebar route
   * switch); more variants will join as Phase B grows (prefill flows,
   * focus-detail, etc).
   */
  clientAction?: ClientAction | null;
}

export type ClientAction = { type: 'navigate'; route: string };

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

/**
 * Tauri event for direct sidebar navigation triggered by Athena's
 * `open_route` op. Payload: the route name (string). Bypasses the
 * approval flow — the chat panel stays open and the sidebar switches
 * behind it.
 */
export const COMPANION_NAVIGATE_EVENT = 'companion://navigate';

/** Payload for COMPANION_APPROVALS_EVENT — array of newly-created approvals. */
export interface CreatedApproval {
  id: string;
  action: string;
  paramsJson: string;
  rationale: string;
}

// ── Brain Viewer ────────────────────────────────────────────────────────

/**
 * Brain item kinds the viewer knows how to list/show.
 *
 * Facts are scoped — the backend accepts both bare `fact` (all scopes
 * mixed) and the suffixed forms `fact:user`, `fact:project`, `fact:world`
 * to filter by scope. The viewer uses the scoped variants for the
 * grouped UI and the bare form for retrieval-time identity in detail.
 *
 * Reflections: scaffolded for the next milestone — the backend already
 * tolerates the kind, but no rows exist yet. UI hides the tab until the
 * reflection generator lands.
 */
export type BrainKind =
  | 'episode'
  | 'doctrine'
  | 'identity'
  | 'constitution'
  | 'fact'
  | 'fact:user'
  | 'fact:project'
  | 'fact:world'
  | 'reflection';

export interface BrainListItem {
  id: string;
  kind: BrainKind;
  title: string;
  preview: string;
  meta: string;
  deletable: boolean;
}

export interface BrainDetail {
  id: string;
  kind: BrainKind;
  title: string;
  content: string;
  meta: string;
  deletable: boolean;
}

export async function companionListBrainItems(
  kind: BrainKind,
): Promise<BrainListItem[]> {
  return invoke<BrainListItem[]>('companion_list_brain_items', { kind });
}

export async function companionGetBrainItem(
  kind: BrainKind,
  id: string,
): Promise<BrainDetail> {
  return invoke<BrainDetail>('companion_get_brain_item', { kind, id });
}

export async function companionDeleteBrainItem(
  kind: BrainKind,
  id: string,
): Promise<void> {
  return invoke<void>('companion_delete_brain_item', { kind, id });
}

// ── Phase C: consolidation + reflection ────────────────────────────────

/**
 * One run of the consolidation pipeline. `status`:
 *   - `running` — CLI in flight (rare to see, runs are short-ish)
 *   - `review` — proposals are persisted, waiting on user review
 *   - `applied` — every item is resolved (applied or rejected)
 *   - `failed` — the CLI errored; check `errorText`
 */
export interface ConsolidationRun {
  id: string;
  status: 'running' | 'review' | 'applied' | 'failed';
  triggeredAt: string;
  completedAt: string | null;
  episodesCount: number;
  itemsTotal: number;
  itemsPending: number;
  itemsApplied: number;
  itemsRejected: number;
  summary: string | null;
  errorText: string | null;
}

export interface ConsolidationItem {
  id: string;
  consolidationId: string;
  kind: 'add' | 'update' | 'contradict';
  scope: 'user' | 'project' | 'world';
  factKey: string;
  proposedValue: string;
  sources: string[];
  importance: number;
  confidence: number;
  supersedesId: string | null;
  rationale: string | null;
  status: 'pending' | 'applied' | 'rejected';
  factId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface ApplyConsolidationEdits {
  value?: string;
  key?: string;
  scope?: string;
  importance?: number;
  confidence?: number;
}

export async function companionRunConsolidation(): Promise<string> {
  return invoke<string>('companion_run_consolidation');
}

export async function companionListConsolidationRuns(
  limit?: number,
): Promise<ConsolidationRun[]> {
  return invoke<ConsolidationRun[]>('companion_list_consolidation_runs', { limit });
}

export async function companionGetConsolidationItems(
  consolidationId: string,
): Promise<ConsolidationItem[]> {
  return invoke<ConsolidationItem[]>('companion_get_consolidation_items', {
    consolidationId,
  });
}

export async function companionApplyConsolidationItem(
  itemId: string,
  edits?: ApplyConsolidationEdits,
): Promise<{ itemId: string; factId: string }> {
  return invoke('companion_apply_consolidation_item', {
    itemId,
    edits: edits ?? null,
  });
}

export async function companionRejectConsolidationItem(
  itemId: string,
): Promise<void> {
  return invoke<void>('companion_reject_consolidation_item', { itemId });
}

export async function companionDecayUnusedFacts(): Promise<number> {
  return invoke<number>('companion_decay_unused_facts');
}

export interface ReflectionRow {
  id: string;
  preview: string;
  createdAt: string;
}

export interface ReflectionDetail {
  id: string;
  body: string;
  createdAt: string;
}

export async function companionRunReflection(): Promise<string> {
  return invoke<string>('companion_run_reflection');
}

export async function companionListReflections(
  limit?: number,
): Promise<ReflectionRow[]> {
  return invoke<ReflectionRow[]>('companion_list_reflections', { limit });
}

export async function companionGetReflection(id: string): Promise<ReflectionDetail> {
  return invoke<ReflectionDetail>('companion_get_reflection', { id });
}

// ── Phase 4: self-improve loop ─────────────────────────────────────────

export interface CompanionBetaFlags {
  /** True when the wrench-send / self-improve UI should be exposed. */
  selfImproveEnabled: boolean;
}

export interface ImprovementOutcome {
  success: boolean;
  /** Final assistant summary text from the coding CLI. */
  summary: string;
  /** Files Claude touched (Edit/Write tool calls), repo-relative. */
  filesModified: string[];
  /** Subset of filesModified that match the critical-files allowlist. */
  criticalFiles: string[];
  elapsedSeconds: number;
  error: string | null;
}

export async function companionBetaFlags(): Promise<CompanionBetaFlags> {
  return invoke<CompanionBetaFlags>('companion_beta_flags');
}

export async function companionRequestImprovement(
  feedback: string,
): Promise<ImprovementOutcome> {
  return invoke<ImprovementOutcome>('companion_request_improvement', { feedback });
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
