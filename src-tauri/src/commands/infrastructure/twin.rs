use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use tokio_util::sync::CancellationToken;
use ts_rs::TS;

use crate::background_job::BackgroundJobManager;
use crate::db::models::{
    TwinChannel, TwinCommunication, TwinContact, TwinDistilledFact, TwinPendingMemory, TwinProfile,
    TwinReflection, TwinTone, TwinVoiceProfile,
};
use crate::db::repos::twin as repo;
use crate::engine::event_registry::event_name;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::{require_auth, require_auth_sync};
use crate::AppState;

// ============================================================================
// Wiki types (P6+ — second-brain build-out)
// ============================================================================

/// Result of a `twin_compile_wiki` invocation. Tells the caller how many
/// files landed and where, so the frontend can show "12 files · ~/twin-wikis/foo/"
/// without a follow-up status query.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinWikiCompileResult {
    pub file_count: u32,
    pub dir_path: String,
    /// ISO-8601 UTC timestamp.
    pub compiled_at: String,
}

/// Snapshot of an on-disk twin wiki. `exists: false` means no compile has
/// run yet (or the dir was deleted out from under us). The frontend uses
/// `last_compiled_at` to render the freshness pill in TwinSelector.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinWikiStatus {
    pub exists: bool,
    pub file_count: u32,
    /// ISO-8601 UTC timestamp of the newest .md file's mtime; `None` when
    /// the directory is empty or absent.
    pub last_compiled_at: Option<String>,
    /// Resolved on-disk path. Always populated even when `exists` is false
    /// — that's where a subsequent compile would write to.
    pub dir_path: String,
}

/// Bundle returned by `twin_recall` — the structured slice of twin state
/// a persona prompt-builder would need when assembling a runtime prompt.
/// Cycle 16 Stage 1 is a *read-only preview*; the actual persona-prompt
/// path doesn't consume this yet (Stage 2). Field casing stays snake_case
/// to match the nested model structs so the TypeScript binding has a
/// consistent shape across all twin recall fields.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TwinRecallBundle {
    pub profile: TwinProfile,
    /// Generic-channel tone for the twin, when configured. `None` means the
    /// twin has no tone rows yet — the prompt builder should fall back to
    /// the bio alone.
    pub tone: Option<TwinTone>,
    /// Newest-first window of `twin_communications` scoped to this twin,
    /// optionally filtered to a specific contact handle. The "recency
    /// shelf" of the recall layer.
    pub recent_communications: Vec<TwinCommunication>,
    /// Top distilled facts by importance × recency. Always includes self-
    /// facts (NULL contact_handle) when a contact filter is applied — the
    /// twin's voice and preferences are relevant regardless of who they're
    /// speaking to. The "always-include facts shelf" of the recall layer.
    pub top_facts: Vec<TwinDistilledFact>,
    /// Top contacts by message count — only populated when the recall is
    /// twin-wide (no `contact_filter`). Gives the operator a sense of who
    /// the twin is most active with.
    pub top_contacts: Vec<TwinContact>,
    /// Echo of the input filter. `None` means twin-wide recall.
    pub contact_filter: Option<String>,
}

/// Default wiki output directory for a twin. Lives under the app data dir
/// so it survives app upgrades but doesn't pollute the user's Documents.
fn default_wiki_dir(app: &AppHandle, twin_id: &str) -> Result<PathBuf, AppError> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Internal(format!("app_data_dir unavailable: {e}")))?;
    Ok(base.join("twin-wikis").join(twin_id))
}

/// Resolve the on-disk wiki directory for a twin, with the caller-supplied
/// `override_dir` treated strictly as a path RELATIVE to the app-managed twin
/// wiki root (`default_wiki_dir`).
///
/// Security: `twin_compile_wiki` / `twin_audit_wiki` write LLM-distilled PII to
/// disk. The directory must therefore never escape the app-controlled base —
/// otherwise an injected `output_dir` (e.g. an OS autostart folder) combined
/// with attacker-influenced memory content would yield arbitrary file writes.
/// Containment mirrors the Drive sandbox's `resolve_safe`:
///   - an empty/unset input maps to the default base (legitimate default —
///     unchanged on-disk location),
///   - absolute inputs are rejected (paths must be relative to the base),
///   - any `..` (`Component::ParentDir`) component is rejected,
///   - the candidate is joined onto the base and then canonicalized and
///     verified to still live under the canonical base, catching symlink and
///     residual-escape attempts.
fn resolve_wiki_dir(
    app: &AppHandle,
    twin_id: &str,
    override_dir: Option<String>,
) -> Result<PathBuf, AppError> {
    // The app-controlled containment root. Also the default landing spot when
    // no override is supplied, so legitimate/default usage is unaffected.
    let base = default_wiki_dir(app, twin_id)?;

    let rel = match override_dir.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
        // Empty/unset override → the default base verbatim (legacy behavior).
        None => return Ok(base),
        Some(rel) => rel,
    };

    // Normalize leading separators so the override is unambiguously relative.
    let rel = rel.trim_start_matches('/').trim_start_matches('\\');
    if rel.is_empty() || rel == "." {
        return Ok(base);
    }

    let candidate = PathBuf::from(rel);

    // Reject absolute inputs outright — the original bug was honoring any
    // absolute path verbatim with zero containment.
    if candidate.is_absolute() {
        return Err(AppError::Validation(
            "Wiki output_dir must be relative to the managed twin wiki root".into(),
        ));
    }

    // Reject `..` (and any rooted/prefixed) components before touching the FS.
    for comp in candidate.components() {
        match comp {
            Component::Normal(_) | Component::CurDir => {}
            Component::ParentDir => {
                return Err(AppError::Validation(
                    "Wiki output_dir may not contain '..'".into(),
                ));
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err(AppError::Validation(
                    "Wiki output_dir must be relative".into(),
                ));
            }
        }
    }

    let joined = base.join(&candidate);

    // Canonicalize an existing ancestor (the deepest one that exists) and
    // re-append the not-yet-created tail, then verify containment. This catches
    // symlink escapes while still allowing a fresh sub-directory to be created.
    let canonical = canonicalize_within(&joined)?;
    let canonical_base = canonicalize_within(&base)?;
    if !canonical.starts_with(&canonical_base) {
        return Err(AppError::Forbidden(format!(
            "Wiki output_dir escapes the managed twin wiki root: {rel}"
        )));
    }

    Ok(canonical)
}

/// Canonicalize `path`, tolerating a tail that does not yet exist by walking up
/// to the nearest existing ancestor, canonicalizing that, and re-joining the
/// remaining (not-yet-created) components. Mirrors the Drive sandbox approach.
fn canonicalize_within(path: &Path) -> Result<PathBuf, AppError> {
    if path.exists() {
        return std::fs::canonicalize(path)
            .map_err(|e| AppError::Internal(format!("Failed to canonicalize wiki path: {e}")));
    }
    let mut ancestor = path.to_path_buf();
    loop {
        match ancestor.parent() {
            Some(p) if p.as_os_str().is_empty() => {
                return Err(AppError::Validation(
                    "Wiki output_dir resolves above the managed root".into(),
                ));
            }
            Some(p) => ancestor = p.to_path_buf(),
            None => {
                return Err(AppError::Validation(
                    "Wiki output_dir resolves above the managed root".into(),
                ));
            }
        }
        if ancestor.exists() {
            break;
        }
    }
    let canonical_ancestor = std::fs::canonicalize(&ancestor)
        .map_err(|e| AppError::Internal(format!("Failed to canonicalize wiki path: {e}")))?;
    let tail = path
        .strip_prefix(&ancestor)
        .map_err(|_| AppError::Internal("wiki path prefix strip failed".into()))?;
    Ok(canonical_ancestor.join(tail))
}

// ============================================================================
// Twin Profiles (P0)
//
// First slice of the Twin plugin commands. CRUD plus an active-profile
// promoter. Multi-twin from day one; the active twin is the one the
// `builtin-twin` connector resolves when a persona invokes a twin tool.
// ============================================================================

