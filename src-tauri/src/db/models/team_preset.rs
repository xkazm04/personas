use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Team Presets
// ============================================================================
//
// A "team preset" is a filesystem-shipped manifest that bundles N persona
// templates plus the wiring (PersonaTeam metadata + members + connections,
// optionally a PersonaGroup binding) needed to land them as a working
// multi-agent setup in one click. The manifest itself is NOT stored in the
// DB — presets live at `scripts/templates/_team_presets/*.json`, parallel
// to `scripts/templates/<category>/*.json`. The loader reads them fresh
// on every IPC call; the adopter (separate module) calls into the existing
// `instant_adopt_template_inner` + `create_team` + `add_team_member` +
// `create_team_connection` paths so no new schema is required for the
// adopted result.
//
// Schema-version is pinned at 1 — future format changes bump this and the
// loader emits a structured error rather than silently mis-parsing.
//
// Field semantics:
//   - `id` matches the on-disk filename minus `.json`. Used by the
//     `get_team_preset` IPC and by the Playwright spec to address a
//     specific preset.
//   - `members[].template_id` matches an existing template's `id` from
//     `scripts/templates/<category>/*.json`. The loader does not validate
//     existence (that would couple the loader to the template index and
//     slow listing); the adopter validates at adoption time and returns
//     a precise error per-missing-template.
//   - `members[].role` is a STRING LABEL the connections reference via
//     `from` / `to`. Must be unique within a preset (loader validates).
//   - `connections[].connection_type` is the same vocabulary
//     `PersonaTeamConnection` uses today (`"data"`, `"feedback"`, …);
//     the adopter passes it through unmodified to
//     `create_team_connection`.
//   - `group` is OPTIONAL — when set, the adopter creates a PersonaGroup
//     and binds every adopted persona to it via `group_id`.

/// Top-level preset manifest, ts-rs-exported so the frontend gallery + the
/// adoption modal can render it without a parallel TS type.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamPreset {
    /// Stable id; matches the on-disk filename minus `.json`.
    pub id: String,
    /// Schema version (currently `1`). Future format changes bump this so
    /// the loader rejects newer manifests on older app builds with a clear
    /// error rather than silently mis-parsing.
    pub schema_version: i32,
    pub name: String,
    pub description: String,
    /// Lucide icon name (e.g. `"ListTodo"`). Frontend resolves to a React
    /// component.
    pub icon: Option<String>,
    /// Hex color stripe / accent for the preset card and the team it
    /// creates.
    pub color: String,
    /// Tags for filtering / grouping presets in the gallery
    /// (e.g. `["productivity", "development"]`). Free-form strings.
    pub category: Vec<String>,
    /// Spec for the parent `PersonaTeam` row that will be created.
    pub team: TeamPresetTeamSpec,
    /// Optional spec for a `PersonaGroup` to create and bind every
    /// adopted persona to. When `None`, personas stay un-grouped.
    pub group: Option<TeamPresetGroupSpec>,
    pub members: Vec<TeamPresetMember>,
    pub connections: Vec<TeamPresetConnection>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetTeamSpec {
    pub name: String,
    pub description: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetGroupSpec {
    pub name: String,
    pub color: String,
    /// Optional `sharedInstructions` to seed the PersonaGroup with.
    /// Surfaces in the GroupEditModal under the same field once adopted.
    pub shared_instructions: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetMember {
    /// Matches an existing template's `id` (from
    /// `scripts/templates/<category>/*.json`). Validated by the adopter,
    /// not the loader.
    pub template_id: String,
    /// Logical label used by `TeamPresetConnection.from` / `.to`. Unique
    /// within a preset (the loader enforces this).
    pub role: String,
    /// Canvas x/y coordinates passed straight through to `add_team_member`.
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetConnection {
    /// Role label of the source member.
    pub from: String,
    /// Role label of the target member.
    pub to: String,
    /// Connection-type vocabulary; passed unmodified to
    /// `create_team_connection`. Common values: `"data"`, `"feedback"`.
    pub connection_type: String,
    pub label: Option<String>,
}

// ============================================================================
// Adoption result types
// ============================================================================
//
// `adopt_team_preset` runs N+1 sub-IPCs in sequence and returns this rich
// shape so the frontend modal can render a per-member status table without
// needing to refetch personas/team/group/connections. Partial-success
// semantics: any member that fails (template missing, integrity check
// fails, atomic create errors) is captured in `failed_members` while the
// team + successfully-adopted personas + edges connecting only successful
// pairs are still returned. The user keeps what worked and can retry the
// rest later from the preview modal.

/// Successfully-adopted preset member: one PersonaTeamMember row plus the
/// underlying Persona id (so the frontend can navigate to the editor).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdoptedTeamPresetMember {
    pub role: String,
    pub template_id: String,
    pub persona_id: String,
    pub team_member_id: String,
}

/// One per-member adoption failure. `reason` is a human-readable string
/// from the underlying error chain; the frontend renders it inline next
/// to the failed role in the preview modal's status table.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdoptedTeamPresetFailure {
    pub role: String,
    pub template_id: String,
    pub reason: String,
}

/// Aggregate return from `adopt_team_preset`. `team_id` is always set
/// (the team itself is the first thing created and never rolled back);
/// `group_id` is set only when the manifest declared a group spec; the
/// two lists partition the manifest's members into success vs. failure.
/// `created_connections` is the count of edges actually wired (an edge
/// is skipped silently when either endpoint role failed adoption).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdoptedTeamPresetResult {
    pub preset_id: String,
    pub team_id: String,
    pub group_id: Option<String>,
    pub members: Vec<AdoptedTeamPresetMember>,
    pub failed_members: Vec<AdoptedTeamPresetFailure>,
    pub created_connections: i32,
}

/// Per-step progress emitted as `team-preset-adopt-progress` events while
/// `adopt_team_preset` runs. The frontend uses this to drive the per-
/// member status badges in the preview modal — every member transitions
/// queued → adopting → done/failed in order.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TeamPresetAdoptProgress {
    pub preset_id: String,
    pub role: String,
    pub template_id: String,
    /// `"queued" | "adopting" | "done" | "failed"`.
    pub status: String,
    pub error: Option<String>,
}
