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
