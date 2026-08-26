//! Orchestrator for `adopt_team_preset` — turns a filesystem-shipped
//! `TeamPreset` manifest into a real PersonaTeam (optionally bound to a
//! PersonaGroup) with N adopted personas and the connection edges that
//! wire them.
//!
//! Composition (not a new transactional primitive — chains existing
//! ones so each sub-step is independently observable):
//!
//!   1. Optional: `repos::core::groups::create` for the manifest's group
//!      spec. `group_id` is stamped onto each adopted persona after
//!      `instant_adopt_template_inner` returns.
//!   2. `repos::resources::teams::create` for the parent PersonaTeam.
//!   3. For each member in the manifest, in declaration order:
//!      a. `team_preset_loader::load_template_design_by_id` reads the
//!      canonical template JSON from disk.
//!      b. `commands::design::template_adopt::instant_adopt_template_inner`
//!      creates the persona atomically (persona + tools + triggers
//!      in one tx) — same path the existing "Dev Clone" shortcut
//!      uses, so the integrity check still runs.
//!      c. If a group was created in step 1, `UPDATE personas SET
//!           group_id = ?` is issued for the new persona.
//!      d. `repos::resources::teams::add_member` adds the persona to
//!      the team at the manifest's `(x, y)` with the role label.
//!      e. Emit a `team-preset-adopt-progress` event with the
//!      per-member status (queued → adopting → done/failed).
//!   4. For each connection in the manifest, if BOTH endpoint roles
//!      adopted successfully: `repos::resources::teams::create_connection`
//!      maps the role strings to the freshly-created member ids and
//!      writes the edge.
//!
//! **Additive mode (`target_team_id`, 2026-08-26).** A dev project owns
//! exactly one team, so adopting a preset "for a project" must ADD members to
//! that team rather than mint a new named one. When `target_team_id` is
//! `Some`, step 2 resolves the existing team instead of creating one, the
//! preset's team/group NAMING and workspace stamping are skipped entirely (the
//! target's own name and shared instructions belong to the project, not to the
//! preset), and the empty-shell rollback below is disabled — you never delete a
//! team you did not create. `None` keeps the legacy standalone behaviour that
//! the engine + templates surfaces already depend on.
//!
//! Partial-success semantics:
//!
//!   The team itself is created in step 2 and never rolled back — even
//!   if every member fails, the user keeps the team shell so they can
//!   retry from the gallery without losing the configured name/color.
//!   Members that fail (template missing on disk, integrity check
//!   failure, atomic-create error) land in `AdoptedTeamPresetResult.
//!   failed_members` with the underlying error string; the rest of the
//!   manifest continues. Connections skip silently when either endpoint
//!   role failed — there's nothing on either side of the edge to point
//!   at, so emitting a stale edge would just create UI clutter.

use std::sync::Arc;

use rusqlite::params;
use tauri::{AppHandle, Emitter};

use crate::commands::design::template_adopt::instant_adopt_template_inner;
use crate::db::models::{
    AdoptedTeamPresetFailure, AdoptedTeamPresetMember, AdoptedTeamPresetResult, CreateTeamInput,
    TeamPreset, TeamPresetAdoptProgress, UpdateTeamInput,
};
use crate::db::repos::resources::teams as team_repo;
use crate::engine::event_registry::event_name;
use crate::engine::inflight_guard::InflightGuard;
use crate::engine::team_preset_loader;
use crate::error::AppError;
use crate::AppState;
use std::sync::LazyLock;

/// Single-flight per preset id. `adopt_preset` creates the team shell
/// unconditionally and then adopts N personas; a double-click (or a retry
/// fired before the first call returned) would create two teams and duplicate
/// every persona, since nothing in the path is idempotent. Refuse the
/// concurrent duplicate instead.
static ADOPT_INFLIGHT: LazyLock<InflightGuard> = LazyLock::new(InflightGuard::new);

const PROGRESS_QUEUED: &str = "queued";
const PROGRESS_ADOPTING: &str = "adopting";
const PROGRESS_DONE: &str = "done";
const PROGRESS_FAILED: &str = "failed";

/// Pipeline role every preset member is stored under. The preset
/// manifest's `role` is a semantic label (used for connection wiring +
/// display), NOT a `persona_team_members.role` — that column is
/// CHECK-constrained to the execution-runner's pipeline-role enum
/// (orchestrator / worker / reviewer / router). `worker` is the neutral
/// default; presets are collaborative agent bundles rather than strict
/// orchestrator/worker pipelines, so every member lands as `worker`.
const MEMBER_PIPELINE_ROLE: &str = "worker";

/// Build the `persona_team_members.config` JSON that preserves the
/// preset's semantic role label, since it can't live in the constrained
/// `role` column. Shape: `{"preset_role":"<role>"}`. The UI's modal
/// reads the role from the manifest directly, but read-back paths
/// (e.g. the Playwright spec, a future "team came from preset X" badge)
/// recover the semantic role from here.
fn preset_role_config(role: &str) -> String {
    serde_json::json!({ "preset_role": role }).to_string()
}

