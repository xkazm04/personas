//! The entry point: [`build_system_prompt`] gathers every block and hands
//! them to [`super::compose::compose`]. The cfg-gated [`EmbedderArg`] seam
//! keeps that one signature identical across ml and non-ml builds.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use super::addenda::{
    autonomous_addendum_if_enabled, daily_goals_addendum, display_addendum_if_voice_active,
    language_addendum, onboarding_addendum_if_needed, progress_addendum, voice_addendum_if_needed,
};
use super::budget::PromptBlockSizes;
use super::capabilities::{dev_tools_registry_for_prompt, format_connectors, format_plugins};
use super::compose::compose;
use super::devices::format_paired_devices;
use super::indexes::{format_context_index, format_persona_index, format_skill_index};
use super::projects::{format_project_goals, format_project_kpis, format_project_tracking_pulses};
use super::recall::{recall_for, synthesize_if_enabled};
use super::recall_preview::{summarize_recall, RecallPreview};
use super::scene::format_scene_digest;
use crate::companion::brain::recall_synthesis::Briefing;
use crate::companion::connectors;
use crate::companion::disk;
use crate::companion::observability;
use crate::companion::plugins;
use crate::db::{DbPool, UserDbPool};
#[cfg(feature = "ml")]
use crate::engine::embedder::EmbeddingManager;
use crate::error::AppError;

/// cfg-gated seam for the optional ml-feature embedder handle, mirroring
/// `athena_reaction::embedding_manager_of`.
/// Non-ml builds never construct a `Some(_)` value of this type — it
/// exists purely so `build_system_prompt` has ONE signature across both
/// feature builds instead of a whole-function cfg split.
#[cfg(feature = "ml")]
pub type EmbedderArg<'a> = Option<&'a Arc<EmbeddingManager>>;
#[cfg(not(feature = "ml"))]
pub type EmbedderArg<'a> = Option<&'a ()>;

/// Build the full system prompt.
///
/// `query` is the user's current message — used to seed retrieval. Pass
/// an empty string for non-retrieval prompts (e.g., reflection cycles).
///
/// Returns the composed prompt, the recall preview the panel renders, and
/// the per-block size breakdown the caller hands to the turn ledger.
// `too_many_arguments`: this signature is wide and stays wide for now. The
// workspace already carries 159 site-level allows on functions of the same
// shape; these were simply the ones that never got one. Converting them to a
// parameter struct is a later wave's job, and the attribute is the marker
// that says so.
#[allow(clippy::too_many_arguments)]
pub async fn build_system_prompt(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    embedder: EmbedderArg<'_>,
    session_id: &str,
    query: &str,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    autonomous_mode: bool,
) -> Result<(String, RecallPreview, PromptBlockSizes), AppError> {
    let root = disk::brain_root()?;
    let constitution =
        fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new());
    let identity = fs::read_to_string(root.join("identity.md")).unwrap_or_else(|_| String::new());

    let observability_md = observability::build(sys_db)
        .ok()
        .as_ref()
        .map(observability::format_for_prompt)
        .unwrap_or_default();

    // Append the operative-memory digest — active orchestration view
    // for Athena (live per-session work, files touched, recent
    // failures). Empty string when no operations are tracked so the
    // prompt stays clean for users not using fleet. This *replaces*
    // the older flat fleet-state digest with an operation-grouped
    // narrative tied to user intent.
    let observability_md = format!(
        "{}{}{}{}{}{}{}{}",
        observability_md,
        crate::companion::orchestration::operative_memory::memory().digest_for_prompt(),
        // Multi-conversation: the roster of the user's OTHER open threads, so one
        // Athena stays aware of all her conversations (design §2). Empty when
        // there's only this thread.
        crate::companion::conversation::roster_digest_for_prompt(user_db, session_id),
        // Fleet index blocks — bounded name→id listings for the three entity
        // kinds Athena's ops address by id. They ride the observability slot
        // ON PURPOSE: `compose()` blanks the six *memory* blocks when a recall
        // briefing exists, and these are structural facts about what exists
        // right now, not recalled memory. Blanking them would put her straight
        // back to inventing UUIDs on exactly the turns where recall is richest.
        format_persona_index(sys_db),
        format_context_index(sys_db),
        format_skill_index(sys_db),
        // Mastermind canvas scene digest (WP2). Same slot and the same
        // reasoning as the three index blocks: it is a structural fact about
        // what the portfolio looks like RIGHT NOW, not recalled memory, so it
        // must survive `compose()`'s recall-briefing blanking.
        format_scene_digest(sys_db),
        // The paired-device roster (WP3). Same slot and the same reasoning as
        // the index blocks: which machines exist and which are up right now is
        // a structural fact about this moment, not recalled memory, so it must
        // survive `compose()`'s recall-briefing blanking. Blanking it would put
        // her back to naming a device only when the operator says it out loud —
        // on exactly the turns where recall is richest.
        format_paired_devices(sys_db),
    );

    // The only genuinely ml-vs-non-ml seams: whether retrieval is
    // embedding-backed, and whether recall synthesis can run at all.
    let recall = recall_for(user_db, embedder, session_id, query).await;
    let briefing: Option<Briefing> =
        synthesize_if_enabled(user_db, &recall, query, recall_synthesis_enabled).await;

    let onboarding_md = onboarding_addendum_if_needed(&identity, &recall.episodes);
    // PROGRESS narration is always-on (visual timeline); the TTS grammar
    // rides the same prompt slot but only when voice playback is active.
    let voice_md = format!(
        "{}{}",
        voice_addendum_if_needed(voice_enabled),
        progress_addendum()
    );
    let display_md = display_addendum_if_voice_active(voice_enabled);
    // Dev-mode self-model rides the same "mode addenda" prompt slot as
    // autonomous mode — both are header-toggle-gated blocks and compose()
    // treats the slot as opaque markdown. The reply-language directive rides
    // the same opaque slot (non-English UI → explicit instruction; see
    // `language_addendum`).
    let autonomous_md = format!(
        "{}{}{}{}",
        autonomous_addendum_if_enabled(autonomous_mode),
        crate::companion::dev_mode::addendum_if_enabled(sys_db),
        daily_goals_addendum(user_db),
        language_addendum(sys_db),
    );
    let connector_names = connectors::list_enabled_for_prompt(user_db).unwrap_or_default();
    let connectors_md = format_connectors(&connector_names);
    let plugin_names = plugins::list_enabled(user_db).unwrap_or_default();
    let projects = dev_tools_registry_for_prompt(sys_db);
    let tracking_pulses_md = format_project_tracking_pulses(user_db, &plugin_names);
    let plugins_md = format!(
        "{}{}{}",
        format_plugins(&plugin_names, &projects, &tracking_pulses_md),
        format_project_goals(sys_db),
        format_project_kpis(sys_db),
    );

    let preview = summarize_recall(&recall, briefing.is_some());
    let (composed, block_sizes) = compose(
        &constitution,
        &identity,
        &observability_md,
        &recall,
        briefing.as_ref(),
        &plugins_md,
        &connectors_md,
        &onboarding_md,
        &voice_md,
        &display_md,
        &autonomous_md,
    );
    // Exactly one budget audit per composed prompt.
    block_sizes.warn_over_budget();
    Ok((composed, preview, block_sizes))
}
