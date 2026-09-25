use std::sync::Arc;

use rusqlite::params;
use serde_json::json;
use tauri::State;

use crate::db::models::{SessionStatus, UpdateN8nSessionInput};
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::n8n_sessions as session_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::ipc_auth::require_auth_sync;
use crate::AppState;

use super::types::{normalize_n8n_persona_draft, N8nPersonaOutput};

// -- Per-entity error tracking --------------------------------------------

/// A single entity that failed during import.
#[derive(Debug, Clone, serde::Serialize)]
pub struct EntityError {
    pub entity_type: String, // "trigger", "tool", "connector"
    pub entity_name: String,
    pub error: String,
}

/// Detailed result of the transactional persona import.
#[derive(Debug, Clone, serde::Serialize)]
pub struct ImportResult {
    pub triggers_created: u32,
    pub tools_created: u32,
    pub connectors_needing_setup: Vec<String>,
    pub entity_errors: Vec<EntityError>,
    pub import_transaction_id: Option<String>,
}

// -- Transactional persona import -----------------------------------------

/// Create persona + all entities atomically on a single connection.
///
/// All inserts happen inside a SQLite transaction. If ANY entity fails,
/// the entire transaction is rolled back and no partial persona exists.
/// Per-entity errors are collected and returned so the frontend can display
/// "3 of 5 tools failed: X, Y, Z -- fix and retry".
pub fn create_persona_atomically(
    pool: &DbPool,
    draft: &N8nPersonaOutput,
    session_id: Option<&str>,
) -> Result<(serde_json::Value, ImportResult), AppError> {
    let mut conn = pool.get()?;
    let now = chrono::Utc::now().to_rfc3339();
    let persona_id = uuid::Uuid::new_v4().to_string();
    let tx_id = uuid::Uuid::new_v4().to_string();

    // Record staged import transaction
    conn.execute(
        "INSERT INTO import_transactions (id, session_id, persona_id, status, created_at)
         VALUES (?1, ?2, ?3, 'staged', ?4)",
        params![tx_id, session_id, persona_id, now],
    )?;

    // Begin the real transaction for persona + entities
    let tx = conn.transaction().map_err(AppError::Database)?;

    let mut entity_errors: Vec<EntityError> = Vec::new();

    // -- 1. Insert persona --------------------------------------------

    let persona_name = draft
        .name
        .as_ref()
        .filter(|n| !n.trim().is_empty())
        .cloned()
        .unwrap_or_else(|| "Imported n8n Workflow".into());

    let project_id = "default";
    let enabled = 1i32;
    let max_concurrent = 1i32;
    let timeout_ms = 300_000i32;
    let structured_prompt = draft
        .structured_prompt
        .as_ref()
        .and_then(|v| serde_json::to_string(v).ok());

    // Encrypt notification channel secrets before storing.
    // Never fall back to the original plaintext on failure: this column is
    // read as ciphertext, so persisting plaintext would leak webhook secrets
    // and break decryption on every subsequent read. If encryption fails
    // (e.g. keyring unavailable), surface the error so the transaction rolls
    // back — the user can retry once the keyring is healthy.
    let encrypted_channels = match &draft.notification_channels {
        Some(json) if !json.trim().is_empty() => {
            match persona_repo::encrypt_notification_channels(json) {
                Ok(enc) => Some(enc),
                Err(e) => {
                    // tx is dropped here (auto-rollback of any tx-scoped work so
                    // far); reconcile the staged row so it doesn't linger forever.
                    let err_msg = e.to_string();
                    drop(tx);
                    record_import_tx_status(&mut conn, &tx_id, "rolled_back", None, Some(&err_msg));
                    return Err(e);
                }
            }
        }
        other => other.clone(),
    };

    if let Err(e) = tx.execute(
        // NOTE: `group_id` was removed from this INSERT after the Groups→Teams
        // consolidation (2026-05-24) dropped `personas.group_id`. Leaving the
        // column in the list made EVERY template adoption fail with
        // "table personas has no column named group_id" — workspace membership
        // is now expressed via `home_team_id`, stamped by the team-preset
        // adopter / editor after creation, not at insert time.
        "INSERT INTO personas
         (id, project_id, name, description, system_prompt, structured_prompt,
          icon, color, enabled, max_concurrent, timeout_ms,
          model_profile, max_budget_usd, max_turns, design_context,
          notification_channels, template_category, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?18)",
        params![
            persona_id,
            project_id,
            persona_name,
            draft.description,
            draft.system_prompt,
            structured_prompt,
            draft.icon,
            draft.color,
            enabled,
            max_concurrent,
            timeout_ms,
            draft.model_profile,
            draft.max_budget_usd,
            draft.max_turns,
            draft.design_context,
            encrypted_channels,
            draft.template_category,
            now,
        ],
    ) {
        // Persona insert failure is fatal -- tx is dropped (auto-rollback)
        let err_msg = e.to_string();
        drop(tx);
        record_import_tx_status(&mut conn, &tx_id, "rolled_back", None, Some(&err_msg));
        return Err(AppError::Database(e));
    }

    // -- 2. Insert triggers -------------------------------------------

    let mut triggers_created = 0u32;
    if let Some(ref triggers) = draft.triggers {
        for trigger_draft in triggers {
            // The whole storable vocabulary, from the single source. This was a
            // hand-written 4-member list that silently rewrote everything else
            // — including `event_listener`, `chain` and every ambient kind —
            // into `manual`, i.e. into a trigger that only fires when a human
            // presses Run. An import that quietly turns an automation into a
            // button is worse than one that refuses.
            let normalized = trigger_repo::normalize_trigger_type(&trigger_draft.trigger_type);
            let trigger_type = match personas_core::models::TriggerKind::from_wire(normalized) {
                Some(kind) => kind.as_str().to_string(),
                None => {
                    entity_errors.push(EntityError {
                        entity_type: "trigger".into(),
                        entity_name: trigger_draft.trigger_type.clone(),
                        error: format!(
                            "Unknown trigger type '{}'. Must be one of: {}",
                            trigger_draft.trigger_type,
                            personas_core::validation::trigger::VALID_TRIGGER_TYPES.join(", ")
                        ),
                    });
                    continue;
                }
            };

            // A model-authored draft has no UI to supply a webhook secret, and
            // `engine/webhook.rs` rejects every secretless call with 401 — so
            // an imported/adopted webhook was born dead. Mint one here, the way
            // promote does; the door itself stays strict for the human path.
            let mut config_value = trigger_draft.config.clone();
            if trigger_type == personas_core::models::TriggerKind::Webhook.as_str() {
                crate::commands::design::build_sessions::mint_webhook_secret_if_missing(
                    &mut config_value,
                );
            }
            let input = crate::db::models::CreateTriggerInput {
                persona_id: persona_id.clone(),
                trigger_type: trigger_type.clone(),
                config: config_value
                    .as_ref()
                    .and_then(|c| serde_json::to_string(c).ok()),
                enabled: Some(true),
                use_case_id: trigger_draft.use_case_id.clone(),
            };

            // Through the one write door (validate_all incl. the SSRF guard,
            // secret encryption, arm-or-refuse, the paired Fix-4a
            // auto-listener). This INSERT used to write the draft config
            // verbatim: no validation, plaintext secrets, and no listener until
            // the hourly backfill. A refusal becomes a per-entity error.
            match create_trigger_in_savepoint(&tx, &input) {
                Ok(_) => triggers_created += 1,
                Err(e) => {
                    let name = trigger_draft
                        .use_case_id
                        .as_deref()
                        .unwrap_or(&trigger_type);
                    let error = match e {
                        AppError::Validation(msg) => msg,
                        other => other.to_string(),
                    };
                    tracing::warn!(
                        persona_id = %persona_id,
                        trigger_type = %trigger_type,
                        error = %error,
                        "Transactional import: trigger refused"
                    );
                    entity_errors.push(EntityError {
                        entity_type: "trigger".into(),
                        entity_name: name.to_string(),
                        error,
                    });
                }
            }
        }
    }

    // -- 3. Insert tool definitions + assignments ---------------------

    let mut tools_created = 0u32;
    let mut tool_credential_map: Vec<(String, String)> = Vec::new();

    if let Some(ref tools) = draft.tools {
        // Load existing definitions once (on the same connection)
        let existing_defs: Vec<(String, String)> = tx
            .prepare("SELECT id, name FROM persona_tool_definitions")
            .and_then(|mut stmt| {
                stmt.query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
            })
            .unwrap_or_default();

        for tool_draft in tools {
            let tool_name = tool_draft.name.replace(' ', "_").to_lowercase();

            // Check if a definition already exists
            let tool_def_id = if let Some((id, _)) =
                existing_defs.iter().find(|(_, n)| n == &tool_name)
            {
                id.clone()
            } else {
                // Create new definition
                let new_id = uuid::Uuid::new_v4().to_string();
                let is_builtin = 0i32;
                let input_schema = tool_draft
                    .input_schema
                    .as_ref()
                    .and_then(|s| serde_json::to_string(s).ok());

                match tx.execute(
                    "INSERT INTO persona_tool_definitions
                     (id, name, category, description, script_path,
                      input_schema, output_schema, requires_credential_type,
                      implementation_guide, is_builtin,
                      created_at, updated_at)
                     VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                    params![
                        new_id,
                        tool_name,
                        tool_draft.category,
                        tool_draft.description,
                        "", // script_path
                        input_schema,
                        Option::<String>::None, // output_schema
                        tool_draft.requires_credential_type,
                        tool_draft.implementation_guide,
                        is_builtin,
                        now,
                    ],
                ) {
                    Ok(_) => new_id,
                    Err(e) => {
                        entity_errors.push(EntityError {
                            entity_type: "tool".into(),
                            entity_name: tool_name.clone(),
                            error: format!("Failed to create definition: {e}"),
                        });
                        tracing::warn!(tool_name = %tool_name, error = %e, "Transactional import: tool def insert failed");
                        continue;
                    }
                }
            };

            if let Some(ref cred_type) = tool_draft.requires_credential_type {
                tool_credential_map.push((tool_name.clone(), cred_type.clone()));
            }

            // Assign tool to persona (check existing assignment first)
            let already_assigned: bool = tx
                .query_row(
                    "SELECT COUNT(*) FROM persona_tools WHERE persona_id = ?1 AND tool_id = ?2",
                    params![persona_id, tool_def_id],
                    |row| row.get::<_, i64>(0),
                )
                .map(|c| c > 0)
                .unwrap_or(false);

            if !already_assigned {
                let assignment_id = uuid::Uuid::new_v4().to_string();
                match tx.execute(
                    "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![
                        assignment_id,
                        persona_id,
                        tool_def_id,
                        Option::<String>::None,
                        now
                    ],
                ) {
                    Ok(_) => tools_created += 1,
                    Err(e) => {
                        entity_errors.push(EntityError {
                            entity_type: "tool".into(),
                            entity_name: tool_name.clone(),
                            error: format!("Failed to assign: {e}"),
                        });
                        tracing::warn!(tool_name = %tool_name, error = %e, "Transactional import: tool assign failed");
                    }
                }
            } else {
                tools_created += 1;
            }
        }
    }

    // -- 4. Register connector services (within the same tx) ----------

    if !tool_credential_map.is_empty() {
        register_connector_services_txn(&tx, &tool_credential_map);
    }

    // -- 5. Decide: commit or rollback --------------------------------

    // If ALL entities failed (nothing was created at all beyond the persona),
    // roll back entirely. Otherwise commit with the entity_errors as warnings.
    let total_requested_triggers = draft.triggers.as_ref().map(|t| t.len()).unwrap_or(0);
    let total_requested_tools = draft.tools.as_ref().map(|t| t.len()).unwrap_or(0);
    let total_requested = total_requested_triggers + total_requested_tools;
    let total_created = triggers_created as usize + tools_created as usize;

    if total_requested > 0 && total_created == 0 && !entity_errors.is_empty() {
        // Complete failure -- roll back everything
        let error_summary = format!("All {} entities failed to create", entity_errors.len());
        tx.rollback().map_err(AppError::Database)?;

        record_import_tx_status(
            &mut conn,
            &tx_id,
            "rolled_back",
            Some(&serde_json::to_string(&entity_errors).unwrap_or_default()),
            Some(&error_summary),
        );

        return Err(AppError::Validation(format!(
            "Import rolled back: {}. Errors: {}",
            error_summary,
            entity_errors
                .iter()
                .map(|e| format!("{} '{}': {}", e.entity_type, e.entity_name, e.error))
                .collect::<Vec<_>>()
                .join("; "),
        )));
    }

    // Commit the transaction
    if let Err(e) = tx.commit() {
        // The tx is consumed by a failed commit attempt (no explicit rollback
        // possible), but the staged row must not be left stuck at 'staged'
        // forever -- reconcile it so retry-cleanup logic can see the failure.
        let err_msg = e.to_string();
        record_import_tx_status(&mut conn, &tx_id, "rolled_back", None, Some(&err_msg));
        return Err(AppError::Database(e));
    }

    // Record successful import
    let entity_results_json = serde_json::to_string(&entity_errors).ok();
    let error_summary = if entity_errors.is_empty() {
        None
    } else {
        Some(format!(
            "{} of {} entities failed",
            entity_errors.len(),
            total_requested
        ))
    };
    record_import_tx_status(
        &mut conn,
        &tx_id,
        "committed",
        entity_results_json.as_deref(),
        error_summary.as_deref(),
    );

    // Read back the created persona (now committed, safe to read)
    let persona = persona_repo::get_by_id(pool, &persona_id)?;

    let connectors_needing_setup = collect_connectors_needing_setup(draft);

    let import_result = ImportResult {
        triggers_created,
        tools_created,
        connectors_needing_setup: connectors_needing_setup.clone(),
        entity_errors,
        import_transaction_id: Some(tx_id),
    };

    let response = json!({
        "persona": persona,
        "triggers_created": import_result.triggers_created,
        "tools_created": import_result.tools_created,
        "connectors_needing_setup": import_result.connectors_needing_setup,
        "entity_errors": import_result.entity_errors,
        "import_transaction_id": import_result.import_transaction_id,
    });

    Ok((response, import_result))
}

