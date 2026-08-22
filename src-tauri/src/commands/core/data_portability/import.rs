//! The import transaction and its row-level primitives.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// `resolutions` is the flat conflict-resolution map keyed `"<kind>:<id>"`
/// (see [`ImportConflict`]). `user_db` is the separate user database that
/// hosts knowledge bases; `None` (unit tests, or a caller without one) simply
/// means a bundled KB is reported as un-importable rather than silently lost.
pub(crate) fn import_bundle(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    bundle: &PortabilityBundle,
    resolutions: &HashMap<String, String>,
) -> Result<PortabilityImportResult, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;

    let mut result = PortabilityImportResult {
        personas_created: 0,
        teams_created: 0,
        tools_created: 0,
        credentials_created: 0,
        team_memories_created: 0,
        kpis_created: 0,
        projects_imported: 0,
        projects_skipped: 0,
        knowledge_imported: 0,
        knowledge_skipped_duplicates: 0,
        skills_written: 0,
        skills_deferred: 0,
        twins_imported: 0,
        twins_skipped: 0,
        twin_kb_chunks_imported: 0,
        athena_memory_imported: 0,
        athena_identity_replaced: false,
        reembed_queued: 0,
        import_conflicts: Vec::new(),
        bundle_file_path: None,
        warnings: Vec::new(),
        id_mapping: std::collections::HashMap::new(),
        pending_kb_reindex: Vec::new(),
    };

    let now = chrono::Utc::now().to_rfc3339();

    // A non-empty resolutions map marks the second (resolution) pass of the
    // two-pass conflict flow: the non-conflicting sections were already
    // imported on pass 1, so only the resolved entities (plus their adoption
    // cells / skills) are processed. The workspace-knowledge phase still runs
    // — its id/dedup checks make it idempotent — so the knowledge id map is
    // available for adoption cells of the newly resolved projects.
    let is_resolution_pass = !resolutions.is_empty();

    // Phase 2: Import tool definitions (map old IDs to new IDs, skip builtins)
    if !is_resolution_pass {
        for t in &bundle.tool_definitions {
            if t.is_builtin {
                // Builtin tools already exist -- try to find matching by name
                let found = tx
                    .query_row(
                        "SELECT id FROM persona_tool_definitions WHERE name = ?1 LIMIT 1",
                        rusqlite::params![t.name],
                        |row| row.get::<_, String>(0),
                    )
                    .ok();
                if let Some(existing_id) = found {
                    result.id_mapping.insert(t.id.clone(), existing_id);
                    continue;
                }
            }

            let id = uuid::Uuid::new_v4().to_string();
            let is_builtin_i = if t.is_builtin { 1i32 } else { 0i32 };
            match tx.execute(
                "INSERT INTO persona_tool_definitions
             (id, name, category, description, script_path,
              input_schema, output_schema, requires_credential_type,
              implementation_guide, is_builtin, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
                rusqlite::params![
                    id,
                    t.name,
                    t.category,
                    t.description,
                    "",
                    t.input_schema,
                    Option::<String>::None,
                    t.requires_credential_type,
                    t.implementation_guide,
                    is_builtin_i,
                    now,
                ],
            ) {
                Ok(_) => {
                    result.id_mapping.insert(t.id.clone(), id);
                    result.tools_created += 1;
                }
                Err(e) => result.warnings.push(format!("Tool '{}': {}", t.name, e)),
            }
        }

        // Phase 3: Import credential metadata (no secrets — user must re-enter via Credential Vault)
        for c in &bundle.credentials {
            let imported_name = format!("{} (imported)", c.name);
            // Skip if a credential shell for this import already exists. Check
            // against the name actually stored below (the "(imported)"-suffixed
            // one) — checking the raw export name here would never match what
            // gets inserted, letting re-imports pile up duplicate shells.
            let exists = tx
            .query_row(
                "SELECT COUNT(*) FROM persona_credentials WHERE name = ?1 AND service_type = ?2",
                rusqlite::params![imported_name, c.service_type],
                |row| row.get::<_, i32>(0),
            )
            .unwrap_or(0)
            > 0;
            if exists {
                continue;
            }

            let id = uuid::Uuid::new_v4().to_string();
            // Create credential shell with empty encrypted data — secrets must be added separately
            let empty_encrypted =
                crypto::encrypt_for_db("{}").map_err(|e| AppError::Internal(e.to_string()))?;
            match tx.execute(
                "INSERT INTO persona_credentials
             (id, name, service_type, encrypted_data, iv, metadata, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?7)",
                rusqlite::params![
                    id,
                    imported_name,
                    c.service_type,
                    empty_encrypted.0,
                    empty_encrypted.1,
                    c.metadata,
                    now,
                ],
            ) {
                Ok(_) => result.credentials_created += 1,
                Err(e) => result
                    .warnings
                    .push(format!("Credential '{}': {}", c.name, e)),
            }
        }

        // Phase 4: Import personas (map old IDs to new)
        for p in &bundle.personas {
            let new_id = uuid::Uuid::new_v4().to_string();
            let persona_name = format!("{} (imported)", p.name);
            let enabled_i = 0i32; // imported personas start disabled
            let max_concurrent = p.max_concurrent;
            let timeout_ms = p.timeout_ms;

            // Encrypt notification channel secrets before storing.
            // Never fall back to the original plaintext on failure: downstream
            // reads treat this column as ciphertext, so persisting plaintext
            // would leak webhook secrets / Slack tokens / SMTP passwords on disk
            // and break decryption on every subsequent read. If the keyring is
            // unavailable, skip this persona and surface a warning so the user
            // can re-import once it's healthy.
            let encrypted_channels = match &p.notification_channels {
                Some(json) if !json.trim().is_empty() => {
                    match persona_repo::encrypt_notification_channels(json) {
                        Ok(enc) => Some(enc),
                        Err(e) => {
                            result.warnings.push(format!(
                            "Persona '{}': skipped — failed to encrypt notification channels ({}). Re-import once the keyring is available.",
                            p.name, e
                        ));
                            continue;
                        }
                    }
                }
                other => other.clone(),
            };

            match tx.execute(
                "INSERT INTO personas
             (id, project_id, name, description, system_prompt, structured_prompt,
              icon, color, enabled, sensitive, max_concurrent, timeout_ms,
              model_profile, max_budget_usd, max_turns, design_context,
              notification_channels, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,0,?10,?11,?12,?13,?14,?15,?16,?17,?17)",
                rusqlite::params![
                    new_id,
                    "default",
                    persona_name,
                    p.description,
                    p.system_prompt,
                    p.structured_prompt,
                    p.icon,
                    p.color,
                    enabled_i,
                    max_concurrent,
                    timeout_ms,
                    p.model_profile,
                    p.max_budget_usd,
                    p.max_turns,
                    p.design_context,
                    encrypted_channels,
                    now,
                ],
            ) {
                Ok(_) => {
                    result.id_mapping.insert(p.id.clone(), new_id.clone());
                    result.personas_created += 1;

                    // Sub-entities: triggers
                    for t in &p.triggers {
                        let tid = uuid::Uuid::new_v4().to_string();
                        let enabled_i = if t.enabled { 1i32 } else { 0i32 };
                        // Arm time-based triggers on import, and write `status`
                        // explicitly. This INSERT named neither, so (a) an imported
                        // schedule was written `next_trigger_at` NULL and could
                        // never become due, and (b) an imported DISABLED trigger got
                        // `status` from the column default 'active' — off in the UI
                        // and on to both dispatch predicates.
                        let parsed_cfg = crate::db::models::TriggerConfig::from_raw(
                            &t.trigger_type,
                            t.config.as_deref(),
                        );
                        let next_trigger_at = personas_core::scheduler::compute_next_from_config(
                            &parsed_cfg,
                            chrono::Utc::now(),
                            personas_core::cron::seed_hash(&tid),
                        );
                        if next_trigger_at.is_none()
                            && personas_core::models::TriggerKind::from_wire(&t.trigger_type)
                                .is_some_and(|k| k.is_time_based())
                        {
                            result.warnings.push(format!(
                                "Persona '{}' trigger ({}): {}",
                                p.name,
                                t.trigger_type,
                                personas_core::validation::trigger::unschedulable_error(
                                    &t.trigger_type,
                                    t.config.as_deref(),
                                )
                                .message
                            ));
                            continue;
                        }
                        if let Err(e) = tx.execute(
                        "INSERT INTO persona_triggers
                         (id, persona_id, trigger_type, config, enabled, status, use_case_id, next_trigger_at, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                        rusqlite::params![
                            tid, new_id, t.trigger_type, t.config, enabled_i,
                            if t.enabled { "active" } else { "disabled" },
                            t.use_case_id, next_trigger_at, now
                        ],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' trigger ({}): {}",
                            p.name, t.trigger_type, e
                        ));
                    }
                    }

                    // Sub-entities: subscriptions
                    for s in &p.subscriptions {
                        let sid = uuid::Uuid::new_v4().to_string();
                        let enabled_i = if s.enabled { 1i32 } else { 0i32 };
                        if let Err(e) = tx.execute(
                        "INSERT OR IGNORE INTO persona_event_subscriptions
                         (id, persona_id, event_type, source_filter, enabled, use_case_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
                        rusqlite::params![sid, new_id, s.event_type, s.source_filter, enabled_i, s.use_case_id, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' subscription ({}): {}",
                            p.name, s.event_type, e
                        ));
                    }
                    }

                    // Sub-entities: memories
                    for m in &p.memories {
                        let mid = uuid::Uuid::new_v4().to_string();
                        let category = m.category.as_str();
                        let importance = m.importance;
                        if let Err(e) = tx.execute(
                        "INSERT INTO persona_memories
                         (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
                        rusqlite::params![mid, new_id, m.title, m.content, category, Option::<String>::None, importance, m.tags, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' memory ({}): {}",
                            p.name, m.title, e
                        ));
                    }
                    }

                    // Sub-entities: tool assignments
                    for old_tool_id in &p.tool_ids {
                        if let Some(new_tool_id) = result.id_mapping.get(old_tool_id) {
                            let aid = uuid::Uuid::new_v4().to_string();
                            if let Err(e) = tx.execute(
                            "INSERT INTO persona_tools (id, persona_id, tool_id, tool_config, created_at)
                             VALUES (?1, ?2, ?3, ?4, ?5)",
                            rusqlite::params![aid, new_id, new_tool_id, Option::<String>::None, now],
                        ) {
                            result.warnings.push(format!(
                                "Persona '{}' tool assignment: {}",
                                p.name, e
                            ));
                        }
                        }
                    }

                    // Sub-entities: test suites
                    for s in &p.test_suites {
                        let sid = uuid::Uuid::new_v4().to_string();
                        if let Err(e) = tx.execute(
                        "INSERT INTO test_suites (id, persona_id, name, description, scenarios, scenario_count, source_run_id, created_at, updated_at)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                        rusqlite::params![sid, new_id, s.name, s.description, s.scenarios, s.scenario_count, Option::<String>::None, now],
                    ) {
                        result.warnings.push(format!(
                            "Persona '{}' test suite ({}): {}",
                            p.name, s.name, e
                        ));
                    }
                    }
                }
                Err(e) => result.warnings.push(format!("Persona '{}': {}", p.name, e)),
            }
        }

        // Phase 5: Import teams (remap member persona IDs)
        for t in &bundle.teams {
            let new_team_id = uuid::Uuid::new_v4().to_string();
            let team_name = format!("{} (imported)", t.name);
            let enabled_i = 0i32; // imported teams start disabled

            match tx.execute(
            "INSERT INTO persona_teams
             (id, project_id, parent_team_id, name, description, canvas_data, team_config, icon, color, enabled, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            rusqlite::params![
                new_team_id,
                Option::<String>::None,
                Option::<String>::None,
                team_name,
                t.description,
                t.canvas_data,
                t.team_config,
                t.icon,
                "#6B7280",
                enabled_i,
                now,
            ],
        ) {
            Ok(_) => {
                result.id_mapping.insert(t.id.clone(), new_team_id.clone());
                result.teams_created += 1;

                // member old ID -> new member ID mapping for connections
                let mut member_id_map: std::collections::HashMap<String, String> =
                    std::collections::HashMap::new();

                for m in &t.members {
                    // No entry in `id_mapping` means the persona was never
                    // created in this import — either it wasn't in the
                    // bundle, or Phase 4 skipped it (e.g. keyring
                    // unavailable while encrypting notification channels).
                    // Falling back to the raw exported persona_id would
                    // insert a member row pointing at an id that exists
                    // nowhere in the new DB. Skip it and say so instead.
                    let Some(new_persona_id) = result.id_mapping.get(&m.persona_id).cloned()
                    else {
                        result.warnings.push(format!(
                            "Team '{}' member skipped: persona '{}' was not imported",
                            t.name, m.persona_id
                        ));
                        continue;
                    };

                    let mid = uuid::Uuid::new_v4().to_string();
                    let role = m.role.as_deref().unwrap_or("worker");
                    let px = m.position_x.unwrap_or(0.0);
                    let py = m.position_y.unwrap_or(0.0);

                    match tx.execute(
                        "INSERT INTO persona_team_members (id, team_id, persona_id, role, position_x, position_y, config, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![mid, new_team_id, new_persona_id, role, px, py, m.config, now],
                    ) {
                        Ok(_) => {
                            member_id_map
                                .insert(m.persona_id.clone(), mid);
                        }
                        Err(e) => result.warnings.push(format!(
                            "Team '{}' member: {}",
                            t.name, e
                        )),
                    }
                }

                for c in &t.connections {
                    let source_id = member_id_map
                        .get(&c.source_persona_id)
                        .cloned()
                        .unwrap_or_else(|| c.source_persona_id.clone());
                    let target_id = member_id_map
                        .get(&c.target_persona_id)
                        .cloned()
                        .unwrap_or_else(|| c.target_persona_id.clone());

                    let cid = uuid::Uuid::new_v4().to_string();
                    let conn_type = c.connection_type.as_deref().unwrap_or("sequential");

                    if let Err(e) = tx.execute(
                        "INSERT INTO persona_team_connections
                         (id, team_id, source_member_id, target_member_id, connection_type, condition, label, created_at)
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![cid, new_team_id, source_id, target_id, conn_type, c.condition, c.label, now],
                    ) {
                        result.warnings.push(format!(
                            "Team '{}' connection: {}",
                            t.name, e
                        ));
                    }
                }

                // Sub-entities: team memories. Run-specific provenance
                // (run_id / member_id / persona_id) does not survive the
                // bundle — those rows aren't exported — so import them as
                // manually-curated memories with null provenance. Importance
                // is clamped to the 1–10 range the repo enforces on create.
                for m in &t.memories {
                    let mid = uuid::Uuid::new_v4().to_string();
                    let importance = m.importance.clamp(1, 10);
                    if let Err(e) = tx.execute(
                        "INSERT INTO team_memories
                         (id, team_id, run_id, member_id, persona_id, title, content, category, importance, tags, created_at, updated_at)
                         VALUES (?1, ?2, NULL, NULL, NULL, ?3, ?4, ?5, ?6, ?7, ?8, ?8)",
                        rusqlite::params![mid, new_team_id, m.title, m.content, m.category, importance, m.tags, now],
                    ) {
                        result.warnings.push(format!(
                            "Team '{}' memory ({}): {}",
                            t.name, m.title, e
                        ));
                    } else {
                        result.team_memories_created += 1;
                    }
                }
            }
            Err(e) => result
                .warnings
                .push(format!("Team '{}': {}", t.name, e)),
        }
        }

        // Phase 6: Import KPI setup. KPIs are project-scoped and FK-bound to
        // dev_projects, but neither projects nor a team's project survive the bundle.
        // So imported KPIs land in a single, deduped, dormant "Imported" project —
        // grouped, paused, and reviewable — instead of polluting a real project. The
        // measure config is tied to the source environment, so a `paused` status keeps
        // them out of autonomous measurement/derivation until the user reconfigures.
        if !bundle.kpis.is_empty() {
            let imported_project_id: Option<String> = match tx
                .query_row(
                    "SELECT id FROM dev_projects WHERE name = 'Imported' LIMIT 1",
                    [],
                    |row| row.get::<_, String>(0),
                )
                .ok()
            {
                Some(id) => Some(id),
                None => {
                    let pid = uuid::Uuid::new_v4().to_string();
                    match tx.execute(
                    "INSERT INTO dev_projects (id, name, root_path, description, status, created_at, updated_at)
                     VALUES (?1, 'Imported', ?2, ?3, 'active', ?4, ?4)",
                    rusqlite::params![
                        pid,
                        format!("imported://{pid}"),
                        "Holds KPI setup brought in by workspace import. Review and reassign as needed.",
                        now,
                    ],
                ) {
                    Ok(_) => Some(pid),
                    Err(e) => {
                        result
                            .warnings
                            .push(format!("Could not create 'Imported' project for KPIs: {e}"));
                        None
                    }
                }
                }
            };

            if let Some(project_id) = imported_project_id {
                for k in bundle.kpis.iter().take(MAX_KPIS) {
                    // Dedup by (project, name) so re-imports don't duplicate.
                    let exists = tx
                        .query_row(
                            "SELECT COUNT(*) FROM dev_kpis WHERE project_id = ?1 AND name = ?2",
                            rusqlite::params![project_id, k.name],
                            |row| row.get::<_, i32>(0),
                        )
                        .unwrap_or(0)
                        > 0;
                    if exists {
                        continue;
                    }

                    let kpi_id = uuid::Uuid::new_v4().to_string();
                    // Measurements are exported newest-first; the head seeds current state.
                    let latest = k.measurements.first();
                    let current_value = latest.map(|m| m.value);
                    let last_measured_at = latest.map(|m| m.measured_at.clone());

                    // Base insert mirrors create_kpi's proven column set; always paused.
                    match tx.execute(
                    "INSERT INTO dev_kpis (id, project_id, context_group_id, name, description,
                        category, measure_kind, measure_config, unit, direction,
                        baseline_value, target_value, target_date, cadence, status,
                        created_by, rationale, needed_connector, metric_type, context_id)
                     VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,'paused','user',?14,?15,?16,NULL)",
                    rusqlite::params![
                        kpi_id, project_id, k.name, k.description, k.category, k.measure_kind,
                        k.measure_config, k.unit, k.direction, k.baseline_value, k.target_value,
                        k.target_date, k.cadence, k.rationale, k.needed_connector, k.metric_type,
                    ],
                ) {
                    Ok(_) => {
                        result.kpis_created += 1;

                        // Preserve tier + calibration lines + seed last-known value.
                        // These columns exist on the current schema; degrade quietly
                        // (the KPI is already imported) if an older DB lacks them.
                        let _ = tx.execute(
                            "UPDATE dev_kpis SET tier = ?1, warn_at = ?2, crit_at = ?3,
                                current_value = ?4, last_measured_at = ?5,
                                updated_at = datetime('now')
                             WHERE id = ?6",
                            rusqlite::params![
                                k.tier, k.warn_at, k.crit_at, current_value, last_measured_at, kpi_id,
                            ],
                        );

                        for m in k.measurements.iter().take(MAX_KPI_MEASUREMENTS) {
                            let mid = uuid::Uuid::new_v4().to_string();
                            // Clamp to the CHECK-constrained source set.
                            let source = match m.source.as_str() {
                                "evaluator" | "manual" | "scan" | "health_snapshot" => {
                                    m.source.as_str()
                                }
                                _ => "manual",
                            };
                            let _ = tx.execute(
                                "INSERT INTO dev_kpi_measurements
                                 (id, kpi_id, value, measured_at, source, evidence, note)
                                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                                rusqlite::params![
                                    mid, kpi_id, m.value, m.measured_at, source, m.evidence, m.note,
                                ],
                            );
                        }
                    }
                    Err(e) => result.warnings.push(format!("KPI '{}': {}", k.name, e)),
                }
                }
            }
        }
    } // end !is_resolution_pass (phases 2–6 run on pass 1 only)

    // Phase 7: Workspaces + knowledge libraries. Runs on both passes — the
    // id / dedup checks make it idempotent, and the resolution pass needs the
    // knowledge id map for adoption cells of the newly resolved projects.
    let mut workspace_id_map: HashMap<String, String> = HashMap::new();
    let mut knowledge_id_map: HashMap<String, String> = HashMap::new();
    import_workspace_knowledge(
        &tx,
        bundle,
        &now,
        &mut result,
        &mut workspace_id_map,
        &mut knowledge_id_map,
    );

    // Phase 8: Dev projects (two-pass conflict flow). `project_id_map` maps
    // bundle project id → the id the project landed under in THIS database
    // (original for fresh imports, existing for replace, fresh uuid for
    // duplicate). Skills are written to disk only after the tx commits.
    let mut project_id_map: HashMap<String, String> = HashMap::new();
    let mut pending_skills: Vec<(String, bool, usize)> = Vec::new(); // (root_path, overwrite, bundle index)
    for (idx, p) in bundle.dev_projects.iter().enumerate() {
        let resolution = resolutions
            .get(&conflict_key("project", &p.id))
            .map(String::as_str);
        if is_resolution_pass && resolution.is_none() {
            // Pass 2 touches only the projects the caller resolved; everything
            // else was handled (imported or conflict-listed) on pass 1.
            continue;
        }

        let conflict = find_project_conflict(&tx, p);
        let mode = match (&conflict, resolution) {
            (Some((existing_id, matched_by)), None) => {
                result.import_conflicts.push(ImportConflict {
                    kind: "project".into(),
                    bundle_id: p.id.clone(),
                    name: p.name.clone(),
                    detail: Some(p.root_path.clone()),
                    existing_id: existing_id.clone(),
                    matched_by: (*matched_by).to_string(),
                });
                continue;
            }
            (Some(_), Some("skip")) => {
                result.projects_skipped += 1;
                continue;
            }
            (Some((existing_id, _)), Some("replace")) => ProjectImportMode::Replace {
                existing_id: existing_id.clone(),
            },
            (Some(_), Some("duplicate")) => ProjectImportMode::Duplicate,
            // No conflict: import with original uuids. This also covers a
            // resolution whose conflict vanished between the two passes.
            (None, _) => ProjectImportMode::Fresh,
            (Some(_), Some(other)) => {
                result.warnings.push(format!(
                    "Project '{}': unknown resolution '{}'; not imported",
                    p.name, other
                ));
                continue;
            }
        };

        // team_id / workspace_id: remap through this bundle's imports when
        // possible, keep when the id already exists here, else NULL + warning.
        let team_id = resolve_soft_row_ref(
            &tx,
            &result.id_mapping,
            &p.team_id,
            "persona_teams",
            &mut result.warnings,
            &format!(
                "Project '{}': team not found in this workspace; cleared",
                p.name
            ),
        );
        let workspace_id = resolve_soft_row_ref(
            &tx,
            &workspace_id_map,
            &p.workspace_id,
            "dev_workspaces",
            &mut result.warnings,
            &format!("Project '{}': workspace not found here; cleared", p.name),
        );

        match import_dev_project_graph(
            &tx,
            p,
            &mode,
            team_id,
            workspace_id,
            &now,
            &mut result.warnings,
        ) {
            Some((target_id, final_root_path)) => {
                result.projects_imported += 1;
                project_id_map.insert(p.id.clone(), target_id);
                if !std::path::Path::new(&final_root_path).is_dir() {
                    result.warnings.push(format!(
                        "Project '{}': folder '{}' not found on this machine; edit it in Project Manager",
                        p.name, final_root_path
                    ));
                }
                pending_skills.push((
                    final_root_path,
                    matches!(mode, ProjectImportMode::Replace { .. }),
                    idx,
                ));
            }
            None => { /* row-level failure already surfaced as a warning */ }
        }
    }

    // Phase 9: Adoption cells — only when BOTH the practice and the project
    // exist post-import (INSERT OR IGNORE on the (practice, project) PK).
    for ws in &bundle.workspace_knowledge {
        for a in &ws.adoption {
            let Some(practice_id) = knowledge_id_map.get(&a.practice_id) else {
                continue;
            };
            let project_id = match project_id_map.get(&a.project_id) {
                Some(id) => Some(id.clone()),
                None => {
                    // Non-conflicting projects keep their original uuids, so a
                    // pass-2 run (or a re-import) can still resolve them by id.
                    if row_exists(
                        &tx,
                        "SELECT 1 FROM dev_projects WHERE id = ?1",
                        &a.project_id,
                    ) {
                        Some(a.project_id.clone())
                    } else {
                        None
                    }
                }
            };
            let Some(project_id) = project_id else {
                continue;
            };
            if let Err(e) = tx.execute(
                "INSERT OR IGNORE INTO workspace_practice_adoption
                 (practice_id, project_id, state, fleet_key, note, last_verified_at, updated_at)
                 VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6)",
                rusqlite::params![
                    practice_id,
                    project_id,
                    a.state,
                    a.note,
                    a.last_verified_at,
                    now
                ],
            ) {
                result
                    .warnings
                    .push(format!("Adoption cell ({practice_id} → {project_id}): {e}"));
            }
        }
    }

    // Phase 10: Twins. Same two-pass conflict flow as dev projects, keyed
    // `"twin:<bundle id>"`. Everything lands under FRESH uuids (a twin id has
    // no external meaning), so the whole soft-ref graph is remapped. A twin's
    // knowledge base is NOT written here: it lives in the other database, so
    // it is queued and created after this transaction commits.
    let mut pending_twin_kbs: Vec<(String, usize)> = Vec::new(); // (target twin id, bundle index)
    for (idx, tw) in bundle.twins.iter().enumerate() {
        let resolution = resolutions
            .get(&conflict_key("twin", &tw.id))
            .map(String::as_str);
        if is_resolution_pass && resolution.is_none() {
            continue;
        }

        let conflict = find_twin_conflict(&tx, tw);
        let mode = match (&conflict, resolution) {
            (Some(existing_id), None) => {
                result.import_conflicts.push(ImportConflict {
                    kind: "twin".into(),
                    bundle_id: tw.id.clone(),
                    name: tw.name.clone(),
                    detail: None,
                    existing_id: existing_id.clone(),
                    matched_by: "name".into(),
                });
                continue;
            }
            (Some(_), Some("skip")) => {
                result.twins_skipped += 1;
                continue;
            }
            (Some(existing_id), Some("replace")) => TwinImportMode::Replace {
                existing_id: existing_id.clone(),
            },
            (Some(_), Some("duplicate")) => TwinImportMode::Duplicate,
            (None, _) => TwinImportMode::Fresh,
            (Some(_), Some(other)) => {
                result.warnings.push(format!(
                    "Twin '{}': unknown resolution '{}'; not imported",
                    tw.name, other
                ));
                continue;
            }
        };

        match import_twin(&tx, tw, &mode, &now, &mut result) {
            Some(target_id) => {
                result.twins_imported += 1;
                if tw.knowledge_base.is_some() {
                    pending_twin_kbs.push((target_id, idx));
                }
            }
            None => { /* row-level failure already surfaced as a warning */ }
        }
    }

    // Commit the transaction -- all entities are persisted atomically.
    // If anything above returned a hard error (not a warning), we would
    // have already returned Err and the transaction would roll back on drop.
    tx.commit().map_err(AppError::Database)?;

    // Phase 11 (post-commit, filesystem): write imported skills under each
    // project's `<root_path>/.claude/skills/`. Deliberately after the commit —
    // disk must never change for a rolled-back import.
    for (root_path, overwrite, idx) in pending_skills {
        write_project_skills(
            &root_path,
            &bundle.dev_projects[idx].skills,
            overwrite,
            &mut result,
        );
    }

    // Phase 12 (post-commit, other database): recreate each imported twin's
    // knowledge base in the USER database and rebind the profile to it. Same
    // reasoning as the skills phase — a rolled-back import must not leave
    // orphan rows in a store the transaction above could not cover.
    for (twin_id, idx) in pending_twin_kbs {
        let tw = &bundle.twins[idx];
        let Some(kb) = tw.knowledge_base.as_ref() else {
            continue;
        };
        let Some(udb) = user_db else {
            result.warnings.push(format!(
                "Twin '{}': knowledge base '{}' not imported (the vector database is not available in this context).",
                tw.name, kb.name
            ));
            continue;
        };
        match import_twin_knowledge_base(pool, udb, &twin_id, kb, &now) {
            Ok(landed) => {
                result.twin_kb_chunks_imported += landed.chunks_imported;
                result.pending_kb_reindex.push(landed.kb_id);
                // A "replace" onto a twin that already had a KB rebinds it to
                // the incoming one. Say so, and name the old id: an orphaned
                // vector store can be gigabytes, and silently leaking it is
                // worse than asking the user to delete it in Connections.
                if let Some(old) = landed.replaced_kb_id {
                    result.warnings.push(format!(
                        "Twin '{}': was bound to knowledge base '{old}', now bound to the imported one. The old base is still in Connections — delete it there if you no longer need it.",
                        tw.name
                    ));
                }
            }
            Err(e) => result.warnings.push(format!(
                "Twin '{}': knowledge base '{}' could not be imported ({e}); the twin was imported without it.",
                tw.name, kb.name
            )),
        }
    }

    // Phase 13 (post-commit, other database + filesystem): Athena's memory.
    //
    // There is exactly one Athena, so this is a MERGE, not a conflict list —
    // asking a user to resolve four hundred individual facts would be a worse
    // product than any merge rule. Everything about it lands outside the
    // transaction above: the brain tables live in the user database and the
    // memories themselves are markdown files, neither of which the app-DB
    // transaction covers. Same reasoning as the skills and knowledge-base
    // phases; the ordering rule is the same too, so a rolled-back import can
    // never leave a file or a foreign-database row behind.
    if !is_resolution_pass {
        if let Some(athena) = bundle.athena.as_ref() {
            import_athena_memory(pool, user_db, athena, &now, &mut result);
        }
    }

    // The bundle records what the EXPORT dropped. Replay it here — the person
    // receiving the bundle is the one who needs to know it is incomplete, and
    // the export commands themselves have no channel back to a UI. Pass 1 only,
    // so a two-pass conflict resolution does not list them twice.
    if !is_resolution_pass {
        for w in &bundle.export_warnings {
            result.warnings.push(format!("Export note — {w}"));
        }
    }

    Ok(result)
}

