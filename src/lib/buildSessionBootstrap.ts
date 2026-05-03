/**
 * App-startup hydration of all active build sessions.
 *
 * Pre-Phase-3 (2026-05-03), build sessions only hydrated when the user
 * navigated INTO a specific persona's wizard — `useBuildSession(personaId)`
 * fires `getActiveBuildSession` on mount. After an app restart, the
 * sidebar's "active drafts" list was empty until the user clicked through
 * each in-flight persona, even though the data was sitting in
 * `build_sessions` SQLite rows.
 *
 * This bootstrap closes the gap: on app launch, list all non-terminal
 * sessions globally and pour them into `buildSessions[sessionId]` via the
 * store's `hydrateBuildSession` action.
 *
 * The Rust side (`commands::design::build_sessions::list_build_sessions`)
 * returns full `PersistedBuildSession` objects (with `resolvedCells`,
 * `pendingQuestion`, `agentIr`); the TS API surface mistypes it as the
 * lighter `BuildSessionSummary`. We cast through an `unknown` here to
 * bypass that mismatch — fixing the TS type would mean rippling changes
 * through every call site, and the runtime payload IS the full shape
 * (verified by inspecting `PersistedBuildSession::from_session` in Rust).
 */
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { useAgentStore } from "@/stores/agentStore";
import type { PersistedBuildSession } from "@/lib/types/buildTypes";
import { appLogger } from "@/lib/logger";

/**
 * List every non-terminal build session and hydrate each into the store.
 * Idempotent — `hydrateBuildSession` overwrites the matching `sessionId`
 * entry if one already exists.
 *
 * Should be called once at app boot. Failure is non-fatal — drafts will
 * still hydrate lazily when the user navigates into their wizard.
 */
export async function bootstrapActiveBuildSessions(): Promise<void> {
  let sessions: PersistedBuildSession[];
  try {
    // Rust returns Vec<PersistedBuildSession> here despite the TS API's
    // BuildSessionSummary annotation — see module header.
    sessions = await invokeWithTimeout<PersistedBuildSession[]>(
      "list_build_sessions",
      { personaId: null },
    );
  } catch (err) {
    appLogger.warn("bootstrapActiveBuildSessions: list_build_sessions failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  if (sessions.length === 0) return;

  const store = useAgentStore.getState();
  for (const session of sessions) {
    try {
      store.hydrateBuildSession(session);
    } catch (err) {
      // A bad session row should not break the rest of the list.
      appLogger.warn("bootstrapActiveBuildSessions: failed to hydrate session", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  appLogger.info("bootstrapActiveBuildSessions: hydrated active drafts", {
    count: sessions.length,
  });
}
