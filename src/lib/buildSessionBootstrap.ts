/**
 * App-startup hydration of in-flight build sessions.
 *
 * History
 * -------
 * Pre-2026-05-04 we hydrated every non-terminal session on boot so the
 * sidebar's "Draft Builds" list survived an app restart.
 *
 * 2026-05-04 (`7e202a002`) swapped that for a cancel-all-on-boot strategy
 * because a hydrated session whose backing CLI process had died would let
 * the user type an answer that went nowhere — `answerBuildQuestion` reached
 * a backend session whose CLI was gone and the build never advanced. The
 * conversation history is in SQLite but the live LLM context, the pending
 * answer hook, and the streaming Channel are all process-local. Reviving
 * them needs a CLI `--resume` flag the build prompt doesn't carry yet.
 *
 * 2026-05-17 user feedback: "Drafts stopped working. The build used to be
 * a background process the user could revisit; now after revisit the
 * progress is lost and the questionnaire is no longer accessible." The
 * cancel-all strategy was too aggressive — even same-session navigation
 * lost the draft because dev hot-reloads (Rust changes) trigger an app
 * boot, the bootstrap cancels every in-flight session in the DB, and the
 * user sees an empty sidebar with no entry point back to their work.
 *
 * Trade-off taken (2026-05-17)
 * ----------------------------
 * Hydrate non-terminal sessions back into the in-memory map so the
 * "Draft Builds" sidebar list survives an app restart. The user gets
 * visibility on what they had in flight and can choose: cancel the
 * draft, or wait for a future `--resume` affordance.
 *
 * Known limitation we accept for now: if the backing CLI process is dead
 * (typical after any app restart, since the CLI is process-local to the
 * old app run), trying to answer a pending question from a hydrated
 * session won't advance the build. That's a worse failure than the
 * pre-regression behavior; addressing it needs a "restart this build"
 * affordance that re-spawns the CLI with the persisted answers as
 * context. Filed as follow-up; not in this fix's scope.
 *
 * We do NOT activate any hydrated session — `activeBuildSessionId` stays
 * null until the user clicks a draft. That way the unified build entry
 * doesn't render automatically on every boot just because a stale draft
 * exists.
 */
import { invokeWithTimeout } from "@/lib/tauriInvoke";
import { useAgentStore } from "@/stores/agentStore";
import type { PersistedBuildSession } from "@/lib/types/buildTypes";
import { createLogger } from "@/lib/log";

const log = createLogger("buildSessionBootstrap");

/**
 * List every non-terminal build session and hydrate it into the in-memory
 * `buildSessions` map. Best-effort — a failure to hydrate any single
 * session does not block the rest. Should be called once at app boot.
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

  // Snapshot the active id BEFORE hydrating — `hydrateBuildSession` sets
  // `activeBuildSessionId` to the session it just hydrated as part of its
  // contract. We don't want bootstrap-on-boot to silently activate a
  // stale draft and force the build surface to render before the user
  // chose anything; restore the original null/undefined active id at the
  // end so they have to click a draft to engage with it.
  const store = useAgentStore.getState();
  const priorActiveId = store.activeBuildSessionId;

  for (const session of sessions) {
    try {
      useAgentStore.getState().hydrateBuildSession(session);
    } catch (err) {
      log.warn("bootstrapActiveBuildSessions: hydrate failed", {
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  useAgentStore.getState().setActiveBuildSession(priorActiveId);

  log.info("bootstrapActiveBuildSessions: hydrated drafts", {
    count: sessions.length,
  });
}