pub(crate) fn row_exists(tx: &rusqlite::Transaction<'_>, sql: &str, id: &str) -> bool {
    tx.query_row(sql, [id], |_| Ok(())).is_ok()
}

/// Warn-and-continue insert helper — the established per-row failure idiom.
pub(crate) fn exec_row(
    tx: &rusqlite::Transaction<'_>,
    sql: &str,
    params: &[&dyn rusqlite::ToSql],
    label: &str,
    warnings: &mut Vec<String>,
) -> bool {
    match tx.execute(sql, params) {
        Ok(_) => true,
        Err(e) => {
            warnings.push(format!("{label}: {e}"));
            false
        }
    }
}

/// Resolve an exported `team_id` / `workspace_id` style soft ref: remap when
/// the referenced row was imported in this bundle, keep when the id already
/// exists in `table`, otherwise NULL + warning.
pub(crate) fn resolve_soft_row_ref(
    tx: &rusqlite::Transaction<'_>,
    imported_map: &HashMap<String, String>,
    value: &Option<String>,
    table: &str,
    warnings: &mut Vec<String>,
    warn_msg: &str,
) -> Option<String> {
    let id = value.as_deref()?;
    if let Some(mapped) = imported_map.get(id) {
        return Some(mapped.clone());
    }
    let sql = format!("SELECT 1 FROM {table} WHERE id = ?1");
    if row_exists(tx, &sql, id) {
        return Some(id.to_string());
    }
    warnings.push(warn_msg.to_string());
    None
}

