//! The Companions category: the status of the three built-in companions and
//! the one door that switches one of them on or off.
//!
//! Three companions, one runtime, three minds: **Athena** (the assistant),
//! **Overseer** (keeps the operator's agents running and worth their cost) and
//! **Curator** (keeps a mapped knowledge registry world-class and applied).
//! This module owns only the CATEGORY: who exists, who may be switched on, and
//! who is on. Each companion's own surface keeps its own module.
//!
//! Vocabulary (decided 2026-09-22): `companions_*` is the category, `companion_*`
//! is the shared runtime all three will run on, `athena_*` is what only she has.
//!
//! ## `enabled` and `eligible` are different facts
//!
//! `enabled` is the OPERATOR'S INTENT, persisted in `app_settings`. `eligible`
//! is whether the prerequisite is met right now (Overseer needs a starred
//! agent; Curator needs a mapped registry). They are kept apart so that losing
//! a prerequisite shows as *blocked* rather than silently rewriting the switch
//! the operator set: unstarring the last agent must not turn Overseer off, or
//! re-starring one would leave him mysteriously silent.
//!
//! ## Who reads this
//!
//! [`athena_enabled`] is the gate every Athena background loop consults ON EACH
//! TICK (never once at boot), so a flip takes effect within one tick instead of
//! at the next app start. [`overseer_active`] is the same for the Director
//! coaching entry points. Both are cheap: one indexed settings read.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use ts_rs::TS;

use crate::db::{repos::core::settings as settings_repo, settings_keys, DbPool};
// The event's NAME lives in the one registry both sides read, not beside its
// emitter: a name that is only a literal here is a name the frontend can
// mistype with nothing to catch it (census `unregistered-tauri-event-name`).
use crate::engine::event_registry::event_name;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

/// Which companion. The wire value is the lowercase id used everywhere else
/// (settings keys, disk roots, the frontend's page ids).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CompanionId {
    Athena,
    Overseer,
    Curator,
}

/// Why a companion cannot be switched on yet. `None` on the DTO means nothing
/// stands in the way; it says nothing about whether the companion is ON.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum CompanionBlocker {
    /// Athena only: the onboarding wizard was never finished.
    NotOnboarded,
    /// Overseer: no persona is starred, so he would have nothing to watch.
    NoStarredPersonas,
    /// Curator: no workspace maps a knowledge registry for her to curate.
    NoRegistry,
}

/// The few live facts a surface may show beside a companion. Every field is
/// OPTIONAL and is omitted when it is unknown: a missing count is not zero.
/// Counts are `u32` on purpose (ts-rs turns i64/u64/usize into `bigint`, which
/// breaks arithmetic on the TS side - census `bigint-binding-field`).
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionDetailDto {
    /// Athena: decisions waiting for the operator right now.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pending_decisions: Option<u32>,
    /// Overseer: how many personas are starred (his scope).
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub starred_count: Option<u32>,
    /// Overseer: how many personas exist at all, so "3 of 16" can be drawn.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agents_total: Option<u32>,
    /// Curator: the mapped registry's name, when one is mapped.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_name: Option<String>,
    /// Curator: the mapped registry's checkout path.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry_path: Option<String>,
}

/// One companion's standing. `enabled` is the operator's intent, `eligible` is
/// whether the prerequisite is met; a surface treats them separately, because
/// losing the prerequisite must never silently rewrite the intent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionStatusDto {
    pub id: CompanionId,
    /// The operator's switch (settings `athena_enabled` / `overseer_enabled` /
    /// `curator_enabled`).
    pub enabled: bool,
    /// Whether the prerequisite is met right now.
    pub eligible: bool,
    /// Set when `eligible` is false; names which prerequisite is missing.
    #[ts(optional)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub blocker: Option<CompanionBlocker>,
    /// Athena: the onboarding wizard was finished (or her brain proves it).
    /// Always true for the other two, which have nothing to onboard.
    pub onboarded: bool,
    pub detail: CompanionDetailDto,
}

