import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { PersonaEpisode } from "@/lib/bindings/PersonaEpisode";

// ============================================================================
// Persona brain (living-agent core): episodic record, self-model,
// consolidation trigger. Commands land in
// `src-tauri/src/commands/core/persona_brain.rs`.
// ============================================================================

/**
 * Enqueue a FORCED sleep-consolidation job for one persona (bypasses
 * pressure/floor/staleness, never the per-persona single-flight guard).
 * Returns the background-job id; progress and verdicts land in the
 * attention ledger.
 */
export const runPersonaConsolidationNow = (personaId: string) =>
  invoke<string>("run_persona_consolidation_now", { personaId });

/**
 * A persona's episodic record, newest first, keyset-paginated: pass BOTH
 * `beforeCreatedAt` and `beforeId` (the last row of the prior page) to
 * continue; omit both for the first page. `limit` clamps server-side to 1..200.
 */
export const listPersonaEpisodes = (
  personaId: string,
  beforeCreatedAt?: string,
  beforeId?: string,
  limit?: number,
) =>
  invoke<PersonaEpisode[]>("list_persona_episodes", {
    personaId,
    beforeCreatedAt,
    beforeId,
    limit,
  });

/**
 * The persona's current self-model (`identity.md` markdown), or `null` when
 * it has never been seeded (first consolidation seeds it).
 */
export const getPersonaIdentity = (personaId: string) =>
  invoke<string | null>("get_persona_identity", { personaId });

/**
 * File anchored self-model diffs as a `self_model_diff` proposal — NEVER
 * applies directly; a human decides through
 * `apply_persona_memory_review_proposal`. `diffsJson` is a JSON array of
 * `{section, op, anchor_text?, new_text?}`. Returns the proposal id.
 */
export const proposePersonaIdentityDiffs = (
  personaId: string,
  diffsJson: string,
  rationale: string,
) =>
  invoke<string>("propose_persona_identity_diffs", {
    personaId,
    diffsJson,
    rationale,
  });
