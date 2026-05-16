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
/** Hard ceiling for a single chat turn. Athena is designed to run long
 * background tasks (codebase scans, idea generation, multi-step
 * reasoning); the default 90s invoke timeout is too short and surfaces
 * as a confusing "Tauri invoke timed out" error even though the
 * backend is still working. 15 minutes matches the backend's own
 * `TURN_TIMEOUT` so the frontend never gives up before the CLI does.
 */
const COMPANION_TURN_TIMEOUT_MS = 15 * 60 * 1000;

export async function companionSendMessage(
  message: string,
  voiceEnabled: boolean = false,
  recallSynthesisEnabled: boolean = false,
  autonomousMode: boolean = false,
): Promise<SendTurnResult> {
  return invoke<SendTurnResult>(
    'companion_send_message',
    { message, voiceEnabled, recallSynthesisEnabled, autonomousMode },
    { timeoutMs: COMPANION_TURN_TIMEOUT_MS },
  );
}

/**
 * Cancel any scheduled autonomous-continuation tick. Backend best-
 * effort: drops the JoinHandle if pending; if a continuation already
 * started, this is a no-op (use `companionInterruptTurn` to stop the
 * in-flight stream instead). Idempotent.
 */
export async function companionCancelAutonomy(): Promise<void> {
  return invoke<void>('companion_cancel_autonomy');
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
  /** `audio/mpeg` for ElevenLabs (MP3), `audio/wav` for Piper. */
  mimeType: string;
  byteSize: number;
}

/**
 * Identifier for which engine should fulfill a TTS request. Matches the
 * snake_case wire format the Rust `TtsEngineId` enum serializes to.
 *
 * - `'elevenlabs'`: cloud TTS via the ElevenLabs API. Requires a vault
 *   credential and a voice id from the user's ElevenLabs account.
 * - `'piper'`: local TTS via ONNX inference (no network, no credential
 *   needed). Requires a Piper voice model previously downloaded through
 *   the companion voice manager.
 */
export type TtsEngineId = 'elevenlabs' | 'piper';

/**
 * Per-call voice tuning. All fields optional; `undefined` falls back to
 * the per-engine defaults. Some fields only apply to certain engines —
 * unrelated engines silently ignore them, so it's safe to send the full
 * union.
 *
 * ElevenLabs-only: modelId, stability, similarityBoost, style.
 * Piper-only: lengthScale, noiseScale.
 * Shared: speed.
 */
export interface TtsSettings {
  modelId?: string;
  stability?: number;
  similarityBoost?: number;
  speed?: number;
  style?: number;
  lengthScale?: number;
  noiseScale?: number;
}

/**
 * Synthesize speech for the given text.
 *
 * `engine` defaults to `'elevenlabs'` so existing callers that only knew
 * the cloud path keep working. `credentialId` is required for ElevenLabs
 * and ignored for Piper (pass `null` for local engines).
 */
export async function companionTts(
  text: string,
  credentialId: string | null,
  voiceId: string,
  settings?: TtsSettings,
  engine: TtsEngineId = 'elevenlabs',
): Promise<TtsAudio> {
  return invoke<TtsAudio>('companion_tts', {
    text,
    voiceId,
    engine,
    credentialId,
    settings: settings ?? null,
  });
}

// ── Piper voice catalog + downloads ─────────────────────────────────────

/**
 * Catalog row + download status. The Voice tab renders these as a
 * scrollable list of cards grouped by language. `isDownloaded` decides
 * whether the row's primary action is "Download" or "Select".
 */
export interface PiperVoiceListing {
  voiceId: string;
  languageCode: string;
  languageLabel: string;
  languageNativeLabel: string;
  speaker: string;
  gender: 'female' | 'male' | 'neutral';
  quality: 'x_low' | 'low' | 'medium' | 'high';
  approxSizeMb: number;
  description: string;
  isDownloaded: boolean;
}

/**
 * Streaming progress for a single Piper voice download. Frontend
 * subscribes to the `companion://tts-download` Tauri event channel and
 * matches by `voiceId`.
 *
 * `bytesTotal` is `null` when the upstream doesn't report Content-Length
 * (rare but possible) — UI should fall back to indeterminate progress.
 */