/// The whole category in one read, always in the order athena, overseer, curator.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct CompanionsStatusDto {
    pub companions: Vec<CompanionStatusDto>,
}

// ---------------------------------------------------------------------------
// The switches — the readers every gated call site uses
// ---------------------------------------------------------------------------

/// Whether Athena runs. **Call this per tick, never once at boot** — the whole
/// point of the switch is that flipping it takes effect on the live process.
pub fn athena_enabled(db: &DbPool) -> bool {
    settings_repo::get_bool(
        db,
        settings_keys::ATHENA_ENABLED,
        settings_keys::ATHENA_ENABLED_DEFAULT,
    )
}

/// Whether the operator has switched Overseer on. Prefer [`overseer_active`] at
/// a call site that is about to DO Overseer's work: being on with nothing to
/// watch is not the same as running.
pub fn overseer_enabled(db: &DbPool) -> bool {
    settings_repo::get_bool(
        db,
        settings_keys::OVERSEER_ENABLED,
        settings_keys::OVERSEER_ENABLED_DEFAULT,
    )
}

/// Whether Curator is switched on. Nothing in the backend acts on this yet —
/// she has no loop (a later stage builds one); the status door and her Setup
/// page are the only readers.
pub fn curator_enabled(db: &DbPool) -> bool {
    settings_repo::get_bool(
        db,
        settings_keys::CURATOR_ENABLED,
        settings_keys::CURATOR_ENABLED_DEFAULT,
    )
}

/// How many personas are starred — Overseer's scope, and his prerequisite.
fn starred_count(db: &DbPool) -> u32 {
    match crate::db::repos::core::personas::get_starred(db) {
        Ok(rows) => rows.len().min(u32::MAX as usize) as u32,
        Err(e) => {
            tracing::warn!(error = %e, "companions: starred-persona read failed - reporting none");
            0
        }
    }
}

/// The registry that makes Curator eligible, or `None`.
///
/// Two terms, and both are load-bearing. **Held by a workspace**: a registry
/// row nobody holds is leftover wiring, not a corpus she was given. **On this
/// disk right now**: a `stat` rather than a row read, because a clone that was
/// moved or deleted is exactly the state that has to show as blocked - the row
/// still says everything is wired, and only the filesystem disagrees.
///
/// Lowest id when several qualify, so two reads a second apart name the same
/// registry.
fn curator_registry(db: &DbPool) -> Option<crate::db::models::DevRegistry> {
    match crate::db::repos::dev_registries::mapped(db) {
        Ok(rows) => rows.into_iter().find(|r| {
            let path = r.clone_path.trim();
            !path.is_empty() && std::path::Path::new(path).is_dir()
        }),
        Err(e) => {
            // A failed read must not report a wiring that may well be there.
            // Blocked is the reading that claims least, and the Setup page's
            // remedy ("map a registry") is harmless if one already is.
            tracing::warn!(error = %e, "companions: registry read failed - reporting Curator blocked");
            None
        }
    }
}

/// Overseer is ACTIVE when the operator has switched him on **and** he has
/// something to watch. Both terms are re-read here rather than cached, so a
/// star or a switch takes effect on the next call.
///
/// This is the gate the Director coaching entry points refuse behind. It is
/// deliberately NOT reached by the App master probation path, which raises its
/// own review packets through `engine::director::create_probation_review` and
/// never enters the coaching cycle.
pub fn overseer_active(db: &DbPool) -> bool {
    overseer_enabled(db) && starred_count(db) >= 1
}

/// The typed refusal a Director coaching entry point returns while Overseer is
/// inactive. `Validation` rather than `Forbidden` because nothing is denied to
/// the caller: a prerequisite is missing, and the message names which.
pub fn overseer_inactive_error() -> AppError {
    AppError::Validation(
        "Overseer is not active: switch him on in Companions > Overseer > Setup and star at \
         least one agent for him to watch"
            .into(),
    )
}

