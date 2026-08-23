//! Import of Athena's memory, prefs, identity and sessions.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Athena memory import (post-commit; merge, never a conflict list)
// ============================================================================

/// Merge a bundle's Athena section into this machine's brain.
///
/// **Merge, not replace.** A workspace has many personas and one Athena, so
/// there is no "which one wins" question to put in front of the user — an
/// incoming memory either says something the brain does not already hold, in
/// which case it lands, or it duplicates something it does, in which case it is
/// dropped whole. Deliberately NOT merged field-by-field: silently raising a
/// local fact's confidence because a bundle claimed a higher one would edit the
/// operator's own brain behind their back.
///
/// Never returns `Err`. Every failure is a warning on the result, because by
/// the time this runs the app-database transaction has already committed and
/// there is nothing left to roll back — an error here would report a failed
/// import that in fact half-succeeded.
pub(crate) fn import_athena_memory(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    athena: &AthenaMemoryExport,
    now: &str,
    result: &mut PortabilityImportResult,
) {
    // Core, part 1 — prefs live in the SYSTEM database and need no brain.
    apply_athena_prefs(pool, athena, result);

    // Core, part 2 — identity.md is a file, likewise.
    apply_athena_identity(athena, result);

    let Some(user_db) = user_db else {
        if !athena.nodes.is_empty() || !athena.decisions.is_empty() {
            result.warnings.push(
                "Athena: her memory could not be imported — the brain database is not available in this context."
                    .into(),
            );
        }
        return;
    };
    {
        let Ok(conn) = user_db.get() else {
            result.warnings.push(
                "Athena: her brain database could not be opened; her memory was not imported."
                    .into(),
            );
            return;
        };
        if !has_companion_schema(&conn) {
            result.warnings.push(
                "Athena: this installation has no companion brain yet; her memory was not imported. Open the companion once and re-import."
                    .into(),
            );
            return;
        }
    }

    if let Err(e) = import_athena_sessions(user_db, athena, result) {
        result.warnings.push(format!(
            "Athena: her conversation list could not be imported ({e})."
        ));
    }
    if let Err(e) = import_athena_learned(user_db, athena, now, result) {
        result
            .warnings
            .push(format!("Athena: her memory could not be imported ({e})."));
    }
}

/// Write the portable prefs into `app_settings`.
///
/// The whitelist check is repeated here on purpose — `validate_athena` runs it
/// first, but this is the function that actually writes to `app_settings`, and
/// a boundary that exists in only one place is one refactor from not existing.
pub(crate) fn apply_athena_prefs(
    pool: &DbPool,
    athena: &AthenaMemoryExport,
    result: &mut PortabilityImportResult,
) {
    for pref in &athena.prefs {
        if !ATHENA_PORTABLE_PREF_KEYS.contains(&pref.key.as_str()) {
            result.warnings.push(format!(
                "Athena: preference '{}' is not portable and was ignored.",
                pref.key
            ));
            continue;
        }
        if let Err(e) = settings_repo::set(pool, &pref.key, &pref.value) {
            result.warnings.push(format!(
                "Athena: preference '{}' could not be applied ({e}).",
                pref.key
            ));
        }
    }
}

/// Replace `identity.md`, backing up whatever was there first.
///
/// Goes through `identity::write_full` rather than writing the file directly:
/// that is the function the rest of the app already trusts to make a
/// timestamped backup before it overwrites, and an import is the single most
/// destructive thing that can happen to this file.
pub(crate) fn apply_athena_identity(
    athena: &AthenaMemoryExport,
    result: &mut PortabilityImportResult,
) {
    let Some(identity) = athena.identity_md.as_deref() else {
        return;
    };
    match crate::companion::brain::identity::write_full(identity) {
        Ok(backup) if backup.is_empty() => {
            // Nothing was there — a first write, not a replacement.
            result
                .warnings
                .push("Athena: identity.md was written (this machine had none).".into());
        }
        Ok(backup) => {
            result.athena_identity_replaced = true;
            result.warnings.push(format!(
                "Athena: identity.md was replaced. The previous one is saved next to it as '{backup}'."
            ));
        }
        Err(e) => result
            .warnings
            .push(format!("Athena: identity.md could not be written ({e}).")),
    }
}