export interface TtsDownloadProgress {
  voiceId: string;
  state: 'queued' | 'downloading' | 'completed' | 'failed';
  bytesDownloaded: number;
  bytesTotal: number | null;
  error: string | null;
}

/**
 * Tauri event channel name for download progress + terminal states.
 */
export const TTS_DOWNLOAD_EVENT = 'companion://tts-download';

export async function companionTtsListPiperVoices(): Promise<PiperVoiceListing[]> {
  return invoke<PiperVoiceListing[]>('companion_tts_list_piper_voices');
}

/**
 * Start a Piper voice download. Resolves once both `.onnx` and `.onnx.json`
 * are on disk. Progress is reported through `TTS_DOWNLOAD_EVENT` events
 * which the caller should subscribe to before invoking.
 */
export async function companionTtsDownloadPiperVoice(voiceId: string): Promise<void> {
  return invoke<void>('companion_tts_download_piper_voice', { voiceId });
}

export async function companionTtsDeletePiperVoice(voiceId: string): Promise<void> {
  return invoke<void>('companion_tts_delete_piper_voice', { voiceId });
}

/**
 * Status of the Piper engine binary on disk. The Voice tab uses this to
 * render an Installed / Not installed badge above the voice catalog and
 * to surface the exact install path so the user can manually drop the
 * binary into place.
 */
export interface PiperEngineStatus {
  installed: boolean;
  /** Resolved binary path when `installed` is true, else null. */
  binaryPath: string | null;
  /** Where the user should put the engine if installing manually. */
  expectedPath: string;
  /** Filename — `piper.exe` on Windows, `piper` elsewhere. */
  expectedFilename: string;
}

export async function companionTtsPiperEngineStatus(): Promise<PiperEngineStatus> {
  return invoke<PiperEngineStatus>('companion_tts_piper_engine_status');
}

// ── Sensory toggles (Phase 2 v2 — desktop-awareness UI) ─────────────────

export type SensorySource =
  | 'clipboard'
  | 'file_watcher'
  | 'app_focus'
  // Phase 5 v1: read-time gate for the user's active Claude CLI session.
  // Unlike the three above, no signals are captured for this — toggling it
  // controls whether the runner reads the transcript and injects a prefix.
  | 'cli_session';

export interface SensorySourceStateView {
  globalEnabled: boolean;
  clipboardEnabled: boolean;
  fileChangesEnabled: boolean;
  appFocusEnabled: boolean;
  cliSessionEnabled: boolean;
  clipboardSignalsInWindow: number;
  fileChangesSignalsInWindow: number;
  appFocusSignalsInWindow: number;
  totalSignalsCaptured: number;
}

/**
 * Read the current per-source capture-gate state for the companion's
 * ambient context. Backend defaults all per-source toggles OFF; the
 * UI flips them ON via {@link companionSetSensorySourceEnabled}.
 *
 * `totalSignalsCaptured` is u64 on the Rust side; the ts-rs binding
 * uses bigint, but we coerce to number here because JS Number is
 * sufficient for the foreseeable signal counts (a `2^53`-bound is
 * safely above the 30-signal rolling-window cap × any reasonable
 * session length).
 */
export async function companionGetSensoryState(): Promise<SensorySourceStateView> {
  const raw = await invoke<{
    globalEnabled: boolean;
    clipboardEnabled: boolean;
    fileChangesEnabled: boolean;
    appFocusEnabled: boolean;
    cliSessionEnabled?: boolean;
    clipboardSignalsInWindow: number;
    fileChangesSignalsInWindow: number;
    appFocusSignalsInWindow: number;
    totalSignalsCaptured: number | bigint;
  }>('companion_get_sensory_state');
  return {
    ...raw,
    cliSessionEnabled: raw.cliSessionEnabled ?? false,
    totalSignalsCaptured:
      typeof raw.totalSignalsCaptured === 'bigint'
        ? Number(raw.totalSignalsCaptured)
        : raw.totalSignalsCaptured,
  };
}