/// Run the trigger write door under a SAVEPOINT so a refusal (or a failure
/// after the row INSERT, e.g. in the auto-listener) leaves nothing half-written
/// while the rest of the import still commits.
fn create_trigger_in_savepoint(
    tx: &rusqlite::Transaction<'_>,
    input: &crate::db::models::CreateTriggerInput,
) -> Result<String, AppError> {
    tx.execute_batch("SAVEPOINT import_trigger")?;
    match trigger_repo::create_in(tx, input, None) {
        Ok(id) => {
            tx.execute_batch("RELEASE import_trigger")?;
            Ok(id)
        }
        Err(e) => {
            if let Err(rb) = tx.execute_batch("ROLLBACK TO import_trigger; RELEASE import_trigger")
            {
                tracing::warn!(error = %rb, "Transactional import: savepoint rollback failed");
            }
            Err(e)
        }
    }
}

/// Update import_transactions status (outside the main transaction).
fn record_import_tx_status(
    conn: &mut r2d2::PooledConnection<r2d2_sqlite::SqliteConnectionManager>,
    tx_id: &str,
    status: &str,
    entity_results: Option<&str>,
    error_summary: Option<&str>,
) {
    let _ = conn.execute(
        "UPDATE import_transactions SET status = ?1, entity_results = ?2, error_summary = ?3 WHERE id = ?4",
        params![status, entity_results, error_summary, tx_id],
    );
}

