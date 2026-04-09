use std::sync::Arc;
use tauri::State;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::db::models::{TwinProfile, TwinTone, TwinPendingMemory, TwinCommunication, TwinVoiceProfile, TwinChannel};
use crate::db::repos::twin as repo;
use crate::engine::prompt;
use crate::error::AppError;
use crate::ipc_auth::{require_auth_sync, require_auth};
use crate::AppState;

// ============================================================================
// Twin Profiles (P0)
//
// First slice of the Twin plugin commands. CRUD plus an active-profile
// promoter. Multi-twin from day one; the active twin is the one the
// `builtin-twin` connector resolves when a persona invokes a twin tool.
// ============================================================================

#[tauri::command]
pub fn twin_list_profiles(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<TwinProfile>, AppError> {
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

#[tauri::command]
pub fn twin_get_active_profile(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<TwinProfile>, AppError> {
    require_auth_sync(&state)?;
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
    )
}

#[tauri::command]
pub fn twin_delete_profile(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
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
pub fn twin_delete_tone(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
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
pub fn twin_delete_channel(
    state: State<'_, Arc<AppState>>,
    id: String,
) -> Result<bool, AppError> {
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
) -> Result<String, AppError> {
    require_auth(&state).await?;

    let prompt_text = format!(
        "Generate a concise professional bio (2-3 sentences, first person) for a digital twin named \"{name}\"{role_part}. \
         Use these keywords/topics as input: {keywords}. \
         Output ONLY the bio text, nothing else. No quotes, no preamble.",
        role_part = role.as_ref().map(|r| format!(", role: {r}")).unwrap_or_default(),
    );

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
            AppError::Internal("Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code".into())
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

    let output = child.wait_with_output().await
        .map_err(|e| AppError::Internal(format!("CLI execution failed: {e}")))?;

    if !output.status.success() {
        return Err(AppError::Internal("Claude CLI returned non-zero exit code".into()));
    }

    let raw = String::from_utf8_lossy(&output.stdout).to_string();
    // Strip any JSON wrapper if the CLI outputs structured content
    let bio = raw.trim().trim_matches('"').to_string();
    Ok(bio)
}
