//! Export of Athena's memory, prefs, sessions and sidecars.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Normalise a `companion_node.file_path` to a path relative to `brain_root`.
///
/// The column is relative by convention at every write site, but "by
/// convention" is not a guarantee and this value crosses machines: an absolute
/// path in a bundle names a directory on the exporting machine, and the
/// importer would create it. So an absolute path is accepted only when it sits
/// under this machine's brain root (in which case it is de-anchored), and
/// rejected otherwise.
pub(crate) fn relative_brain_path(file_path: &str, root: &std::path::Path) -> Option<String> {
    let p = std::path::Path::new(file_path);
    if !p.is_absolute() {
        // Reject traversal too — `../../x` re-anchored on the target would
        // write outside the brain.
        if p.components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return None;
        }
        return Some(file_path.replace('\\', "/"));
    }
    p.strip_prefix(root)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

/// Collect Athena's memory for the requested tiers.
///
/// Returns `Ok(None)` when nothing was asked for, or when this machine has no
/// companion brain to read — never an error for either. Every drop (an
/// unreadable markdown body, an oversize file, a cap) is reported through
/// `export_warnings`, because a memory silently missing from a bundle is
/// indistinguishable from a memory that never existed.
pub(crate) fn collect_athena_export(
    pool: &DbPool,
    user_db: Option<&UserDbPool>,
    tiers: AthenaTiers,
    export_warnings: &mut Vec<String>,
) -> Result<Option<AthenaMemoryExport>, AppError> {
    if !tiers.any() {
        return Ok(None);
    }
    let root = match crate::companion::disk::brain_root() {
        Ok(r) => r,
        Err(e) => {
            export_warnings.push(format!(
                "Athena: her brain directory could not be resolved ({e}); her memory was not exported."
            ));
            return Ok(None);
        }
    };

    let mut out = AthenaMemoryExport::default();

    if tiers.core {
        collect_athena_core_disk_and_prefs(pool, &root, &mut out, export_warnings);
    }

    let Some(user_db) = user_db else {
        // Identity + prefs still made it; everything else lives in the other
        // database. Say so rather than reporting a suspiciously small brain.
        if tiers.learned || tiers.core {
            export_warnings.push(
                "Athena: the brain database was not available in this context; only her identity file and preferences were exported."
                    .into(),
            );
        }
        return Ok(if out.is_empty() { None } else { Some(out) });
    };
    let conn = user_db.get()?;
    if !has_companion_schema(&conn) {
        return Ok(if out.is_empty() { None } else { Some(out) });
    }

    if tiers.core {
        collect_athena_sessions(&conn, &mut out, export_warnings)?;
    }
    if tiers.learned {
        collect_athena_learned(&conn, &root, &mut out, export_warnings)?;
    }

    Ok(if out.is_empty() { None } else { Some(out) })
}

/// `identity.md` + the three portable prefs. Neither needs the brain database:
/// identity is a file, prefs live in the SYSTEM database (`personas.db`) while
/// every `companion_*` table lives in the USER one. The two pools are the same
/// Rust type, so this split is a thing to hold in your head, not something the
/// compiler will catch.
pub(crate) fn collect_athena_core_disk_and_prefs(
    pool: &DbPool,
    root: &std::path::Path,
    out: &mut AthenaMemoryExport,
    export_warnings: &mut Vec<String>,
) {
    let identity_path = root.join("identity.md");
    if identity_path.is_file() {
        match std::fs::read_to_string(&identity_path) {
            Ok(body) if body.len() > MAX_IDENTITY_BYTES => export_warnings.push(format!(
                "Athena: identity.md is {} bytes, over the {MAX_IDENTITY_BYTES}-byte cap; it was not exported.",
                body.len()
            )),
            Ok(body) => out.identity_md = Some(body),
            Err(e) => export_warnings.push(format!(
                "Athena: identity.md could not be read ({e}); it was not exported."
            )),
        }
    }

    for key in ATHENA_PORTABLE_PREF_KEYS {
        if let Ok(Some(value)) = settings_repo::get(pool, key) {
            out.prefs.push(AthenaPrefExport {
                key: key.to_string(),
                value,
            });
        }
    }
}

