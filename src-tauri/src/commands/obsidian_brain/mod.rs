pub mod conflict;
pub mod drive;
pub mod graph;
pub mod lint;
pub mod markdown;
pub mod revitalize;
pub mod semantic_lint;

#[cfg(test)]
mod mirror_tests;

use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::models::{
    DetectedVault, ExecutionKnowledge, ObsidianAvailability, ObsidianMirrorConfig,
    ObsidianVaultConfig, PullSyncResult, PushSyncResult, SemanticLintReport, SyncConflict,
    SyncLogEntry, SyncState, VaultConnectionResult, VaultLintReport, VaultTreeNode,
};
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::execution::knowledge as knowledge_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::core::settings;
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::dev_tools as dev_tools_repo;
use crate::db::repos::resources::{connectors as connector_repo, obsidian_brain as sync_repo};
use crate::db::settings_keys;
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use self::conflict::{three_way_compare, ThreeWayResult};
use self::markdown::{
    compute_content_hash, connector_to_markdown, extract_yaml_field, extract_yaml_tags,
    memory_to_markdown, parse_frontmatter, persona_to_markdown, sanitize_filename,
};

const SETTINGS_KEY: &str = "obsidian_brain_config";
const MIRROR_SETTINGS_KEY: &str = "obsidian_mirror_config";
const SAVED_VAULTS_KEY: &str = "obsidian_brain_saved_vaults";

/// Atomically write `content` to `path` via temp-file + rename.
///
/// `std::fs::write` truncates the destination first and then streams bytes,
/// so a process kill (OS reboot, OOM, taskkill) mid-write leaves a
/// zero-byte or partial file on disk -- and any code that records sync
/// progress *after* the write would treat that corrupted state as the
/// new canonical content. Writing to `<path>.tmp` then renaming over
/// `<path>` is atomic on the same filesystem (POSIX rename semantics;
/// Windows MoveFileEx-equivalent), so the destination either contains
/// the old bytes or the full new bytes -- never a torn write.
///
/// On rename failure (e.g. target file is open elsewhere on Windows),
/// the temp file is best-effort cleaned up so we don't accumulate
/// `.tmp` siblings under the vault.
fn atomic_write(path: &Path, content: &[u8]) -> std::io::Result<()> {
    let mut tmp_os = path.as_os_str().to_owned();
    tmp_os.push(".tmp");
    let tmp_path = std::path::PathBuf::from(tmp_os);
    std::fs::write(&tmp_path, content)?;
    match std::fs::rename(&tmp_path, path) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = std::fs::remove_file(&tmp_path);
            Err(e)
        }
    }
}

// ── Phase 1: Vault Discovery & Config ────────────────────────────────