/// A bundled project conflicts when the target holds a project with the same
/// `root_path` (primary — the column is UNIQUE) or, failing that, the same
/// name compared case-insensitively.
pub(crate) fn find_project_conflict(
    tx: &rusqlite::Transaction<'_>,
    p: &DevProjectExport,
) -> Option<(String, &'static str)> {
    if let Ok(id) = tx.query_row(
        "SELECT id FROM dev_projects WHERE root_path = ?1",
        [p.root_path.as_str()],
        |r| r.get::<_, String>(0),
    ) {
        return Some((id, "root_path"));
    }
    if let Ok(id) = tx.query_row(
        "SELECT id FROM dev_projects WHERE name = ?1 COLLATE NOCASE",
        [p.name.as_str()],
        |r| r.get::<_, String>(0),
    ) {
        return Some((id, "name"));
    }
    None
}

/// Required internal ref remap (columns that always point inside the bundled
/// graph). Falls back to the original id when unmapped — the insert's own
/// FK/warning path reports anything genuinely broken.
pub(crate) fn remap_req(map: &HashMap<String, String>, id: &str) -> String {
    map.get(id).cloned().unwrap_or_else(|| id.to_string())
}

/// Optional soft-ref remap. In `strict` (duplicate) mode an unmappable ref is
/// cleared to NULL with a warning — keeping the original would point the fresh
/// copy at another project's rows. In identity modes the original is kept.
pub(crate) fn remap_soft(
    map: &HashMap<String, String>,
    v: &Option<String>,
    strict: bool,
    warnings: &mut Vec<String>,
    ctx: &str,
) -> Option<String> {
    match v.as_deref() {
        None => None,
        Some(id) => match map.get(id) {
            Some(n) => Some(n.clone()),
            None if strict => {
                warnings.push(format!("{ctx}: unresolved reference '{id}' cleared"));
                None
            }
            None => Some(id.to_string()),
        },
    }
}
