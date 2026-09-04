import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { AttentionLoopStatus } from "@/lib/bindings/AttentionLoopStatus";
import type { PersonaBrainDashboard } from "@/lib/bindings/PersonaBrainDashboard";
import type { PersonaEpisode } from "@/lib/bindings/PersonaEpisode";
import type { PersonaManifestView } from "@/lib/bindings/PersonaManifestView";

// ============================================================================
// Persona brain (living-agent core): episodic record, manifest (two-author
// core document), Brain dashboard, consolidation trigger. Commands land in
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
 * The attention loop's global switch (`autonomous_attention_loop`) plus a
 * fleet-wide ledger aggregate for the Overview status tile: the newest pass
 * overall and today's dispatched / refused / consolidation counts.
 */
export const getAttentionLoopStatus = () =>
  invoke<AttentionLoopStatus>("get_attention_loop_status");

/**
 * The persona's current manifest text (`manifest.md` markdown), or `null`
 * when it has never been seeded. Read-only and non-seeding; the editor's
 * door is `getPersonaManifest`.
 */
export const getPersonaIdentity = (personaId: string) =>
  invoke<string | null>("get_persona_identity", { personaId });

/**
 * The persona's manifest, seeded (or migrated from the legacy `identity.md`)
 * on first access, with the law / self-model section map and the count of
 * `self_model_diff` proposals awaiting review.
 */
export const getPersonaManifest = (personaId: string) =>
  invoke<PersonaManifestView>("get_persona_manifest", { personaId });

/**
 * Operator door for the LAW sections (`Mandate` | `Boundaries` |
 * `Operation defaults`): replaces one section's body on disk and refreshes
 * the `core_profile` mirror. Any other heading is a validation refusal.
 */
export const updatePersonaManifestLaw = (
  personaId: string,
  section: string,
  content: string,
) =>
  invoke<void>("update_persona_manifest_law", { personaId, section, content });

/**
 * The Brain dashboard: memory tiers and categories, 30 days of episode
 * activity, consolidation history, the pressure gauge, the anomaly strip and
 * per-charter coverage.
 */
export const getPersonaBrainDashboard = (personaId: string) =>
  invoke<PersonaBrainDashboard>("get_persona_brain_dashboard", { personaId });

/**
 * File anchored self-model diffs as a `self_model_diff` proposal — NEVER
 * applies directly; a human decides through
 * `apply_persona_memory_review_proposal`. `diffsJson` is a JSON array of
 * `{section, op, anchor_text?, new_text?}`; a diff aimed at a law section is
 * refused. Returns the proposal id.
 */
export const proposePersonaManifestDiffs = (
  personaId: string,
  diffsJson: string,
  rationale: string,
) =>
  invoke<string>("propose_persona_manifest_diffs", {
    personaId,
    diffsJson,
    rationale,
  });
