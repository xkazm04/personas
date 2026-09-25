//! The entry point: [`build_system_prompt`] gathers every block and hands
//! them to [`super::compose::compose`]. The cfg-gated [`EmbedderArg`] seam
//! keeps that one signature identical across ml and non-ml builds.
//!
//! Moved verbatim out of the former single-file `prompt.rs`.

use std::fs;
#[cfg(feature = "ml")]
use std::sync::Arc;

use super::addenda::{
    autonomous_addendum_if_enabled, language_addendum, onboarding_addendum_if_needed,
    progress_addendum,
};
use super::budget::PromptBlockSizes;
use super::capabilities::{
    dev_tools_registry_for_prompt, format_browser_page, format_browser_whitelist,
    format_connectors, format_flagged_credentials, format_plugins,
};
use super::chat_family::{chat_static_core, layer_one_flag_for, voice_flag, PromptClass};
use super::compose::compose_for_class;
use super::devices::format_paired_devices;
use super::indexes::{format_context_index, format_persona_index, format_skill_index};
use super::projects::{format_project_goals, format_project_kpis, format_project_tracking_pulses};
use super::recall::{recall_for, synthesize_if_enabled};
use super::recall_preview::{summarize_recall, RecallPreview};
use super::scene::format_scene_digest;
use crate::browser_bridge::webview::PageCapture;
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

/// Build the system prompt for a MAIN-tier turn.
///
/// The compatibility entry point: every caller that predates the prompt
/// family selector goes through here and gets the class the MAIN tier
/// resolves to ([`PromptClass::for_tier`] on `TurnTierClass::Main`: the chat
/// family once certified, the constitution otherwise, `PERSONAS_ATHENA_PROMPT_CLASS`
/// overriding both). A caller that knows its tier passes it to
/// [`build_system_prompt_for_class`] instead.
///
/// `query` is the user's current message — used to seed retrieval. Pass
/// an empty string for non-retrieval prompts (e.g., reflection cycles).
///
/// `browser_page` is the focused Browser page's capture for THIS turn
/// (`browser_bridge::webview::page_capture`), rendered as the dynamic
/// `# What you are looking at (Browser)` block. `None` composes exactly the
/// prompt every turn had before it existed.
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
    browser_page: Option<&PageCapture>,
) -> Result<(String, RecallPreview, PromptBlockSizes), AppError> {
    build_system_prompt_for_class(
        user_db,
        sys_db,
        embedder,
        session_id,
        query,
        voice_enabled,
        recall_synthesis_enabled,
        autonomous_mode,
        PromptClass::for_tier(crate::companion::engine_settings::TurnTierClass::Main),
        browser_page,
    )
    .await
}

/// Build the system prompt of a given [`PromptClass`].
///
/// [`PromptClass::Full`] reads the constitution from the brain root exactly
/// as before. [`PromptClass::Chat`] builds on the chat family's static core
/// instead and drops the two always-on static addenda the chat core already
/// teaches. Both families carry the same two short per-turn flags (voice on,
/// and the layer-one register); the rules behind them live in the static
/// core, so the cached prefix does not change between a spoken and a typed
/// turn or when the register moves. Every dynamic block is gathered
/// identically for both.
#[allow(clippy::too_many_arguments)]
pub async fn build_system_prompt_for_class(
    user_db: &UserDbPool,
    sys_db: &DbPool,
    embedder: EmbedderArg<'_>,
    session_id: &str,
    query: &str,
    voice_enabled: bool,
    recall_synthesis_enabled: bool,
    autonomous_mode: bool,
    class: PromptClass,
    browser_page: Option<&PageCapture>,
) -> Result<(String, RecallPreview, PromptBlockSizes), AppError> {
    let root = disk::brain_root()?;
    let constitution = match class {
        PromptClass::Full => {
            fs::read_to_string(root.join("constitution.md")).unwrap_or_else(|_| String::new())
        }
        PromptClass::Chat => chat_static_core().to_string(),
    };
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
    // The voice slot carries the per-turn voice flag in both families (the
    // voice RULES live in the static core: chat core `# Voice`, constitution
    // `## Voice`). The full family also carries the always-on PROGRESS
    // grammar here; the chat core teaches PROGRESS itself.
    //
    // The display slot carries the per-turn layer-one register flag in both
    // families (`Layer one this turn: at most N sentences.`, from the reply
    // register). It used to hold the voice-only dual-language addendum,
    // retired with the layered voice: layer one IS the spoken register.
    let (voice_md, display_md) = match class {
        PromptClass::Full => (
            format!("{}{}", voice_flag(voice_enabled), progress_addendum()),
            layer_one_flag_for(user_db),
        ),
        PromptClass::Chat => (voice_flag(voice_enabled), layer_one_flag_for(user_db)),
    };
    // Dev-mode self-model rides the same "mode addenda" prompt slot as
    // autonomous mode — both are header-toggle-gated blocks and compose()
    // treats the slot as opaque markdown. The reply-language directive rides
    // the same opaque slot (non-English UI → explicit instruction; see
    // `language_addendum`).
    let autonomous_md = format!(
        "{}{}{}",
        autonomous_addendum_if_enabled(autonomous_mode),
        crate::companion::dev_mode::addendum_if_enabled(sys_db),
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
    // The browser Whitelist rides the plugins slot rather than the connectors
    // one: `browser` IS a connector for PERSONAS (they bind it and the runner
    // hands them the bridge), but Athena reaches the browser through her own
    // ops, not through `use_connector` — putting it under the connector
    // heading would teach her a call shape that does not exist for her.
    let plugins_md = format!("{plugins_md}{}", format_browser_whitelist(sys_db));
    // Flagged credentials ride the same slot for the same reason: a revoked
    // grant is a capability she has LOST, and `reconnect_credential` is her op
    // for it — not a `use_connector` call.
    let plugins_md = format!("{plugins_md}{}", format_flagged_credentials(sys_db));
    // The focused Browser page, its own measured block: it is the one block
    // whose size is decided by a web page rather than by this app, so it is
    // never folded into a slot whose budget was set for something else.
    let browser_page_md = format_browser_page(browser_page);

    let preview = summarize_recall(&recall, briefing.is_some());
    let (composed, block_sizes) = compose_for_class(
        class,
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
        &browser_page_md,
    );
    // Exactly one budget audit per composed prompt.
    block_sizes.warn_over_budget();
    tracing::debug!(
        prompt_class = class.as_str(),
        total_prompt_chars = block_sizes.total(),
        "companion prompt: composed"
    );
    Ok((composed, preview, block_sizes))
}
