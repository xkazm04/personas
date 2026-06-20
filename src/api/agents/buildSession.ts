/**
 * Typed Tauri invoke wrappers for build session commands.
 *
 * These map 1:1 to the Rust commands registered in lib.rs invoke_handler.
 * The Channel parameter enables streaming BuildEvent updates from the backend.
 */
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { Channel } from "@tauri-apps/api/core";
import type {
  BuildEvent,
  BuildReference,
  BuildWebhookSource,
  PersistedBuildSession,
  BuildSessionSummary,
  PromoteBuildResult,
  TestReport,
} from "@/lib/types/buildTypes";

/**
 * Start a new build session for a persona. Returns the session ID.
 * Build events are streamed via the provided Channel.
 *
 * `mode` selects the gate-resolution strategy:
 *   - `"interactive"` (default) — ask-the-user clarifying flow.
 *   - `"one_shot"` — autonomous: LLM resolves every gate, retries test
 *     failures up to 3×, auto-promotes on success. Read-only Glyph view
 *     while running; OS notification + bell entry on terminal phase.
 *
 * `companionSessionId` links the build back to the Companion chat that
 * originated it so the BuildWatcher job can post a result message into
 * that chat's episode log on terminal phase.
 */
export async function startBuildSession(
  channel: Channel<BuildEvent>,
  personaId: string,
  intent: string,
  workflowJson?: string | null,
  parserResultJson?: string | null,
  language?: string | null,
  mode?: 'interactive' | 'one_shot' | null,
  companionSessionId?: string | null,
  context?: string | null,
): Promise<string> {
  return invokeWithTimeout<string>("start_build_session", {
    channel,
    personaId,
    intent,
    workflowJson: workflowJson ?? null,
    parserResultJson: parserResultJson ?? null,
    language: language ?? null,
    mode: mode ?? null,
    companionSessionId: companionSessionId ?? null,
    context: context ?? null,
  });
}

/** Submit an answer to a pending build question.
 *
 * `reference` is optional — supply when the question carried
 * `acceptsReference: true` and the user attached a file / URL / inline text.
 * The backend resolves the reference server-side (SSRF-safe URL fetch,
 * size cap, content-type guard) and prepends a fenced block to the answer
 * before piping it to the CLI subprocess. See
 * `src-tauri/src/engine/build_session/reference.rs`.
 *
 * `webhookSource` is optional — supply when the question carried
 * `acceptsWebhookSource: true` and the user attached a smee.io URL. The
 * backend appends a fenced WEBHOOK SOURCE block to the answer text so the
 * LLM places the URL on the trigger config; promote then auto-creates the
 * smee_relays binding (see `commands/design/build_sessions.rs::auto_create_smee_relays`).
 */
export async function answerBuildQuestion(
  sessionId: string,
  cellKey: string,
  answer: string,
  reference?: BuildReference | null,
  webhookSource?: BuildWebhookSource | null,
): Promise<void> {
  return invokeWithTimeout("answer_build_question", {
    sessionId,
    cellKey,
    answer,
    reference: reference ?? null,
    webhookSource: webhookSource ?? null,
  });
}

/** Cancel an in-progress build session. */
export async function cancelBuildSession(sessionId: string): Promise<void> {
  return invokeWithTimeout("cancel_build_session", { sessionId });
}

/**
 * Update the per-capability disabled-dims map on a build session row.
 * Pass `null` to clear the column; pass a JSON string
 * `{ [use_case_id]: GlyphDimension[] }` to set it. Drives the
 * SigilEditModal toggle in adoption + build modes.
 */
export async function updateBuildSessionDisabledDims(
  sessionId: string,
  disabledDimsJson: string | null,
): Promise<void> {
  return invokeWithTimeout("update_build_session_disabled_dims", {
    sessionId,
    disabledDimsJson,
  });
}

/** Get the active (non-completed, non-cancelled) build session for a persona. */
export async function getActiveBuildSession(
  personaId: string,
): Promise<PersistedBuildSession | null> {
  return invokeWithTimeout<PersistedBuildSession | null>(
    "get_active_build_session",
    { personaId },
  );
}

