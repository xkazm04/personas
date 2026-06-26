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
    /// Design D — the team's `north_star` (a `TeamNorthStar` JSON: the shared
    /// "#1 in category" motivation every member imprints). Stamped onto
    /// `persona_teams.north_star` at adoption. Optional (older presets omit it).
    pub north_star: Option<String>,
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
/// `home_team_id` is set only when the manifest declared a workspace
/// (group) spec — it equals `team_id` and means the adopted personas were
/// anchored to this team as their workspace. The two lists partition the
/// manifest's members into success vs. failure. `created_connections` is
/// the count of edges actually wired (an edge is skipped silently when
/// either endpoint role failed adoption).
///
/// `handoff_wired` reflects step 5 — the `team_handoff::wire_team_handoff`
/// pass that turns the connection graph into the `chain`/`event_listener`
/// triggers members fire each other through. It is the difference between a
/// team that cascades and one that stalls after its entry member. Wiring is
/// best-effort (it never fails the adoption), so this flag carries the truth
/// to the UI: `false` means the team was created but is NOT cascading, and
/// the modal surfaces a "Repair handoff" affordance (the `repair_team_handoff`
/// command re-runs the wiring). `handoff_error` holds the underlying error
/// string when wiring failed (`None` on success).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AdoptedTeamPresetResult {
    pub preset_id: String,
    pub team_id: String,
    pub home_team_id: Option<String>,
    pub members: Vec<AdoptedTeamPresetMember>,
    pub failed_members: Vec<AdoptedTeamPresetFailure>,
    pub created_connections: i32,
    /// `true` when step-5 handoff wiring succeeded; `false` when it failed
    /// (the team exists but downstream members won't cascade until repaired).
    pub handoff_wired: bool,
    /// The error string from a failed `wire_team_handoff` pass; `None` when
    /// `handoff_wired == true`.
    pub handoff_error: Option<String>,
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

// ============================================================================
// Adoption-time questionnaire schema
// ============================================================================
//
// Each member template ships `payload.adoption_questions[]` — a list of
// configuration knobs whose values flow into the persona's parameters at
// adoption time. For a single-template adoption the ChronologyAdoptionView
// renders these in a form; for a preset adoption we aggregate every
// member's questions into one combined form rendered before the per-row
// member-status table.
//
// The `get_preset_adoption_schema` IPC returns this shape. Frontend uses
// it to render the questionnaire AND to know which question_ids to pass
// back as overrides during the actual adopt call.
//
// `questions` is intentionally passed through as raw JSON values because:
//   1. The adoption_questions schema is rich (type, options, label, hint,
//      default, maps_to, vault_category, …) and any typed Rust model
//      would force the loader to stay in lockstep with template-schema
//      bumps in the wrong layer.
//   2. The frontend already has a narrow typed view of the same shape
//      from the single-template adoption flow (`ChronologyAdoptionView`'s
//      question consumer) and can reuse it directly.
//   3. ts-rs models `serde_json::Value` as `any` on the TS side, which
//      lets the frontend keep its own narrow type without an
//      intermediate mapping layer here.

/// Per-member subsection of the combined preset questionnaire.
///
/// Members with NO adoption_questions still appear in the response
/// (with an empty `questions` array) so the UI can render the full
/// member list and let the user verify "no config needed here" instead
/// of silently dropping the row.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PresetMemberAdoptionSchema {
    /// The preset-manifest role (`"capture"`, `"triage"`, …) — keys the
    /// override map returned from the UI back to the right member at
    /// adopt time.
    pub role: String,
    /// Canonical template id (matches `members[].template_id` in the
    /// preset manifest and the on-disk template filename minus
    /// `.json`).
    pub template_id: String,
    /// Translated template name when locale overlay is active,
    /// canonical English otherwise. Used as the per-member section
    /// header in the combined questionnaire.
    pub template_name: String,
    /// Short one-line description of the template — surfaced under the
    /// section header so the user remembers what THIS particular role
    /// does without expanding the section. Pulled from the template's
    /// `payload.persona.identity.description` field (truncated to ~120
    /// chars frontend-side).
    pub template_description: Option<String>,
    /// Raw adoption_questions array from the template's design JSON.
    /// Shape on the wire matches what
    /// `scripts/templates/<category>/<template>.json :: payload.adoption_questions`
    /// ships. Empty array when the member has no configurable knobs.
    pub questions: Vec<serde_json::Value>,
}

/// Top-level response of `get_preset_adoption_schema`. The per-preset
/// metadata is duplicated here so the UI can render the questionnaire
/// modal title + the "X of Y members have configurable inputs" summary
/// without a separate `get_team_preset` round-trip.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PresetAdoptionSchema {
    pub preset_id: String,
    /// Translated preset name (or canonical English).
    pub preset_name: String,
    /// `members.length` total; `members.iter().filter(non-empty
    /// questions).count()` configurable.
    pub member_count: i32,
    pub configurable_member_count: i32,
    /// Sum of `questions.len()` across all members.
    pub total_question_count: i32,
    pub members: Vec<PresetMemberAdoptionSchema>,
}