/// Add conversation threads that are not already here, by id.
///
/// The transcripts do not travel, so these land empty — titles, pins and
/// origin only. That is said out loud in a warning rather than left for the
/// user to discover by opening one.
pub(crate) fn import_athena_sessions(
    user_db: &UserDbPool,
    athena: &AthenaMemoryExport,
    result: &mut PortabilityImportResult,
) -> Result<(), AppError> {
    if athena.sessions.is_empty() {
        return Ok(());
    }
    let mut conn = user_db.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let mut added = 0u32;
    for s in &athena.sessions {
        // `claude_session_id` is left NULL: the bundle never carried one, and
        // a resume pointer from another machine would attach the wrong CLI
        // process to this thread.
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO companion_session \
                    (id, claude_session_id, constitution_version, last_active_at, created_at, \
                     title, status, last_read_at, pinned, origin) \
                 VALUES (?1, NULL, 1, datetime('now'), datetime('now'), ?2, ?3, NULL, ?4, ?5)",
                rusqlite::params![s.id, s.title, s.status, s.pinned, s.origin],
            )
            .map_err(AppError::Database)?;
        added += n as u32;
    }
    tx.commit().map_err(AppError::Database)?;
    if added > 0 {
        result.warnings.push(format!(
            "Athena: {added} conversation(s) were added to her list. They arrive empty — the messages themselves do not travel in a bundle."
        ));
    }
    Ok(())
}

/// Dedup identity for one incoming memory — what makes two of them "the same".
///
/// Content-shaped rather than id-shaped, because a re-import of the same bundle
/// onto a brain that has since regenerated its ids must still be a no-op, and
/// because the same fact learned twice on two machines really is one fact.
pub(crate) fn athena_dedup_key(
    athena: &AthenaMemoryExport,
    node_id: &str,
    kind: &str,
) -> Option<String> {
    match kind {
        "fact" => athena
            .facts
            .iter()
            .find(|f| f.id == node_id)
            .map(|f| format!("{}\u{1}{}", f.scope, f.fact_key)),
        "procedural" => athena
            .procedurals
            .iter()
            .find(|p| p.id == node_id)
            .map(|p| p.trigger_pattern.clone()),
        "goal" => athena
            .goals
            .iter()
            .find(|g| g.id == node_id)
            .map(|g| g.title.clone()),
        "backlog" => athena
            .backlog
            .iter()
            .find(|b| b.id == node_id)
            .map(|b| b.summary.clone()),
        "ritual" => athena
            .rituals
            .iter()
            .find(|r| r.id == node_id)
            .map(|r| format!("{}\u{1}{}", r.kind, r.description)),
        _ => None,
    }
}

/// The dedup keys already present in this brain, per kind.
pub(crate) fn existing_athena_keys(
    conn: &rusqlite::Connection,
) -> Result<HashMap<&'static str, std::collections::HashSet<String>>, AppError> {
    let mut out: HashMap<&'static str, std::collections::HashSet<String>> = HashMap::new();
    let mut collect = |kind: &'static str, sql: &str| -> Result<(), AppError> {
        let mut stmt = conn.prepare(sql).map_err(AppError::Database)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(AppError::Database)?;
        let set = out.entry(kind).or_default();
        for row in rows {
            set.insert(row.map_err(AppError::Database)?);
        }
        Ok(())
    };
    collect(
        "fact",
        "SELECT scope || char(1) || fact_key FROM companion_fact",
    )?;
    collect(
        "procedural",
        "SELECT trigger_pattern FROM companion_procedural",
    )?;
    collect("goal", "SELECT title FROM companion_goal")?;
    collect("backlog", "SELECT summary FROM companion_backlog_item")?;
    collect(
        "ritual",
        "SELECT kind || char(1) || description FROM companion_ritual",
    )?;
    Ok(out)
}