/// Register tool -> connector service mappings (within a transaction).
fn register_connector_services_txn(
    conn: &rusqlite::Connection,
    tool_credential_map: &[(String, String)],
) {
    let mut type_to_tools: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for (tool_name, cred_type) in tool_credential_map {
        type_to_tools
            .entry(cred_type.clone())
            .or_default()
            .push(tool_name.clone());
    }

    // Load connectors on the same connection
    let connectors: Vec<(String, String, String)> = conn
        .prepare("SELECT id, name, services FROM connector_definitions")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            })
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        })
        .unwrap_or_default();

    for (cred_type, tool_names) in &type_to_tools {
        // 1. Exact match on connector name == credential type (canonical)
        let matching = connectors
            .iter()
            .find(|(_, name, _)| name == cred_type)
            .or_else(|| {
                // 2. Prefix fallback -- only if exactly one connector matches
                //    to avoid "github" -> "github-enterprise" mislinks.
                let prefix_matches: Vec<_> = connectors
                    .iter()
                    .filter(|(_, name, _)| {
                        name.starts_with(cred_type.as_str()) || cred_type.starts_with(name.as_str())
                    })
                    .collect();
                if prefix_matches.len() == 1 {
                    Some(prefix_matches[0])
                } else {
                    None
                }
            });

        if let Some((connector_id, _, services_json)) = matching {
            let mut services: Vec<serde_json::Value> =
                serde_json::from_str(services_json).unwrap_or_default();

            for tool_name in tool_names {
                let already_listed = services.iter().any(|s| {
                    s.get("toolName")
                        .and_then(|v| v.as_str())
                        .map(|n| n == tool_name.as_str())
                        .unwrap_or(false)
                });
                if !already_listed {
                    services.push(json!({
                        "toolName": tool_name,
                        "source": "import"
                    }));
                }
            }

            if let Ok(updated) = serde_json::to_string(&services) {
                let _ = conn.execute(
                    "UPDATE connector_definitions SET services = ?1, updated_at = ?2 WHERE id = ?3",
                    params![updated, chrono::Utc::now().to_rfc3339(), connector_id],
                );
            }
        }
    }
}