#[tauri::command]
pub fn obsidian_brain_detect_vaults(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<DetectedVault>, AppError> {
    require_auth_sync(&state)?;

    let mut vaults = Vec::new();

    // On Windows, Obsidian stores vault registry at %APPDATA%/obsidian/obsidian.json
    // On macOS: ~/Library/Application Support/obsidian/obsidian.json
    // On Linux: ~/.config/obsidian/obsidian.json
    let config_path = if cfg!(target_os = "windows") {
        dirs::config_dir().map(|d| d.join("obsidian").join("obsidian.json"))
    } else if cfg!(target_os = "macos") {
        dirs::data_dir().map(|d| d.join("obsidian").join("obsidian.json"))
    } else {
        dirs::config_dir().map(|d| d.join("obsidian").join("obsidian.json"))
    };

    if let Some(path) = config_path {
        if path.exists() {
            if let Ok(content) = std::fs::read_to_string(&path) {
                // Parse the obsidian.json which contains a "vaults" object
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(vault_map) = json.get("vaults").and_then(|v| v.as_object()) {
                        for (_key, vault_info) in vault_map {
                            if let Some(vault_path) =
                                vault_info.get("path").and_then(|p| p.as_str())
                            {
                                let p = Path::new(vault_path);
                                let name = p
                                    .file_name()
                                    .map(|n| n.to_string_lossy().to_string())
                                    .unwrap_or_else(|| vault_path.to_string());
                                vaults.push(DetectedVault {
                                    name,
                                    path: vault_path.to_string(),
                                    exists: p.exists(),
                                });
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(vaults)
}

#[tauri::command]
pub fn obsidian_brain_test_connection(
    state: State<'_, Arc<AppState>>,
    vault_path: String,
) -> Result<VaultConnectionResult, AppError> {
    require_auth_sync(&state)?;

    let path = Path::new(&vault_path);

    if !path.exists() || !path.is_dir() {
        return Ok(VaultConnectionResult {
            valid: false,
            note_count: 0,
            vault_name: String::new(),
            error: Some("Path does not exist or is not a directory".into()),
        });
    }

    let obsidian_dir = path.join(".obsidian");
    if !obsidian_dir.exists() {
        return Ok(VaultConnectionResult {
            valid: false,
            note_count: 0,
            vault_name: String::new(),
            error: Some("Not an Obsidian vault (no .obsidian folder found)".into()),
        });
    }

    // Count .md files (non-recursive for speed, just top-level + 1 deep)
    let mut note_count: i64 = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            let ep = entry.path();
            if ep.extension().map(|e| e == "md").unwrap_or(false) {
                note_count += 1;
            } else if ep.is_dir()
                && ep
                    .file_name()
                    .map(|n| !n.to_string_lossy().starts_with('.'))
                    .unwrap_or(false)
            {
                if let Ok(sub) = std::fs::read_dir(&ep) {
                    note_count += sub
                        .flatten()
                        .filter(|e| e.path().extension().map(|ext| ext == "md").unwrap_or(false))
                        .count() as i64;
                }
            }
        }
    }

    let vault_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| vault_path.clone());

    Ok(VaultConnectionResult {
        valid: true,
        note_count,
        vault_name,
        error: None,
    })
}

#[tauri::command]
pub fn obsidian_brain_save_config(
    state: State<'_, Arc<AppState>>,
    config: ObsidianVaultConfig,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let json = serde_json::to_string(&config)
        .map_err(|e| AppError::Internal(format!("Failed to serialize config: {e}")))?;
    settings_repo::set(&state.db, SETTINGS_KEY, &json)
}

#[tauri::command]
pub fn obsidian_brain_get_config(
    state: State<'_, Arc<AppState>>,
) -> Result<Option<ObsidianVaultConfig>, AppError> {
    require_auth_sync(&state)?;
    match settings_repo::get(&state.db, SETTINGS_KEY)? {
        Some(json) => {
            let config: ObsidianVaultConfig = serde_json::from_str(&json)
                .map_err(|e| AppError::Internal(format!("Failed to parse config: {e}")))?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

/// List the saved-vault roster (the quick-switch list in the Brain plugin's
/// "Saved vaults" sidebar). Stored in app_settings so it survives app
/// sessions — see `settings_keys::OBSIDIAN_BRAIN_SAVED_VAULTS`.
#[tauri::command]
pub fn obsidian_brain_list_saved_vaults(
    state: State<'_, Arc<AppState>>,
) -> Result<Vec<ObsidianVaultConfig>, AppError> {
    require_auth_sync(&state)?;
    match settings_repo::get(&state.db, SAVED_VAULTS_KEY)? {
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| AppError::Internal(format!("Failed to parse saved vaults: {e}"))),
        None => Ok(Vec::new()),
    }
}

/// Replace the saved-vault roster wholesale. The frontend owns merge
/// semantics (add/update/remove by vaultPath); the backend just persists.
#[tauri::command]
pub fn obsidian_brain_set_saved_vaults(
    state: State<'_, Arc<AppState>>,
    configs: Vec<ObsidianVaultConfig>,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let json = serde_json::to_string(&configs)
        .map_err(|e| AppError::Internal(format!("Failed to serialize saved vaults: {e}")))?;
    settings_repo::set(&state.db, SAVED_VAULTS_KEY, &json)
}

// ── Knowledge Mirror config + availability (opt-in, off by default) ──

/// Read the knowledge-mirror config, falling back to all-off defaults so a
/// fresh install (or a parse failure) never surprises the caller.
pub(crate) fn mirror_config(pool: &crate::db::DbPool) -> ObsidianMirrorConfig {
    match settings_repo::get(pool, MIRROR_SETTINGS_KEY) {
        Ok(Some(json)) => serde_json::from_str(&json).unwrap_or_default(),
        _ => ObsidianMirrorConfig::default(),
    }
}

/// Resolve Obsidian presence: the desktop binary is detected OR a vault with a
/// non-empty path is configured in the Brain plugin. Either is enough to
/// surface/enable the integration; neither (the default) means nothing is
/// offered and no mirror code path runs.
pub(crate) fn resolve_availability(pool: &crate::db::DbPool) -> ObsidianAvailability {
    let (binary_installed, _) =
        crate::engine::desktop_discovery::is_desktop_app_installed("desktop_obsidian");
    let vault_configured = match settings_repo::get(pool, SETTINGS_KEY) {
        Ok(Some(json)) => serde_json::from_str::<ObsidianVaultConfig>(&json)
            .map(|c| !c.vault_path.is_empty())
            .unwrap_or(false),
        _ => false,
    };
    ObsidianAvailability {
        binary_installed,
        vault_configured,
        available: binary_installed || vault_configured,
    }
}

#[tauri::command]
pub fn obsidian_mirror_get_config(
    state: State<'_, Arc<AppState>>,
) -> Result<ObsidianMirrorConfig, AppError> {
    require_auth_sync(&state)?;
    Ok(mirror_config(&state.db))
}

#[tauri::command]
pub fn obsidian_mirror_set_config(
    state: State<'_, Arc<AppState>>,
    config: ObsidianMirrorConfig,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let json = serde_json::to_string(&config)
        .map_err(|e| AppError::Internal(format!("Failed to serialize mirror config: {e}")))?;
    settings_repo::set(&state.db, MIRROR_SETTINGS_KEY, &json)
}

#[tauri::command]
pub fn obsidian_available(
    state: State<'_, Arc<AppState>>,
) -> Result<ObsidianAvailability, AppError> {
    require_auth_sync(&state)?;
    Ok(resolve_availability(&state.db))
}

// ── Mirror-domain write primitive ────────────────────────────────────
//
// Shared by the knowledge-mirror domains (Research Lab, and later Execution
// Knowledge + Athena). Each domain supplies a vault-relative path + rendered
// markdown; this layer handles vault resolution, incremental hashing, atomic
// writes, and sync bookkeeping so the domains stay thin.

/// The configured Brain vault config when a non-empty vault path is set, else
/// None so a caller can fall back to legacy behaviour.
pub(crate) fn mirror_vault_root(pool: &crate::db::DbPool) -> Option<ObsidianVaultConfig> {
    match settings_repo::get(pool, SETTINGS_KEY) {
        Ok(Some(json)) => serde_json::from_str::<ObsidianVaultConfig>(&json)
            .ok()
            .filter(|c| !c.vault_path.is_empty()),
        _ => None,
    }
}

/// Incremental, hash-gated note write. Writes `content` to
/// `<vault_path>/<rel_path>` only when its content hash differs from the last
/// recorded sync for `(entity_type, entity_id)`; records sync state + a
/// sync-log row. Returns `Ok(true)` when written, `Ok(false)` when the content
/// was unchanged (skipped).
pub(crate) fn mirror_write_note(
    pool: &crate::db::DbPool,
    vault_path: &str,
    rel_path: &str,
    entity_type: &str,
    entity_id: &str,
    content: &str,
) -> Result<bool, AppError> {
    let hash = compute_content_hash(content);
    let prev = sync_repo::get_sync_state(pool, entity_type, entity_id)?;
    if prev.as_ref().map(|s| s.content_hash == hash).unwrap_or(false) {
        return Ok(false);
    }
    let full = Path::new(vault_path).join(rel_path);
    if let Some(parent) = full.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| AppError::Internal(format!("Failed to create vault dir: {e}")))?;
    }
    atomic_write(&full, content.as_bytes())
        .map_err(|e| AppError::Internal(format!("Failed to write {}: {e}", full.display())))?;
    sync_repo::upsert_sync_state(
        pool,
        &SyncState {
            id: Uuid::new_v4().to_string(),
            entity_type: entity_type.into(),
            entity_id: entity_id.into(),
            vault_file_path: rel_path.into(),
            content_hash: hash,
            sync_direction: "push".into(),
            synced_at: Utc::now().to_rfc3339(),
        },
    )?;
    log_sync(
        pool,
        "mirror",
        entity_type,
        Some(entity_id),
        Some(rel_path),
        if prev.is_some() { "updated" } else { "created" },
        None,
    );
    Ok(true)
}

// ── Execution Knowledge mirror (P2, one-way) ─────────────────────────

/// Render an execution-knowledge row as a vault note (frontmatter + body).
fn render_knowledge_note(k: &ExecutionKnowledge) -> String {
    let pretty = serde_json::from_str::<serde_json::Value>(&k.pattern_data)
        .ok()
        .and_then(|v| serde_json::to_string_pretty(&v).ok())
        .unwrap_or_else(|| k.pattern_data.clone());
    format!(
        "---\ntype: execution_knowledge\nknowledge_type: {kt}\npersona: {pid}\nconfidence: {conf:.2}\nupdated: {upd}\n---\n\n# {pk}\n\n- **Type:** {kt}\n- **Confidence:** {conf:.2}\n- **Success / Failure:** {sc} / {fc}\n- **Avg cost:** ${cost:.4}\n- **Avg duration:** {dur:.0} ms\n\n## Pattern\n\n```json\n{pretty}\n```\n",
        kt = k.knowledge_type,
        pid = k.persona_id,
        conf = k.confidence,
        upd = k.updated_at,
        pk = k.pattern_key,
        sc = k.success_count,
        fc = k.failure_count,
        cost = k.avg_cost_usd,
        dur = k.avg_duration_ms,
    )
}

/// Mirror one persona's execution-knowledge rows into the vault (one-way),
/// when the execution-knowledge mirror is enabled and a vault is configured.
/// Incremental (unchanged rows skipped). Best-effort: errors are logged, never
/// returned — knowledge mirroring must never break the execution path. Returns
/// the number of notes written.
pub(crate) fn mirror_execution_knowledge_for_persona(
    pool: &crate::db::DbPool,
    persona_id: &str,
) -> u32 {
    if !mirror_config(pool).execution_knowledge {
        return 0;
    }
    let Some(cfg) = mirror_vault_root(pool) else {
        return 0;
    };
    let rows = match knowledge_repo::list_for_persona(pool, persona_id, None, None) {
        Ok(r) => r,
        Err(e) => {
            tracing::warn!("execution-knowledge mirror: list failed for {persona_id}: {e}");
            return 0;
        }
    };
    let mut written = 0u32;
    for k in &rows {
        let rel = format!(
            "{}/{}/{}.md",
            cfg.folder_mapping.knowledge_folder,
            k.knowledge_type,
            sanitize_filename(&k.pattern_key),
        );
        match mirror_write_note(
            pool,
            &cfg.vault_path,
            &rel,
            "execution_knowledge",
            &k.id,
            &render_knowledge_note(k),
        ) {
            Ok(true) => written += 1,
            Ok(false) => {}
            Err(e) => tracing::warn!("execution-knowledge mirror: write failed for {}: {e}", k.id),
        }
    }
    written
}

/// Backfill every persona's execution knowledge into the vault. Invoked when
/// the user first enables the execution-knowledge mirror (existing rows would
/// otherwise only appear as each persona runs again). Returns notes written.
#[tauri::command]
pub fn obsidian_mirror_backfill_execution_knowledge(
    state: State<'_, Arc<AppState>>,
) -> Result<u32, AppError> {
    require_auth_sync(&state)?;
    let mut total = 0u32;
    for p in persona_repo::get_all(&state.db)? {
        total += mirror_execution_knowledge_for_persona(&state.db, &p.id);
    }
    Ok(total)
}

// ── Phase 2: Push Sync ───────────────────────────────────────────────

pub(crate) fn get_config_or_err(pool: &crate::db::DbPool) -> Result<ObsidianVaultConfig, AppError> {
    match settings_repo::get(pool, SETTINGS_KEY)? {
        Some(json) => serde_json::from_str(&json)
            .map_err(|e| AppError::Internal(format!("Invalid obsidian config: {e}"))),
        None => Err(AppError::Validation(
            "Obsidian Brain not configured. Please set up a vault first.".into(),
        )),
    }
}

fn log_sync(
    pool: &crate::db::DbPool,
    sync_type: &str,
    entity_type: &str,
    entity_id: Option<&str>,
    vault_file_path: Option<&str>,
    action: &str,
    details: Option<&str>,
) {
    let entry = SyncLogEntry {
        id: Uuid::new_v4().to_string(),
        sync_type: sync_type.into(),
        entity_type: entity_type.into(),
        entity_id: entity_id.map(|s| s.to_string()),
        vault_file_path: vault_file_path.map(|s| s.to_string()),
        action: action.into(),
        details: details.map(|s| s.to_string()),
        created_at: Utc::now().to_rfc3339(),
    };
    let _ = sync_repo::insert_sync_log(pool, &entry);
}

/// Build an injective vault filename for a synced entity. `sanitize_filename` is
/// many-to-one (collapses many distinct chars to `-`, truncates at 100), so
/// keying the on-disk note by title alone let two entities that sanitize to the
/// same name clobber each other's file — silent data loss with success theater
/// (bug-hunt 2026-06-07 creative #1). Appending a short, stable, filesystem-safe
/// slice of the entity id makes the name unique per entity.
fn vault_note_filename(title: &str, entity_id: &str) -> String {
    let base = sanitize_filename(title);
    let alnum: String = entity_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect();
    let suffix = if alnum.len() > 8 {
        alnum[alnum.len() - 8..].to_string()
    } else if alnum.is_empty() {
        "x".to_string()
    } else {
        alnum
    };
    format!("{base}--{suffix}.md")
}

#[tauri::command]
pub fn obsidian_brain_push_sync(
    state: State<'_, Arc<AppState>>,
    persona_ids: Option<Vec<String>>,
) -> Result<PushSyncResult, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_base = Path::new(&config.vault_path);

    if !vault_base.exists() {
        return Err(AppError::Validation("Vault path no longer exists".into()));
    }

    let mut result = PushSyncResult::default();

    // Get personas to sync
    let personas = if let Some(ids) = &persona_ids {
        let mut list = Vec::new();
        for id in ids {
            match persona_repo::get_by_id(&state.db, id) {
                Ok(p) => list.push(p),
                Err(e) => {
                    result
                        .errors
                        .push(format!("Error fetching persona {id}: {e}"));
                }
            }
        }
        list
    } else {
        persona_repo::get_all(&state.db)?
    };

    // Push memories for each persona
    if config.sync_memories {
        for persona in &personas {
            let memories = mem_repo::get_by_persona(&state.db, &persona.id, Some(10000))?;
            let persona_dir = vault_base
                .join(&config.folder_mapping.personas_folder)
                .join(sanitize_filename(&persona.name))
                .join(&config.folder_mapping.memories_folder);

            for memory in &memories {
                let cat_dir = persona_dir.join(&memory.category);

                let md_content = memory_to_markdown(memory, &persona.name);
                let new_hash = compute_content_hash(&md_content);

                // Check if we need to write
                let existing = sync_repo::get_sync_state(&state.db, "memory", &memory.id)?;
                let is_update = existing.is_some();
                if let Some(ref es) = existing {
                    if es.content_hash == new_hash {
                        result.skipped += 1;
                        continue;
                    }
                }

                // Reuse the path already chosen for this entity (stable across
                // title edits and never orphans an existing note); a NEW entity
                // gets a collision-free, id-suffixed name so two memories that
                // sanitize to the same title can't clobber one file
                // (bug-hunt 2026-06-07 creative #1).
                let rel_path = match existing.as_ref() {
                    Some(es) => es.vault_file_path.clone(),
                    None => {
                        let abs = cat_dir.join(vault_note_filename(&memory.title, &memory.id));
                        abs.strip_prefix(vault_base)
                            .unwrap_or(&abs)
                            .to_string_lossy()
                            .to_string()
                    }
                };
                let file_path = vault_base.join(&rel_path);

                // Ensure directory exists (parent of the resolved file path).
                let write_dir = file_path.parent().unwrap_or(cat_dir.as_path());
                if let Err(e) = std::fs::create_dir_all(write_dir) {
                    result
                        .errors
                        .push(format!("Failed to create dir {}: {e}", write_dir.display()));
                    continue;
                }

                // Before overwriting, re-read the on-disk note and refuse to
                // clobber a divergent vault edit (symmetry with the pull path).
                if is_update {
                    let base_hash =
                        existing.as_ref().map(|e| e.content_hash.as_str()).unwrap_or("");
                    match classify_push("memory", &memory.id, &file_path, &rel_path, base_hash, &md_content) {
                        ThreeWayResult::Conflict(_) | ThreeWayResult::VaultChanged => {
                            // Vault note diverged from what we last pushed — the
                            // user edited it directly in Obsidian. Skip + record
                            // instead of overwriting their edit (the data loss
                            // this guard fixes); they can resolve via pull.
                            result.skipped += 1;
                            log_sync(&state.db, "push", "memory", Some(&memory.id), Some(&rel_path), "skipped_vault_conflict", Some(&memory.title));
                            continue;
                        }
                        _ => {}
                    }
                }

                // Write file atomically so a kill mid-write doesn't corrupt
                // an existing vault note (and advance sync state below).
                if let Err(e) = atomic_write(&file_path, md_content.as_bytes()) {
                    result
                        .errors
                        .push(format!("Failed to write {}: {e}", file_path.display()));
                    continue;
                }

                // Update sync state
                let sync_state = SyncState {
                    id: existing
                        .map(|e| e.id)
                        .unwrap_or_else(|| Uuid::new_v4().to_string()),
                    entity_type: "memory".into(),
                    entity_id: memory.id.clone(),
                    vault_file_path: rel_path.clone(),
                    content_hash: new_hash,
                    sync_direction: "push".into(),
                    synced_at: Utc::now().to_rfc3339(),
                };
                let _ = sync_repo::upsert_sync_state(&state.db, &sync_state);

                if is_update {
                    result.updated += 1;
                    log_sync(
                        &state.db,
                        "push",
                        "memory",
                        Some(&memory.id),
                        Some(&rel_path),
                        "updated",
                        Some(&memory.title),
                    );
                } else {
                    result.created += 1;
                    log_sync(
                        &state.db,
                        "push",
                        "memory",
                        Some(&memory.id),
                        Some(&rel_path),
                        "created",
                        Some(&memory.title),
                    );
                }
            }
        }
    }

    // Push persona profiles
    if config.sync_personas {
        for persona in &personas {
            let persona_dir = vault_base
                .join(&config.folder_mapping.personas_folder)
                .join(sanitize_filename(&persona.name));
            let file_path = persona_dir.join("profile.md");
            let rel_path = file_path
                .strip_prefix(vault_base)
                .unwrap_or(&file_path)
                .to_string_lossy()
                .to_string();

            let md_content = persona_to_markdown(persona);
            let new_hash = compute_content_hash(&md_content);

            let existing = sync_repo::get_sync_state(&state.db, "persona", &persona.id)?;
            let is_update = existing.is_some();
            if let Some(ref es) = existing {
                if es.content_hash == new_hash {
                    result.skipped += 1;
                    continue;
                }
            }

            if let Err(e) = std::fs::create_dir_all(&persona_dir) {
                result.errors.push(format!("Failed to create dir: {e}"));
                continue;
            }

            if is_update {
                let base_hash =
                    existing.as_ref().map(|e| e.content_hash.as_str()).unwrap_or("");
                match classify_push("persona", &persona.id, &file_path, &rel_path, base_hash, &md_content) {
                    ThreeWayResult::Conflict(_) | ThreeWayResult::VaultChanged => {
                        // Vault profile diverged from our last push — skip rather
                        // than overwrite the user's direct edit.
                        result.skipped += 1;
                        log_sync(&state.db, "push", "persona", Some(&persona.id), Some(&rel_path), "skipped_vault_conflict", Some(&persona.name));
                        continue;
                    }
                    _ => {}
                }
            }

            if let Err(e) = atomic_write(&file_path, md_content.as_bytes()) {
                result.errors.push(format!("Failed to write profile: {e}"));
                continue;
            }

            let sync_state = SyncState {
                id: existing
                    .map(|e| e.id)
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                entity_type: "persona".into(),
                entity_id: persona.id.clone(),
                vault_file_path: rel_path.clone(),
                content_hash: new_hash,
                sync_direction: "push".into(),
                synced_at: Utc::now().to_rfc3339(),
            };
            let _ = sync_repo::upsert_sync_state(&state.db, &sync_state);

            if is_update {
                result.updated += 1;
            } else {
                result.created += 1;
            }
            log_sync(
                &state.db,
                "push",
                "persona",
                Some(&persona.id),
                Some(&rel_path),
                "synced",
                Some(&persona.name),
            );
        }
    }

    // Push connectors
    if config.sync_connectors {
        let connectors = connector_repo::get_all(&state.db)?;
        let conn_dir = vault_base.join(&config.folder_mapping.connectors_folder);
        let _ = std::fs::create_dir_all(&conn_dir);

        for connector in &connectors {
            let filename = format!("{}.md", sanitize_filename(&connector.label));
            let file_path = conn_dir.join(&filename);
            let rel_path = file_path
                .strip_prefix(vault_base)
                .unwrap_or(&file_path)
                .to_string_lossy()
                .to_string();

            let md_content = connector_to_markdown(connector);
            let new_hash = compute_content_hash(&md_content);

            let existing = sync_repo::get_sync_state(&state.db, "connector", &connector.id)?;
            let is_update = existing.is_some();
            if let Some(ref es) = existing {
                if es.content_hash == new_hash {
                    result.skipped += 1;
                    continue;
                }
            }

            if is_update {
                let base_hash =
                    existing.as_ref().map(|e| e.content_hash.as_str()).unwrap_or("");
                match classify_push("connector", &connector.id, &file_path, &rel_path, base_hash, &md_content) {
                    ThreeWayResult::Conflict(_) | ThreeWayResult::VaultChanged => {
                        // Vault note diverged from our last push — skip rather
                        // than overwrite the user's direct edit.
                        result.skipped += 1;
                        log_sync(&state.db, "push", "connector", Some(&connector.id), Some(&rel_path), "skipped_vault_conflict", Some(&connector.label));
                        continue;
                    }
                    _ => {}
                }
            }

            if let Err(e) = atomic_write(&file_path, md_content.as_bytes()) {
                result
                    .errors
                    .push(format!("Failed to write connector: {e}"));
                continue;
            }

            let sync_state = SyncState {
                id: existing
                    .map(|e| e.id)
                    .unwrap_or_else(|| Uuid::new_v4().to_string()),
                entity_type: "connector".into(),
                entity_id: connector.id.clone(),
                vault_file_path: rel_path.clone(),
                content_hash: new_hash,
                sync_direction: "push".into(),
                synced_at: Utc::now().to_rfc3339(),
            };
            let _ = sync_repo::upsert_sync_state(&state.db, &sync_state);

            if is_update {
                result.updated += 1;
            } else {
                result.created += 1;
            }
        }
    }

    Ok(result)
}

/// Re-read the on-disk vault file and classify a pending push against it, so the
/// push path can refuse to overwrite a note the user edited directly in Obsidian.
/// The pull path already three-way-compares; push previously blind-wrote and
/// silently destroyed such edits. A missing/unreadable file is reported as
/// AppChanged (safe to create). `base_hash` is the content_hash recorded at the
/// last push.
fn classify_push(
    entity_type: &str,
    entity_id: &str,
    file_path: &std::path::Path,
    rel_path: &str,
    base_hash: &str,
    app_md: &str,
) -> ThreeWayResult {
    match std::fs::read_to_string(file_path) {
        Ok(current) => {
            three_way_compare(entity_type, entity_id, rel_path, base_hash, app_md, &current)
        }
        Err(_) => ThreeWayResult::AppChanged,
    }
}

#[tauri::command]
pub fn obsidian_brain_get_sync_log(
    state: State<'_, Arc<AppState>>,
    limit: Option<i64>,
) -> Result<Vec<SyncLogEntry>, AppError> {
    require_auth_sync(&state)?;
    sync_repo::list_sync_log(&state.db, limit.unwrap_or(50))
}

// ── Phase 3: Pull Sync ───────────────────────────────────────────────

#[tauri::command]
pub fn obsidian_brain_pull_sync(
    state: State<'_, Arc<AppState>>,
) -> Result<PullSyncResult, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_base = Path::new(&config.vault_path);

    if !vault_base.exists() {
        return Err(AppError::Validation("Vault path no longer exists".into()));
    }

    let mut result = PullSyncResult::default();

    // Scan all tracked memory sync states and check for vault-side changes
    let tracked_memories = sync_repo::get_sync_states_by_type(&state.db, "memory")?;

    for tracked in &tracked_memories {
        let file_path = vault_base.join(&tracked.vault_file_path);
        if !file_path.exists() {
            // File deleted in vault — log but don't delete from app
            log_sync(
                &state.db,
                "pull",
                "memory",
                Some(&tracked.entity_id),
                Some(&tracked.vault_file_path),
                "skipped",
                Some("File removed from vault"),
            );
            continue;
        }

        let vault_content = match std::fs::read_to_string(&file_path) {
            Ok(c) => c,
            Err(e) => {
                result
                    .errors
                    .push(format!("Failed to read {}: {e}", tracked.vault_file_path));
                continue;
            }
        };

        // Get current app-side content
        let memory = match mem_repo::get_by_id(&state.db, &tracked.entity_id) {
            Ok(m) => m,
            Err(_) => continue, // Memory deleted in app or error
        };

        // Look up persona name for markdown regeneration
        let persona_name = persona_repo::get_by_id(&state.db, &memory.persona_id)
            .map(|p| p.name)
            .unwrap_or_else(|_| "Unknown".into());

        let app_md = memory_to_markdown(&memory, &persona_name);

        match three_way_compare(
            "memory",
            &tracked.entity_id,
            &tracked.vault_file_path,
            &tracked.content_hash,
            &app_md,
            &vault_content,
        ) {
            ThreeWayResult::NoChange => {}
            ThreeWayResult::AppChanged => {
                // App changed, vault didn't — push update
                let new_hash = compute_content_hash(&app_md);
                // Only advance sync state on a confirmed write. Swallowing the
                // error here would record the NEW content_hash while the vault
                // file still holds the OLD bytes, so the next three-way compare
                // sees "no change" and app/vault diverge permanently while the
                // run reports success. Mirror the push path: record the error
                // and skip the state advance.
                if let Err(e) = atomic_write(&file_path, app_md.as_bytes()) {
                    result
                        .errors
                        .push(format!("Failed to write {}: {e}", file_path.display()));
                    continue;
                }
                let ss = SyncState {
                    id: tracked.id.clone(),
                    entity_type: "memory".into(),
                    entity_id: tracked.entity_id.clone(),
                    vault_file_path: tracked.vault_file_path.clone(),
                    content_hash: new_hash,
                    sync_direction: "push".into(),
                    synced_at: Utc::now().to_rfc3339(),
                };
                let _ = sync_repo::upsert_sync_state(&state.db, &ss);
                result.updated += 1;
            }
            ThreeWayResult::VaultChanged => {
                // Vault changed, app didn't — pull update
                if let Some((yaml, body)) = parse_frontmatter(&vault_content) {
                    // Extract updated fields from frontmatter
                    let new_title = body
                        .lines()
                        .find(|l| l.starts_with("# "))
                        .map(|l| l[2..].trim().to_string())
                        .unwrap_or(memory.title.clone());
                    let new_content = body
                        .lines()
                        .skip_while(|l| l.starts_with("# ") || l.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n")
                        .trim()
                        .to_string();

                    let new_category =
                        extract_yaml_field(&yaml, "category").unwrap_or(memory.category.clone());
                    let new_importance = extract_yaml_field(&yaml, "importance")
                        .and_then(|v| v.parse::<i32>().ok())
                        .unwrap_or(memory.importance);
                    let new_tier = extract_yaml_field(&yaml, "tier").unwrap_or(memory.tier.clone());
                    let new_tags = extract_yaml_tags(&yaml);

                    // Update memory in DB
                    let conn = state.db.get()?;
                    let tags_json =
                        serde_json::to_string(&new_tags).unwrap_or_else(|_| "[]".into());
                    let now = Utc::now().to_rfc3339();
                    conn.execute(
                        "UPDATE persona_memories SET title = ?1, content = ?2, category = ?3, importance = ?4, tier = ?5, tags = ?6, updated_at = ?7 WHERE id = ?8",
                        rusqlite::params![
                            new_title,
                            if new_content.is_empty() { &memory.content } else { &new_content },
                            new_category,
                            new_importance.clamp(1, 5),
                            new_tier,
                            tags_json,
                            now,
                            memory.id,
                        ],
                    )?;

                    // Update sync state with new vault hash
                    let new_hash = compute_content_hash(&vault_content);
                    let ss = SyncState {
                        id: tracked.id.clone(),
                        entity_type: "memory".into(),
                        entity_id: tracked.entity_id.clone(),
                        vault_file_path: tracked.vault_file_path.clone(),
                        content_hash: new_hash,
                        sync_direction: "pull".into(),
                        synced_at: Utc::now().to_rfc3339(),
                    };
                    let _ = sync_repo::upsert_sync_state(&state.db, &ss);

                    result.updated += 1;
                    log_sync(
                        &state.db,
                        "pull",
                        "memory",
                        Some(&memory.id),
                        Some(&tracked.vault_file_path),
                        "updated",
                        Some("Pulled vault changes into app"),
                    );
                }
            }
            ThreeWayResult::ConvergedConflict { app_hash, .. } => {
                // Both sides edited and ended up identical — a real conflict
                // avoided by chance. Update the sync state to the converged
                // hash so future runs see no change, and log a distinct
                // "converged" action so SyncBridge can surface a confirmation
                // toast ("Both sides edited X and ended up identical —
                // keeping shared version").
                let ss = SyncState {
                    id: tracked.id.clone(),
                    entity_type: "memory".into(),
                    entity_id: tracked.entity_id.clone(),
                    vault_file_path: tracked.vault_file_path.clone(),
                    content_hash: app_hash,
                    sync_direction: "converged".into(),
                    synced_at: Utc::now().to_rfc3339(),
                };
                let _ = sync_repo::upsert_sync_state(&state.db, &ss);
                log_sync(
                    &state.db,
                    "pull",
                    "memory",
                    Some(&tracked.entity_id),
                    Some(&tracked.vault_file_path),
                    "converged",
                    Some("Both sides edited and ended up identical — keeping shared version"),
                );
                result.converged += 1;
            }
            ThreeWayResult::Conflict(c) => {
                log_sync(
                    &state.db,
                    "pull",
                    "memory",
                    Some(&tracked.entity_id),
                    Some(&tracked.vault_file_path),
                    "conflict",
                    Some("Both sides changed since last sync"),
                );
                result.conflicts.push(c);
            }
        }
    }

    // Scan for NEW vault files not yet tracked
    let personas_dir = vault_base.join(&config.folder_mapping.personas_folder);
    if personas_dir.exists() {
        if let Ok(persona_dirs) = std::fs::read_dir(&personas_dir) {
            for persona_entry in persona_dirs.flatten() {
                if !persona_entry.path().is_dir() {
                    continue;
                }
                let mem_dir = persona_entry
                    .path()
                    .join(&config.folder_mapping.memories_folder);
                if !mem_dir.exists() {
                    continue;
                }
                scan_new_vault_memories(&state.db, vault_base, &mem_dir, &mut result)?;
            }
        }
    }

    Ok(result)
}

/// Scan a vault memories directory for new .md files not yet tracked.
fn scan_new_vault_memories(
    pool: &crate::db::DbPool,
    vault_base: &Path,
    mem_dir: &Path,
    result: &mut PullSyncResult,
) -> Result<(), AppError> {
    // Walk category subdirectories
    let entries = match std::fs::read_dir(mem_dir) {
        Ok(e) => e,
        Err(_) => return Ok(()),
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            // Category subdirectory — scan .md files inside
            if let Ok(files) = std::fs::read_dir(&path) {
                for file_entry in files.flatten() {
                    let file_path = file_entry.path();
                    if file_path.extension().map(|e| e == "md").unwrap_or(false) {
                        try_import_vault_note(pool, vault_base, &file_path, result)?;
                    }
                }
            }
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            try_import_vault_note(pool, vault_base, &path, result)?;
        }
    }
    Ok(())
}

/// Attempt to import a single vault .md file as a new memory if not already tracked.
fn try_import_vault_note(
    pool: &crate::db::DbPool,
    vault_base: &Path,
    file_path: &Path,
    result: &mut PullSyncResult,
) -> Result<(), AppError> {
    let rel_path = file_path
        .strip_prefix(vault_base)
        .unwrap_or(file_path)
        .to_string_lossy()
        .to_string();

    // Check if already tracked by vault_file_path by looking at all memory sync states
    let all_states = sync_repo::get_sync_states_by_type(pool, "memory")?;
    if all_states.iter().any(|s| s.vault_file_path == rel_path) {
        return Ok(()); // Already tracked
    }

    let content = match std::fs::read_to_string(file_path) {
        Ok(c) => c,
        Err(_) => return Ok(()),
    };

    let (yaml, body) = match parse_frontmatter(&content) {
        Some(parts) => parts,
        None => return Ok(()), // No frontmatter, skip
    };

    // Only import files with type: "persona-memory"
    let file_type = extract_yaml_field(&yaml, "type").unwrap_or_default();
    if file_type != "persona-memory" {
        return Ok(());
    }

    // Check if this has an existing id that's already in our DB
    if let Some(existing_id) = extract_yaml_field(&yaml, "id") {
        if mem_repo::get_by_id(pool, &existing_id).is_ok() {
            return Ok(()); // Already exists in DB, just not tracked — will be picked up on next push
        }
    }

    // Extract persona name and look up ID
    let persona_name = extract_yaml_field(&yaml, "persona").unwrap_or_default();
    let persona = persona_repo::get_all(pool)?
        .into_iter()
        .find(|p| p.name == persona_name);

    let persona_id = match persona {
        Some(p) => p.id,
        None => {
            result.errors.push(format!(
                "Skipped {rel_path}: persona '{persona_name}' not found"
            ));
            return Ok(());
        }
    };

    // Build memory from frontmatter + body
    let title = body
        .lines()
        .find(|l| l.starts_with("# "))
        .map(|l| l[2..].trim().to_string())
        .unwrap_or_else(|| {
            file_path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "Untitled".into())
        });

    let mem_content = body
        .lines()
        .skip_while(|l| l.starts_with("# ") || l.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    let category = extract_yaml_field(&yaml, "category").unwrap_or_else(|| "fact".into());
    let importance = extract_yaml_field(&yaml, "importance")
        .and_then(|v| v.parse::<i32>().ok())
        .unwrap_or(3)
        .clamp(1, 5);
    let tags = extract_yaml_tags(&yaml);

    let input = crate::db::models::CreatePersonaMemoryInput {
        persona_id,
        title,
        content: if mem_content.is_empty() {
            "Imported from Obsidian vault".into()
        } else {
            mem_content
        },
        category: Some(category),
        source_execution_id: None,
        importance: Some(importance),
        tags: if tags.is_empty() {
            None
        } else {
            Some(crate::db::models::Json(tags))
        },
        use_case_id: None,
    };

    let created = mem_repo::create(pool, input)?;

    // Track in sync state
    let new_hash = compute_content_hash(&content);
    let ss = SyncState {
        id: Uuid::new_v4().to_string(),
        entity_type: "memory".into(),
        entity_id: created.id.clone(),
        vault_file_path: rel_path.clone(),
        content_hash: new_hash,
        sync_direction: "pull".into(),
        synced_at: Utc::now().to_rfc3339(),
    };
    let _ = sync_repo::upsert_sync_state(pool, &ss);

    result.created += 1;
    log_sync(
        pool,
        "pull",
        "memory",
        Some(&created.id),
        Some(&rel_path),
        "created",
        Some("Imported new memory from vault"),
    );

    Ok(())
}

#[tauri::command]
pub fn obsidian_brain_resolve_conflict(
    state: State<'_, Arc<AppState>>,
    conflict: SyncConflict,
    resolution: String,
) -> Result<(), AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_base = Path::new(&config.vault_path);

    match resolution.as_str() {
        "use_app" => {
            // Overwrite vault file with app content
            let file_path = vault_base.join(&conflict.file_path);
            atomic_write(&file_path, conflict.app_content.as_bytes())
                .map_err(|e| AppError::Internal(format!("Failed to write: {e}")))?;
            let new_hash = compute_content_hash(&conflict.app_content);
            let ss = SyncState {
                id: Uuid::new_v4().to_string(),
                entity_type: conflict.entity_type.clone(),
                entity_id: conflict.entity_id.clone(),
                vault_file_path: conflict.file_path.clone(),
                content_hash: new_hash,
                sync_direction: "push".into(),
                synced_at: Utc::now().to_rfc3339(),
            };
            sync_repo::upsert_sync_state(&state.db, &ss)?;
            log_sync(
                &state.db,
                "resolve",
                &conflict.entity_type,
                Some(&conflict.entity_id),
                Some(&conflict.file_path),
                "resolved_use_app",
                None,
            );
        }
        "use_vault" => {
            // Update app memory with vault content
            if conflict.entity_type == "memory" {
                if let Some((yaml, body)) = parse_frontmatter(&conflict.vault_content) {
                    let new_title = body
                        .lines()
                        .find(|l| l.starts_with("# "))
                        .map(|l| l[2..].trim().to_string());
                    let new_content = body
                        .lines()
                        .skip_while(|l| l.starts_with("# ") || l.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n")
                        .trim()
                        .to_string();
                    let new_category = extract_yaml_field(&yaml, "category");
                    let new_importance =
                        extract_yaml_field(&yaml, "importance").and_then(|v| v.parse::<i32>().ok());
                    let new_tags = extract_yaml_tags(&yaml);
                    let tags_json =
                        serde_json::to_string(&new_tags).unwrap_or_else(|_| "[]".into());
                    let now = Utc::now().to_rfc3339();

                    let conn = state.db.get()?;
                    conn.execute(
                        "UPDATE persona_memories SET title = COALESCE(?1, title), content = CASE WHEN ?2 = '' THEN content ELSE ?2 END, category = COALESCE(?3, category), importance = COALESCE(?4, importance), tags = ?5, updated_at = ?6 WHERE id = ?7",
                        rusqlite::params![
                            new_title,
                            new_content,
                            new_category,
                            new_importance.map(|i| i.clamp(1, 5)),
                            tags_json,
                            now,
                            conflict.entity_id,
                        ],
                    )?;
                }
            }
            let new_hash = compute_content_hash(&conflict.vault_content);
            let ss = SyncState {
                id: Uuid::new_v4().to_string(),
                entity_type: conflict.entity_type.clone(),
                entity_id: conflict.entity_id.clone(),
                vault_file_path: conflict.file_path.clone(),
                content_hash: new_hash,
                sync_direction: "pull".into(),
                synced_at: Utc::now().to_rfc3339(),
            };
            sync_repo::upsert_sync_state(&state.db, &ss)?;
            log_sync(
                &state.db,
                "resolve",
                &conflict.entity_type,
                Some(&conflict.entity_id),
                Some(&conflict.file_path),
                "resolved_use_vault",
                None,
            );
        }
        "skip" => {
            log_sync(
                &state.db,
                "resolve",
                &conflict.entity_type,
                Some(&conflict.entity_id),
                Some(&conflict.file_path),
                "skipped",
                None,
            );
        }
        _ => {
            return Err(AppError::Validation(format!(
                "Invalid resolution: {resolution}. Use 'use_app', 'use_vault', or 'skip'"
            )));
        }
    }

    Ok(())
}

// ── Phase 4: Vault Browser ──────────────────────────────────────────

/// Resolve a caller-supplied path that must stay inside the configured vault.
/// Rejects absolute paths and `..` segments, then canonicalises both the vault
/// root and the joined target and asserts containment — covering symlink escapes
/// (canonicalize resolves them) and Windows case-folding (canonicalize normalises
/// case). `rel = None`/empty resolves to the vault root. Returns the canonical,
/// in-vault absolute path.
///
/// Every command that joins a caller-supplied path to the vault MUST go through
/// this so the guard cannot diverge between siblings — which is exactly how the
/// listing command shipped without the read command's checks
/// (bug-hunt 2026-06-07 creative #2).
fn resolve_vault_subpath(vault_base: &Path, rel: Option<&str>) -> Result<std::path::PathBuf, AppError> {
    let vault_canon = vault_base
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("Vault path is not accessible: {e}")))?;
    let rel = match rel {
        None => return Ok(vault_canon),
        Some(r) if r.trim().is_empty() => return Ok(vault_canon),
        Some(r) => r,
    };
    let candidate = Path::new(rel);
    if candidate.is_absolute() {
        return Err(AppError::Validation(
            "Path must be relative to the vault root".into(),
        ));
    }
    if candidate
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(AppError::Validation(
            "Path must not contain `..` segments".into(),
        ));
    }
    let target_canon = vault_canon
        .join(candidate)
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("Vault path not found: {e}")))?;
    if !target_canon.starts_with(&vault_canon) {
        return Err(AppError::Validation(
            "Path resolves outside the configured vault".into(),
        ));
    }
    Ok(target_canon)
}

