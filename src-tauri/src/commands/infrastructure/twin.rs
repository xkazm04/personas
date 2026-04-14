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

    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err(AppError::Validation(
            "URL must start with http:// or https://".into(),
        ));
    }

    // Verify the twin exists before doing the fetch so we don't waste a network
    // round-trip on an invalid id.
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .user_agent("Mozilla/5.0 (compatible; PersonasTwinIngest/1.0)")
        .build()
        .map_err(|e| AppError::Internal(format!("HTTP client init failed: {e}")))?;

    let response = client
        .get(&url)
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
    )
}

// ----------------------------------------------------------------------------
// twin_compile_wiki — approved memories → topic .md files with [[wikilinks]]
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn twin_compile_wiki(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    output_dir: String,
) -> Result<u32, AppError> {
    require_auth(&state).await?;

    let profile = repo::get_profile_by_id(&state.db, &twin_id)?;
    let approved = repo::list_pending_memories(&state.db, &twin_id, Some("approved"))?;

    if approved.is_empty() {
        return Err(AppError::Validation(
            "No approved memories to compile. Approve some memories in the Knowledge tab first."
                .into(),
        ));
    }

    std::fs::create_dir_all(&output_dir)
        .map_err(|e| AppError::Internal(format!("Failed to create output dir: {e}")))?;

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
                let safe_name = name
                    .replace("..", "_")
                    .replace('/', "_")
                    .replace('\\', "_");
                if !safe_name.is_empty() {
                    let path = std::path::Path::new(&output_dir).join(&safe_name);
                    std::fs::write(&path, current_content.trim_start_matches('\n'))
                        .map_err(|e| {
                            AppError::Internal(format!("Failed to write {safe_name}: {e}"))
                        })?;
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

    Ok(written)
}

// ----------------------------------------------------------------------------
// twin_audit_wiki — consistency check over compiled wiki files
// ----------------------------------------------------------------------------

#[tauri::command]
pub async fn twin_audit_wiki(
    state: State<'_, Arc<AppState>>,
    twin_id: String,
    wiki_dir: String,
) -> Result<TwinPendingMemory, AppError> {
    require_auth(&state).await?;

    // Verify the twin exists before doing file I/O
    let _ = repo::get_profile_by_id(&state.db, &twin_id)?;

    let dir = std::path::Path::new(&wiki_dir);
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
        let entry = entry
            .map_err(|e| AppError::Internal(format!("Failed to read wiki entry: {e}")))?;
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
    )
}
