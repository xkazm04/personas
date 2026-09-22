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
//! WP0 CONTRACT STUB: the shapes and the wire names are frozen here so the
//! frontend can be built against them; WP3 implements the bodies.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

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

/// The status of all three companions.
///
/// WP0 STUB: returns the shape with intent-only values so the frontend compiles
/// and renders; WP3 replaces the body with the real reads.
#[tauri::command]
pub fn companions_status(state: State<'_, Arc<AppState>>) -> Result<CompanionsStatusDto, AppError> {
    require_auth_sync(&state)?;
    Ok(CompanionsStatusDto {
        companions: vec![
            CompanionStatusDto {
                id: CompanionId::Athena,
                enabled: true,
                eligible: true,
                blocker: None,
                onboarded: true,
                detail: CompanionDetailDto::default(),
            },
            CompanionStatusDto {
                id: CompanionId::Overseer,
                enabled: false,
                eligible: false,
                blocker: Some(CompanionBlocker::NoStarredPersonas),
                onboarded: true,
                detail: CompanionDetailDto::default(),
            },
            CompanionStatusDto {
                id: CompanionId::Curator,
                enabled: false,
                eligible: true,
                blocker: None,
                onboarded: true,
                detail: CompanionDetailDto::default(),
            },
        ],
    })
}

/// Switch one companion on or off. Refuses when the prerequisite is missing.
///
/// WP0 STUB: WP3 writes the setting, enforces the prerequisite and emits
/// `companions://status-changed`.
#[tauri::command]
pub fn companions_set_enabled(
    state: State<'_, Arc<AppState>>,
    companion_id: CompanionId,
    enabled: bool,
) -> Result<CompanionsStatusDto, AppError> {
    require_auth_sync(&state)?;
    let _ = (companion_id, enabled);
    companions_status(state)
}

/// Record that Athena's onboarding wizard was finished.
///
/// WP0 STUB: WP3 writes the `athena_onboarded_at` setting.
#[tauri::command]
pub fn athena_mark_onboarded(state: State<'_, Arc<AppState>>) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    Ok(())
}