#[tauri::command]
pub fn obsidian_brain_list_vault_files(
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
) -> Result<VaultTreeNode, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_base = Path::new(&config.vault_path);
    // Confine the listing to the vault. This previously joined the caller path
    // verbatim, so an absolute or `..` path enumerated arbitrary directories and
    // returned their absolute paths (bug-hunt 2026-06-07 creative #2).
    let vault_canon = vault_base
        .canonicalize()
        .map_err(|e| AppError::Validation(format!("Vault path is not accessible: {e}")))?;
    let scan_path = resolve_vault_subpath(vault_base, path.as_deref())?;

    fn build_tree(dir: &Path, root: &Path, depth: u32) -> VaultTreeNode {
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        // Always report vault-relative paths, never absolute filesystem paths.
        let rel_path = dir
            .strip_prefix(root)
            .unwrap_or(dir)
            .to_string_lossy()
            .to_string();

        if depth > 5 {
            return VaultTreeNode {
                name,
                path: rel_path,
                is_dir: true,
                children: vec![],
                note_count: 0,
            };
        }

        let mut children = Vec::new();
        let mut note_count: i64 = 0;

        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut entries: Vec<_> = entries.flatten().collect();
            entries.sort_by_key(|e| e.file_name());

            for entry in entries {
                let ep = entry.path();
                let fname = ep
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_default();

                // Skip hidden dirs/files
                if fname.starts_with('.') {
                    continue;
                }

                // Never descend into symlinked directories — a symlink inside
                // the vault can still point outside it.
                let is_symlink = entry
                    .file_type()
                    .map(|t| t.is_symlink())
                    .unwrap_or(false);
                if is_symlink {
                    continue;
                }

                if ep.is_dir() {
                    let child = build_tree(&ep, root, depth + 1);
                    note_count += child.note_count;
                    children.push(child);
                } else if ep.extension().map(|e| e == "md").unwrap_or(false) {
                    note_count += 1;
                    children.push(VaultTreeNode {
                        name: fname,
                        path: ep
                            .strip_prefix(root)
                            .unwrap_or(&ep)
                            .to_string_lossy()
                            .to_string(),
                        is_dir: false,
                        children: vec![],
                        note_count: 0,
                    });
                }
            }
        }

        VaultTreeNode {
            name,
            path: rel_path,
            is_dir: true,
            children,
            note_count,
        }
    }

    Ok(build_tree(&scan_path, &vault_canon, 0))
}

