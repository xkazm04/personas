/**
 * App-startup cleanup of stale build sessions.
 *
 * Pre-2026-05-04 we hydrated every non-terminal session on boot so the
 * sidebar's "Draft Builds" list survived an app restart. The trouble: the
 * CLI process that drove each session was tied to the old app run and
 * died with it. The hydrated session showed up in the sidebar with a
 * pending question, the user typed an answer, `answerBuildQuestion` was
 * dispatched — and reached a backend session whose CLI process had been
 * gone since startup. The build never advanced.
 *
 * The honest answer: a build session can't survive an app restart. The
 * conversation history is in SQLite but the live LLM context, the
 * pending answer hook, and the streaming Channel are all process-local.
 * Reviving them would require respawning the CLI with a `--resume` flag
 * the build prompt doesn't support yet.
 *
 * So this bootstrap now does the inverse of the old behaviour: it cancels
 * every non-terminal session it finds. The DB row stays around (the
 * user's intent + answers + agent_ir-so-far are still recoverable for
 * forensics) but the session is marked `cancelled` so the sidebar's
 * `activeDrafts` filter excludes it. The user sees a clean Draft Builds
 * list and starts fresh.
 */
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { cancelBuildSession } from "@/api/agents/buildSession";
import type { PersistedBuildSession } from "@/lib/types/buildTypes";
import { createLogger } from "@/lib/log";

const log = createLogger("buildSessionBootstrap");

/**
 * List every non-terminal build session and cancel it. Best-effort —
 * a failure to cancel any single session does not block the rest.
 * Should be called once at app boot.
 */
export async function bootstrapActiveBuildSessions(): Promise<void> {
  let sessions: PersistedBuildSession[];
  try {
    // Rust returns Vec<PersistedBuildSession> here despite the TS API's
    // BuildSessionSummary annotation — the runtime payload IS the full
    // shape (verified by `PersistedBuildSession::from_session` in Rust).
    sessions = await invokeWithTimeout<PersistedBuildSession[]>(
      "list_build_sessions",
      { personaId: null },
    );
  } catch (err) {
    log.warn("bootstrapActiveBuildSessions: list_build_sessions failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (sessions.length === 0) return;

  // Cancel concurrently — the Rust side serializes via the sessions Mutex
  // and the process registry, so parallel calls are safe and additive
  // round-trips collapse from O(n) to O(1) wall time.
  const results = await Promise.allSettled(
    sessions.map((session) => cancelBuildSession(session.id)),
  );

  let failures = 0;
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      failures += 1;
      log.warn("bootstrapActiveBuildSessions: cancel failed", {
        sessionId: sessions[i]?.id,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  });

  log.info("bootstrapActiveBuildSessions: cancelled orphan drafts", {
    count: sessions.length,
    failures,
  });
}