/// Whether Athena's onboarding is done.
///
/// Two ways to be onboarded, and the second one is why this is not a single
/// settings read: the `athena_onboarded_at` marker is NEWER than the wizard, so
/// an install that finished onboarding before the marker existed has no row.
/// The fallback is the same fresh-install predicate her own prompt uses
/// (`prompt::needs_onboarding`) — no conversation episode has ever been
/// recorded AND her identity layer still holds the seeded placeholder bullets.
/// Sharing that predicate is what keeps the two from drifting: an install whose
/// prompt is still in onboarding mode while the status says "onboarded" would
/// offer no way to finish what she is asking for.
fn athena_onboarded(state: &Arc<AppState>) -> bool {
    if matches!(
        settings_repo::get(&state.db, settings_keys::ATHENA_ONBOARDED_AT),
        Ok(Some(ref v)) if !v.trim().is_empty()
    ) {
        return true;
    }
    let identity = crate::companion::disk::brain_root()
        .ok()
        .and_then(|root| std::fs::read_to_string(root.join("identity.md")).ok())
        .unwrap_or_default();
    let no_episodes = match crate::companion::brain::episodic::any_conversation_episode(
        &state.user_db,
    ) {
        Ok(any) => !any,
        Err(e) => {
            // A failed read must not raise a false "finish your onboarding"
            // banner over a brain that is full; assume there is history.
            tracing::warn!(error = %e, "companions: episode probe failed - assuming Athena has history");
            false
        }
    };
    // An absent identity.md reads as fresh, not as onboarded: the file is
    // written from the seeded template at first init, so its absence means
    // nothing has happened yet. The shared predicate cannot say that on its own
    // — it answers "does this text still carry the placeholder markers", and
    // empty text carries none.
    let fresh = if identity.trim().is_empty() {
        no_episodes
    } else {
        crate::companion::prompt::needs_onboarding(&identity, no_episodes)
    };
    !fresh
}

// ---------------------------------------------------------------------------
// The snapshot
// ---------------------------------------------------------------------------

/// Build the whole category's standing. Shared by the command, the event
/// emitter and the tests, so there is one definition of each companion's state.
///
/// All three companions answer from the database here. Curator's did not until
/// the workspace -> registry link was promoted out of the browser (migration
/// e47): this function reported `eligible: true, blocker: None` and the
/// frontend hook patched both from `localStorage`, which meant the one surface
/// that could see her prerequisite was the one surface her loop will never run
/// in. That seam is closed - the hook now renders what this says.
pub fn status_snapshot(state: &Arc<AppState>) -> CompanionsStatusDto {
    let db = &state.db;

    let starred = starred_count(db);
    let agents_total = match crate::db::repos::core::personas::count_non_system(db) {
        Ok(n) => Some(n.min(u32::MAX as usize) as u32),
        Err(e) => {
            // Omitted, never 0: "0 agents" and "we could not count" are
            // different sentences and the surface must not print the first.
            tracing::warn!(error = %e, "companions: persona count failed - omitting agentsTotal");
            None
        }
    };
    let onboarded = athena_onboarded(state);

    CompanionsStatusDto {
        companions: vec![
            CompanionStatusDto {
                id: CompanionId::Athena,
                enabled: athena_enabled(db),
                // She has no prerequisite: unfinished onboarding is reported on
                // `onboarded`, which the landing surface ranks above both.
                eligible: true,
                blocker: (!onboarded).then_some(CompanionBlocker::NotOnboarded),
                onboarded,
                // `pendingDecisions` is omitted on purpose. The decision queue is
                // an aggregate of three live sources (pending approvals, blocking
                // incidents, pending human reviews - see `useDecisionQueue`), so
                // there is no one cheap count, and a partial one would print a
                // number that disagrees with the badge next to it.
                detail: CompanionDetailDto::default(),
            },
            {
                let eligible = starred >= 1;
                CompanionStatusDto {
                    id: CompanionId::Overseer,
                    enabled: overseer_enabled(db),
                    eligible,
                    blocker: (!eligible).then_some(CompanionBlocker::NoStarredPersonas),
                    onboarded: true,
                    detail: CompanionDetailDto {
                        starred_count: Some(starred),
                        agents_total,
                        ..CompanionDetailDto::default()
                    },
                }
            },
            {
                let registry = curator_registry(db);
                CompanionStatusDto {
                    id: CompanionId::Curator,
                    enabled: curator_enabled(db),
                    eligible: registry.is_some(),
                    blocker: registry.is_none().then_some(CompanionBlocker::NoRegistry),
                    onboarded: true,
                    detail: CompanionDetailDto {
                        registry_name: registry.as_ref().map(|r| r.full_name.clone()),
                        registry_path: registry.as_ref().map(|r| r.clone_path.clone()),
                        ..CompanionDetailDto::default()
                    },
                }
            },
        ],
    }
}