#[tauri::command]
pub fn obsidian_brain_read_vault_note(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_base = Path::new(&config.vault_path);
    // Confine the read to the configured vault via the shared guard (rejects
    // absolute/`..`, canonicalises both sides, asserts containment — covering
    // symlink escapes and Windows case-folding).
    let target_canon = resolve_vault_subpath(vault_base, Some(&file_path))?;
    std::fs::read_to_string(&target_canon)
        .map_err(|e| AppError::Validation(format!("Failed to read file: {e}")))
}

// ============================================================================
// Goal Tree Sync — push goals to vault as linked markdown notes
// ============================================================================

fn goal_to_markdown(
    goal: &crate::db::models::DevGoal,
    children: &[&crate::db::models::DevGoal],
) -> String {
    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("id: \"{}\"\n", goal.id));
    md.push_str(&format!("project_id: \"{}\"\n", goal.project_id));
    if let Some(ref parent) = goal.parent_goal_id {
        md.push_str(&format!("parent_goal_id: \"{}\"\n", parent));
    }
    md.push_str(&format!("status: \"{}\"\n", goal.status));
    md.push_str(&format!("progress: {}\n", goal.progress));
    if let Some(ref td) = goal.target_date {
        md.push_str(&format!("target_date: \"{}\"\n", td));
    }
    md.push_str(&format!("type: \"dev-goal\"\n"));
    md.push_str(&format!("created: \"{}\"\n", goal.created_at));
    md.push_str(&format!("updated: \"{}\"\n", goal.updated_at));
    md.push_str("---\n\n");
    md.push_str(&format!("# {}\n\n", goal.title));
    if let Some(ref desc) = goal.description {
        md.push_str(desc);
        md.push_str("\n\n");
    }

    // Link to parent
    if let Some(ref parent) = goal.parent_goal_id {
        md.push_str(&format!("**Parent:** [[{}]]\n\n", parent));
    }

    // Link to children
    if !children.is_empty() {
        md.push_str("## Sub-goals\n\n");
        for child in children {
            let status_icon = match child.status.as_str() {
                "done" => "✅",
                "in-progress" => "🔄",
                "blocked" => "🚫",
                _ => "⬜",
            };
            md.push_str(&format!(
                "- {} [[{}]] ({}%)\n",
                status_icon,
                sanitize_filename(&child.title),
                child.progress
            ));
        }
        md.push_str("\n");
    }

    md
}