/// Recover a member's SEMANTIC preset role from the stash `preset_role_config`
/// wrote into `persona_team_members.config` (`{"preset_role":"<role>"}`). The
/// `role` column is CHECK-constrained to the pipeline-role enum and always
/// lands as `worker`, so it can't be used to identify which manifest role a
/// member fills. Falls back to the raw `role` for any member not adopted from a
/// preset. Without this recovery, `retry_failed_members` reads every existing
/// member as `worker` — so it can neither skip already-present roles (it would
/// re-adopt duplicates) nor resolve connection endpoints back to existing
/// members (new members would wire only to each other, not into the pipeline).
///
/// `pub(crate)` because the same recovery is the ONLY way any consumer can read
/// a semantic role: `team_assignment_orchestrator::maybe_post_channel_message`
/// gates channel posting on `engineer` / `qa` / `architect`, none of which the
/// `role` column's CHECK admits, so reading that column made the gate
/// unreachable for every team. Any future role-aware feature must come through
/// here rather than growing a second config parser.
pub(crate) fn member_semantic_role(config: Option<&str>, role: &str) -> String {
    config
        .and_then(|c| serde_json::from_str::<serde_json::Value>(c).ok())
        .and_then(|v| {
            v.get("preset_role")
                .and_then(|r| r.as_str())
                .map(str::to_string)
        })
        .unwrap_or_else(|| role.to_string())
}

/// `instant_adopt_template_inner` expects the template's DESIGN — the
/// `payload` object — as its `design_result_json`, NOT the whole
/// on-disk template file (`{ id, name, payload: { … } }`). The
/// frontend Dev-Clone shortcut passes `JSON.stringify(template.payload)`
/// for exactly this reason; passing the full file instead yields an
/// empty persona (default "You are a helpful AI assistant." prompt,
/// no parameters) because the v3 normalizer + parameter-population
/// both look for `persona` / `adoption_questions` at the top level.
///
/// `load_template_design_by_id` returns the full file (so the
/// questionnaire-schema reader can pointer into `/payload/...`); this
/// helper unwraps the `payload` for the adopt path. Legacy flat
/// templates without a `payload` key fall through unchanged.
fn design_payload_json(full_file_json: &str) -> String {
    match serde_json::from_str::<serde_json::Value>(full_file_json) {
        Ok(v) => match v.get("payload") {
            Some(payload) => {
                serde_json::to_string(payload).unwrap_or_else(|_| full_file_json.to_string())
            }
            None => full_file_json.to_string(),
        },
        Err(_) => full_file_json.to_string(),
    }
}

fn emit_progress(
    app: &Option<AppHandle>,
    preset_id: &str,
    role: &str,
    template_id: &str,
    status: &str,
    error: Option<String>,
) {
    let Some(app) = app else { return };
    let payload = TeamPresetAdoptProgress {
        preset_id: preset_id.to_string(),
        role: role.to_string(),
        template_id: template_id.to_string(),
        status: status.to_string(),
        error,
    };
    let _ = app.emit(event_name::TEAM_PRESET_ADOPT_PROGRESS, payload);
}

/// Anchor a freshly-adopted persona to its home team (workspace). Best-effort:
/// a failure logs and returns Ok(()) so the adopter doesn't fail the whole
/// member just because the home-team binding follow-up tripped.
fn bind_persona_home_team(
    state: &Arc<AppState>,
    persona_id: &str,
    home_team_id: &str,
) -> Result<(), AppError> {
    let conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE personas SET home_team_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![home_team_id, now, persona_id],
    )?;
    Ok(())
}