/// Publish the category's standing to every listening surface.
///
/// Best-effort by construction: the write that prompted it has already
/// committed, so a failed emit costs a stale panel until the next read, never
/// a lost change. Call it from anywhere that changes a TERM of the status.
pub fn emit_status(app: &AppHandle, state: &Arc<AppState>) {
    let payload = status_snapshot(state);
    if let Err(e) = app.emit(event_name::COMPANIONS_STATUS_CHANGED, &payload) {
        tracing::warn!(error = %e, "companions: status event emit failed");
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// The status of all three companions.
#[tauri::command]
pub fn companions_status(state: State<'_, Arc<AppState>>) -> Result<CompanionsStatusDto, AppError> {
    require_auth_sync(&state)?;
    Ok(status_snapshot(state.inner()))
}

/// Switch one companion on or off, and report the whole category back.
///
/// Refuses when the prerequisite is missing, so the caller surfaces the refusal
/// rather than pretending the switch moved. Switching OFF is never refused —
/// an operator must always be able to stop a companion, whatever state it is in.
#[tauri::command]
pub fn companions_set_enabled(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    companion_id: CompanionId,
    enabled: bool,
) -> Result<CompanionsStatusDto, AppError> {
    require_auth_sync(&state)?;
    let key = match companion_id {
        CompanionId::Athena => settings_keys::ATHENA_ENABLED,
        CompanionId::Overseer => settings_keys::OVERSEER_ENABLED,
        CompanionId::Curator => settings_keys::CURATOR_ENABLED,
    };
    if enabled && companion_id == CompanionId::Overseer && starred_count(&state.db) < 1 {
        return Err(overseer_inactive_error());
    }
    settings_repo::set(&state.db, key, if enabled { "true" } else { "false" })?;
    let snapshot = status_snapshot(state.inner());
    if let Err(e) = app.emit(event_name::COMPANIONS_STATUS_CHANGED, &snapshot) {
        tracing::warn!(error = %e, "companions: status event emit failed");
    }
    Ok(snapshot)
}

/// Record that Athena's onboarding wizard was finished.
///
/// Idempotent: the marker is a milestone, so a second finish keeps the first
/// instant rather than back-dating it to now.
#[tauri::command]
pub fn athena_mark_onboarded(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let already = matches!(
        settings_repo::get(&state.db, settings_keys::ATHENA_ONBOARDED_AT),
        Ok(Some(ref v)) if !v.trim().is_empty()
    );
    if !already {
        settings_repo::set(
            &state.db,
            settings_keys::ATHENA_ONBOARDED_AT,
            &chrono::Utc::now().to_rfc3339(),
        )?;
    }
    emit_status(&app, state.inner());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The two switch readers must answer from the SETTINGS ROW, and must
    /// answer the documented default when the row is absent. A default read the
    /// wrong way round would either run Athena's loops on an install that
    /// switched her off, or leave Overseer silent after the operator turned him
    /// on.
    #[test]
    fn switch_defaults_match_the_documented_meaning_of_unset() {
        let db = personas_db::init_test_db().expect("test db");
        // Unset: Athena runs, the other two do not.
        assert!(athena_enabled(&db));
        assert!(!overseer_enabled(&db));
        assert!(!curator_enabled(&db));

        settings_repo::set(&db, settings_keys::ATHENA_ENABLED, "false").expect("write");
        settings_repo::set(&db, settings_keys::OVERSEER_ENABLED, "true").expect("write");
        settings_repo::set(&db, settings_keys::CURATOR_ENABLED, "true").expect("write");
        assert!(!athena_enabled(&db));
        assert!(overseer_enabled(&db));
        assert!(curator_enabled(&db));
    }

    /// Overseer switched ON with nothing starred is NOT active. This is the
    /// predicate the three coaching entry points refuse behind; if it ever
    /// returned true for an empty scope, `run_director_cycle_batch` would spend
    /// LLM budget walking an empty roster.
    #[test]
    fn overseer_is_inactive_without_a_starred_agent() {
        let db = personas_db::init_test_db().expect("test db");
        settings_repo::set(&db, settings_keys::OVERSEER_ENABLED, "true").expect("write");
        assert_eq!(starred_count(&db), 0);
        assert!(overseer_enabled(&db));
        assert!(
            !overseer_active(&db),
            "an Overseer with nothing to watch must not read as active"
        );
    }

    /// And the mirror: switched OFF is inactive however many agents are
    /// starred. Kept separate from the test above because the two halves fail
    /// for different reasons and a combined assert would not say which.
    #[test]
    fn overseer_is_inactive_while_switched_off() {
        let db = personas_db::init_test_db().expect("test db");
        assert!(!overseer_enabled(&db));
        assert!(!overseer_active(&db));
    }

    /// Curator's prerequisite, which until migration e47 no Rust could see at
    /// all. Three states, and the middle one is the whole reason this is a
    /// `stat` and not a row read: a registry row can say everything is wired
    /// while the working copy it names is gone.
    #[test]
    fn curator_needs_a_held_registry_whose_checkout_is_on_disk() {
        use crate::db::models::{DevRegistryInput, RegistryPairingState};
        use crate::db::repos::dev_registries as registries;
        let db = personas_db::init_test_db().expect("test db");

        // Nothing wired at all.
        assert!(curator_registry(&db).is_none());

        let root = std::env::temp_dir().join(format!("personas_curator_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root).expect("temp checkout");
        let clone_path = root.to_string_lossy().to_string();
        let input = DevRegistryInput {
            id: "org/reg".into(),
            full_name: "org/reg".into(),
            url: None,
            default_branch: "main".into(),
            credential_id: None,
            clone_path: clone_path.clone(),
            state: RegistryPairingState::Paired,
            session_id: None,
            lanes: vec!["knowledge".into()],
            domains: Vec::new(),
            sha: None,
            paired_at: None,
            error: None,
        };
        registries::upsert(&db, &input).expect("registry");

        // A registry nobody holds is leftover wiring, not a corpus she was
        // given.
        assert!(
            curator_registry(&db).is_none(),
            "an unheld registry must not make her eligible"
        );

        // Through the workspaces repo, not a hand-written INSERT: the command
        // layer has no business checking a connection out, and a fixture that
        // builds its own row stops matching production the moment a column
        // lands.
        let workspace =
            crate::db::repos::workspaces::org::create_workspace(&db, "Alpha", None, None, false)
                .expect("workspace");
        registries::link_workspace(&db, &workspace.id, "org/reg").expect("link");
        let found = curator_registry(&db).expect("held and present");
        assert_eq!(found.full_name, "org/reg");
        assert_eq!(found.clone_path, clone_path);

        // The checkout goes away and the row does not. Blocked is the only
        // honest answer, and it is the one the operator can act on.
        std::fs::remove_dir_all(&root).expect("remove checkout");
        assert!(
            curator_registry(&db).is_none(),
            "a row pointing at a vanished clone is not a wiring"
        );
    }

    /// The refusal is a typed `Validation` carrying a message that names the
    /// remedy. The Setup page maps it to `companions.errors.overseer_needs_star`;
    /// a bare `Internal` would reach the operator as an opaque failure.
    #[test]
    fn the_overseer_refusal_is_typed_and_names_the_remedy() {
        let err = overseer_inactive_error();
        assert!(matches!(err, AppError::Validation(_)));
        let text = err.to_string();
        assert!(
            text.contains("star"),
            "the refusal must name the remedy: {text}"
        );
    }
}