/// The conversation roster. `claude_session_id` is named in the SELECT's
/// absence on purpose: it is a `--resume` handle into a CLI process on the
/// exporting machine, so carrying it would at best resume nothing and at worst
/// attach a foreign conversation.
pub(crate) fn collect_athena_sessions(
    conn: &rusqlite::Connection,
    out: &mut AthenaMemoryExport,
    export_warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    let total: usize = conn
        .query_row("SELECT COUNT(*) FROM companion_session", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as usize;
    let mut stmt = conn
        .prepare(
            "SELECT id, title, pinned, origin, status FROM companion_session \
             ORDER BY pinned DESC, last_active_at DESC",
        )
        .map_err(AppError::Database)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AthenaSessionExport {
                id: r.get(0)?,
                title: r.get(1)?,
                pinned: r.get(2)?,
                origin: r.get(3)?,
                status: r.get(4)?,
            })
        })
        .map_err(AppError::Database)?;
    for row in rows {
        out.sessions.push(row.map_err(AppError::Database)?);
        if out.sessions.len() >= MAX_ATHENA_SESSIONS {
            break;
        }
    }
    push_truncation_warning(
        export_warnings,
        "conversations",
        out.sessions.len(),
        total,
        "Athena",
    );
    Ok(())
}

/// Per-kind cap for a learned node kind.
pub(crate) fn athena_cap_for(kind: &str) -> usize {
    match kind {
        "fact" => MAX_ATHENA_FACTS,
        "procedural" => MAX_ATHENA_PROCEDURALS,
        "goal" => MAX_ATHENA_GOALS,
        "backlog" => MAX_ATHENA_BACKLOG,
        "ritual" => MAX_ATHENA_RITUALS,
        _ => 0,
    }
}

