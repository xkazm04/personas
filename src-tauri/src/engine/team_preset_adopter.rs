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
//!        a. `team_preset_loader::load_template_design_by_id` reads the
//!           canonical template JSON from disk.
//!        b. `commands::design::template_adopt::instant_adopt_template_inner`
//!           creates the persona atomically (persona + tools + triggers
//!           in one tx) — same path the existing "Dev Clone" shortcut
//!           uses, so the integrity check still runs.
//!        c. If a group was created in step 1, `UPDATE personas SET
//!           group_id = ?` is issued for the new persona.
//!        d. `repos::resources::teams::add_member` adds the persona to
//!           the team at the manifest's `(x, y)` with the role label.
//!        e. Emit a `team-preset-adopt-progress` event with the
//!           per-member status (queued → adopting → done/failed).
//!   4. For each connection in the manifest, if BOTH endpoint roles
//!      adopted successfully: `repos::resources::teams::create_connection`
//!      maps the role strings to the freshly-created member ids and
//!      writes the edge.
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
    AdoptedTeamPresetFailure, AdoptedTeamPresetMember, AdoptedTeamPresetResult,
    CreateTeamInput, TeamPreset, TeamPresetAdoptProgress, UpdateTeamInput,
};
use crate::db::repos::resources::teams as team_repo;
use crate::engine::event_registry::event_name;
use crate::engine::team_preset_loader;
use crate::error::AppError;
use crate::AppState;

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
        &std::collections::HashMap<
            String,
            std::collections::HashMap<String, serde_json::Value>,
        >,
    >,
    // When `Some`, adopt only the members whose `role` is in this set
    // (the preview modal lets the user deselect members before adopting).
    // `None` adopts every member — the default "Adopt all" path. Connections
    // are wired only between members that BOTH landed, so deselecting an
    // endpoint silently drops its edges (existing endpoint-missing skip).
    roles_filter: Option<&[String]>,
) -> Result<AdoptedTeamPresetResult, AppError> {
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

    // 1. Team shell — created unconditionally so the user keeps it on
    //    partial failure. The team IS the workspace now (Groups→Teams
    //    consolidation): a manifest `group` spec folds its workspace
    //    settings onto this team rather than creating a separate group.
    let team = team_repo::create(
        &state.db,
        CreateTeamInput {
            name: preset.team.name.clone(),
            project_id: None,
            parent_team_id: None,
            description: preset.team.description.clone(),
            canvas_data: None,
            team_config: None,
            icon: preset.icon.clone(),
            color: preset.team.color.clone().or_else(|| Some(preset.color.clone())),
            enabled: Some(true),
        },
    )?;

    // 2. Optional workspace facet. When the manifest declares a `group`
    //    spec, stamp its shared instructions onto the team and anchor every
    //    adopted persona's `home_team_id` to this team. `home_team_id` ==
    //    the team id; `None` means the preset declared no workspace.
    let home_team_id: Option<String> = if let Some(group_spec) = &preset.group {
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
        let adopt_value =
            match instant_adopt_template_inner(
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
    //    and one that stalls after the entry member.
    if let Err(e) = crate::engine::team_handoff::wire_team_handoff(&state.db, &team.id) {
        tracing::warn!(team_id = %team.id, error = %e, "adopt_team_preset: handoff wiring failed (continuing)");
    }

    Ok(AdoptedTeamPresetResult {
        preset_id: preset.id,
        team_id: team.id,
        home_team_id,
        members,
        failed_members: failures,
        created_connections,
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
pub fn retry_failed_members(
    state: &Arc<AppState>,
    app: Option<AppHandle>,
    preset_id: &str,
    team_id: &str,
    home_team_id: Option<&str>,
    roles_to_retry: &[String],
    language: Option<&str>,
    parameter_overrides: Option<
        &std::collections::HashMap<
            String,
            std::collections::HashMap<String, serde_json::Value>,
        >,
    >,
) -> Result<AdoptedTeamPresetResult, AppError> {
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
        role_to_member_id.insert(m.role.clone(), m.id.clone());
    }
    let existing_members_view: Vec<AdoptedTeamPresetMember> = existing_members
        .iter()
        .filter_map(|m| {
            preset
                .members
                .iter()
                .find(|pm| pm.role == m.role)
                .map(|pm| AdoptedTeamPresetMember {
                    role: m.role.clone(),
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
            Err(AppError::Validation(msg)) if msg.contains("already exists") || msg.contains("Duplicate") => {
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
    if let Err(e) = crate::engine::team_handoff::wire_team_handoff(&state.db, team_id) {
        tracing::warn!(team_id, error = %e, "retry_failed_members: handoff wiring failed (continuing)");
    }

    Ok(AdoptedTeamPresetResult {
        preset_id: preset.id,
        team_id: team_id.to_string(),
        home_team_id: home_team_id.map(|s| s.to_string()),
        members: all_members,
        failed_members: failures,
        created_connections,
    })
}
