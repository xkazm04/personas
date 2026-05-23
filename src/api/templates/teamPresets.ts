import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";
import { useI18nStore } from "@/stores/i18nStore";

import type { TeamPreset } from "@/lib/bindings/TeamPreset";
import type { AdoptedTeamPresetResult } from "@/lib/bindings/AdoptedTeamPresetResult";
import type { PresetAdoptionSchema } from "@/lib/bindings/PresetAdoptionSchema";

/**
 * Resolve the user's current locale to pass to the Rust preset loader.
 * Returns `null` for English so the backend short-circuits the overlay
 * lookup path entirely (canonical file IS English — no sibling needed).
 *
 * Read at call time (not module load) so a language switch mid-session
 * affects the next preset operation without a reload.
 */
function currentLanguage(): string | null {
  const lang = useI18nStore.getState().language;
  return lang === "en" ? null : lang;
}

// ============================================================================
// Team Presets — filesystem-shipped multi-template bundles
// ============================================================================
//
// A team preset is a manifest under `scripts/templates/_team_presets/*.json`
// that bundles N persona templates plus their team wiring (PersonaTeam
// metadata + members + connections, optionally a PersonaGroup binding).
// The Presets gallery (PresetLibraryPage) and the preview/adoption modal
// (PresetPreviewModal) consume these wrappers.
//
// Loading is read-fresh-from-disk per call — presets are tiny and rarely
// listed, so a stale cache trap (annoying during dev edits to the manifest)
// is worse than the few-ms read cost.

export const listTeamPresets = () =>
  invoke<TeamPreset[]>("list_team_presets", { language: currentLanguage() });

export const getTeamPreset = (id: string) =>
  invoke<TeamPreset>("get_team_preset", { id, language: currentLanguage() });

/**
 * Aggregate every member template's `payload.adoption_questions[]` for
 * the combined preset questionnaire. Returns one row per preset member
 * (members with no questions appear with an empty `questions` array
 * rather than being dropped, so the UI can show "no config needed").
 *
 * Failures to LOAD a member's template (renamed, deleted, parse error)
 * silently skip that row at the schema view — the same template will
 * raise a precise error when the adopter tries to use it. The
 * questionnaire screen treats schema-load best-effort; the adopt
 * action is the source of truth for member success/failure.
 */
export const getPresetAdoptionSchema = (presetId: string) =>
  invoke<PresetAdoptionSchema>("get_preset_adoption_schema", {
    presetId,
    language: currentLanguage(),
  });

/**
 * Run a preset's full adoption flow. Emits `team-preset-adopt-progress`
 * events per member transition (queued → adopting → done/failed) — wire
 * `useTypedTauriEvent(EventName.TEAM_PRESET_ADOPT_PROGRESS, ...)` to
 * drive per-row status badges in the preview modal.
 *
 * Returns an aggregate result with the new team_id, optional group_id,
 * successfully-adopted members, and any per-template failures. The team
 * shell is created unconditionally — partial failures leave the user
 * with the team + the members that did succeed so they can retry the
 * rest without losing progress.
 */
export const adoptTeamPreset = (id: string) =>
  invoke<AdoptedTeamPresetResult>("adopt_team_preset", {
    id,
    language: currentLanguage(),
  });

/**
 * Retry the named failed roles of a previously-adopted preset. Reuses
 * the same TEAM_PRESET_ADOPT_PROGRESS event stream so the modal's per-
 * row status badges animate identically to the first attempt.
 * Idempotent on roles already present in the team (silently skipped),
 * so double-clicking is safe.
 *
 * Returns the FULL member list (old + newly-retried) plus any roles
 * that still failed this round, so the modal can swap state in one
 * assignment instead of merging two views.
 */
export const retryTeamPresetMembers = (
  presetId: string,
  teamId: string,
  groupId: string | null,
  roles: string[],
) =>
  invoke<AdoptedTeamPresetResult>("retry_team_preset_members", {
    presetId,
    teamId,
    groupId,
    roles,
    language: currentLanguage(),
  });