/// Collect connector names that still need credential setup.
fn collect_connectors_needing_setup(draft: &N8nPersonaOutput) -> Vec<String> {
    draft
        .required_connectors
        .as_ref()
        .map(|connectors| {
            connectors
                .iter()
                .filter(|c| !c.has_credential)
                .map(|c| c.name.clone())
                .collect()
        })
        .unwrap_or_default()
}

// -- Tauri command --------------------------------------------------------

#[tauri::command]
pub fn confirm_n8n_persona_draft(
    state: State<'_, Arc<AppState>>,
    draft_json: String,
    session_id: Option<String>,
) -> Result<serde_json::Value, AppError> {
    require_auth_sync(&state)?;
    // Idempotency guard: if the session already produced a persona, check its
    // completeness before blindly returning it. If the persona exists but had a
    // rolled-back import (import_transactions.status = 'rolled_back'), clear the
    // session's persona_id so the retry path can re-create cleanly.
    if let Some(ref sid) = session_id {
        if let Ok(session) = session_repo::get(&state.db, sid) {
            if let Some(ref existing_pid) = session.persona_id {
                // Check if this persona was part of a rolled-back import
                let was_rolled_back = was_import_rolled_back(&state.db, existing_pid);

                if was_rolled_back {
                    // Clear the stale persona_id so we can retry
                    let _ = session_repo::update(
                        &state.db,
                        sid,
                        &UpdateN8nSessionInput {
                            persona_id: Some(None),
                            status: Some(SessionStatus::Transforming),
                            ..Default::default()
                        },
                    );
                    tracing::info!(
                        session_id = %sid,
                        persona_id = %existing_pid,
                        "Cleared rolled-back persona from session for retry"
                    );
                } else if let Ok(existing) = persona_repo::get_by_id(&state.db, existing_pid) {
                    tracing::info!(session_id = %sid, persona_id = %existing_pid, "Returning already-confirmed persona");
                    return Ok(json!({
                        "persona": existing,
                        "triggers_created": 0,
                        "tools_created": 0,
                        "connectors_needing_setup": Vec::<String>::new(),
                        "entity_errors": Vec::<EntityError>::new(),
                    }));
                }
            }
        }
    }

    let draft: N8nPersonaOutput = serde_json::from_str(&draft_json)
        .map_err(|e| AppError::Validation(format!("Invalid draft JSON: {e}")))?;

    let draft = normalize_n8n_persona_draft(draft, "Imported n8n Workflow");

    if draft.system_prompt.trim().is_empty() {
        return Err(AppError::Validation(
            "Draft system_prompt cannot be empty".into(),
        ));
    }

    // Perform atomic import
    let (response, import_result) =
        create_persona_atomically(&state.db, &draft, session_id.as_deref())?;

    // Stamp the persona_id on the session (outside the transaction -- the persona is committed)
    if let Some(ref sid) = session_id {
        if let Some(persona_val) = response.get("persona") {
            if let Some(pid) = persona_val.get("id").and_then(|v| v.as_str()) {
                let _ = session_repo::update(
                    &state.db,
                    sid,
                    &UpdateN8nSessionInput {
                        persona_id: Some(Some(pid.to_string())),
                        status: Some(SessionStatus::Confirmed),
                        ..Default::default()
                    },
                );
            }
        }
    }

    if !import_result.entity_errors.is_empty() {
        tracing::warn!(
            errors = import_result.entity_errors.len(),
            created_triggers = import_result.triggers_created,
            created_tools = import_result.tools_created,
            "Import committed with partial entity failures"
        );
    }

    Ok(response)
}

