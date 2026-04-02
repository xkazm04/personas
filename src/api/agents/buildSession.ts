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
  PersistedBuildSession,
  BuildSessionSummary,
  PromoteBuildResult,
  TestReport,
} from "@/lib/types/buildTypes";

/**
 * Start a new build session for a persona. Returns the session ID.
 * Build events are streamed via the provided Channel.
 */
export async function startBuildSession(
  channel: Channel<BuildEvent>,
  personaId: string,
  intent: string,
  workflowJson?: string | null,
  parserResultJson?: string | null,
  language?: string | null,
): Promise<string> {
  return invokeWithTimeout<string>("start_build_session", {
    channel,
    personaId,
    intent,
    workflowJson: workflowJson ?? null,
    parserResultJson: parserResultJson ?? null,
    language: language ?? null,
  });
}

/** Submit an answer to a pending build question. */
export async function answerBuildQuestion(
  sessionId: string,
  cellKey: string,
  answer: string,
): Promise<void> {
  return invokeWithTimeout("answer_build_question", {
    sessionId,
    cellKey,
    answer,
  });
}

/** Cancel an in-progress build session. */
export async function cancelBuildSession(sessionId: string): Promise<void> {
  return invokeWithTimeout("cancel_build_session", { sessionId });
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
 */
export async function promoteBuildDraft(
  sessionId: string,
  personaId: string,
): Promise<PromoteBuildResult> {
  return invokeWithTimeout<PromoteBuildResult>("promote_build_draft", {
    sessionId,
    personaId,
  });
}
