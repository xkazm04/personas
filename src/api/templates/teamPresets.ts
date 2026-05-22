import { invokeWithTimeout as invoke } from "@/lib/tauriInvoke";

import type { TeamPreset } from "@/lib/bindings/TeamPreset";

// ============================================================================
// Team Presets — filesystem-shipped multi-template bundles
// ============================================================================
//
// A team preset is a manifest under `scripts/templates/_team_presets/*.json`
// that bundles N persona templates plus their team wiring (PersonaTeam
// metadata + members + connections, optionally a PersonaGroup binding).
// The Presets gallery (PresetLibraryPage) and the preview/adoption modal
// (PresetPreviewModal) consume these wrappers; the adoption IPC lives in
// `adoptTeamPreset` below once the adopter module lands.
//
// Loading is read-fresh-from-disk per call — presets are tiny and rarely
// listed, so a stale cache trap (annoying during dev edits to the manifest)
// is worse than the few-ms read cost.

export const listTeamPresets = () =>
  invoke<TeamPreset[]>("list_team_presets");

export const getTeamPreset = (id: string) =>
  invoke<TeamPreset>("get_team_preset", { id });