#[tauri::command]
pub fn obsidian_brain_push_goals(
    state: State<'_, Arc<AppState>>,
    project_id: String,
) -> Result<PushSyncResult, AppError> {
    require_auth_sync(&state)?;

    let config = get_config_or_err(&state.db)?;

    let goals = dev_tools_repo::list_goals_by_project(&state.db, &project_id, None)?;
    if goals.is_empty() {
        return Ok(PushSyncResult {
            created: 0,
            updated: 0,
            skipped: 0,
            errors: vec![],
        });
    }

    let goals_folder = Path::new(&config.vault_path).join("DevTools").join("Goals");
    std::fs::create_dir_all(&goals_folder)
        .map_err(|e| AppError::Validation(format!("Failed to create goals folder: {e}")))?;

    let mut created = 0i64;
    let mut updated = 0i64;
    let mut skipped = 0i64;
    let mut errors = Vec::new();

    for goal in &goals {
        let children: Vec<&crate::db::models::DevGoal> = goals
            .iter()
            .filter(|g| g.parent_goal_id.as_deref() == Some(&goal.id))
            .collect();

        let content = goal_to_markdown(goal, &children);
        let hash = compute_content_hash(&content);
        let filename = format!("{}.md", sanitize_filename(&goal.title));
        let file_path = goals_folder.join(&filename);

        // Check sync state
        let existing = sync_repo::get_sync_state(&state.db, "dev-goal", &goal.id)
            .ok()
            .flatten();
        if let Some(ref state_entry) = existing {
            if state_entry.content_hash == hash {
                skipped += 1;
                continue;
            }
        }

        match atomic_write(&file_path, content.as_bytes()) {
            Ok(()) => {
                let _ = sync_repo::upsert_sync_state(
                    &state.db,
                    &SyncState {
                        id: format!("sync-{}", uuid::Uuid::new_v4()),
                        entity_type: "dev-goal".into(),
                        entity_id: goal.id.clone(),
                        vault_file_path: file_path.to_string_lossy().into_owned(),
                        content_hash: hash.clone(),
                        sync_direction: "push".into(),
                        synced_at: chrono::Utc::now().to_rfc3339(),
                    },
                );
                if existing.is_some() {
                    updated += 1;
                } else {
                    created += 1;
                }
            }
            Err(e) => {
                errors.push(format!("Failed to write {}: {}", filename, e));
            }
        }
    }

    let _ = sync_repo::insert_sync_log(
        &state.db,
        &SyncLogEntry {
            id: format!("log-{}", uuid::Uuid::new_v4()),
            sync_type: "push".into(),
            entity_type: "dev-goal".into(),
            entity_id: None,
            vault_file_path: None,
            action: "sync".into(),
            details: Some(format!(
                "Goals push: {} created, {} updated, {} skipped",
                created, updated, skipped
            )),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    );

    Ok(PushSyncResult {
        created,
        updated,
        skipped,
        errors,
    })
}

// ── Phase 5: Vault Lint (knowledge integrity check) ──────────────────
//
// Inspired by Karpathy-style LLM knowledge bases (research run 2026-04-08).
// Treats the vault like source code: a lint pass that catches stale notes,
// broken wikilinks, and orphan pages so the knowledge surface stays trusted
// as it grows. Pure read-only — never mutates the vault.

#[tauri::command]
pub fn obsidian_brain_lint_vault(
    state: State<'_, Arc<AppState>>,
    vault_path: Option<String>,
    stale_days: Option<i64>,
) -> Result<VaultLintReport, AppError> {
    require_auth_sync(&state)?;

    // If the caller didn't supply a path, fall back to the configured vault.
    let path = match vault_path {
        Some(p) if !p.trim().is_empty() => p,
        _ => get_config_or_err(&state.db)?.vault_path,
    };

    let stale_days = stale_days.unwrap_or(self::lint::DEFAULT_STALE_DAYS);
    self::lint::lint_vault(Path::new(&path), stale_days)
}

// ── Phase 5.1: Semantic Vault Lint (LLM-assisted integrity check) ────
//
// Complement to `obsidian_brain_lint_vault`: spawns a short Claude Code CLI
// call to find inconsistencies, missing-page candidates, and obvious missing
// wikilinks the syntactic lint can't catch. Opt-in; bills tokens. Inspired by
// Karpathy's LLM knowledge base walkthrough (research run 2026-04-08,
// youtube.com/watch?v=sboNwYmH3AY).

#[tauri::command]
pub async fn obsidian_brain_semantic_lint_vault(
    state: State<'_, Arc<AppState>>,
    vault_path: Option<String>,
) -> Result<SemanticLintReport, AppError> {
    require_auth(&state).await?;

    // If the caller didn't supply a path, fall back to the configured vault.
    let path = match vault_path {
        Some(p) if !p.trim().is_empty() => p,
        _ => get_config_or_err(&state.db)?.vault_path,
    };

    // Resolve the model: per-app override, else the module default.
    let model = settings::get(&state.db, settings_keys::SEMANTIC_LINT_MODEL)?
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| self::semantic_lint::DEFAULT_SEMANTIC_LINT_MODEL.to_string());

    self::semantic_lint::run_semantic_lint(Path::new(&path), model).await
}