/// The learned tier: markdown to disk, then rows, then a queued re-embed.
///
/// The order is the brain's own contract — the markdown is the source of truth
/// and `companion_node` is an index over it, so writing rows first would leave
/// an index pointing at files that do not exist yet. A node whose file cannot
/// be written is dropped rather than indexed.
pub(crate) fn import_athena_learned(
    user_db: &UserDbPool,
    athena: &AthenaMemoryExport,
    now: &str,
    result: &mut PortabilityImportResult,
) -> Result<(), AppError> {
    if athena.nodes.is_empty() && athena.decisions.is_empty() {
        return Ok(());
    }
    let root = crate::companion::disk::brain_root()?;

    let (existing_keys, existing_ids) = {
        let conn = user_db.get()?;
        let keys = existing_athena_keys(&conn)?;
        let mut ids = std::collections::HashSet::new();
        let mut stmt = conn
            .prepare("SELECT id FROM companion_node")
            .map_err(AppError::Database)?;
        let rows = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .map_err(AppError::Database)?;
        for row in rows {
            ids.insert(row.map_err(AppError::Database)?);
        }
        (keys, ids)
    };

    // Pass 1: decide what lands, mint replacement ids for the (vanishingly
    // rare) case where an incoming id is already taken by a DIFFERENT memory,
    // and write the markdown.
    let mut taken_ids = existing_ids;
    let mut id_map: HashMap<&str, String> = HashMap::new();
    let mut planned: Vec<(&AthenaNodeExport, String, String)> = Vec::new(); // (node, new id, new rel path)
    let mut skipped_duplicates = 0u32;

    for node in &athena.nodes {
        let seen = athena_dedup_key(athena, &node.id, &node.kind);
        let Some(key) = seen else {
            result.warnings.push(format!(
                "Athena: {} '{}' arrived without its detail row and was skipped.",
                node.kind, node.id
            ));
            continue;
        };
        if existing_keys
            .get(node.kind.as_str())
            .is_some_and(|s| s.contains(&key))
        {
            skipped_duplicates += 1;
            continue;
        }

        let new_id = if taken_ids.contains(&node.id) {
            let fresh = format!(
                "{}_{}",
                node.id.split('_').next().unwrap_or("mem"),
                &uuid::Uuid::new_v4().simple().to_string()[..8]
            );
            result.warnings.push(format!(
                "Athena: {} '{}' collided with an existing id and landed as '{fresh}'.",
                node.kind, node.id
            ));
            fresh
        } else {
            node.id.clone()
        };
        // The node id is embedded in its filename; keep the two in step.
        let rel_path = if new_id == node.id {
            node.file_path.clone()
        } else {
            node.file_path.replace(&node.id, &new_id)
        };

        // Validation already refused an escaping `file_path`, but `rel_path`
        // is not that value -- the collision rename above rewrote it. Re-assert
        // the boundary where the write actually happens, so a path that only
        // becomes unsafe after the rewrite still cannot leave the brain root.
        let Some(abs) = safe_join(&root, &rel_path) else {
            result.warnings.push(format!(
                "Athena: {} '{}' named a file path outside her brain directory ('{rel_path}'); skipped.",
                node.kind, node.id
            ));
            continue;
        };
        if let Some(parent) = abs.parent() {
            if let Err(e) = std::fs::create_dir_all(parent) {
                result.warnings.push(format!(
                    "Athena: {} '{}' could not be saved ({e}); skipped.",
                    node.kind, node.id
                ));
                continue;
            }
        }
        if let Err(e) = std::fs::write(&abs, &node.body) {
            result.warnings.push(format!(
                "Athena: {} '{}' could not be saved ({e}); skipped.",
                node.kind, node.id
            ));
            continue;
        }

        taken_ids.insert(new_id.clone());
        id_map.insert(node.id.as_str(), new_id.clone());
        planned.push((node, new_id, rel_path));
    }

    // Pass 2: the index rows, in one transaction over the brain database.
    let mut conn = user_db.get()?;
    let tx = conn.transaction().map_err(AppError::Database)?;
    let remap = |id: &Option<String>| -> Option<String> {
        // A superseded fact that did not travel leaves a dangling pointer;
        // NULL is the honest value for "the thing this replaced is not here".
        id.as_deref().and_then(|i| id_map.get(i).cloned())
    };

    let mut nodes_written = 0u32;
    for (node, new_id, rel_path) in &planned {
        tx.execute(
            "INSERT INTO companion_node \
                (id, kind, file_path, content_hash, importance, embedding_model, embedding_dims, \
                 body_excerpt, created_at, updated_at, session_id) \
             VALUES (?1,?2,?3,?4,?5,NULL,NULL,?6,?7,?8,?9)",
            rusqlite::params![
                new_id,
                node.kind,
                rel_path,
                node.content_hash,
                node.importance,
                node.body_excerpt,
                node.created_at,
                node.updated_at,
                node.session_id,
            ],
        )
        .map_err(AppError::Database)?;
        nodes_written += 1;

        match node.kind.as_str() {
            "fact" => {
                if let Some(f) = athena.facts.iter().find(|f| f.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_fact \
                            (id, scope, fact_key, confidence, supersedes_id, contradicts_id, \
                             last_seen_at, last_decayed_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![
                            new_id,
                            f.scope,
                            f.fact_key,
                            f.confidence,
                            remap(&f.supersedes_id),
                            remap(&f.contradicts_id),
                            f.last_seen_at,
                            f.last_decayed_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "procedural" => {
                if let Some(p) = athena.procedurals.iter().find(|p| p.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_procedural \
                            (id, scope, trigger_pattern, confidence, supersedes_id, last_used_at, \
                             last_decayed_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7)",
                        rusqlite::params![
                            new_id,
                            p.scope,
                            p.trigger_pattern,
                            p.confidence,
                            remap(&p.supersedes_id),
                            p.last_used_at,
                            p.last_decayed_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "goal" => {
                if let Some(g) = athena.goals.iter().find(|g| g.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_goal \
                            (id, title, status, priority, target_date, sources_json, completed_at, \
                             created_at, updated_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                        rusqlite::params![
                            new_id,
                            g.title,
                            g.status,
                            g.priority,
                            g.target_date,
                            g.sources_json,
                            g.completed_at,
                            g.created_at,
                            g.updated_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "backlog" => {
                if let Some(b) = athena.backlog.iter().find(|b| b.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_backlog_item \
                            (id, summary, kind, status, source_episode_id, reminded_count, \
                             created_at, resolved_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![
                            new_id,
                            b.summary,
                            b.kind,
                            b.status,
                            b.source_episode_id,
                            b.reminded_count,
                            b.created_at,
                            b.resolved_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            "ritual" => {
                if let Some(r) = athena.rituals.iter().find(|r| r.id == node.id) {
                    tx.execute(
                        "INSERT INTO companion_ritual \
                            (id, kind, description, schedule_json, active, sources_json, \
                             created_at, updated_at) \
                         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                        rusqlite::params![
                            new_id,
                            r.kind,
                            r.description,
                            r.schedule_json,
                            r.active,
                            r.sources_json,
                            r.created_at,
                            r.updated_at,
                        ],
                    )
                    .map_err(AppError::Database)?;
                }
            }
            _ => {}
        }
    }

    // Provenance. The episode ids dangle by design — the conversations do not
    // travel — and both `semantic::load_sources` and `procedural::load_sources`
    // read this table with no join, so a dangling id comes back verbatim and
    // never errors. What survives is "she believes this for three separate
    // reasons", which is the part worth carrying.
    let mut dangling = 0u32;
    for pr in &athena.provenance {
        let Some(fact_id) = id_map.get(pr.fact_id.as_str()) else {
            continue;
        };
        tx.execute(
            "INSERT OR IGNORE INTO companion_provenance (fact_id, episode_id) VALUES (?1, ?2)",
            rusqlite::params![fact_id, pr.episode_id],
        )
        .map_err(AppError::Database)?;
        dangling += 1;
    }

    // Design decisions dedup on id — they have no content key, and unlike a
    // fact there is no natural "same decision, said twice".
    let mut decisions_written = 0u32;
    for d in &athena.decisions {
        let n = tx
            .execute(
                "INSERT OR IGNORE INTO companion_design_decision \
                    (id, session_id, persona_context, label, choice, rationale, \
                     decision_timestamp, created_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                rusqlite::params![
                    d.id,
                    d.session_id,
                    d.persona_context,
                    d.label,
                    d.choice,
                    d.rationale,
                    d.decision_timestamp,
                    d.created_at,
                ],
            )
            .map_err(AppError::Database)?;
        decisions_written += n as u32;
    }

    tx.commit().map_err(AppError::Database)?;
    let _ = now;

    result.athena_memory_imported += nodes_written + decisions_written;
    // Only nodes carry vectors; decisions are never embedded.
    result.reembed_queued += nodes_written;
    if skipped_duplicates > 0 {
        result.warnings.push(format!(
            "Athena: {skipped_duplicates} memory item(s) were already in her brain and were left alone."
        ));
    }
    if dangling > 0 {
        result.warnings.push(format!(
            "Athena: {dangling} provenance link(s) point at conversations that do not travel in a bundle. The memories keep their sourcing; the conversations themselves are not here."
        ));
    }
    Ok(())
}