/// Nodes + markdown + every sidecar table.
///
/// The nodes are gathered FIRST and everything else is filtered to the ids that
/// survived, so a node dropped for an unreadable body cannot leave a widowed
/// `companion_fact` row behind. Order matters here in a way it does not for the
/// flatter sections of this bundle.
pub(crate) fn collect_athena_learned(
    conn: &rusqlite::Connection,
    root: &std::path::Path,
    out: &mut AthenaMemoryExport,
    export_warnings: &mut Vec<String>,
) -> Result<(), AppError> {
    let kinds = athena_kind_list();

    // Per-kind totals for the truncation forecast, before any filtering.
    let mut totals: HashMap<String, usize> = HashMap::new();
    {
        let mut stmt = conn
            .prepare(&format!(
                "SELECT kind, COUNT(*) FROM companion_node WHERE kind IN ({kinds}) GROUP BY kind"
            ))
            .map_err(AppError::Database)?;
        let rows = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)))
            .map_err(AppError::Database)?;
        for row in rows {
            let (kind, n) = row.map_err(AppError::Database)?;
            totals.insert(kind, n.max(0) as usize);
        }
    }

    // Highest-importance first, so a capped export keeps what matters most
    // rather than whatever happens to be oldest.
    let mut stmt = conn
        .prepare(&format!(
            "SELECT id, kind, file_path, content_hash, importance, body_excerpt, created_at, \
                    updated_at, session_id \
             FROM companion_node WHERE kind IN ({kinds}) \
             ORDER BY kind, importance DESC, updated_at DESC"
        ))
        .map_err(AppError::Database)?;
    type NodeRow = (
        String,
        String,
        String,
        String,
        i64,
        Option<String>,
        String,
        String,
        Option<String>,
    );
    let rows = stmt
        .query_map([], |r| {
            Ok((
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
                r.get(3)?,
                r.get(4)?,
                r.get(5)?,
                r.get(6)?,
                r.get(7)?,
                r.get(8)?,
            ))
        })
        .map_err(AppError::Database)?;

    let mut kept_per_kind: HashMap<String, usize> = HashMap::new();
    // Nodes dropped for a bad body, per kind. Subtracted from the cap forecast
    // below so a memory is never reported twice — once by name and again as an
    // anonymous cap casualty.
    let mut dropped_per_kind: HashMap<String, usize> = HashMap::new();
    for row in rows {
        let (
            id,
            kind,
            file_path,
            content_hash,
            importance,
            body_excerpt,
            created_at,
            updated_at,
            session_id,
        ): NodeRow = row.map_err(AppError::Database)?;
        let cap = athena_cap_for(&kind);
        let kept = kept_per_kind.entry(kind.clone()).or_insert(0);
        if *kept >= cap {
            continue;
        }
        let Some(rel_path) = relative_brain_path(&file_path, root) else {
            export_warnings.push(format!(
                "Athena: {kind} '{id}' points outside her brain directory ('{file_path}'); not exported."
            ));
            *dropped_per_kind.entry(kind).or_insert(0) += 1;
            continue;
        };
        let abs = root.join(&rel_path);
        let body = match std::fs::read_to_string(&abs) {
            Ok(b) if b.len() > MAX_ATHENA_MD_FILE_BYTES => {
                export_warnings.push(format!(
                    "Athena: {kind} '{id}' is {} bytes, over the {MAX_ATHENA_MD_FILE_BYTES}-byte per-memory cap; not exported.",
                    b.len()
                ));
                *dropped_per_kind.entry(kind).or_insert(0) += 1;
                continue;
            }
            Ok(b) => b,
            Err(e) => {
                // The markdown IS the memory; the row is only an index over it.
                // Exporting the row alone would move a pointer to nothing.
                export_warnings.push(format!(
                    "Athena: {kind} '{id}' has no readable body at '{rel_path}' ({e}); not exported."
                ));
                *dropped_per_kind.entry(kind).or_insert(0) += 1;
                continue;
            }
        };
        *kept += 1;
        out.nodes.push(AthenaNodeExport {
            id,
            kind,
            file_path: rel_path,
            content_hash,
            importance,
            body_excerpt,
            created_at,
            updated_at,
            session_id,
            body,
        });
    }
    drop(stmt);

    for kind in ATHENA_LEARNED_KINDS {
        let total = totals.get(kind).copied().unwrap_or(0);
        let dropped = dropped_per_kind.get(kind).copied().unwrap_or(0);
        push_truncation_warning(
            export_warnings,
            kind,
            kept_per_kind.get(kind).copied().unwrap_or(0),
            total.saturating_sub(dropped),
            "Athena",
        );
    }

    let kept_ids: std::collections::HashSet<String> =
        out.nodes.iter().map(|n| n.id.clone()).collect();

    collect_athena_sidecars(conn, &kept_ids, out)?;

    // Design decisions have no node and no file — the one learned table that is
    // pure DB. Capped on its own.
    let total_decisions: usize = conn
        .query_row("SELECT COUNT(*) FROM companion_design_decision", [], |r| {
            r.get::<_, i64>(0)
        })
        .unwrap_or(0)
        .max(0) as usize;
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, persona_context, label, choice, rationale, \
                    decision_timestamp, created_at \
             FROM companion_design_decision ORDER BY created_at DESC",
        )
        .map_err(AppError::Database)?;
    let rows = stmt
        .query_map([], |r| {
            Ok(AthenaDecisionExport {
                id: r.get(0)?,
                session_id: r.get(1)?,
                persona_context: r.get(2)?,
                label: r.get(3)?,
                choice: r.get(4)?,
                rationale: r.get(5)?,
                decision_timestamp: r.get(6)?,
                created_at: r.get(7)?,
            })
        })
        .map_err(AppError::Database)?;
    for row in rows {
        out.decisions.push(row.map_err(AppError::Database)?);
        if out.decisions.len() >= MAX_ATHENA_DECISIONS {
            break;
        }
    }
    push_truncation_warning(
        export_warnings,
        "design decisions",
        out.decisions.len(),
        total_decisions,
        "Athena",
    );

    Ok(())
}