/** List build session summaries, optionally filtered by persona. */
export async function listBuildSessions(
  personaId?: string,
): Promise<BuildSessionSummary[]> {
  return invokeWithTimeout<BuildSessionSummary[]>("list_build_sessions", {
    personaId: personaId ?? null,
  });
}

/**
 * Test a build draft by executing each tool against its real API.
 * Returns a per-tool test report with HTTP status codes, latency, and errors.
 */
export async function testBuildDraft(
  sessionId: string,
  personaId: string,
): Promise<TestReport> {
  return invokeWithTimeout<TestReport>("test_build_draft", {
    sessionId,
    personaId,
  }, undefined, 180_000);
}

/**
 * Promote a build draft to production: updates the persona with enriched
 * prompt data and atomically creates tools, triggers, and connectors.
 *
 * `excludedUseCaseIds` (A-grade Phase 5b): capability ids the user
 * excluded via the preview panel. Match against the LLM-emitted id
 * (e.g. `uc_morning_digest`), NOT the post-promote UUID-rekeyed id.
 * Optional; missing/empty means "promote everything in agent_ir".
 */
export async function promoteBuildDraft(
  sessionId: string,
  personaId: string,
  excludedUseCaseIds?: string[],
): Promise<PromoteBuildResult> {
  return invokeWithTimeout<PromoteBuildResult>("promote_build_draft", {
    sessionId,
    personaId,
    excludedUseCaseIds: excludedUseCaseIds ?? null,
  });
}

// ---------------------------------------------------------------------------
// Dry-run / simulation (C7) — preview a capability before promoting.
// Backend: src-tauri/src/commands/design/build_simulate.rs
// ---------------------------------------------------------------------------

/** Minimal shape of a PersonaExecution row returned by simulate_build_draft.
 * Snake-case fields mirror what `serde` emits (no rename_all on PersonaExecution).
 */
export interface SimulatedExecution {
  id: string;
  persona_id: string;
  status: string;
  is_simulation?: boolean;
  use_case_id?: string | null;
  created_at?: string;
  updated_at?: string;
  // Other fields (input_data, output_data, error_message, ...) are present
  // but the dry-run UI doesn't currently consume them — kept open via index.
  [key: string]: unknown;
}

/** Bundled artefacts response from get_simulation_artefacts. CamelCase per the
 * Rust struct's `#[serde(rename_all = "camelCase")]`. */
export interface SimulationArtefacts {
  executionId: string;
  /** Manual reviews emitted during the simulated execution. Snake-case fields
   * inside each item mirror PersonaManualReview as serialised today. */
  reviews: Array<{
    id: string;
    execution_id: string;
    persona_id: string;
    title: string;
    description: string | null;
    severity: string;
    status: "pending" | "approved" | "rejected" | "resolved";
    reviewer_notes: string | null;
    use_case_id: string | null;
    created_at: string;
    updated_at: string;
    [key: string]: unknown;
  }>;
  /** Memories the agent stored during the simulated execution. */
  memories: Array<{
    id: string;
    persona_id: string;
    title: string;
    content: string;
    category: string | null;
    importance: number | null;
    created_at: string;
    [key: string]: unknown;
  }>;
}

/**
 * Run a capability against the draft persona's `agent_ir` without promoting.
 * Snapshots a `design_context` onto the persona row, dispatches via
 * `execute_persona_inner` with `is_simulation=true`, returns the execution row.
 *
 * Throws AppError::Validation if the session is in a phase earlier than
 * `draft_ready`, or if `useCaseId` doesn't match any UC in the draft IR.
 */
export async function simulateBuildDraft(
  sessionId: string,
  useCaseId: string,
  inputOverride?: string | null,
): Promise<SimulatedExecution> {
  return invokeWithTimeout<SimulatedExecution>(
    "simulate_build_draft",
    {
      sessionId,
      useCaseId,
      inputOverride: inputOverride ?? null,
    },
    undefined,
    180_000,
  );
}

/**
 * Fetch artefacts (manual reviews, memories) a single simulation execution
 * produced. Used by the dry-run preview panel.
 */
export async function getSimulationArtefacts(
  executionId: string,
): Promise<SimulationArtefacts> {
  return invokeWithTimeout<SimulationArtefacts>("get_simulation_artefacts", {
    executionId,
  });
}
