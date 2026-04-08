pub mod conflict;
pub mod lint;
pub mod markdown;
pub mod semantic_lint;

use std::path::Path;
use std::sync::Arc;

use chrono::Utc;
use tauri::State;
use uuid::Uuid;

use crate::db::models::{
    DetectedVault, ObsidianVaultConfig, PullSyncResult, PushSyncResult, SemanticLintReport,
    SyncConflict, SyncLogEntry, SyncState, VaultConnectionResult, VaultLintReport, VaultTreeNode,
};
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::ipc_auth::require_auth;
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::core::settings as settings_repo;
use crate::db::repos::resources::{connectors as connector_repo, obsidian_brain as sync_repo};
use crate::db::repos::dev_tools as dev_tools_repo;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use self::conflict::{three_way_compare, ThreeWayResult};
use self::markdown::{
    compute_content_hash, connector_to_markdown, extract_yaml_field, extract_yaml_tags,
    memory_to_markdown, parse_frontmatter, persona_to_markdown, sanitize_filename,
};

const SETTINGS_KEY: &str = "obsidian_brain_config";

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
            } else if ep.is_dir() && ep.file_name().map(|n| !n.to_string_lossy().starts_with('.')).unwrap_or(false) {
                if let Ok(sub) = std::fs::read_dir(&ep) {
                    note_count += sub
                        .flatten()
                        .filter(|e| {
                            e.path().extension().map(|ext| ext == "md").unwrap_or(false)
                        })
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

// ── Phase 2: Push Sync ───────────────────────────────────────────────

fn get_config_or_err(pool: &crate::db::DbPool) -> Result<ObsidianVaultConfig, AppError> {
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
                    result.errors.push(format!("Error fetching persona {id}: {e}"));
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
                let filename = format!("{}.md", sanitize_filename(&memory.title));
                let file_path = cat_dir.join(&filename);
                let rel_path = file_path
                    .strip_prefix(vault_base)
                    .unwrap_or(&file_path)
                    .to_string_lossy()
                    .to_string();

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

                // Ensure directory exists
                if let Err(e) = std::fs::create_dir_all(&cat_dir) {
                    result
                        .errors
                        .push(format!("Failed to create dir {}: {e}", cat_dir.display()));
                    continue;
                }

                // Write file
                if let Err(e) = std::fs::write(&file_path, &md_content) {
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
                result
                    .errors
                    .push(format!("Failed to create dir: {e}"));
                continue;
            }

            if let Err(e) = std::fs::write(&file_path, &md_content) {
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

            if let Err(e) = std::fs::write(&file_path, &md_content) {
                result.errors.push(format!("Failed to write connector: {e}"));
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
                result.errors.push(format!(
                    "Failed to read {}: {e}",
                    tracked.vault_file_path
                ));
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
                let _ = std::fs::write(&file_path, &app_md);
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

                    let new_category = extract_yaml_field(&yaml, "category")
                        .unwrap_or(memory.category.clone());
                    let new_importance = extract_yaml_field(&yaml, "importance")
                        .and_then(|v| v.parse::<i32>().ok())
                        .unwrap_or(memory.importance);
                    let new_tier = extract_yaml_field(&yaml, "tier")
                        .unwrap_or(memory.tier.clone());
                    let new_tags = extract_yaml_tags(&yaml);

                    // Update memory in DB
                    let conn = state.db.get()?;
                    let tags_json = serde_json::to_string(&new_tags).unwrap_or_else(|_| "[]".into());
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
                let mem_dir = persona_entry.path().join(&config.folder_mapping.memories_folder);
                if !mem_dir.exists() {
                    continue;
                }
                scan_new_vault_memories(
                    &state.db,
                    vault_base,
                    &mem_dir,
                    &mut result,
                )?;
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
            std::fs::write(&file_path, &conflict.app_content)
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
                    let new_importance = extract_yaml_field(&yaml, "importance")
                        .and_then(|v| v.parse::<i32>().ok());
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

#[tauri::command]
pub fn obsidian_brain_list_vault_files(
    state: State<'_, Arc<AppState>>,
    path: Option<String>,
) -> Result<VaultTreeNode, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;
    let vault_base = Path::new(&config.vault_path);
    let scan_path = match &path {
        Some(p) => vault_base.join(p),
        None => vault_base.to_path_buf(),
    };

    fn build_tree(dir: &Path, depth: u32) -> VaultTreeNode {
        let name = dir
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        if depth > 5 {
            return VaultTreeNode {
                name,
                path: dir.to_string_lossy().to_string(),
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

                if ep.is_dir() {
                    let child = build_tree(&ep, depth + 1);
                    note_count += child.note_count;
                    children.push(child);
                } else if ep.extension().map(|e| e == "md").unwrap_or(false) {
                    note_count += 1;
                    children.push(VaultTreeNode {
                        name: fname,
                        path: ep.to_string_lossy().to_string(),
                        is_dir: false,
                        children: vec![],
                        note_count: 0,
                    });
                }
            }
        }

        VaultTreeNode {
            name,
            path: dir.to_string_lossy().to_string(),
            is_dir: true,
            children,
            note_count,
        }
    }

    Ok(build_tree(&scan_path, 0))
}

#[tauri::command]
pub fn obsidian_brain_read_vault_note(
    state: State<'_, Arc<AppState>>,
    file_path: String,
) -> Result<String, AppError> {
    require_auth_sync(&state)?;
    let config = get_config_or_err(&state.db)?;

    // Safety: ensure the path is within the vault
    let vault_base = Path::new(&config.vault_path);
    let target = Path::new(&file_path);

    if !target.starts_with(vault_base) && !target.starts_with(&config.vault_path) {
        return Err(AppError::Validation(
            "File path is outside the configured vault".into(),
        ));
    }

    std::fs::read_to_string(target)
        .map_err(|e| AppError::Validation(format!("Failed to read file: {e}")))
}

// ============================================================================
// Goal Tree Sync — push goals to vault as linked markdown notes
// ============================================================================

fn goal_to_markdown(goal: &crate::db::models::DevGoal, children: &[&crate::db::models::DevGoal]) -> String {
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
            md.push_str(&format!("- {} [[{}]] ({}%)\n", status_icon, sanitize_filename(&child.title), child.progress));
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
        let existing = sync_repo::get_sync_state(&state.db, "dev-goal", &goal.id).ok().flatten();
        if let Some(ref state_entry) = existing {
            if state_entry.content_hash == hash {
                skipped += 1;
                continue;
            }
        }

        match std::fs::write(&file_path, &content) {
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
                if existing.is_some() { updated += 1; } else { created += 1; }
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
            details: Some(format!("Goals push: {} created, {} updated, {} skipped", created, updated, skipped)),
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    );

    Ok(PushSyncResult { created, updated, skipped, errors })
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
