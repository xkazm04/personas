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
    CreatePersonaGroupInput, CreateTeamInput, TeamPreset, TeamPresetAdoptProgress,
};
use crate::db::repos::core::groups as group_repo;
use crate::db::repos::resources::teams as team_repo;
use crate::engine::event_registry::event_name;
use crate::engine::team_preset_loader;
use crate::error::AppError;
use crate::AppState;

const PROGRESS_QUEUED: &str = "queued";
const PROGRESS_ADOPTING: &str = "adopting";
const PROGRESS_DONE: &str = "done";
const PROGRESS_FAILED: &str = "failed";

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

/// Stamp `group_id` onto a freshly-adopted persona. Best-effort: a
/// failure logs and returns Ok(()) so the adopter doesn't fail the
/// whole member just because the group-binding follow-up tripped.
fn bind_persona_to_group(
    state: &Arc<AppState>,
    persona_id: &str,
    group_id: &str,
) -> Result<(), AppError> {
    let conn = state.db.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    conn.execute(
        "UPDATE personas SET group_id = ?1, updated_at = ?2 WHERE id = ?3",
        params![group_id, now, persona_id],
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
pub fn adopt_preset(
    state: &Arc<AppState>,
    app: Option<AppHandle>,
    preset_id: &str,
    language: Option<&str>,
) -> Result<AdoptedTeamPresetResult, AppError> {
    let preset: TeamPreset = team_preset_loader::get_preset(preset_id, language)?;

    // 0. Emit a `queued` event per member up-front so the UI's per-row
    //    status table can render the full skeleton immediately. Then the
    //    subsequent `adopting` / `done` / `failed` transitions update
    //    rows in place.
    for m in &preset.members {
        emit_progress(
            &app,
            &preset.id,
            &m.role,
            &m.template_id,
            PROGRESS_QUEUED,
            None,
        );
    }

    // 1. Optional group
    let group_id: Option<String> = if let Some(group_spec) = &preset.group {
        let created = group_repo::create(
            &state.db,
            CreatePersonaGroupInput {
                name: group_spec.name.clone(),
                color: Some(group_spec.color.clone()),
                sort_order: None,
                description: None,
            },
        )?;
        // sharedInstructions / defaultModelProfile / etc. are stamped via
        // a follow-up update so the create path stays narrow.
        if let Some(shared) = &group_spec.shared_instructions {
            use crate::db::models::UpdatePersonaGroupInput;
            let _ = group_repo::update(
                &state.db,
                &created.id,
                UpdatePersonaGroupInput {
                    shared_instructions: Some(Some(shared.clone())),
                    ..Default::default()
                },
            );
        }
        Some(created.id)
    } else {
        None
    };

    // 2. Team shell — created unconditionally so the user keeps it on
    //    partial failure.
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

    // 3. Per-member adoption. role → team_member_id lookup is built as
    //    we go so step 4 can resolve connection endpoints without a
    //    second pass over the result list.
    let mut members: Vec<AdoptedTeamPresetMember> = Vec::new();
    let mut failures: Vec<AdoptedTeamPresetFailure> = Vec::new();
    let mut role_to_member_id: std::collections::HashMap<String, String> =
        std::collections::HashMap::new();

    for m in &preset.members {
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
        //    integrity-checked).
        let adopt_value =
            match instant_adopt_template_inner(state, m.template_id.clone(), design_json) {
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

        // c. Bind to group if applicable. Best-effort — logged on failure
        //    but doesn't fail the member.
        if let Some(gid) = &group_id {
            if let Err(e) = bind_persona_to_group(state, &persona_id, gid) {
                tracing::warn!(
                    persona_id = %persona_id,
                    group_id = %gid,
                    error = %e,
                    "adopt_team_preset: bind_persona_to_group failed (continuing)"
                );
            }
        }

        // d. Add to team at the manifest position.
        let team_member = match team_repo::add_member(
            &state.db,
            &team.id,
            &persona_id,
            Some(m.role.clone()),
            Some(m.x),
            Some(m.y),
            None,
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

    Ok(AdoptedTeamPresetResult {
        preset_id: preset.id,
        team_id: team.id,
        group_id,
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
    group_id: Option<&str>,
    roles_to_retry: &[String],
    language: Option<&str>,
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

        let adopt_value = match instant_adopt_template_inner(
            state,
            manifest_member.template_id.clone(),
            design_json,
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

        if let Some(gid) = group_id {
            if let Err(e) = bind_persona_to_group(state, &persona_id, gid) {
                tracing::warn!(
                    persona_id = %persona_id,
                    group_id = %gid,
                    error = %e,
                    "retry_failed_members: bind_persona_to_group failed (continuing)"
                );
            }
        }

        let team_member = match team_repo::add_member(
            &state.db,
            team_id,
            &persona_id,
            Some(role.clone()),
            Some(manifest_member.x),
            Some(manifest_member.y),
            None,
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

    Ok(AdoptedTeamPresetResult {
        preset_id: preset.id,
        team_id: team_id.to_string(),
        group_id: group_id.map(|s| s.to_string()),
        members: all_members,
        failed_members: failures,
        created_connections,
    })
}
