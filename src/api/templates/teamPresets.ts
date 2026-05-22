import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { TeamPreset } from "@/lib/bindings/TeamPreset";
import type { AdoptedTeamPresetResult } from "@/lib/bindings/AdoptedTeamPresetResult";

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
  invoke<TeamPreset[]>("list_team_presets");

export const getTeamPreset = (id: string) =>
  invoke<TeamPreset>("get_team_preset", { id });

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
  invoke<AdoptedTeamPresetResult>("adopt_team_preset", { id });