#[tauri::command]
pub fn twin_list_profiles(state: State<'_, Arc<AppState>>) -> Result<Vec<TwinProfile>, AppError> {
    require_auth_sync(&state)?;
    repo::list_profiles(&state.db)
}

#[tauri::command]
pub fn twin_get_profile(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<TwinProfile, AppError> {
    require_auth_sync(&state)?;
    repo::get_profile_by_id(&state.db, &id)
}

/// Resolve which twin a persona should adopt.
///
/// Lookup chain (first hit wins):
/// 1. `design_context.credential_links["twin"]` — a Twin connector binding the
///    user created in the vault catalog. Read its `twin_profile_id` field and
///    return that profile. This is the multi-twin path: a persona can be
///    bound to any of the user's Twin profiles via a named catalog entry.
/// 2. `design_context.twin_id` — legacy explicit pin set by some templates /
///    older personas. Kept for backwards compat.
/// 3. The row marked `is_active` in `twin_profiles` — the global active twin.
///
/// At every step, a credential or twin id that no longer exists silently
/// falls through to the next rule so a deleted binding never crashes a
/// persona mid-execution.
///
/// `persona_id` is optional so existing callers (the Twin plugin UI, which
/// reads the globally-active twin for the selector banner) keep working
/// without a code change. Connector tool calls invoked on behalf of a
/// persona pass the persona id and pick up the override.
#[tauri::command]
pub fn twin_get_active_profile(
    state: State<'_, Arc<AppState>>,
    persona_id: Option<String>,
) -> Result<Option<TwinProfile>, AppError> {
    require_auth_sync(&state)?;
    if let Some(pid) = persona_id.as_deref().filter(|s| !s.is_empty()) {
        match crate::db::repos::core::personas::get_by_id(&state.db, pid) {
            Ok(persona) => {
                let dc = persona.parsed_design_context();

                // 1. Catalog binding via credential_links["twin"]
                if let Some(cred_id) = dc
                    .credential_links
                    .as_ref()
                    .and_then(|m| m.get("twin"))
                    .filter(|s| !s.is_empty())
                {
                    if let Ok(cred) = crate::db::repos::resources::credentials::get_by_id(
                        &state.db, cred_id,
                    ) {
                        if let Ok(fields) =
                            crate::db::repos::resources::credentials::get_decrypted_fields(
                                &state.db, &cred,
                            )
                        {
                            if let Some(twin_pid) =
                                fields.get("twin_profile_id").filter(|s| !s.is_empty())
                            {
                                if let Ok(profile) =
                                    repo::get_profile_by_id(&state.db, twin_pid)
                                {
                                    return Ok(Some(profile));
                                }
                            }
                        }
                    }
                }

                // 2. Legacy explicit pin
                if let Some(twin_id) = dc.twin_id {
                    if let Ok(pinned) = repo::get_profile_by_id(&state.db, &twin_id) {
                        return Ok(Some(pinned));
                    }
                }
            }
            Err(AppError::NotFound(_)) => {
                // Unknown persona — caller bug, but tolerate by returning
                // the global active twin so the connector path stays
                // resilient.
            }
            Err(e) => return Err(e),
        }
    }
    // 3. Global active
    repo::get_active_profile(&state.db)
}

#[tauri::command]
pub fn twin_create_profile(
    state: State<'_, Arc<AppState>>,
    name: String,
    bio: Option<String>,
    role: Option<String>,
    languages: Option<String>,
    pronouns: Option<String>,
) -> Result<TwinProfile, AppError> {
    require_auth_sync(&state)?;
    repo::create_profile(
        &state.db,
        &name,
        bio.as_deref(),
        role.as_deref(),
        languages.as_deref(),
        pronouns.as_deref(),
    )
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn twin_update_profile(
    state: State<'_, Arc<AppState>>,
    id: String,
    name: Option<String>,
    bio: Option<Option<String>>,
    role: Option<Option<String>>,
    languages: Option<Option<String>>,
    pronouns: Option<Option<String>>,
    obsidian_subpath: Option<String>,
    training_directives: Option<Option<String>>,
) -> Result<TwinProfile, AppError> {
    require_auth_sync(&state)?;
    repo::update_profile(
        &state.db,
        &id,
        name.as_deref(),
        bio.as_ref().map(|o| o.as_deref()),
        role.as_ref().map(|o| o.as_deref()),
        languages.as_ref().map(|o| o.as_deref()),
        pronouns.as_ref().map(|o| o.as_deref()),
        obsidian_subpath.as_deref(),
        training_directives.as_ref().map(|o| o.as_deref()),
    )
}

#[tauri::command]
pub fn twin_delete_profile(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_profile(&state.db, &id)
}

#[tauri::command]
pub fn twin_set_active_profile(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<TwinProfile, AppError> {
    require_auth_sync(&state)?;
    repo::set_active_profile(&state.db, &id)
}

// ============================================================================
// Tone Profiles (P1)
// ============================================================================

#[tauri::command]
pub fn twin_list_tones(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<Vec<TwinTone>, AppError> {
    require_auth_sync(&state)?;
    repo::list_tones(&state.db, &twin_id)
}

#[tauri::command]
pub fn twin_get_tone(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    channel: String,
) -> Result<TwinTone, AppError> {
    require_auth_sync(&state)?;
    repo::get_tone(&state.db, &twin_id, &channel)
}

#[tauri::command]
pub fn twin_upsert_tone(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    channel: String,
    voice_directives: String,
    examples_json: Option<String>,
    constraints_json: Option<String>,
    length_hint: Option<String>,
) -> Result<TwinTone, AppError> {
    require_auth_sync(&state)?;
    repo::upsert_tone(
        &state.db,
        &twin_id,
        &channel,
        &voice_directives,
        examples_json.as_deref(),
        constraints_json.as_deref(),
        length_hint.as_deref(),
    )
}

#[tauri::command]
pub fn twin_delete_tone(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_tone(&state.db, &id)
}

// ============================================================================
// Knowledge Base Binding (P2)
// ============================================================================

#[tauri::command]
pub fn twin_bind_knowledge_base(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    kb_id: String,
) -> Result<TwinProfile, AppError> {
    require_auth_sync(&state)?;
    repo::bind_knowledge_base(&state.db, &twin_id, &kb_id)
}

#[tauri::command]
pub fn twin_unbind_knowledge_base(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<TwinProfile, AppError> {
    require_auth_sync(&state)?;
    repo::unbind_knowledge_base(&state.db, &twin_id)
}

// ============================================================================
// Pending Memories (P2)
// ============================================================================

#[tauri::command]
pub fn twin_list_pending_memories(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    status: Option<String>,
) -> Result<Vec<TwinPendingMemory>, AppError> {
    require_auth_sync(&state)?;
    repo::list_pending_memories(&state.db, &twin_id, status.as_deref())
}

#[tauri::command]
pub fn twin_review_memory(
    state: State<'_, Arc<AppState>>,
    id: String,
    approved: bool,
    reviewer_notes: Option<String>,
) -> Result<TwinPendingMemory, AppError> {
    require_auth_sync(&state)?;
    repo::review_pending_memory(&state.db, &id, approved, reviewer_notes.as_deref())
}

// ============================================================================
// Communications (P2)
// ============================================================================

#[tauri::command]
pub fn twin_list_communications(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    channel: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<TwinCommunication>, AppError> {
    require_auth_sync(&state)?;
    repo::list_communications(&state.db, &twin_id, channel.as_deref(), limit.unwrap_or(50))
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn twin_record_interaction(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    channel: String,
    direction: String,
    contact_handle: Option<String>,
    content: String,
    summary: Option<String>,
    key_facts_json: Option<String>,
    create_memory: Option<bool>,
) -> Result<TwinCommunication, AppError> {
    require_auth_sync(&state)?;
    repo::record_interaction(
        &state.db,
        &twin_id,
        &channel,
        &direction,
        contact_handle.as_deref(),
        &content,
        summary.as_deref(),
        key_facts_json.as_deref(),
        create_memory.unwrap_or(true),
    )
}

// ============================================================================
// Voice Profiles (P3)
// ============================================================================

#[tauri::command]
pub fn twin_get_voice_profile(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<Option<TwinVoiceProfile>, AppError> {
    require_auth_sync(&state)?;
    repo::get_voice_profile(&state.db, &twin_id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn twin_upsert_voice_profile(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    credential_id: Option<String>,
    voice_id: String,
    model_id: Option<String>,
    stability: Option<f64>,
    similarity_boost: Option<f64>,
    style: Option<f64>,
) -> Result<TwinVoiceProfile, AppError> {
    require_auth_sync(&state)?;
    repo::upsert_voice_profile(
        &state.db,
        &twin_id,
        credential_id.as_deref(),
        &voice_id,
        model_id.as_deref(),
        stability.unwrap_or(0.5),
        similarity_boost.unwrap_or(0.75),
        style.unwrap_or(0.0),
    )
}

#[tauri::command]
pub fn twin_delete_voice_profile(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_voice_profile(&state.db, &twin_id)
}

// ============================================================================
// Channels (P4)
// ============================================================================

#[tauri::command]
pub fn twin_list_channels(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<Vec<TwinChannel>, AppError> {
    require_auth_sync(&state)?;
    repo::list_channels(&state.db, &twin_id)
}

#[tauri::command]
pub fn twin_create_channel(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    channel_type: String,
    credential_id: String,
    persona_id: Option<String>,
    label: Option<String>,
) -> Result<TwinChannel, AppError> {
    require_auth_sync(&state)?;
    repo::create_channel(
        &state.db,
        &twin_id,
        &channel_type,
        &credential_id,
        persona_id.as_deref(),
        label.as_deref(),
    )
}

#[tauri::command]
pub fn twin_update_channel(
    state: State<'_, Arc<AppState>>,
    id: String,
    persona_id: Option<Option<String>>,
    label: Option<Option<String>>,
    is_active: Option<bool>,
) -> Result<TwinChannel, AppError> {
    require_auth_sync(&state)?;
    repo::update_channel(
        &state.db,
        &id,
        persona_id.as_ref().map(|o| o.as_deref()),
        label.as_ref().map(|o| o.as_deref()),
        is_active,
    )
}

#[tauri::command]
pub fn twin_delete_channel(state: State<'_, Arc<AppState>>, id: String) -> Result<bool, AppError> {
    require_auth_sync(&state)?;
    repo::delete_channel(&state.db, &id)
}

// ============================================================================
// AI Bio Generation (P5 polish)
//
// Runs the Claude CLI headlessly with a prompt that generates a polished bio
// from the twin's name, role, and user-supplied keywords.
// ============================================================================

#[tauri::command]
pub async fn twin_generate_bio(
    state: State<'_, Arc<AppState>>,
    name: String,
    role: Option<String>,
    keywords: String,
    existing_bio: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let role_part = role
        .as_ref()
        .map(|r| format!(", role: {r}"))
        .unwrap_or_default();

    let prompt_text = match existing_bio.as_ref().filter(|s| !s.trim().is_empty()) {
        Some(existing) => format!(
            "Refine the bio below for a digital twin named \"{name}\"{role_part}. \
             Keep the original voice, facts, and structure intact — improve clarity, \
             flow, and word choice; tighten where verbose; preserve any concrete \
             details. Apply these steering keywords/notes if non-empty: {keywords}. \
             Output ONLY the refined bio text (2-3 sentences, first person). No \
             quotes, no preamble, no explanation.\n\nExisting bio:\n{existing}",
            existing = existing.trim(),
        ),
        None => format!(
            "Generate a concise professional bio (2-3 sentences, first person) for a digital twin named \"{name}\"{role_part}. \
             Use these keywords/topics as input: {keywords}. \
             Output ONLY the bio text, nothing else. No quotes, no preamble.",
        ),
    };

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Internal(format!("CLI execution failed: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Internal(
            "Claude CLI returned non-zero exit code".into(),
        ));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    // Strip any JSON wrapper if the CLI outputs structured content
    let bio = raw.trim().trim_matches('"').to_string();
    Ok(bio)
}

// ----------------------------------------------------------------------------
// twin_simulate_answer — Training Studio "twin simulation" side
//
// Drafts an interview answer *as the twin*, grounded in the same material a
// persona adopting the twin sees at runtime (bio + generic tone + top
// distilled self-facts). This is the answer half of the Training Studio: the
// user reviews/edits the draft before it is saved as a memory. `directions`
// carries the user's steering or critique on a regenerate ("too formal, add
// the 2019 story"). Uses the shared spawn_claude_with_prompt envelope rather
// than abusing twin_generate_bio's bio-framed prompt.
// ----------------------------------------------------------------------------

/// Number of top distilled facts to ground a simulated answer. Matches the
/// grounding window the training session previously read client-side.
const SIMULATE_ANSWER_FACTS_LIMIT: i32 = 12;

#[tauri::command]
pub async fn twin_simulate_answer(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    question: String,
    directions: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let question = question.trim();
    if question.is_empty() {
        return Err(AppError::Internal(
            "twin_simulate_answer: question is empty".into(),
        ));
    }

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let tone = repo::get_tone_optional(&state.db, &twin_id, "generic")?;
    let facts =
        repo::top_distilled_facts_for_recall(&state.db, &twin_id, None, SIMULATE_ANSWER_FACTS_LIMIT)?;

    let effective = merge_directions(profile.training_directives.as_deref(), directions.as_deref());
    let prompt_text = build_answer_prompt(&profile, tone.as_ref(), &facts, question, effective.as_deref());
    let raw = spawn_claude_with_prompt(prompt_text).await?;
    Ok(raw.trim().trim_matches('"').trim().to_string())
}

/// Build the "answer as the twin" prompt shared by `twin_simulate_answer` and
/// the Training Studio batch job. Grounds the answer in the same material a
/// persona adopting the twin sees: bio + generic tone + top distilled facts.
fn build_answer_prompt(
    profile: &TwinProfile,
    tone: Option<&TwinTone>,
    facts: &[TwinDistilledFact],
    question: &str,
    directions: Option<&str>,
) -> String {
    let role_part = profile
        .role
        .as_ref()
        .map(|r| r.trim())
        .filter(|s| !s.is_empty())
        .map(|r| format!(", {r}"))
        .unwrap_or_default();

    let bio_block = profile
        .bio
        .as_ref()
        .map(|b| b.trim())
        .filter(|s| !s.is_empty())
        .map(|b| format!("\n\nBio:\n{b}"))
        .unwrap_or_default();

    let tone_block = match tone {
        Some(t) if !t.voice_directives.trim().is_empty() => {
            let mut s = format!("\n\nVoice — write the way they speak:\n{}", t.voice_directives.trim());
            if let Some(len) = t.length_hint.as_ref().map(|s| s.trim()).filter(|s| !s.is_empty()) {
                s.push_str(&format!("\nPreferred reply length: {len}"));
            }
            s
        }
        _ => String::new(),
    };

    let facts_block = if facts.is_empty() {
        String::new()
    } else {
        let lines = facts
            .iter()
            .map(|f| format!("- {}", f.content.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n\nWhat is known about them (stay consistent — never contradict these):\n{lines}")
    };

    let directions_block = directions
        .map(|d| d.trim())
        .filter(|s| !s.is_empty())
        .map(|d| format!("\n\nApply this revision the user asked for: {d}"))
        .unwrap_or_default();

    format!(
        "You are \"{name}\"{role_part}, answering an interview question to help build a faithful digital twin of yourself. \
         Answer in the FIRST PERSON, in {name}'s own voice — concrete, personal, and specific rather than generic. \
         Draw on the material below; where it doesn't cover something, answer plausibly and stay consistent, but never invent verifiable specifics (named dates, numbers, places, people) that aren't grounded here. \
         Keep it to 2-5 sentences unless the voice guidance says otherwise. \
         Output ONLY the answer prose — no preamble, no surrounding quotes, no \"As {name}, ...\" framing.{bio_block}{tone_block}{facts_block}{directions_block}\n\nInterview question:\n{question}",
        name = profile.name,
        question = question.trim(),
    )
}

/// Combine a twin's persistent training directives (D5) with the call-time
/// directions (the Studio's Directions box or a regenerate comment). The
/// persistent style guide applies to every generation; the call-time note
/// layers on top for this specific request.
fn merge_directions(persistent: Option<&str>, call: Option<&str>) -> Option<String> {
    let p = persistent.map(str::trim).filter(|s| !s.is_empty());
    let c = call.map(str::trim).filter(|s| !s.is_empty());
    match (p, c) {
        (Some(p), Some(c)) => Some(format!("{p}\nFor this request specifically: {c}")),
        (Some(p), None) => Some(p.to_string()),
        (None, Some(c)) => Some(c.to_string()),
        (None, None) => None,
    }
}

// ============================================================================
// Training Studio — background batch generation (questions + answers)
//
// The Studio lets the user gather a large batch of training material in one go
// while the Claude CLI works in the background. Both passes run as a tracked
// BackgroundJobManager job so the UI stays responsive, the sidebar shows a
// progress dot, and an OS notification fires on completion — the same pattern
// as the codebase context scan and the artist creative session. Results live
// in the job's `extra` (in-memory, 30-min TTL); the frontend hydrates from
// events and can re-fetch the full batch via twin_studio_get_batch.
// ============================================================================

/// One question (and optionally a drafted answer) in a Studio batch.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinStudioItem {
    pub id: String,
    pub question: String,
    pub answer: Option<String>,
}

/// Seed question passed to the answer-drafting batch.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinStudioSeed {
    pub id: String,
    pub question: String,
}

/// Snapshot of a Studio batch job (status + accumulated items), returned by
/// `twin_studio_get_batch` so the frontend can hydrate even if it missed
/// in-flight events (e.g. it was on a different route while the job ran).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinStudioBatch {
    pub batch_id: String,
    pub status: String,
    pub phase: String,
    pub completed: u32,
    pub total: u32,
    pub items: Vec<TwinStudioItem>,
    pub error: Option<String>,
}

#[derive(Clone, Default)]
struct TwinStudioExtra {
    phase: String,
    completed: u32,
    total: u32,
    items: Vec<TwinStudioItem>,
}

static TWIN_STUDIO_JOBS: BackgroundJobManager<TwinStudioExtra> = BackgroundJobManager::new(
    "twin-studio lock poisoned",
    event_name::TWIN_STUDIO_STATUS,
    event_name::TWIN_STUDIO_OUTPUT,
);

/// Progress event payload (drives the sidebar dot + studio progress bar).
#[derive(Clone, Serialize)]
struct TwinStudioProgress {
    batch_id: String,
    phase: String,
    completed: u32,
    total: u32,
}

/// Completion event payload. The frontend re-fetches the full batch via
/// `twin_studio_get_batch` for robustness; this just signals done + outcome.
#[derive(Clone, Serialize)]
struct TwinStudioCompletePayload {
    batch_id: String,
    status: String,
    phase: String,
    item_count: u32,
}

fn emit_studio_progress(app: &AppHandle, batch_id: &str, phase: &str, completed: u32, total: u32) {
    let _ = app.emit(
        event_name::TWIN_STUDIO_PROGRESS,
        TwinStudioProgress {
            batch_id: batch_id.to_string(),
            phase: phase.to_string(),
            completed,
            total,
        },
    );
}

fn emit_studio_complete(app: &AppHandle, batch_id: &str, status: &str, phase: &str, item_count: u32) {
    let _ = app.emit(
        event_name::TWIN_STUDIO_COMPLETE,
        TwinStudioCompletePayload {
            batch_id: batch_id.to_string(),
            status: status.to_string(),
            phase: phase.to_string(),
            item_count,
        },
    );
}

/// Hard caps so a runaway request can't spawn an unbounded batch of CLI calls.
const STUDIO_QUESTION_MAX: u32 = 12;
const STUDIO_ANSWER_MAX: usize = 24;

/// Build the questions-generation prompt for the Studio batch. Proper
/// question-shaped instructions (no longer wrapped inside a bio prompt).
fn build_questions_prompt(
    profile: &TwinProfile,
    facts: &[TwinDistilledFact],
    topic: &str,
    directions: Option<&str>,
    count: u32,
) -> String {
    let role_part = profile
        .role
        .as_ref()
        .map(|r| r.trim())
        .filter(|s| !s.is_empty())
        .map(|r| format!(", role: {r}"))
        .unwrap_or_default();
    let bio_part = profile
        .bio
        .as_ref()
        .map(|b| b.trim())
        .filter(|s| !s.is_empty())
        .map(|b| format!(" Bio: {b}."))
        .unwrap_or_default();
    let grounding = if facts.is_empty() {
        String::new()
    } else {
        let lines = facts
            .iter()
            .map(|f| format!("- {}", f.content.trim()))
            .collect::<Vec<_>>()
            .join("\n");
        format!("\n\nAlready known about them (do NOT re-ask these — build on or around them):\n{lines}")
    };
    let directions_block = directions
        .map(|d| d.trim())
        .filter(|s| !s.is_empty())
        .map(|d| format!("\n\nThe user's directions for these questions (follow them): {d}"))
        .unwrap_or_default();
    format!(
        "You are interviewing \"{name}\"{role_part} to build a faithful digital twin of them.{bio_part}\n\nTopic: {topic}{grounding}{directions_block}\n\nGenerate exactly {count} interview questions. Each question must:\n- Be specific and conversational, not generic\n- Draw out their unique perspective, voice, opinions, and concrete stories\n- Build on what's already known — never duplicate it\n\nOutput ONLY the questions, one per line, numbered 1-{count}. No preamble, no commentary.",
        name = profile.name,
    )
}

/// Parse the CLI's numbered question list into clean question strings.
fn parse_questions(raw: &str, max: usize) -> Vec<String> {
    raw.lines()
        .map(|line| {
            let t = line.trim();
            let bytes = t.as_bytes();
            let mut i = 0;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i > 0 && i < bytes.len() && (bytes[i] == b'.' || bytes[i] == b')') {
                t[i + 1..].trim().to_string()
            } else {
                t.trim_start_matches(['-', '*', '•']).trim().to_string()
            }
        })
        .filter(|l| l.len() > 10)
        .take(max)
        .collect()
}

/// Start a background job that generates a batch of interview questions.
/// Returns the `batch_id` immediately; progress arrives via TWIN_STUDIO_PROGRESS
/// and the final set via TWIN_STUDIO_COMPLETE (+ get_batch).
#[tauri::command]
pub async fn twin_studio_generate_questions(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    twin_id: String,
    topic: String,
    directions: Option<String>,
    count: Option<u32>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let facts =
        repo::top_distilled_facts_for_recall(&state.db, &twin_id, None, SIMULATE_ANSWER_FACTS_LIMIT)?;
    let count = count.unwrap_or(8).clamp(1, STUDIO_QUESTION_MAX);

    let batch_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    TWIN_STUDIO_JOBS.insert_running(
        batch_id.clone(),
        cancel_token.clone(),
        TwinStudioExtra {
            phase: "questions".into(),
            completed: 0,
            total: count,
            items: Vec::new(),
        },
    )?;
    TWIN_STUDIO_JOBS.set_status(&app, &batch_id, "running", None);
    emit_studio_progress(&app, &batch_id, "questions", 0, count);

    let effective = merge_directions(profile.training_directives.as_deref(), directions.as_deref());
    let prompt_text = build_questions_prompt(&profile, &facts, &topic, effective.as_deref(), count);
    let app_handle = app.clone();
    let batch_for_task = batch_id.clone();
    let twin_name = profile.name.clone();

    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel_token.cancelled() => Err(AppError::Internal("Cancelled by user".into())),
            res = spawn_claude_with_prompt(prompt_text) => res,
        };
        match result {
            Ok(raw) => {
                let items: Vec<TwinStudioItem> = parse_questions(&raw, count as usize)
                    .into_iter()
                    .enumerate()
                    .map(|(i, q)| TwinStudioItem {
                        id: format!("{batch_for_task}-q{i}"),
                        question: q,
                        answer: None,
                    })
                    .collect();
                let n = items.len() as u32;
                TWIN_STUDIO_JOBS.update_extra(&batch_for_task, |e| {
                    e.completed = n;
                    e.total = n;
                    e.items = items;
                });
                TWIN_STUDIO_JOBS.set_status(&app_handle, &batch_for_task, "completed", None);
                emit_studio_progress(&app_handle, &batch_for_task, "questions", n, n);
                emit_studio_complete(&app_handle, &batch_for_task, "completed", "questions", n);
                crate::notifications::send(
                    &app_handle,
                    "Training questions ready",
                    &format!("{twin_name}: {n} questions drafted — review them in the Training Studio."),
                );
            }
            Err(e) => {
                let msg = format!("{e}");
                TWIN_STUDIO_JOBS.set_status(&app_handle, &batch_for_task, "failed", Some(msg.clone()));
                emit_studio_complete(&app_handle, &batch_for_task, "failed", "questions", 0);
                if !msg.contains("Cancelled") {
                    crate::notifications::send(
                        &app_handle,
                        "Training questions failed",
                        &format!("{twin_name}: {msg}"),
                    );
                }
            }
        }
    });

    Ok(batch_id)
}

/// Start a background job that drafts an answer (as the twin) for each seed
/// question. This is the long-running pass — N sequential CLI calls — so it is
/// the one that most benefits from running in the background with a completion
/// notification.
#[tauri::command]
pub async fn twin_studio_generate_answers(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    twin_id: String,
    items: Vec<TwinStudioSeed>,
    directions: Option<String>,
) -> Result<String, AppError> {
    require_auth(&state).await?;

    if items.is_empty() {
        return Err(AppError::Validation(
            "twin_studio_generate_answers: no questions provided".into(),
        ));
    }
    let items: Vec<TwinStudioSeed> = items.into_iter().take(STUDIO_ANSWER_MAX).collect();
    let total = items.len() as u32;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let tone = repo::get_tone_optional(&state.db, &twin_id, "generic")?;
    let facts =
        repo::top_distilled_facts_for_recall(&state.db, &twin_id, None, SIMULATE_ANSWER_FACTS_LIMIT)?;

    let batch_id = uuid::Uuid::new_v4().to_string();
    let cancel_token = CancellationToken::new();
    TWIN_STUDIO_JOBS.insert_running(
        batch_id.clone(),
        cancel_token.clone(),
        TwinStudioExtra {
            phase: "answers".into(),
            completed: 0,
            total,
            items: Vec::new(),
        },
    )?;
    TWIN_STUDIO_JOBS.set_status(&app, &batch_id, "running", None);
    emit_studio_progress(&app, &batch_id, "answers", 0, total);

    let app_handle = app.clone();
    let batch_for_task = batch_id.clone();
    let twin_name = profile.name.clone();
    let directions_owned = merge_directions(profile.training_directives.as_deref(), directions.as_deref());

    tokio::spawn(async move {
        let mut completed: u32 = 0;
        let mut cancelled = false;
        for seed in &items {
            if cancel_token.is_cancelled() {
                cancelled = true;
                break;
            }
            let prompt = build_answer_prompt(
                &profile,
                tone.as_ref(),
                &facts,
                &seed.question,
                directions_owned.as_deref(),
            );
            let answer = tokio::select! {
                _ = cancel_token.cancelled() => { cancelled = true; break; }
                res = spawn_claude_with_prompt(prompt) => res.ok(),
            };
            let item = TwinStudioItem {
                id: seed.id.clone(),
                question: seed.question.clone(),
                answer: answer.map(|a| a.trim().trim_matches('"').trim().to_string()),
            };
            completed += 1;
            TWIN_STUDIO_JOBS.update_extra(&batch_for_task, |e| {
                e.completed = completed;
                e.items.push(item);
            });
            emit_studio_progress(&app_handle, &batch_for_task, "answers", completed, total);
        }

        let status = if cancelled { "failed" } else { "completed" };
        TWIN_STUDIO_JOBS.set_status(
            &app_handle,
            &batch_for_task,
            status,
            cancelled.then(|| "Cancelled by user".to_string()),
        );
        emit_studio_complete(&app_handle, &batch_for_task, status, "answers", completed);
        if !cancelled {
            crate::notifications::send(
                &app_handle,
                "Twin drafts ready",
                &format!("{twin_name}: {completed} answers drafted — review & edit them in the Training Studio."),
            );
        }
    });

    Ok(batch_id)
}

/// Fetch the current state of a Studio batch (status + accumulated items).
#[tauri::command]
pub fn twin_studio_get_batch(
    state: State<'_, Arc<AppState>>,
    batch_id: String,
) -> Result<Option<TwinStudioBatch>, AppError> {
    require_auth_sync(&state)?;
    Ok(TWIN_STUDIO_JOBS.get_snapshot_with(&batch_id, |id, job| TwinStudioBatch {
        batch_id: id.to_string(),
        status: if job.status.is_empty() {
            "idle".into()
        } else {
            job.status.clone()
        },
        phase: job.extra.phase.clone(),
        completed: job.extra.completed,
        total: job.extra.total,
        items: job.extra.items.clone(),
        error: job.error.clone(),
    }))
}

/// Cancel a running Studio batch.
#[tauri::command]
pub fn twin_studio_cancel(
    state: State<'_, Arc<AppState>>,
    app: AppHandle,
    batch_id: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    TWIN_STUDIO_JOBS.cancel(&app, &batch_id)
}

// ============================================================================
// Second-Brain build-out (P6)
//
// Three commands that turn the Twin from "speaks as me" into "is my second
// brain that speaks as me", inspired by Karpathy's flat-file LLM knowledge
// base pattern (Nick Spisak walkthrough, 2026-04-14):
//
//   1. twin_ingest_url    — scrape URL → pending memory
//   2. twin_compile_wiki  — approved memories → navigable .md files
//   3. twin_audit_wiki    — wiki .md files → consistency report (pending memory)
//
// All three reuse the existing pending-memory approval gate so error
// compounding is bounded by the same review workflow that handles agent-
// generated memories.
//
// Source markers live in the title prefix ("[ingest] ...", "[audit] ...")
// rather than a dedicated source_type column — kept additive to avoid a
// migration. Promote to a column when the patterns are validated by use.
// ============================================================================

/// Strip HTML tags from a fetched response and normalize whitespace.
/// Crude but dependency-free; good enough for a pending-memory preview that
/// the human will review before approving. Sites that need real extraction
/// can be ingested via firecrawl/desktop_browser as a follow-up.
fn strip_html_to_text(html: &str) -> String {
    let re_script = regex::Regex::new(r"(?is)<script[^>]*>.*?</script>").unwrap();
    let re_style = regex::Regex::new(r"(?is)<style[^>]*>.*?</style>").unwrap();
    let re_tags = regex::Regex::new(r"(?s)<[^>]+>").unwrap();

    let s = re_script.replace_all(html, "");
    let s = re_style.replace_all(&s, "");
    let no_tags = re_tags.replace_all(&s, " ");

    let decoded = no_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'");

    decoded.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Spawn the Claude CLI with a prompt and return its stdout. Shared envelope
/// for twin_compile_wiki and twin_audit_wiki — same pattern as twin_generate_bio
/// but factored out so both new commands can reuse it without duplicating the
/// Windows creation_flags / env_overrides / stdin-pipe boilerplate.
async fn spawn_claude_with_prompt(prompt_text: String) -> Result<String, AppError> {
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push("claude-sonnet-4-6".to_string());

    let mut cmd = Command::new(&cli_args.command);
    cmd.args(&cli_args.args)
        .kill_on_drop(true)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null());

    #[cfg(windows)]
    {
        #[allow(unused_imports)]
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    for key in &cli_args.env_removals {
        cmd.env_remove(key);
    }
    for (key, val) in &cli_args.env_overrides {
        cmd.env(key, val);
    }

    let mut child = cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            AppError::Internal(
                "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code"
                    .into(),
            )
        } else {
            AppError::Internal(format!("Failed to spawn Claude CLI: {e}"))
        }
    })?;

    if let Some(mut stdin) = child.stdin.take() {
        let bytes = prompt_text.into_bytes();
        tokio::spawn(async move {
            let _ = stdin.write_all(&bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    let output = child
        .wait_with_output()
        .await
        .map_err(|e| AppError::Internal(format!("CLI execution failed: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Internal(
            "Claude CLI returned non-zero exit code".into(),
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

// ----------------------------------------------------------------------------
// twin_ingest_url — fetch a URL and create a pending memory from its content
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn twin_ingest_url(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    url: String,
    note: Option<String>,
) -> Result<TwinPendingMemory, AppError> {
    require_auth(&state).await?;

    // SSRF defense. Reject loopback / private (10/8, 172.16/12, 192.168/16),
    // link-local (169.254/16 — covers the AWS/Azure/GCP metadata IP), CGN
    // (100.64/10), IPv6 ULA (fc00::/7), `.local` / `.internal` hostnames,
    // and any hostname that resolves to an internal IP. Combined with the
    // SSRF-safe DNS resolver attached to the client below this also covers
    // DNS-rebinding (resolver re-checks at connect time) and the redirect
    // policy re-checks IP literals on every hop.
    let validated_url = crate::engine::url_safety::validate_url_safety(&url)
        .map(|_| url.clone())
        .map_err(AppError::Validation)?;

    // Verify the twin exists before doing the fetch so we don't waste a network
    // round-trip on an invalid id.
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; PersonasTwinIngest/1.0)")
        .dns_resolver(std::sync::Arc::new(
            crate::engine::url_safety::SsrfSafeResolver,
        ))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            // Re-check each redirect target. The DNS resolver above blocks
            // hostname-based rebinding, but a `Location: http://127.0.0.1/`
            // header skips DNS entirely and would otherwise reach the
            // loopback service, so we inspect IP literals here too.
            if crate::engine::url_safety::is_url_target_private(attempt.url()) {
                attempt.error("redirect target is a private/internal address")
            } else if attempt.previous().len() >= 5 {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client init failed: {e}")))?;

    let response = client
        .get(&validated_url)
        .send()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to fetch URL: {e}")))?;

    let status = response.status();
    if !status.is_success() {
        return Err(AppError::Internal(format!(
            "URL returned HTTP {status} — refusing to ingest"
        )));
    }

    let raw_body = response
        .text()
        .await
        .map_err(|e| AppError::Internal(format!("Failed to read response body: {e}")))?;

    let stripped = strip_html_to_text(&raw_body);

    // Cap content length so a giant page doesn't blow up the pending-memory
    // table. The reviewer can re-fetch with a more targeted tool if needed.
    const MAX_CONTENT_CHARS: usize = 50_000;
    let content = if stripped.chars().count() > MAX_CONTENT_CHARS {
        let truncated: String = stripped.chars().take(MAX_CONTENT_CHARS).collect();
        format!(
            "{truncated}\n\n[truncated — original was {} chars]",
            stripped.chars().count()
        )
    } else {
        stripped
    };

    if content.trim().is_empty() {
        return Err(AppError::Validation(
            "Fetched page produced no readable text after HTML stripping".into(),
        ));
    }

    let title_text = match note.as_deref().filter(|n| !n.trim().is_empty()) {
        Some(n) => format!("[ingest] {n} — {url}"),
        None => format!("[ingest] {url}"),
    };

    repo::create_pending_memory(
        &state.db,
        &twin_id,
        Some("url_ingest"),
        &content,
        Some(&title_text),
        3, // medium importance
        None, // URL ingest doesn't originate from a single communication
    )
}

// ----------------------------------------------------------------------------
// twin_compile_wiki — approved memories → topic .md files with [[wikilinks]]
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn twin_compile_wiki(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    output_dir: Option<String>,
) -> Result<TwinWikiCompileResult, AppError> {
    require_auth(&state).await?;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let approved = repo::list_pending_memories(&state.db, &twin_id, Some("approved"))?;

    if approved.is_empty() {
        return Err(AppError::Validation(
            "No approved memories to compile. Approve some memories in the Knowledge tab first."
                .into(),
        ));
    }

    let dir_path = resolve_wiki_dir(&app, &twin_id, output_dir)?;
    std::fs::create_dir_all(&dir_path)
        .map_err(|e| AppError::Internal(format!("Failed to create output dir: {e}")))?;
    let output_dir = dir_path
        .to_string_lossy()
        .to_string();

    let identity_block = format!(
        "Twin: {name}\nRole: {role}\nBio: {bio}\nLanguages: {langs}\n",
        name = profile.name,
        role = profile.role.as_deref().unwrap_or("(not specified)"),
        bio = profile.bio.as_deref().unwrap_or("(not specified)"),
        langs = profile.languages.as_deref().unwrap_or("(not specified)"),
    );

    let memories_block = approved
        .iter()
        .map(|m| {
            format!(
                "---\nID: {id}\nTitle: {title}\nDate: {date}\nContent:\n{content}",
                id = m.id,
                title = m.title.as_deref().unwrap_or("(untitled)"),
                date = &m.created_at[..10.min(m.created_at.len())],
                content = m.content,
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n");

    let n_memories = approved.len();
    let prompt_text = format!(
        "You are compiling a personal knowledge wiki for a digital twin.\n\
         The wiki turns a pile of approved memories into navigable, linked\n\
         markdown files that the twin and its operators can browse.\n\n\
         # About the Twin\n{identity_block}\n\
         # Approved Memories ({n_memories})\n{memories_block}\n\n\
         # Your Task\n\
         Group these memories into topics. For each topic, output ONE file\n\
         block in the EXACT format below. Then output one INDEX.md file at\n\
         the end. Output ONLY file blocks — no preamble, no commentary.\n\n\
         === FILE: <kebab-case-slug>.md ===\n\
         # <Topic Title>\n\n\
         <2-3 sentence overview of this topic>\n\n\
         ## Key Points\n\n\
         - <bullet>\n\
         - <bullet>\n\
         - <bullet>\n\n\
         ## Sources\n\n\
         - Memory <id> — <title or short ref>\n\
         - Memory <id> — <title or short ref>\n\n\
         ## Related\n\n\
         - [[other-slug]]\n\
         - [[other-slug]]\n\
         === END FILE ===\n\n\
         === FILE: INDEX.md ===\n\
         # {twin_name} — Knowledge Wiki\n\n\
         Compiled {today}. <N> topics, {n_memories} source memories.\n\n\
         ## Topics\n\n\
         - [[slug-1]] — one-line description\n\
         - [[slug-2]] — one-line description\n\
         === END FILE ===\n\n\
         Rules:\n\
         - Every memory must appear under at least one topic's Sources list\n\
         - Topics must link to related topics via [[slug]] wikilinks\n\
         - Slugs must be kebab-case, ASCII, no slashes\n\
         - No content allowed outside === FILE / === END FILE blocks",
        identity_block = identity_block,
        memories_block = memories_block,
        n_memories = n_memories,
        twin_name = profile.name,
        today = chrono::Utc::now().format("%Y-%m-%d"),
    );

    let raw = spawn_claude_with_prompt(prompt_text).await?;

    // Parse === FILE: name === / === END FILE === blocks and write files
    let mut written = 0u32;
    let mut current_file: Option<String> = None;
    let mut current_content = String::new();

    for line in raw.lines() {
        if let Some(rest) = line.strip_prefix("=== FILE: ") {
            if let Some(name) = rest.strip_suffix(" ===") {
                current_file = Some(name.trim().to_string());
                current_content.clear();
                continue;
            }
        }
        if line.trim() == "=== END FILE ===" {
            if let Some(name) = current_file.take() {
                // Sanitize filename — only allow basename, strip path traversal
                let safe_name = name.replace("..", "_").replace('/', "_").replace('\\', "_");
                if !safe_name.is_empty() {
                    let path = std::path::Path::new(&output_dir).join(&safe_name);
                    std::fs::write(&path, current_content.trim_start_matches('\n')).map_err(
                        |e| AppError::Internal(format!("Failed to write {safe_name}: {e}")),
                    )?;
                    written += 1;
                }
                current_content.clear();
            }
            continue;
        }
        if current_file.is_some() {
            current_content.push_str(line);
            current_content.push('\n');
        }
    }

    if written == 0 {
        return Err(AppError::Internal(
            "Claude CLI returned no parseable === FILE === blocks".into(),
        ));
    }

    Ok(TwinWikiCompileResult {
        file_count: written,
        dir_path: output_dir,
        compiled_at: chrono::Utc::now().to_rfc3339(),
    })
}

// ----------------------------------------------------------------------------
// twin_audit_wiki — consistency check over compiled wiki files
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn twin_audit_wiki(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    wiki_dir: Option<String>,
) -> Result<TwinPendingMemory, AppError> {
    require_auth(&state).await?;

    // Verify the twin exists before doing file I/O
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;

    let dir_buf = resolve_wiki_dir(&app, &twin_id, wiki_dir)?;
    let dir = dir_buf.as_path();
    let wiki_dir = dir.to_string_lossy().to_string();
    if !dir.exists() {
        return Err(AppError::NotFound(format!(
            "Wiki directory not found: {wiki_dir}. Run twin_compile_wiki first."
        )));
    }

    let mut wiki_blob = String::new();
    let mut file_count: u32 = 0;
    for entry in std::fs::read_dir(dir)
        .map_err(|e| AppError::Internal(format!("Failed to read wiki dir: {e}")))?
    {
        let entry =
            entry.map_err(|e| AppError::Internal(format!("Failed to read wiki entry: {e}")))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("md") {
            let content = std::fs::read_to_string(&path).map_err(|e| {
                AppError::Internal(format!("Failed to read {}: {e}", path.display()))
            })?;
            let filename = path.file_name().and_then(|s| s.to_str()).unwrap_or("?");
            wiki_blob.push_str(&format!("\n\n=== {filename} ===\n{content}\n"));
            file_count += 1;
        }
    }

    if file_count == 0 {
        return Err(AppError::Validation(
            "Wiki dir has no .md files. Run twin_compile_wiki first.".into(),
        ));
    }

    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let prompt_text = format!(
        "You are auditing a personal knowledge wiki for consistency and completeness.\n\n\
         # Wiki Contents ({file_count} files)\n{wiki_blob}\n\n\
         # Your Task\n\
         Review the wiki and produce a structured audit report covering:\n\n\
         1. Contradictions — topics where two articles say opposing things\n\
         2. Unsupported claims — statements not backed by a Source line\n\
         3. Topic gaps — concepts mentioned but never explained in their own article\n\
         4. Broken wikilinks — [[slug]] references pointing to files that don't exist\n\
         5. Suggested new articles — 3 topics that would meaningfully fill gaps\n\n\
         Output format (markdown, no preamble, no code fences):\n\n\
         # Wiki Audit Report\n\n\
         **Files reviewed:** {file_count}\n\
         **Date:** {today}\n\n\
         ## Contradictions\n\
         <bullet list, or 'None found'>\n\n\
         ## Unsupported Claims\n\
         <bullet list, or 'None found'>\n\n\
         ## Topic Gaps\n\
         <bullet list, or 'None found'>\n\n\
         ## Broken Wikilinks\n\
         <bullet list, or 'None found'>\n\n\
         ## Suggested New Articles\n\
         1. ...\n\
         2. ...\n\
         3. ...\n\n\
         ## Overall Health: <Healthy | Needs Attention | Critical>\n\n\
         <one-paragraph summary of the wiki's current state>",
        file_count = file_count,
        wiki_blob = wiki_blob,
        today = today,
    );

    let report = spawn_claude_with_prompt(prompt_text).await?;
    let title_text = format!("[audit] Wiki review {today} ({file_count} files)");

    repo::create_pending_memory(
        &state.db,
        &twin_id,
        Some("audit"),
        report.trim(),
        Some(&title_text),
        4, // high importance — audits should surface clearly
        None, // wiki audit synthesises from many files, not one communication
    )
}

// ----------------------------------------------------------------------------
// twin_wiki_status — non-mutating freshness query for the selector pill
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn twin_wiki_status(
    app: AppHandle,
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<TwinWikiStatus, AppError> {
    require_auth(&state).await?;
    // Confirm the twin exists so we never surface a freshness pill for a
    // dangling id (e.g. after a delete from another tab).
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;

    let dir_buf = default_wiki_dir(&app, &twin_id)?;
    let dir_path = dir_buf.to_string_lossy().to_string();

    if !dir_buf.exists() {
        return Ok(TwinWikiStatus {
            exists: false,
            file_count: 0,
            last_compiled_at: None,
            dir_path,
        });
    }

    let mut file_count: u32 = 0;
    let mut newest_mtime: Option<std::time::SystemTime> = None;
    let entries = std::fs::read_dir(&dir_buf)
        .map_err(|e| AppError::Internal(format!("Failed to read wiki dir: {e}")))?;
    for entry in entries {
        let Ok(entry) = entry else { continue };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        file_count += 1;
        if let Ok(meta) = entry.metadata() {
            if let Ok(mtime) = meta.modified() {
                newest_mtime = Some(match newest_mtime {
                    Some(prev) if prev > mtime => prev,
                    _ => mtime,
                });
            }
        }
    }

    let last_compiled_at = newest_mtime.map(|t| {
        let dt: chrono::DateTime<chrono::Utc> = t.into();
        dt.to_rfc3339()
    });

    Ok(TwinWikiStatus {
        exists: file_count > 0,
        file_count,
        last_compiled_at,
        dir_path,
    })
}

// ============================================================================
// Distilled facts — manual write surface (Cycle 12 Stage 1)
//
// Future stages will add a Claude-driven consolidation pass that turns raw
// communications + approved pending memories into proposed distilled facts;
// for now the table is populated manually so the rest of the stack (recall,
// reflection, contacts) has something concrete to target.
// ============================================================================

#[tauri::command]
pub async fn twin_list_distilled_facts(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    contact_handle: Option<String>,
) -> Result<Vec<TwinDistilledFact>, AppError> {
    require_auth(&state).await?;
    let handle = contact_handle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    repo::list_distilled_facts(&state.db, &twin_id, handle)
}

#[tauri::command]
pub async fn twin_create_distilled_fact(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    contact_handle: Option<String>,
    content: String,
    importance: Option<i32>,
    source_communication_ids: Vec<String>,
) -> Result<TwinDistilledFact, AppError> {
    require_auth(&state).await?;
    // Confirm the twin exists before doing the write — keeps a dangling id
    // from poisoning the table after a delete from another tab.
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;
    let handle = contact_handle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    repo::create_distilled_fact(
        &state.db,
        &twin_id,
        handle,
        &content,
        importance.unwrap_or(3),
        &source_communication_ids,
    )
}

#[tauri::command]
pub async fn twin_delete_distilled_fact(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    repo::delete_distilled_fact(&state.db, &id)
}

// ============================================================================
// Contacts (Cycle 14 Stage 1)
//
// twin_list_contacts auto-upserts new handles seen in twin_communications
// every call, so the table self-maintains without a background job. Stage
// 2 will add proactive nudges scoped per (twin_id, handle); Stage 1 just
// gives operators a single place to attach aliases + notes to each contact.
// ============================================================================

#[tauri::command]
pub async fn twin_list_contacts(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<Vec<TwinContact>, AppError> {
    require_auth(&state).await?;
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;
    repo::list_contacts_with_activity(&state.db, &twin_id)
}

#[tauri::command]
pub async fn twin_update_contact(
    state: State<'_, Arc<AppState>>,
    id: String,
    alias: Option<String>,
    notes: Option<String>,
) -> Result<TwinContact, AppError> {
    require_auth(&state).await?;
    let alias_trim = alias
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let notes_trim = notes.as_deref().map(str::trim).filter(|s| !s.is_empty());
    repo::update_contact(&state.db, &id, alias_trim, notes_trim)
}

// ============================================================================
// Reflections (Cycle 15 Stage 1)
//
// Twin-wide operator-audit journals. Builds a prompt from the twin profile
// + recent communications + the user's seed question, runs it through the
// existing Claude CLI dispatcher, and persists the prose result. Read-only
// once written; the audit value depends on the journal being frozen.
// ============================================================================

const REFLECT_COMMS_LIMIT: i32 = 40;

#[tauri::command]
pub async fn twin_list_reflections(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<Vec<TwinReflection>, AppError> {
    require_auth(&state).await?;
    repo::list_reflections(&state.db, &twin_id)
}

#[tauri::command]
pub async fn twin_delete_reflection(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
    require_auth(&state).await?;
    repo::delete_reflection(&state.db, &id)
}

// ============================================================================
// Recall preview (Cycle 16 Stage 1 — read-only)
//
// Returns the structured slice of twin state a persona prompt-builder would
// need at runtime. Stage 1 surfaces it through a Brain preview panel only —
// the actual persona prompt path doesn't consume the bundle yet. Stage 2
// will wire this into the connector tool that assembles the runtime prompt
// so persona replies pick up the same recency + facts shelves the operator
// previews here.
// ============================================================================

const RECALL_COMMS_LIMIT: i32 = 5;
const RECALL_FACTS_LIMIT: i32 = 5;
const RECALL_CONTACTS_LIMIT: i32 = 5;

#[tauri::command]
pub async fn twin_recall(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    contact_handle: Option<String>,
) -> Result<TwinRecallBundle, AppError> {
    require_auth(&state).await?;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let tone = repo::get_tone_optional(&state.db, &twin_id, "generic")?;
    let contact_filter = contact_handle
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let filter_ref = contact_filter.as_deref();

    let recent_communications =
        repo::list_communications_by_contact(&state.db, &twin_id, filter_ref, RECALL_COMMS_LIMIT)?;
    let top_facts =
        repo::top_distilled_facts_for_recall(&state.db, &twin_id, filter_ref, RECALL_FACTS_LIMIT)?;
    let top_contacts = if filter_ref.is_some() {
        Vec::new()
    } else {
        repo::top_contacts_by_activity(&state.db, &twin_id, RECALL_CONTACTS_LIMIT)?
    };

    Ok(TwinRecallBundle {
        profile,
        tone,
        recent_communications,
        top_facts,
        top_contacts,
        contact_filter,
    })
}

#[tauri::command]
pub async fn twin_reflect(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    prompt_seed: String,
) -> Result<TwinReflection, AppError> {
    require_auth(&state).await?;
    let seed = prompt_seed.trim();
    if seed.is_empty() {
        return Err(AppError::Validation(
            "twin_reflect: prompt_seed cannot be empty".into(),
        ));
    }

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let comms = repo::list_communications(&state.db, &twin_id, None, REFLECT_COMMS_LIMIT)?;

    let identity_block = format!(
        "Twin: {name}\nRole: {role}\nBio: {bio}\n",
        name = profile.name,
        role = profile.role.as_deref().unwrap_or("(not specified)"),
        bio = profile.bio.as_deref().unwrap_or("(not specified)"),
    );

    let comms_block = if comms.is_empty() {
        "(no communications recorded yet)".to_string()
    } else {
        comms
            .iter()
            .map(|c| {
                let date = &c.occurred_at[..10.min(c.occurred_at.len())];
                let dir = if c.direction == "out" { "→" } else { "←" };
                let handle = c.contact_handle.as_deref().unwrap_or("(no handle)");
                let snippet = if c.content.len() > 240 {
                    format!("{}…", &c.content[..240])
                } else {
                    c.content.clone()
                };
                format!("{date} {dir} {handle} [{ch}]: {snippet}", ch = c.channel)
            })
            .collect::<Vec<_>>()
            .join("\n")
    };

    let prompt_text = format!(
        "You are writing a private operator-audit reflection on a digital twin's recent activity. \
         The reader is the human operator (the twin's owner) — not the twin itself. Be candid, \
         specific, and short. Output ONLY the reflection prose (markdown allowed for paragraph \
         breaks; no headings, no preamble, no code fences).\n\n\
         # Twin\n{identity_block}\n\
         # Recent communications (newest first, up to {limit})\n{comms_block}\n\n\
         # Operator's seed question\n{seed}\n\n\
         Write 3-6 sentences answering the seed question, grounded in the communications above. \
         If the communications don't support a confident answer, say so plainly rather than \
         inventing detail.",
        identity_block = identity_block,
        comms_block = comms_block,
        limit = REFLECT_COMMS_LIMIT,
        seed = seed,
    );

    let raw = spawn_claude_with_prompt(prompt_text).await?;
    let content = raw.trim();
    if content.is_empty() {
        return Err(AppError::Internal(
            "twin_reflect: Claude returned empty output".into(),
        ));
    }
    repo::create_reflection(&state.db, &twin_id, seed, content)
}

// ============================================================================
// twin_ingest_doctrine_docs
//
// Seed the twin's bound knowledge base with the curated `docs/features/*`
// pages embedded at compile time by `companion::brain::doctrine`. The Twin
// plugin's Knowledge atelier surfaces this as a "Ingest docs/features"
// button so the user can give a Twin product-level grounding with one click.
//
// We deliberately reuse `doctrine::embedded_feature_docs()` (the same
// content the Athena companion already ships) rather than walking disk —
// production installs don't have the repo, and the embedded copy is the
// authoritative one.
// ============================================================================

/// Summary returned to the UI after a docs ingest pass.
#[derive(Debug, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinIngestDocsSummary {
    pub files_ingested: usize,
    pub chunks_added: usize,
    pub files_skipped: usize,
}

#[cfg(feature = "ml")]
#[tauri::command]
pub async fn twin_ingest_doctrine_docs(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<TwinIngestDocsSummary, AppError> {
    require_auth(&state).await?;

    let twin = repo::get_profile_by_id(&state.db, &twin_id)?;
    let kb_id = twin.knowledge_base_id.clone().ok_or_else(|| {
        AppError::Validation(
            "Twin has no bound knowledge base. Bind one in the Knowledge tab first."
                .into(),
        )
    })?;

    let embedder = state.embedding_manager.as_ref().ok_or_else(|| {
        AppError::Internal("Embedding manager not initialized (ml feature off)".into())
    })?;
    let vector_store = state.vector_store.as_ref().ok_or_else(|| {
        AppError::Internal("Vector store not initialized (ml feature off)".into())
    })?;

    let kb = crate::engine::kb_ingest::get_kb(&state.user_db, &kb_id)?;

    let mut files_ingested = 0usize;
    let mut chunks_added = 0usize;
    let mut files_skipped = 0usize;
    for (rel, content) in crate::companion::brain::doctrine::embedded_feature_docs() {
        // `ingest_text` returns 0 when the same content_hash is already
        // indexed — count that as a skip so the UI can tell the difference
        // between "ingested fresh" and "already there".
        match crate::engine::kb_ingest::ingest_text(
            &state.user_db,
            embedder,
            vector_store,
            &kb,
            rel,
            content,
        )
        .await
        {
            Ok(0) => files_skipped += 1,
            Ok(n) => {
                files_ingested += 1;
                chunks_added += n;
            }
            Err(e) => {
                tracing::warn!(rel = %rel, error = %e, "twin_ingest_doctrine_docs: file failed");
            }
        }
    }
    Ok(TwinIngestDocsSummary {
        files_ingested,
        chunks_added,
        files_skipped,
    })
}

#[cfg(not(feature = "ml"))]
#[tauri::command]
pub async fn twin_ingest_doctrine_docs(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
) -> Result<TwinIngestDocsSummary, AppError> {
    require_auth(&state).await?;
    let _ = twin_id;
    Err(AppError::Internal(
        "Twin docs ingest requires the ml feature (vector search is not built into this binary)."
            .into(),
    ))
}