/// Check if a persona's most recent import was rolled back.
fn was_import_rolled_back(pool: &DbPool, persona_id: &str) -> bool {
    let conn = match pool.get() {
        Ok(c) => c,
        Err(_) => return false,
    };
    conn.query_row(
        "SELECT status FROM import_transactions WHERE persona_id = ?1 ORDER BY created_at DESC LIMIT 1",
        params![persona_id],
        |row| row.get::<_, String>(0),
    )
    .map(|status| status == "rolled_back")
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    //! `create_persona_atomically` is the materializer behind BOTH the n8n
    //! confirm and instant template adoption (and so every team-preset member).
    //! These pin that its trigger rows get the same five rules the repo door
    //! (`trigger_repo::create`) enforces: validate_all incl. the SSRF guard,
    //! secret encryption, arming, the Fix-4a auto-listener, and — because a
    //! model-authored draft has no UI to supply one — a minted webhook secret.
    use super::*;

    fn draft_with_triggers(triggers: serde_json::Value) -> N8nPersonaOutput {
        // Invariant: every omitted field is an `Option`, which serde fills with
        // `None`; `system_prompt` is the only required key.
        serde_json::from_value(serde_json::json!({
            "name": "Import Test",
            "system_prompt": "You are a test persona.",
            "triggers": triggers,
        }))
        .expect("test draft deserializes")
    }

    /// `(id, trigger_type, raw stored config, next_trigger_at)` for every row.
    fn trigger_rows(
        pool: &DbPool,
        persona_id: &str,
    ) -> Result<Vec<(String, String, Option<String>, Option<String>)>, AppError> {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id, trigger_type, config, next_trigger_at FROM persona_triggers
                 WHERE persona_id = ?1 ORDER BY created_at",
        )?;
        let rows = stmt.query_map(params![persona_id], |r| {
            Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
        })?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    fn persona_id_of(response: &serde_json::Value) -> String {
        response["persona"]["id"].as_str().unwrap().to_string()
    }

    #[test]
    fn create_persona_atomically_mints_and_encrypts_a_webhook_secret() {
        let pool = crate::db::init_test_db().unwrap();
        let draft = draft_with_triggers(serde_json::json!([
            {"trigger_type": "webhook", "config": {"event_type": "order.created"}}
        ]));
        let (response, result) = create_persona_atomically(&pool, &draft, None).unwrap();
        assert!(
            result.entity_errors.is_empty(),
            "{:?}",
            result.entity_errors
        );
        let rows = trigger_rows(&pool, &persona_id_of(&response)).unwrap();
        let webhooks: Vec<_> = rows.iter().filter(|r| r.1 == "webhook").collect();
        assert_eq!(webhooks.len(), 1, "exactly one webhook row: {rows:?}");
        let cfg = webhooks[0].2.as_deref().unwrap_or("");
        assert!(
            cfg.contains("webhook_secret_enc"),
            "a secretless webhook is rejected with 401 forever; the import must mint + encrypt one: {cfg}"
        );
    }

    #[test]
    fn create_persona_atomically_encrypts_polling_headers() {
        let pool = crate::db::init_test_db().unwrap();
        // A public IP literal, not a hostname: `validate_polling_url` resolves
        // hostnames and a unit test must not depend on DNS.
        let draft = draft_with_triggers(serde_json::json!([{
            "trigger_type": "polling",
            "config": {
                "url": "https://93.184.216.34/items",
                "interval_seconds": 300,
                "headers": {"Authorization": "Bearer sk-live-123"}
            }
        }]));
        let (response, result) = create_persona_atomically(&pool, &draft, None).unwrap();
        assert!(
            result.entity_errors.is_empty(),
            "{:?}",
            result.entity_errors
        );
        let rows = trigger_rows(&pool, &persona_id_of(&response)).unwrap();
        let polling: Vec<_> = rows.iter().filter(|r| r.1 == "polling").collect();
        assert_eq!(polling.len(), 1, "{rows:?}");
        let cfg = polling[0].2.as_deref().unwrap_or("");
        assert!(
            cfg.contains("headers_enc"),
            "headers must be encrypted: {cfg}"
        );
        assert!(
            !cfg.contains("sk-live-123"),
            "plaintext bearer token stored: {cfg}"
        );
    }

    #[test]
    fn create_persona_atomically_refuses_a_link_local_polling_url() {
        let pool = crate::db::init_test_db().unwrap();
        // A second, valid trigger keeps the import from rolling back whole, so
        // the refusal is observable as a per-entity error.
        let draft = draft_with_triggers(serde_json::json!([
            {
                "trigger_type": "polling",
                "config": {"url": "http://169.254.169.254/latest/meta-data", "interval_seconds": 300}
            },
            {"trigger_type": "manual"}
        ]));
        let (response, result) = create_persona_atomically(&pool, &draft, None).unwrap();
        let rows = trigger_rows(&pool, &persona_id_of(&response)).unwrap();
        assert_eq!(
            rows.iter().filter(|r| r.1 == "polling").count(),
            0,
            "SSRF target must not be stored: {rows:?}"
        );
        let first = result
            .entity_errors
            .first()
            .expect("an entity error for the refused trigger");
        assert_eq!(first.entity_type, "trigger");
        assert!(
            first.error.contains("Polling URL blocked"),
            "error names the SSRF refusal: {}",
            first.error
        );
    }

    #[test]
    fn create_persona_atomically_pairs_a_schedule_with_its_auto_listener() {
        let pool = crate::db::init_test_db().unwrap();
        let draft = draft_with_triggers(serde_json::json!([
            {"trigger_type": "schedule", "config": {"cron": "0 9 * * *"}}
        ]));
        let (response, result) = create_persona_atomically(&pool, &draft, None).unwrap();
        assert!(
            result.entity_errors.is_empty(),
            "{:?}",
            result.entity_errors
        );
        assert_eq!(
            result.triggers_created, 1,
            "the auto-listener is not a requested entity"
        );
        let rows = trigger_rows(&pool, &persona_id_of(&response)).unwrap();
        assert_eq!(rows.len(), 2, "schedule + its paired listener: {rows:?}");
        let schedule = rows
            .iter()
            .find(|r| r.1 == "schedule")
            .expect("schedule row");
        assert!(schedule.3.is_some(), "schedule must be armed at insert");
        let listener = rows
            .iter()
            .find(|r| r.1 == "event_listener")
            .expect("paired auto-listener row");
        let cfg: serde_json::Value = serde_json::from_str(listener.2.as_deref().unwrap()).unwrap();
        assert_eq!(cfg["_auto_for_trigger"].as_str(), Some(schedule.0.as_str()));
    }
}