// ── Phase 5 v1: CLI session-resume awareness audit ────────────────────────

/**
 * One row from the `cli_session_read_audit` table — represents a single
 * time a persona execution injected a Claude CLI session block into its
 * prompt prefix. Surfaced in the "What did Athena see?" modal so the
 * user can review what was extracted on their behalf.
 */
export interface CliSessionReadAuditView {
  id: string;
  personaId: string;
  personaName: string;
  project: string;
  /** Number of conversation turns extracted (capped at 8). */
  turnCount: number;
  /** Unix epoch seconds when the read happened. */
  readAt: number;
}

/**
 * List recent CLI session read audit rows. Newest first, capped at
 * `limit` (default 50, hard-clamped server-side at 200). The audit
 * is append-only — there's no delete counterpart because the read
 * already happened. TTL eviction (24h) keeps the table bounded.
 */
export async function companionListCliSessionReads(
  limit?: number,
): Promise<CliSessionReadAuditView[]> {
  const raw = await invoke<
    Array<{
      id: string;
      personaId: string;
      personaName: string;
      project: string;
      turnCount: number | bigint;
      readAt: number | bigint;
    }>
  >('companion_list_cli_session_reads', { limit });
  return raw.map((r) => ({
    id: r.id,
    personaId: r.personaId,
    personaName: r.personaName,
    project: r.project,
    turnCount: typeof r.turnCount === 'bigint' ? Number(r.turnCount) : r.turnCount,
    readAt: typeof r.readAt === 'bigint' ? Number(r.readAt) : r.readAt,
  }));
}

/**
 * Toggle a per-source capture gate. Returns the number of signals
 * purged from the rolling window when transitioning from on → off
 * (always 0 on the off → on direction). Privacy contract: disabling
 * a source stops new capture AND drops what was already captured.
 */
export async function companionSetSensorySourceEnabled(
  source: SensorySource,
  enabled: boolean,
): Promise<number> {
  return invoke<number>('companion_set_sensory_source_enabled', { source, enabled });
}

/**
 * One captured ambient signal as the UI sees it. Mirrors the Rust-side
 * `AmbientSignalEntry` shape but with `bigint` fields coerced to `number`
 * since the rolling window holds at most ~30 signals — well below the
 * safe-integer cap.
 */
export interface SensorySignalEntry {
  id: string;
  source: SensorySource;
  summary: string;
  capturedAt: number;
  ageSecs: number;
  /**
   * Redacted preview of the captured payload (Phase 3 — clipboard MVP).
   * Present for clipboard signals when the user has the source enabled;
   * `null` for file-watcher and app-focus signals (which carry
   * everything in the summary). Credential-shaped substrings are
   * already masked at capture (`[REDACTED:jwt]`, `[REDACTED:aws-key]`,
   * `[email]`, etc.).
   */
  redactedContent: string | null;
}

/**
 * List captured ambient signals for the "What did Athena see?" view.
 * Optional `source` narrows to one of the three known sources; omitting
 * returns all sources. `limit` is clamped server-side to 200; default is
 * 50 (comfortably above the ~30 rolling-window cap).
 *
 * Returns newest-first.
 */
export async function companionListSensorySignals(
  source?: SensorySource,
  limit?: number,
): Promise<SensorySignalEntry[]> {
  const raw = await invoke<
    Array<{
      id: string;
      source: SensorySource;
      summary: string;
      capturedAt: number | bigint;
      ageSecs: number | bigint;
      redactedContent: string | null;
    }>
  >('companion_list_sensory_signals', {
    source: source ?? null,
    limit: limit ?? null,
  });
  return raw.map((s) => ({
    id: s.id,
    source: s.source,
    summary: s.summary,
    capturedAt:
      typeof s.capturedAt === 'bigint' ? Number(s.capturedAt) : s.capturedAt,
    ageSecs:
      typeof s.ageSecs === 'bigint' ? Number(s.ageSecs) : s.ageSecs,
    redactedContent: s.redactedContent,
  }));
}

/**
 * Delete a specific captured signal by id. Returns true when the signal
 * was found and removed; false when it was already gone (e.g. evicted
 * by the rolling-window TTL between the user opening the view and
 * clicking delete). Idempotent — calling twice is safe.
 */