/// Extract the persona id out of the JSON envelope `instant_adopt_template_inner`
/// returns. Shape is `{ "persona": { "id": "...", ... } }`. Returns
/// `Validation` if the field is missing — the inner call should never
/// produce a shape without it, but if it ever does we want a structured
/// error rather than a panic.
fn persona_id_from_adopt_value(value: &serde_json::Value) -> Result<String, AppError> {
    value
        .get("persona")
        .and_then(|p| p.get("id"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| {
            AppError::Validation(
                "instant_adopt_template returned a value without persona.id".into(),
            )
        })
}

/// Decide which team a preset's members land in — the one branch that
/// separates additive adoption from the legacy standalone path.
///
/// `Some(team_id)` resolves that EXISTING team and mints nothing;
/// `get_by_id` raising `NotFound` is the whole validation, because a caller
/// must never be able to name a team into existence and adopting into a team
/// that was deleted mid-flow has to fail loudly rather than silently create a
/// replacement under the preset's name.
///
/// `None` creates the standalone shell from the manifest's team spec.
///
/// Extracted from `adopt_preset` so it can be tested against a real database:
/// `adopt_preset` itself takes an `Arc<AppState>` no unit test can build.
pub(crate) fn resolve_adoption_team(
    db: &crate::db::DbPool,
    preset: &TeamPreset,
    target_team_id: Option<&str>,
) -> Result<crate::db::models::PersonaTeam, AppError> {
    match target_team_id {
        Some(team_id) => team_repo::get_by_id(db, team_id),
        None => team_repo::create(
            db,
            CreateTeamInput {
                name: preset.team.name.clone(),
                project_id: None,
                parent_team_id: None,
                description: preset.team.description.clone(),
                canvas_data: None,
                team_config: None,
                icon: preset.icon.clone(),
                color: preset
                    .team
                    .color
                    .clone()
                    .or_else(|| Some(preset.color.clone())),
                enabled: Some(true),
            },
        ),
    }
}

/// Whether an adoption in which every selected member failed should DELETE the
/// team it was working against.
///
/// Only ever true for a shell this call created moments earlier and left
/// empty. A team supplied by the caller (additive mode) is the project's
/// roster: it may already hold members this adoption knows nothing about, and
/// deleting it would cascade them away. The failure is still raised either
/// way — this decides the cleanup, not the verdict.
pub(crate) fn should_delete_empty_shell(
    adding_to_existing_team: bool,
    members_landed: usize,
    failures: usize,
) -> bool {
    !adding_to_existing_team && members_landed == 0 && failures > 0
}

/// Run a preset's full adoption flow. `app` is optional so unit tests can
/// invoke the adopter without a real Tauri AppHandle — when `None`, no
/// progress events are emitted but the rest of the flow runs.
///
/// `language` selects the locale-overlay sibling (`<id>.<lang>.json`) so
/// the persisted team + group + member names match what the user saw in
/// the preview modal. `None` adopts the canonical English manifest.
///
/// `parameter_overrides` carries the combined-questionnaire answers
/// from the preview modal: `role -> question_id -> value`. The outer
/// key is the preset-manifest role (`"capture"`, `"triage"`, …) so we
/// can target each member's overrides precisely; the inner map is
/// forwarded to `instant_adopt_template_inner` which lands the
/// answers as `persona.parameters[]` values. `None` (or an empty map)
/// adopts every member with its template defaults — the "Adopt with
/// defaults" CTA path.
pub fn adopt_preset(
    state: &Arc<AppState>,
    app: Option<AppHandle>,
    preset_id: &str,
    language: Option<&str>,
    parameter_overrides: Option<
        &std::collections::HashMap<String, std::collections::HashMap<String, serde_json::Value>>,
    >,
    // When `Some`, adopt only the members whose `role` is in this set
    // (the preview modal lets the user deselect members before adopting).
    // `None` adopts every member — the default "Adopt all" path. Connections
    // are wired only between members that BOTH landed, so deselecting an
    // endpoint silently drops its edges (existing endpoint-missing skip).
    roles_filter: Option<&[String]>,
    // ADDITIVE MODE. `Some(team_id)` adds the preset's members to that
    // EXISTING team — typically a dev project's own team, which is the only
    // team a project has. No team row is minted and the preset's team naming
    // is skipped. `None` is the legacy standalone path.
    target_team_id: Option<&str>,
) -> Result<AdoptedTeamPresetResult, AppError> {
    // Refuse a concurrent/double adoption of the same preset INTO THE SAME
    // TARGET. The key carries the target because two projects adopting the
    // same preset at once are independent operations — keying on the preset
    // alone would fail one of them for no reason. The RAII handle releases the
    // key on every return path below (including `?` early-returns).
    let inflight_key = match target_team_id {
        Some(t) => format!("{preset_id}->{t}"),
        None => preset_id.to_string(),
    };
    let _inflight = ADOPT_INFLIGHT.guard(&inflight_key).ok_or_else(|| {
        AppError::RateLimited(format!(
            "Preset '{preset_id}' is already being adopted — wait for it to finish"
        ))
    })?;

    let preset: TeamPreset = team_preset_loader::get_preset(preset_id, language)?;

    // A member is in-scope when there's no filter, or its role is listed.
    let is_selected = |role: &str| {
        roles_filter
            .map(|roles| roles.iter().any(|r| r == role))
            .unwrap_or(true)
    };

    // 0. Emit a `queued` event per selected member up-front so the UI's
    //    per-row status table can render the skeleton immediately. Then the
    //    subsequent `adopting` / `done` / `failed` transitions update
    //    rows in place.
    for m in preset.members.iter().filter(|m| is_selected(&m.role)) {
        emit_progress(
            &app,
            &preset.id,
            &m.role,
            &m.template_id,
            PROGRESS_QUEUED,
            None,
        );
    }

    // 1. The team the members land in.
    //
    //    ADDITIVE: resolve the caller's target. `get_by_id` raising NotFound
    //    is the whole validation — a preset must never be able to invent a
    //    team id, and adopting into a team that was deleted mid-flow has to
    //    fail loudly rather than silently mint a replacement.
    //
    //    STANDALONE (legacy): create the shell unconditionally so the user
    //    keeps it on partial failure. The team IS the workspace now
    //    (Groups→Teams consolidation): a manifest `group` spec folds its
    //    workspace settings onto this team rather than creating a group.
    let adding_to_existing_team = target_team_id.is_some();
    let team = resolve_adoption_team(&state.db, &preset, target_team_id)?;

    // 2. Optional workspace facet. When the manifest declares a `group`
    //    spec, stamp its shared instructions onto the team and anchor every
    //    adopted persona's `home_team_id` to this team. `home_team_id` ==
    //    the team id; `None` means the preset declared no workspace.
    //
    //    ADDITIVE mode never stamps: the target team's shared instructions,
    //    north star and name belong to the project that owns it, and a preset
    //    dropped into it is a roster addition, not a re-configuration. The
    //    members still anchor their `home_team_id` to the target — that is
    //    what makes them the project's people rather than free-floating.
    let home_team_id: Option<String> = if adding_to_existing_team {
        Some(team.id.clone())
    } else if let Some(group_spec) = &preset.group {
        if let Some(shared) = &group_spec.shared_instructions {
            let _ = team_repo::update(
                &state.db,
                &team.id,
                UpdateTeamInput {
                    name: None,
                    description: None,
                    canvas_data: None,
                    team_config: None,
                    icon: None,
                    color: None,
                    enabled: None,
                    shared_instructions: Some(Some(shared.clone())),
                    default_model_profile: None,
                    default_max_budget_usd: None,
                    default_max_turns: None,
                },
            );
        }
        // Design D: stamp the team's north star (shared motivation) so every
        // member's deliberation turn imprints it.
        if let Some(north_star) = &group_spec.north_star {
            let _ = team_repo::set_north_star(&state.db, &team.id, north_star);
        }
        Some(team.id.clone())
    } else {
        None
    };

    // 3. Per-member adoption. role → team_member_id lookup is built as
    //    we go so step 4 can resolve connection endpoints without a
    //    second pass over the result list.
    let mut members: Vec<AdoptedTeamPresetMember> = Vec::new();
    let mut failures: Vec<AdoptedTeamPresetFailure> = Vec::new();
    let mut role_to_member_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for m in preset.members.iter().filter(|m| is_selected(&m.role)) {
        emit_progress(
            &app,
            &preset.id,
            &m.role,
            &m.template_id,
            PROGRESS_ADOPTING,
            None,
        );

        // a. Read template design from disk.
        let design_json = match team_preset_loader::load_template_design_by_id(&m.template_id) {
            Ok(s) => s,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: m.role.clone(),
                    template_id: m.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    &m.role,
                    &m.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        // b. Adopt via the existing single-template path (atomic +
        //    integrity-checked). The per-role override map is extracted
        //    from the outer `parameter_overrides` so each member only
        //    sees its own questions — keeps the
        //    `instant_adopt_template_inner` contract narrow (it
        //    receives only the overrides relevant to ONE template).
        //    Pass the template's DESIGN (payload), not the whole file.
        let member_overrides = parameter_overrides.and_then(|all| all.get(&m.role));
        let adopt_value = match instant_adopt_template_inner(
            state,
            m.template_id.clone(),
            design_payload_json(&design_json),
            member_overrides,
        ) {
            Ok(v) => v,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: m.role.clone(),
                    template_id: m.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    &m.role,
                    &m.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        let persona_id = match persona_id_from_adopt_value(&adopt_value) {
            Ok(id) => id,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: m.role.clone(),
                    template_id: m.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    &m.role,
                    &m.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        // c. Anchor to home team if the preset declared a workspace.
        //    Best-effort — logged on failure but doesn't fail the member.
        if let Some(tid) = &home_team_id {
            if let Err(e) = bind_persona_home_team(state, &persona_id, tid) {
                tracing::warn!(
                    persona_id = %persona_id,
                    home_team_id = %tid,
                    error = %e,
                    "adopt_team_preset: bind_persona_home_team failed (continuing)"
                );
            }
        }

        // d. Add to team at the manifest position. The preset's `role` is a
        //    semantic LABEL ("capture", "triage", …) used for connection
        //    wiring; it is NOT a valid `persona_team_members.role`, which is
        //    CHECK-constrained to the pipeline-role enum (orchestrator /
        //    worker / reviewer / router) the execution runner understands.
        //    So we store every preset member as the neutral `worker` role
        //    and preserve the semantic label in `config` (JSON) for the UI
        //    and read-back.
        let team_member = match team_repo::add_member(
            &state.db,
            &team.id,
            &persona_id,
            Some(MEMBER_PIPELINE_ROLE.to_string()),
            Some(m.x),
            Some(m.y),
            Some(preset_role_config(&m.role)),
        ) {
            Ok(tm) => tm,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: m.role.clone(),
                    template_id: m.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    &m.role,
                    &m.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        role_to_member_id.insert(m.role.clone(), team_member.id.clone());
        members.push(AdoptedTeamPresetMember {
            role: m.role.clone(),
            template_id: m.template_id.clone(),
            persona_id,
            team_member_id: team_member.id,
        });
        emit_progress(
            &app,
            &preset.id,
            &m.role,
            &m.template_id,
            PROGRESS_DONE,
            None,
        );
    }

    // 3b. If EVERY selected member failed, the team is an empty shell — that's
    //     a failed adoption, not a partial success. The unconditional shell
    //     (step 1) exists so the user keeps a *partially* populated team; a
    //     zero-member team is useless and would otherwise be returned as a
    //     hollow Ok the UI renders as success with the errors buried in a list.
    //     Roll back the shell and surface the failures loudly instead. (An
    //     empty `failures` with empty `members` means nothing was selected —
    //     not a failure — so guard on `!failures.is_empty()`.)
    //
    //     ADDITIVE mode never rolls back: the target team is the project's
    //     roster and may already hold members this adoption knows nothing
    //     about. You do not delete a team you did not create. The failure is
    //     still raised — only the deletion is skipped.
    if members.is_empty() && !failures.is_empty() {
        if should_delete_empty_shell(adding_to_existing_team, members.len(), failures.len()) {
            if let Err(e) = team_repo::delete(&state.db, &team.id) {
                tracing::warn!(
                    team_id = %team.id,
                    error = %e,
                    "adopt_team_preset: failed to roll back empty team shell after all members failed"
                );
            }
        } else {
            tracing::warn!(
                team_id = %team.id,
                "adopt_team_preset: every member failed against an existing team — nothing to roll back"
            );
        }
        let summary = failures
            .iter()
            .map(|f| format!("{} ({}): {}", f.role, f.template_id, f.reason))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(AppError::Internal(format!(
            "Team preset adoption failed: all {} member(s) failed to adopt — {summary}",
            failures.len()
        )));
    }

    // 4. Connections — skip silently when either endpoint role failed.
    let mut created_connections: i32 = 0;
    for c in &preset.connections {
        let src = role_to_member_id.get(&c.from);
        let dst = role_to_member_id.get(&c.to);
        let (Some(src), Some(dst)) = (src, dst) else {
            tracing::info!(
                preset = %preset.id,
                from = %c.from,
                to = %c.to,
                "adopt_team_preset: skipping connection — endpoint role failed adoption"
            );
            // Narrate the decision into the team's own channel, not only the
            // log — the wiring gap is otherwise invisible to the user who
            // sees "created_connections: N" with no indication of which
            // edges were dropped or why (see engine::director /
            // team_assignment_orchestrator's `maybe_post_channel_message`
            // for the same system-narration idiom).
            let _ = crate::db::repos::resources::team_channel::create(
                &state.db,
                crate::db::models::CreateChannelMessageInput {
                    team_id: team.id.clone(),
                    author_kind: "system".into(),
                    author_id: None,
                    body: format!(
                        "Skipped connection \"{} → {}\" — one of these roles failed to adopt, so there's nothing to wire it to.",
                        c.from, c.to
                    ),
                    addressed_to: None,
                    reply_to: None,
                    assignment_id: None,
                    consumer: Some("display".into()),
                },
            );
            continue;
        };
        match team_repo::create_connection(
            &state.db,
            &team.id,
            src,
            dst,
            Some(c.connection_type.clone()),
            None,
            c.label.clone(),
        ) {
            Ok(_) => created_connections += 1,
            Err(e) => {
                tracing::warn!(
                    preset = %preset.id,
                    from = %c.from,
                    to = %c.to,
                    error = %e,
                    "adopt_team_preset: create_connection failed (continuing)"
                );
            }
        }
    }

    // 5. Wire intra-team handoff from the connection graph (chain + listener
    //    triggers per non-feedback edge) so members actually fire each other.
    //    Best-effort: a wiring failure must not fail an otherwise-successful
    //    adoption, but it IS the difference between a team that can cascade
    //    and one that stalls after the entry member — so capture the outcome
    //    on the result (`handoff_wired`/`handoff_error`) instead of swallowing
    //    it, letting the UI surface a "Repair handoff" affordance.
    let (handoff_wired, handoff_error) = match crate::engine::team_handoff::wire_team_handoff(
        &state.db, &team.id,
    ) {
        Ok(_) => (true, None),
        Err(e) => {
            tracing::warn!(team_id = %team.id, error = %e, "adopt_team_preset: handoff wiring failed (continuing)");
            (false, Some(e.to_string()))
        }
    };

    Ok(AdoptedTeamPresetResult {
        preset_id: preset.id,
        team_id: team.id,
        home_team_id,
        members,
        failed_members: failures,
        created_connections,
        handoff_wired,
        handoff_error,
    })
}

/// Retry the failed members of a previously-adopted preset, in place.
/// Targeted at the "Retry N failed" affordance in `PresetPreviewModal`:
/// the team + the members that succeeded are already in the DB, and the
/// user just wants the failed roles to take another swing without re-
/// adopting the whole thing.
///
/// Idempotent on roles already present in the team — silently skipped
/// rather than failed, so double-clicking the retry button doesn't
/// produce confusing duplicate errors.
///
/// Connection wiring is rebuilt at the end: any manifest connection
/// whose endpoints now BOTH resolve to team-member ids (across old +
/// newly-retried members) AND isn't already in the team is created.
/// Connections from the original adoption that survived are left
/// untouched (the existing-edge guard in `teams::create_connection`
/// rejects duplicates with an error, which we catch + log + skip).
// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
pub fn retry_failed_members(
    state: &Arc<AppState>,
    app: Option<AppHandle>,
    preset_id: &str,
    team_id: &str,
    home_team_id: Option<&str>,
    roles_to_retry: &[String],
    language: Option<&str>,
    parameter_overrides: Option<
        &std::collections::HashMap<String, std::collections::HashMap<String, serde_json::Value>>,
    >,
) -> Result<AdoptedTeamPresetResult, AppError> {
    // Refuse a concurrent/double retry of the same team's failed members —
    // mirrors the `adopt_preset` guard above. Without this, two concurrent
    // retries both read `get_members` before either inserts, both see the
    // role absent, and both adopt: duplicate personas + duplicate team
    // members for the same role. RAII handle releases on every return path.
    let inflight_key = format!("{preset_id}:{team_id}");
    let _inflight = ADOPT_INFLIGHT.guard(&inflight_key).ok_or_else(|| {
        AppError::RateLimited(format!(
            "Team '{team_id}' is already retrying failed members — wait for it to finish"
        ))
    })?;

    let preset: TeamPreset = team_preset_loader::get_preset(preset_id, language)?;

    // Verify the team still exists. Returns NotFound if the user
    // deleted it between the failed adopt and the retry click.
    let _team = team_repo::get_by_id(&state.db, team_id)?;

    // Build the role → existing team_member_id map from the team's
    // current members. Used to skip already-present roles AND to
    // resolve connection endpoints that survived the first adopt.
    let existing_members = team_repo::get_members(&state.db, team_id)?;
    let mut role_to_member_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();
    for m in &existing_members {
        // Key by the SEMANTIC role (recovered from config), NOT the always-
        // `worker` pipeline-role column — otherwise the skip + connection
        // rebuild below can't match existing members to manifest roles.
        let semantic = member_semantic_role(m.config.as_deref(), &m.role);
        role_to_member_id.insert(semantic, m.id.clone());
    }
    let existing_members_view: Vec<AdoptedTeamPresetMember> = existing_members
        .iter()
        .filter_map(|m| {
            let semantic = member_semantic_role(m.config.as_deref(), &m.role);
            preset
                .members
                .iter()
                .find(|pm| pm.role == semantic)
                .map(|pm| AdoptedTeamPresetMember {
                    role: semantic.clone(),
                    template_id: pm.template_id.clone(),
                    persona_id: m.persona_id.clone(),
                    team_member_id: m.id.clone(),
                })
        })
        .collect();

    // Per-member retry loop. Reuses the same emit-progress contract so
    // the UI's status badges animate the same way as on the first run.
    let mut new_members: Vec<AdoptedTeamPresetMember> = Vec::new();
    let mut failures: Vec<AdoptedTeamPresetFailure> = Vec::new();

    for role in roles_to_retry {
        let Some(manifest_member) = preset.members.iter().find(|m| &m.role == role) else {
            failures.push(AdoptedTeamPresetFailure {
                role: role.clone(),
                template_id: String::new(),
                reason: format!("Role '{role}' not found in preset manifest"),
            });
            continue;
        };

        // Idempotent skip — role already in the team means the retry
        // already landed (perhaps via a previous attempt the user
        // didn't see complete). Don't re-adopt.
        if role_to_member_id.contains_key(role) {
            continue;
        }

        emit_progress(
            &app,
            &preset.id,
            role,
            &manifest_member.template_id,
            PROGRESS_ADOPTING,
            None,
        );

        let design_json =
            match team_preset_loader::load_template_design_by_id(&manifest_member.template_id) {
                Ok(s) => s,
                Err(err) => {
                    let reason = err.to_string();
                    failures.push(AdoptedTeamPresetFailure {
                        role: role.clone(),
                        template_id: manifest_member.template_id.clone(),
                        reason: reason.clone(),
                    });
                    emit_progress(
                        &app,
                        &preset.id,
                        role,
                        &manifest_member.template_id,
                        PROGRESS_FAILED,
                        Some(reason),
                    );
                    continue;
                }
            };

        let member_overrides = parameter_overrides.and_then(|all| all.get(role));
        let adopt_value = match instant_adopt_template_inner(
            state,
            manifest_member.template_id.clone(),
            design_payload_json(&design_json),
            member_overrides,
        ) {
            Ok(v) => v,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: role.clone(),
                    template_id: manifest_member.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    role,
                    &manifest_member.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        let persona_id = match persona_id_from_adopt_value(&adopt_value) {
            Ok(id) => id,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: role.clone(),
                    template_id: manifest_member.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    role,
                    &manifest_member.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        if let Some(tid) = home_team_id {
            if let Err(e) = bind_persona_home_team(state, &persona_id, tid) {
                tracing::warn!(
                    persona_id = %persona_id,
                    home_team_id = %tid,
                    error = %e,
                    "retry_failed_members: bind_persona_home_team failed (continuing)"
                );
            }
        }

        // See adopt_preset: the preset role is a semantic label, not a
        // pipeline-role enum value — store `worker` + stash the label in
        // config.
        let team_member = match team_repo::add_member(
            &state.db,
            team_id,
            &persona_id,
            Some(MEMBER_PIPELINE_ROLE.to_string()),
            Some(manifest_member.x),
            Some(manifest_member.y),
            Some(preset_role_config(role)),
        ) {
            Ok(tm) => tm,
            Err(err) => {
                let reason = err.to_string();
                failures.push(AdoptedTeamPresetFailure {
                    role: role.clone(),
                    template_id: manifest_member.template_id.clone(),
                    reason: reason.clone(),
                });
                emit_progress(
                    &app,
                    &preset.id,
                    role,
                    &manifest_member.template_id,
                    PROGRESS_FAILED,
                    Some(reason),
                );
                continue;
            }
        };

        role_to_member_id.insert(role.clone(), team_member.id.clone());
        new_members.push(AdoptedTeamPresetMember {
            role: role.clone(),
            template_id: manifest_member.template_id.clone(),
            persona_id,
            team_member_id: team_member.id,
        });
        emit_progress(
            &app,
            &preset.id,
            role,
            &manifest_member.template_id,
            PROGRESS_DONE,
            None,
        );
    }

    // Wire any connections that NOW have both endpoints resolved.
    // teams::create_connection's own dedupe rejects existing edges as a
    // validation error — we swallow that one specific case so a retry
    // doesn't surface harmless duplicate-attempt errors.
    let mut created_connections: i32 = 0;
    for c in &preset.connections {
        let (Some(src), Some(dst)) = (role_to_member_id.get(&c.from), role_to_member_id.get(&c.to))
        else {
            continue;
        };
        match team_repo::create_connection(
            &state.db,
            team_id,
            src,
            dst,
            Some(c.connection_type.clone()),
            None,
            c.label.clone(),
        ) {
            Ok(_) => created_connections += 1,
            Err(AppError::Validation(msg))
                if msg.contains("already exists") || msg.contains("Duplicate") =>
            {
                // Pre-existing edge from the original adoption — fine.
            }
            Err(e) => {
                tracing::warn!(
                    preset = %preset.id,
                    from = %c.from,
                    to = %c.to,
                    error = %e,
                    "retry_failed_members: create_connection failed (continuing)"
                );
            }
        }
    }

    // Return the FULL member list (old + new) so the UI can swap the
    // whole state without re-reading separately. Existing members
    // mapped to AdoptedTeamPresetMember above.
    let mut all_members = existing_members_view;
    all_members.extend(new_members);

    // Re-wire handoff now that newly-retried members + their connections exist.
    // Surface the outcome on the result (same contract as adopt_preset) so a
    // retry that lands members but fails to wire them still tells the UI the
    // team isn't cascading yet.
    let (handoff_wired, handoff_error) = match crate::engine::team_handoff::wire_team_handoff(
        &state.db, team_id,
    ) {
        Ok(_) => (true, None),
        Err(e) => {
            tracing::warn!(team_id, error = %e, "retry_failed_members: handoff wiring failed (continuing)");
            (false, Some(e.to_string()))
        }
    };

    Ok(AdoptedTeamPresetResult {
        preset_id: preset.id,
        team_id: team_id.to_string(),
        home_team_id: home_team_id.map(|s| s.to_string()),
        members: all_members,
        failed_members: failures,
        created_connections,
        handoff_wired,
        handoff_error,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semantic_role_recovers_preset_role_from_config() {
        // The role column is always `worker`; the real role is stashed in config.
        let cfg = preset_role_config("architect");
        assert_eq!(member_semantic_role(Some(&cfg), "worker"), "architect");
        let cfg = preset_role_config("qa");
        assert_eq!(member_semantic_role(Some(&cfg), "worker"), "qa");
    }

    #[test]
    fn semantic_role_falls_back_to_role_column_when_no_preset_stash() {
        // Non-preset member (no config / no preset_role key) → use the raw role.
        assert_eq!(member_semantic_role(None, "reviewer"), "reviewer");
        assert_eq!(
            member_semantic_role(Some("{}"), "orchestrator"),
            "orchestrator"
        );
        assert_eq!(member_semantic_role(Some("not json"), "worker"), "worker");
        assert_eq!(
            member_semantic_role(Some(r#"{"other":"x"}"#), "worker"),
            "worker"
        );
    }
}

// ---------------------------------------------------------------------------
// Additive-mode tests.
//
// `adopt_preset` itself takes an `Arc<AppState>` — a ~40-field struct with a
// live engine, scheduler, session keypair and tokio handles — so no unit test
// can call it. The two decisions that additive mode actually changes were
// extracted (`resolve_adoption_team`, `should_delete_empty_shell`) precisely so
// they can be exercised against a real database instead of being asserted only
// by reading the code.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod additive_mode_tests {
    use super::*;
    use crate::db::models::{TeamPresetGroupSpec, TeamPresetMember, TeamPresetTeamSpec};
    use crate::db::repos::resources::teams as team_repo;

    fn fixture_preset() -> TeamPreset {
        TeamPreset {
            id: "fixture".into(),
            schema_version: 1,
            name: "Fixture".into(),
            description: "d".into(),
            icon: None,
            color: "#123456".into(),
            category: vec![],
            team: TeamPresetTeamSpec {
                name: "Preset's Own Team Name".into(),
                description: Some("preset description".into()),
                color: Some("#abcdef".into()),
            },
            group: Some(TeamPresetGroupSpec {
                name: "g".into(),
                color: "#000000".into(),
                shared_instructions: Some("preset instructions".into()),
                north_star: None,
            }),
            members: vec![TeamPresetMember {
                template_id: "t1".into(),
                role: "capture".into(),
                x: 0.0,
                y: 0.0,
            }],
            connections: vec![],
        }
    }

    /// Checks out through the db crate's instrumented `PoolExt::conn` and reads
    /// the count BY NAME — the same two rules production code follows.
    fn team_count(pool: &crate::db::DbPool) -> i64 {
        crate::db::PoolExt::conn(pool, "test:preset_team_count")
            .unwrap()
            .query_row("SELECT COUNT(*) AS n FROM persona_teams", [], |r| {
                r.get("n")
            })
            .unwrap()
    }

    /// The core of additive mode: adopting into a project's team resolves that
    /// team and mints NOTHING. The preset's own team name never touches it.
    #[test]
    fn target_team_id_reuses_the_team_and_creates_no_row() {
        let pool = crate::db::init_test_db().unwrap();
        let project = crate::db::repos::dev::projects::create_project(
            &pool,
            "Personas",
            "/tmp/adopt-target",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let project = crate::db::project_team::ensure_project_team(&pool, &project).unwrap();
        let team_id = project.team_id.clone().unwrap();
        assert_eq!(team_count(&pool), 1);

        let resolved =
            resolve_adoption_team(&pool, &fixture_preset(), Some(team_id.as_str())).unwrap();

        assert_eq!(resolved.id, team_id, "the project's own team");
        assert_eq!(
            resolved.name, "Personas",
            "the preset must not rename the project's team"
        );
        assert_eq!(team_count(&pool), 1, "no second team was minted");
    }

    /// A caller cannot name a team into existence, and a team deleted between
    /// the picker rendering and the adopt click must fail loudly.
    #[test]
    fn an_unknown_target_team_is_rejected_rather_than_created() {
        let pool = crate::db::init_test_db().unwrap();
        let err = resolve_adoption_team(&pool, &fixture_preset(), Some("no-such-team"))
            .expect_err("must not invent a team");
        assert!(
            matches!(err, AppError::NotFound(_)),
            "expected NotFound, got {err:?}"
        );
        assert_eq!(team_count(&pool), 0);
    }

    /// The legacy path is untouched: no target → a standalone team from the
    /// manifest's own spec. Engine/templates surfaces still depend on this.
    #[test]
    fn no_target_still_creates_the_standalone_team_from_the_manifest() {
        let pool = crate::db::init_test_db().unwrap();
        let team = resolve_adoption_team(&pool, &fixture_preset(), None).unwrap();
        assert_eq!(team.name, "Preset's Own Team Name");
        assert_eq!(team.color, "#abcdef");
        assert_eq!(team_count(&pool), 1);
        // And it is a real row the members can be added to.
        assert_eq!(team_repo::get_members(&pool, &team.id).unwrap().len(), 0);
    }

    /// You never delete a team you did not create. The all-members-failed
    /// rollback exists to clean up a shell this call minted seconds earlier;
    /// against a project's roster it would cascade away members the adoption
    /// knows nothing about.
    #[test]
    fn the_empty_shell_rollback_never_touches_a_caller_supplied_team() {
        // Standalone, everything failed → clean up the shell.
        assert!(should_delete_empty_shell(false, 0, 3));
        // Additive, everything failed → leave the project's team alone.
        assert!(!should_delete_empty_shell(true, 0, 3));
        // Partial success is not a rollback in either mode.
        assert!(!should_delete_empty_shell(false, 2, 1));
        assert!(!should_delete_empty_shell(true, 2, 1));
        // Nothing selected (no members, no failures) is not a failure.
        assert!(!should_delete_empty_shell(false, 0, 0));
    }
}