// ── Phase 6: Google Drive Cloud Sync ────────────────────────────────────
// pending: companion of `drive.rs`. These commands need to be registered in
// `lib.rs`'s `invoke_handler` once the Drive sync UI ships.

#[tauri::command]
#[allow(dead_code)]
pub async fn obsidian_drive_status(
    state: State<'_, Arc<AppState>>,
) -> Result<drive::DriveStatus, AppError> {
    require_auth(&state).await?;

    let token = get_google_provider_token(&state).await?;
    let config = get_config_or_err(&state.db)?;
    let vault_name = config
        .vault_name
        .is_empty()
        .then(|| "default".to_string())
        .unwrap_or(config.vault_name);

    drive::get_drive_status(&token, &vault_name).await
}

#[tauri::command]
#[allow(dead_code)]
pub async fn obsidian_drive_push_sync(
    state: State<'_, Arc<AppState>>,
    folder_names: Option<Vec<String>>,
) -> Result<drive::DriveSyncResult, AppError> {
    require_auth(&state).await?;

    let token = get_google_provider_token(&state).await?;
    let config = get_config_or_err(&state.db)?;

    let folders = folder_names.unwrap_or_else(|| {
        let mut f = Vec::new();
        if config.sync_personas {
            f.push(config.folder_mapping.personas_folder.clone());
        }
        if config.sync_memories {
            f.push(format!(
                "{}/{}",
                config.folder_mapping.personas_folder, config.folder_mapping.memories_folder
            ));
        }
        if config.sync_connectors {
            f.push(config.folder_mapping.connectors_folder.clone());
        }
        f
    });

    let vault_name = if config.vault_name.is_empty() {
        "default".to_string()
    } else {
        config.vault_name
    };

    drive::push_to_drive(&token, Path::new(&config.vault_path), &vault_name, &folders).await
}