/// Every sidecar table, filtered to the nodes that actually made it.
pub(crate) fn collect_athena_sidecars(
    conn: &rusqlite::Connection,
    kept_ids: &std::collections::HashSet<String>,
    out: &mut AthenaMemoryExport,
) -> Result<(), AppError> {
    /// `$key` names the field that has to be in `kept_ids` for the row to
    /// travel — always the owning node's id, spelled `fact_id` in the
    /// provenance table.
    macro_rules! sweep {
        ($sql:expr, $target:expr, $key:ident, $map:expr) => {{
            let mut stmt = conn.prepare($sql).map_err(AppError::Database)?;
            let rows = stmt.query_map([], $map).map_err(AppError::Database)?;
            for row in rows {
                let row = row.map_err(AppError::Database)?;
                if kept_ids.contains(row.$key.as_str()) {
                    $target.push(row);
                }
            }
        }};
    }

    sweep!(
        "SELECT id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, \
                last_decayed_at FROM companion_fact",
        out.facts,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaFactExport {
            id: r.get(0)?,
            scope: r.get(1)?,
            fact_key: r.get(2)?,
            confidence: r.get(3)?,
            supersedes_id: r.get(4)?,
            contradicts_id: r.get(5)?,
            last_seen_at: r.get(6)?,
            last_decayed_at: r.get(7)?,
        })
    );
    sweep!(
        "SELECT id, scope, trigger_pattern, confidence, supersedes_id, last_used_at, \
                last_decayed_at FROM companion_procedural",
        out.procedurals,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaProceduralExport {
            id: r.get(0)?,
            scope: r.get(1)?,
            trigger_pattern: r.get(2)?,
            confidence: r.get(3)?,
            supersedes_id: r.get(4)?,
            last_used_at: r.get(5)?,
            last_decayed_at: r.get(6)?,
        })
    );
    sweep!(
        "SELECT id, title, status, priority, target_date, sources_json, completed_at, \
                created_at, updated_at FROM companion_goal",
        out.goals,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaGoalExport {
            id: r.get(0)?,
            title: r.get(1)?,
            status: r.get(2)?,
            priority: r.get(3)?,
            target_date: r.get(4)?,
            sources_json: r.get(5)?,
            completed_at: r.get(6)?,
            created_at: r.get(7)?,
            updated_at: r.get(8)?,
        })
    );
    sweep!(
        "SELECT id, summary, kind, status, source_episode_id, reminded_count, created_at, \
                resolved_at FROM companion_backlog_item",
        out.backlog,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaBacklogExport {
            id: r.get(0)?,
            summary: r.get(1)?,
            kind: r.get(2)?,
            status: r.get(3)?,
            source_episode_id: r.get(4)?,
            reminded_count: r.get(5)?,
            created_at: r.get(6)?,
            resolved_at: r.get(7)?,
        })
    );
    sweep!(
        "SELECT id, kind, description, schedule_json, active, sources_json, created_at, \
                updated_at FROM companion_ritual",
        out.rituals,
        id,
        |r: &rusqlite::Row<'_>| Ok(AthenaRitualExport {
            id: r.get(0)?,
            kind: r.get(1)?,
            description: r.get(2)?,
            schedule_json: r.get(3)?,
            active: r.get(4)?,
            sources_json: r.get(5)?,
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    );
    // `fact_id` is overloaded — it holds proc_* ids too — so filtering on the
    // kept-node set covers both tiers with one sweep.
    sweep!(
        "SELECT fact_id, episode_id FROM companion_provenance",
        out.provenance,
        fact_id,
        |r: &rusqlite::Row<'_>| Ok(AthenaProvenanceExport {
            fact_id: r.get(0)?,
            episode_id: r.get(1)?,
        })
    );

    Ok(())
}