export async function companionDeleteSensorySignal(id: string): Promise<boolean> {
  return invoke<boolean>('companion_delete_sensory_signal', { id });
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

/**
 * Request that an in-flight turn be interrupted. Best-effort: the
 * backend polls the registry every ~200ms during streaming, so a click
 * registered between `Started` and the first CLI line lands on the
 * next tick. The partial reply (if any) is persisted as the assistant
 * episode, tagged `[interrupted by user]`. Idempotent.
 */
export async function companionInterruptTurn(turnId: string): Promise<void> {
  return invoke<void>('companion_interrupt_turn', { turnId });
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
export interface CompanionTemplateMatch {
  id: string;
  name: string;
  /** First ~200 chars of the instruction body. */
  snippet: string;
  category: string | null;
  connectors: string[];
}

/**
 * Lightweight keyword match against the persona_design_reviews table for
 * Athena's `show_template_suggestions` chat-card. No LLM call — the
 * widget surfaces top matches as a "worth a look" pointer; users wanting
 * LLM-ranked search use the design-reviews view's smart-search.
 */
export async function companionMatchTemplates(
  intent: string,
  limit?: number,
): Promise<CompanionTemplateMatch[]> {
  return invoke<CompanionTemplateMatch[]>('companion_match_templates', {
    intent,
    limit: limit ?? null,
  });
}

export interface CompanionDesignDecision {
  id: string;
  sessionId: string;
  personaContext: string | null;
  label: string;
  choice: string;
  rationale: string;
  decisionTimestamp: string | null;
  createdAt: string;
}

/**
 * Retrospective list of design decisions Athena has logged across all
 * conversations. Filter by `personaContext` to scope to a specific
 * persona id / build session id / intent string.
 */
export async function companionListDesignDecisions(
  personaContext?: string | null,
  limit?: number,
): Promise<CompanionDesignDecision[]> {
  return invoke<CompanionDesignDecision[]>('companion_list_design_decisions', {
    personaContext: personaContext ?? null,
    limit: limit ?? null,
  });
}

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
  status: 'approved' | 'approved_failed' | 'rejected';
  message: string;
  /**
   * UI-only follow-up the frontend should run after a successful
   * approve. Currently the only kind is `navigate` (sidebar route
   * switch); more variants will join as Phase B grows (prefill flows,
   * focus-detail, etc).
   */
  clientAction?: ClientAction | null;
}

/**
 * Client-side follow-up the frontend runs after an approval lands.
 * Discriminated by `type`. Backend mirror: `commands::companion::approvals::ClientAction`.
 *
 * - `navigate`: switch the sidebar to a top-level section.
 * - `prefill_persona_create`: stash a prefill payload + route to
 *   `personas`. UnifiedBuildEntry reads it and (if `auto_launch`)
 *   kicks off the build.
 */
export type ClientAction =
  | { type: 'navigate'; route: string }
  | {
      type: 'prefill_persona_create';
      intent: string;
      name: string | null;
      autoLaunch: boolean;
      /** Optional build strategy when autoLaunch is true. */
      mode?: 'interactive' | 'one_shot';
      /** Companion session that originated the build (threaded for BuildWatcher). */
      companionSessionId?: string | null;
    }
  | {
      type: 'open_companion_tab';
      tab: 'setup' | 'memory' | 'voice' | 'dashboard' | string;
    };

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
 * Phase F: emitted when Athena's `open_lab` op fires. Bypasses
 * approvals like NAVIGATE_EVENT. Payload selects which persona's lab
 * to open and which mode (`arena`, `ab`, `versions`, etc.).
 */
export const COMPANION_OPEN_LAB_EVENT = 'companion://open-lab';

export interface OpenLabEvent {
  personaId: string;
  mode: string;
}

/**
 * Phase F: emitted when Athena's `compose_dashboard` op fires (auto-
 * approve path). The spec is already persisted server-side; the
 * frontend just navigates to the Companion → Dashboard tab. Empty
 * payload — no need to ship the spec across IPC, the dashboard panel
 * re-fetches from `companion_get_dashboard` on mount.
 */
export const COMPANION_COMPOSE_DASHBOARD_EVENT = 'companion://compose-dashboard';

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
  | 'reflection'
  // Phase D
  | 'procedural'
  | 'procedural:chat'
  | 'procedural:action'
  | 'procedural:memory'
  | 'procedural:build'
  | 'goal'
  | 'goal:active'
  | 'goal:paused'
  | 'goal:completed'
  | 'goal:abandoned'
  | 'ritual'
  | 'ritual:quiet_hours'
  | 'ritual:cadence'
  | 'ritual:focus_window'
  | 'backlog'
  | 'backlog:self_promise'
  | 'backlog:capability_gap'
  // Audit trail of design choices — populated by the dispatcher
  // whenever Athena emits a show_decision_log card.
  | 'design_decision';

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

// ── Phase E: proactive messaging ──────────────────────────────────────

/**
 * One nudge Athena drafted on her own initiative. `triggerKind`
 * tells the UI what kind of context to show (goal target, aging
 * promise, ritual cadence) and `triggerRef` is the row id of the
 * thing that fired (used for deep-linking from the card to the
 * brain inspector — e.g., clicking a goal-approaching nudge could
 * open the goal detail).
 */
export interface ProactiveMessage {
  id: string;
  triggerKind:
    | 'goal_target_approaching'
    | 'backlog_aging'
    | 'cadence_due'
    | 'athena_scheduled'
    | string;
  triggerRef: string | null;
  message: string;
  status: 'queued' | 'delivered' | 'engaged' | 'dismissed' | 'expired';
  createdAt: string;
  deliveredAt: string | null;
  resolvedAt: string | null;
  /**
   * ISO8601 UTC. Non-null on rows Athena scheduled via `schedule_proactive`
   * — the deliver-due sweep holds them in `queued` until this timestamp
   * is reached. Null for trigger-driven nudges (delivered as soon as
   * their guards pass).
   */
  scheduledFor: string | null;
}

/** Tauri event channel — new proactive messages arriving from the engine. */
export const COMPANION_PROACTIVE_EVENT = 'companion://proactive';

export interface ProactiveDeliveryEvent {
  messages: ProactiveMessage[];
}

/** Force a trigger evaluation pass (in addition to the 5-min scheduler). */
export async function companionEvaluateProactiveNow(): Promise<number> {
  return invoke<number>('companion_evaluate_proactive_now');
}

export async function companionListProactiveMessages(
  onlyUnresolved?: boolean,
  limit?: number,
): Promise<ProactiveMessage[]> {
  return invoke<ProactiveMessage[]>('companion_list_proactive_messages', {
    onlyUnresolved: onlyUnresolved ?? null,
    limit: limit ?? null,
  });
}

export interface EngageProactiveOutcome {
  messageId: string;
  /** The message body — caller fires it through the normal chat-send path. */
  message: string;
}

export async function companionEngageProactive(
  messageId: string,
): Promise<EngageProactiveOutcome> {
  return invoke<EngageProactiveOutcome>('companion_engage_proactive', { messageId });
}

export async function companionDismissProactive(messageId: string): Promise<void> {
  return invoke<void>('companion_dismiss_proactive', { messageId });
}

// ── Phase F: dashboard composition (chat-driven UI playground) ─────────

/**
 * Widget kinds Athena can compose. Backend doesn't validate the kind
 * — it stores the spec as opaque JSON. The frontend's `widgetRegistry`
 * is the single source of truth for which kinds render and what
 * config shape each accepts.
 */
export type CompanionDashboardWidgetKind =
  | 'kpi_tile'
  | 'executions_status_chart'
  | 'cost_per_day_chart'
  | 'top_personas_list'
  // Round-2 additions — extend the visual palette without breaking
  // existing dashboards. Backend doesn't validate kinds, so old specs
  // keep rendering through the registry.
  | 'latency_distribution_chart'
  | 'success_rate_gauge'
  | 'persona_cost_donut'
  | 'activity_heatmap'
  | 'recent_executions_table';

/**
 * Spec for one widget. `config` is widget-specific — see
 * `widgetRegistry` in `sub_dashboard/`. `span` is a 1-12 grid hint;
 * the layout component clamps to row width.
 */
export interface CompanionDashboardWidget {
  id: string;
  kind: CompanionDashboardWidgetKind | string;
  title?: string;
  span?: number;
  config?: Record<string, unknown>;
}

export interface CompanionDashboardSpecBody {
  title?: string;
  widgets: CompanionDashboardWidget[];
  updatedAt?: string;
}

/** Wire shape returned by `companion_get_dashboard`. `null` when unset. */
export interface CompanionDashboardSpec {
  specJson: string;
  updatedAt: string;
}

export async function companionGetDashboard(): Promise<CompanionDashboardSpec | null> {
  return invoke<CompanionDashboardSpec | null>('companion_get_dashboard');
}

// ── Cockpit (compose_cockpit op) ─────────────────────────────────────

export type CompanionCockpitWidgetKind =
  | 'persona_overview'
  | 'connected_services'
  | 'decisions_panel'
  | 'message_summary'
  | 'execution_facts'
  | 'linked_decisions'
  | 'linked_memories';

export interface CompanionCockpitWidget {
  id: string;
  kind: CompanionCockpitWidgetKind | string;
  title?: string;
  span?: number;
  config?: Record<string, unknown>;
}

export interface CompanionCockpitSpecBody {
  title?: string;
  widgets: CompanionCockpitWidget[];
  updatedAt?: string;
}

/** Wire shape returned by `companion_get_cockpit`. `null` when unset. */
export interface CompanionCockpitSpec {
  specJson: string;
  updatedAt: string;
}

export async function companionGetCockpit(): Promise<CompanionCockpitSpec | null> {
  return invoke<CompanionCockpitSpec | null>('companion_get_cockpit');
}

/**
 * Append a single widget to the user's cockpit. Wired to the "Pin to
 * cockpit" affordance on `InlineChatCard`. Idempotent on the backend —
 * pinning the same {kind, config} twice is a no-op.
 */
export async function companionPinWidgetToCockpit(payload: {
  kind: string;
  title?: string | null;
  config?: Record<string, unknown> | null;
}): Promise<void> {
  return invoke<void>('companion_pin_widget_to_cockpit', {
    kind: payload.kind,
    title: payload.title ?? null,
    config: payload.config ?? null,
  });
}

/** Tauri event for `compose_cockpit` auto-fire. Payload is empty. */
export const COMPANION_COMPOSE_COCKPIT_EVENT = 'companion://compose-cockpit';

// ── Inline chat-cards (show_* ops) ───────────────────────────────────

/**
 * One inline chat-card emitted via `show_persona_overview`,
 * `show_connected_services`, or `show_decisions`. The frontend renders these
 * inside the latest assistant bubble (alongside ApprovalCards / QuickReplies).
 */
export interface ChatCard {
  /** Widget kind from the cockpit registry — currently
   *  `persona_overview` | `connected_services` | `decisions_panel`. */
  kind: string;
  title?: string;
  config?: Record<string, unknown>;
}

/** Tauri event for chat-card delivery. Auto-fire, no approval. */
export const COMPANION_CHAT_CARDS_EVENT = 'companion://chat-cards';

export interface CompanionChatCardsEvent {
  turnId: string;
  cards: ChatCard[];
}

// ── Phase F: connectors pinned in the chat sidebar ────────────────────

export interface CompanionConnector {
  connectorName: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function companionListActiveConnectors(): Promise<CompanionConnector[]> {
  return invoke<CompanionConnector[]>('companion_list_active_connectors');
}

/**
 * Replace the entire pinned set with `connectorNames`. Names already
 * pinned keep their `enabled` state; new names default to enabled.
 * Used by the "Apply" button on the picker modal.
 */
export async function companionSetActiveConnectors(
  connectorNames: string[],
): Promise<CompanionConnector[]> {
  return invoke<CompanionConnector[]>('companion_set_active_connectors', {
    connectorNames,
  });
}

export async function companionSetConnectorEnabled(
  connectorName: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>('companion_set_connector_enabled', {
    connectorName,
    enabled,
  });
}

export async function companionRemoveConnector(
  connectorName: string,
): Promise<void> {
  return invoke<void>('companion_remove_connector', { connectorName });
}

// ── Phase F: plugin toggles (dev_tools, future) ────────────────────────

export interface PluginToggle {
  pluginName: string;
  enabled: boolean;
  updatedAt: string;
}

export async function companionListPluginToggles(): Promise<PluginToggle[]> {
  return invoke<PluginToggle[]>('companion_list_plugin_toggles');
}

export async function companionSetPluginEnabled(
  pluginName: string,
  enabled: boolean,
): Promise<void> {
  return invoke<void>('companion_set_plugin_enabled', { pluginName, enabled });
}

// ── Phase G: project registry + background jobs ───────────────────────

export interface KnownProject {
  id: string;
  name: string;
  path: string;
  description: string | null;
  lastScanAt: string | null;
  lastScanSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackgroundJob {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | string;
  paramsJson: string;
  resultText: string | null;
  errorText: string | null;
  projectId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

/** Tauri event emitted on job status transitions (queued→running, completion). */
export const COMPANION_JOB_EVENT = 'companion://job';

export async function companionListProjects(): Promise<KnownProject[]> {
  return invoke<KnownProject[]>('companion_list_projects');
}

export async function companionRegisterProject(
  name: string,
  path: string,
  description?: string,
): Promise<string> {
  return invoke<string>('companion_register_project', {
    name,
    path,
    description: description ?? null,
  });
}

export async function companionListJobs(
  onlyUnresolved?: boolean,
  limit?: number,
): Promise<BackgroundJob[]> {
  return invoke<BackgroundJob[]>('companion_list_jobs', {
    onlyUnresolved: onlyUnresolved ?? null,
    limit: limit ?? null,
  });
}

export async function companionGetJob(id: string): Promise<BackgroundJob | null> {
  return invoke<BackgroundJob | null>('companion_get_job', { id });
}

export async function companionEnqueueJob(
  kind: string,
  params?: Record<string, unknown>,
  projectId?: string,
): Promise<string> {
  return invoke<string>('companion_enqueue_job', {
    kind,
    params: params ?? null,
    projectId: projectId ?? null,
  });
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

/**
 * Per-turn rollup of what Athena's brain pulled into the system prompt.
 * Fired once per turn, right after the prompt is built and right before
 * the CLI spawn — so the panel can show a "Athena consulted N memories"
 * strip above the streaming bubble.
 */
export const COMPANION_RECALL_PREVIEW_EVENT = 'companion://recall-preview';

export interface CompanionRecallPreviewEntry {
  /** Stable id of the underlying memory row (or doctrine file_path). */
  id: string;
  /** Short, glanceable label (≤60 chars, truncated server-side). */
  title: string;
}

export interface CompanionRecallPreview {
  episodeCount: number;
  doctrine: CompanionRecallPreviewEntry[];
  facts: CompanionRecallPreviewEntry[];
  procedurals: CompanionRecallPreviewEntry[];
  goals: CompanionRecallPreviewEntry[];
  backlog: CompanionRecallPreviewEntry[];
  /** True when a synthesis briefing replaced raw chunks this turn. */
  synthesized: boolean;
}

export interface CompanionRecallPreviewEvent {
  sessionId: string;
  turnId: string;
  preview: CompanionRecallPreview;
}

/**
 * Per-turn rollup of dispatcher side-effects keyed by assistant episode.
 * Fires once per turn after the dispatcher block. The panel renders a
 * tiny chip below the completed assistant bubble — total=0 turns are
 * silently elided.
 */
export const COMPANION_TURN_SUMMARY_EVENT = 'companion://turn-summary';

export interface CompanionTurnSummaryEvent {
  sessionId: string;
  turnId: string;
  assistantEpisodeId: string;
  approvals: number;
  navigations: number;
  labOpens: number;
  dashboards: number;
  cockpits: number;
  chatCards: number;
  continuation: boolean;
}