#[tauri::command]
#[allow(dead_code)]
pub async fn obsidian_drive_pull_sync(
    state: State<'_, Arc<AppState>>,
    folder_names: Option<Vec<String>>,
) -> Result<drive::DriveSyncResult, AppError> {
    require_auth(&state).await?;

    let token = get_google_provider_token(&state).await?;
    let config = get_config_or_err(&state.db)?;

    let folders = folder_names.unwrap_or_else(|| {
        let mut f = Vec::new();
        if config.sync_personas {
            f.push(config.folder_mapping.personas_folder.clone());
        }
        if config.sync_memories {
            f.push(format!(
                "{}/{}",
                config.folder_mapping.personas_folder, config.folder_mapping.memories_folder
            ));
        }
        if config.sync_connectors {
            f.push(config.folder_mapping.connectors_folder.clone());
        }
        f
    });

    let vault_name = if config.vault_name.is_empty() {
        "default".to_string()
    } else {
        config.vault_name
    };

    drive::pull_from_drive(&token, Path::new(&config.vault_path), &vault_name, &folders).await
}

/// Extract the Google provider token from auth state.
/// This is the raw Google access token (not the Supabase JWT),
/// obtained when the user authenticates with the `drive.file` scope.
#[allow(dead_code)] // pending: only called from obsidian_drive_* commands above (also dormant)
async fn get_google_provider_token(state: &Arc<AppState>) -> Result<String, AppError> {
    let auth = state.auth.read().await;
    auth.google_provider_token
        .as_ref()
        .map(|t| t.expose_secret().to_string())
        .ok_or_else(|| {
            AppError::Auth(
                "Google Drive not connected. Please sign in with Google Drive access.".into(),
            )
        })
}

// ============================================================================
// Competition insight sync — push a winning insight as a markdown note
// ============================================================================

/// Push a competition's winning insight to the Obsidian vault.
/// Creates a note in DevTools/Competitions/<competition_id>.md with
/// YAML frontmatter linking the strategy, timestamp, and project.
///
/// Can be called from the frontend or from dev_tools pick_winner.
/// Returns true if the note was written, false if Obsidian is not configured.
pub fn push_competition_insight_to_vault(
    pool: &crate::db::DbPool,
    competition_id: &str,
    strategy_label: &str,
    insight_text: &str,
    project_name: &str,
    task_title: &str,
) -> Result<bool, AppError> {
    let config = match get_config_or_err(pool) {
        Ok(c) => c,
        Err(_) => return Ok(false), // Obsidian not configured — skip silently
    };

    let folder = Path::new(&config.vault_path)
        .join("DevTools")
        .join("Competitions");
    std::fs::create_dir_all(&folder)
        .map_err(|e| AppError::Validation(format!("Failed to create Competitions folder: {e}")))?;

    let now = chrono::Utc::now().to_rfc3339();
    let short_id: String = competition_id.chars().take(8).collect();
    let filename = format!("comp-{}-{}.md", short_id, sanitize_filename(strategy_label));

    let content = format!(
        r#"---
id: "{competition_id}"
type: "competition-insight"
strategy: "{strategy_label}"
project: "{project_name}"
task: "{task_title}"
created: "{now}"
---

# Competition Winner — {strategy_label}

**Project:** {project_name}
**Task:** {task_title}
**Strategy:** {strategy_label}
**Date:** {now}

## Winning Insight

{insight_text}
"#
    );

    let file_path = folder.join(&filename);
    match atomic_write(&file_path, content.as_bytes()) {
        Ok(()) => {
            tracing::info!("Pushed competition insight to Obsidian: {}", filename);
            Ok(true)
        }
        Err(e) => {
            tracing::warn!("Failed to write competition insight to vault: {}", e);
            Ok(false)
        }
    }
}
