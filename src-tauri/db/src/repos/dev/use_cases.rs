use super::contexts::list_contexts_by_project;
use crate::models::{DevContext, DevUseCase};
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};
use std::collections::{HashMap, HashSet};

// ============================================================================
// Use cases (behavioral slice layer — docs/plans/use-case-slice-layer.md)
// ============================================================================

const USE_CASE_KINDS: [&str; 4] = ["user_flow", "capability", "integration", "ops"];
const USE_CASE_STATUSES: [&str; 3] = ["proposed", "active", "archived"];

/// Normalize a human name into the stable join key: lowercase, every run of
/// non-alphanumerics collapsed to a single `-`, trimmed. Also the function that
/// normalizes an observability pinpoint's use-case name before matching, so
/// `"Checkout Conversion"`, `"checkout_conversion"` and `"checkout-conversion"`
/// all resolve to the same use case.
pub fn slugify_use_case(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut pending_sep = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            if pending_sep && !out.is_empty() {
                out.push('-');
            }
            pending_sep = false;
            out.extend(ch.to_lowercase());
        } else {
            pending_sep = true;
        }
    }
    out
}

fn row_to_use_case(row: &Row) -> rusqlite::Result<DevUseCase> {
    Ok(DevUseCase {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        name: row.get("name")?,
        slug: row.get("slug")?,
        description: row.get("description")?,
        kind: row.get("kind")?,
        primary_context_id: row.get("primary_context_id")?,
        status: row.get("status")?,
        created_by: row.get("created_by")?,
        pinned: row.get::<_, i64>("pinned").unwrap_or(0) != 0,
        rationale: row.get("rationale")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
        context_ids: Vec::new(),
    })
}

/// Attach each use case's context slice in one query (no N+1).
fn hydrate_use_case_contexts(
    conn: &rusqlite::Connection,
    use_cases: &mut [DevUseCase],
) -> Result<(), AppError> {
    if use_cases.is_empty() {
        return Ok(());
    }
    let placeholders = vec!["?"; use_cases.len()].join(",");
    let sql = format!(
        "SELECT use_case_id, context_id FROM dev_use_case_contexts
          WHERE use_case_id IN ({placeholders})"
    );
    let ids: Vec<&str> = use_cases.iter().map(|u| u.id.as_str()).collect();
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(ids.iter()), |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut by_id: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (uc_id, ctx_id) = row?;
        by_id.entry(uc_id).or_default().push(ctx_id);
    }
    drop(stmt);
    for uc in use_cases.iter_mut() {
        uc.context_ids = by_id.remove(&uc.id).unwrap_or_default();
    }
    Ok(())
}

/// List a project's use cases, optionally filtered by status. Active first,
/// then the proposal queue, then archived; alphabetical within each band.
pub fn list_use_cases(
    pool: &DbPool,
    project_id: &str,
    status: Option<&str>,
) -> Result<Vec<DevUseCase>, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::list_use_cases", {
        let conn = pool.get()?;
        let mut sql = String::from("SELECT * FROM dev_use_cases WHERE project_id = ?1");
        if status.is_some() {
            sql.push_str(" AND status = ?2");
        }
        sql.push_str(
            " ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'proposed' THEN 1 ELSE 2 END, name",
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = match status {
            Some(st) => stmt.query_map(params![project_id, st], row_to_use_case)?,
            None => stmt.query_map(params![project_id], row_to_use_case)?,
        };
        let mut out: Vec<DevUseCase> = rows.collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        hydrate_use_case_contexts(&conn, &mut out)?;
        Ok(out)
    })
}

pub fn get_use_case(pool: &DbPool, id: &str) -> Result<DevUseCase, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::get_use_case", {
        let conn = pool.get()?;
        let mut uc = conn
            .query_row(
                "SELECT * FROM dev_use_cases WHERE id = ?1",
                params![id],
                row_to_use_case,
            )
            .map_err(|_| AppError::NotFound(format!("Use case {id} not found")))?;
        hydrate_use_case_contexts(&conn, std::slice::from_mut(&mut uc))?;
        Ok(uc)
    })
}

/// Every non-archived use case whose slice includes `context_id` — powers the
/// Context Map's per-context use-case list.
pub fn list_use_cases_for_context(
    pool: &DbPool,
    context_id: &str,
) -> Result<Vec<DevUseCase>, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::list_for_context", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT u.* FROM dev_use_cases u
               JOIN dev_use_case_contexts ucc ON ucc.use_case_id = u.id
              WHERE ucc.context_id = ?1 AND u.status != 'archived'
              ORDER BY u.name",
        )?;
        let rows = stmt.query_map(params![context_id], row_to_use_case)?;
        let mut out: Vec<DevUseCase> = rows.collect::<Result<Vec<_>, _>>()?;
        drop(stmt);
        hydrate_use_case_contexts(&conn, &mut out)?;
        Ok(out)
    })
}

/// Replace a use case's context slice wholesale. Unknown context ids are
/// ignored rather than erroring — a caller resolving names against a map that
/// just changed should not lose the whole write.
fn write_use_case_contexts(
    conn: &rusqlite::Connection,
    use_case_id: &str,
    context_ids: &[String],
) -> Result<(), AppError> {
    conn.execute(
        "DELETE FROM dev_use_case_contexts WHERE use_case_id = ?1",
        params![use_case_id],
    )?;
    for cid in context_ids {
        let _ = conn.execute(
            "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id) VALUES (?1, ?2)",
            params![use_case_id, cid],
        );
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn create_use_case(
    pool: &DbPool,
    project_id: &str,
    name: &str,
    description: Option<&str>,
    kind: &str,
    primary_context_id: Option<&str>,
    context_ids: &[String],
    status: Option<&str>,
    created_by: &str,
    rationale: Option<&str>,
) -> Result<DevUseCase, AppError> {
    let name = name.trim();
    if name.is_empty() {
        return Err(AppError::Validation("Use case name cannot be empty".into()));
    }
    let slug = slugify_use_case(name);
    if slug.is_empty() {
        return Err(AppError::Validation(
            "Use case name must contain at least one alphanumeric character".into(),
        ));
    }
    let kind = if USE_CASE_KINDS.contains(&kind) {
        kind
    } else {
        "capability"
    };
    let status = status
        .filter(|s| USE_CASE_STATUSES.contains(s))
        .unwrap_or("active");
    timed_query!("dev_use_cases", "dev_use_cases::create_use_case", {
        let id = uuid::Uuid::new_v4().to_string();
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_use_cases (id, project_id, name, slug, description, kind,
                primary_context_id, status, created_by, rationale)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            params![
                id,
                project_id,
                name,
                slug,
                description,
                kind,
                primary_context_id,
                status,
                created_by,
                rationale
            ],
        )
        .map_err(|e| match e {
            rusqlite::Error::SqliteFailure(err, _)
                if err.extended_code == rusqlite::ffi::SQLITE_CONSTRAINT_UNIQUE =>
            {
                AppError::Validation(format!("A use case named \"{name}\" already exists"))
            }
            other => AppError::Database(other),
        })?;
        write_use_case_contexts(&conn, &id, context_ids)?;
        drop(conn);
        get_use_case(pool, &id)
    })
}

/// Field-wise update; `Option<Option<...>>` distinguishes "leave unchanged" from
/// "set NULL". `context_ids: Some(..)` replaces the whole slice.
#[allow(clippy::too_many_arguments)]
pub fn update_use_case(
    pool: &DbPool,
    id: &str,
    name: Option<&str>,
    description: Option<Option<&str>>,
    kind: Option<&str>,
    primary_context_id: Option<Option<&str>>,
    status: Option<&str>,
    pinned: Option<bool>,
    context_ids: Option<&[String]>,
) -> Result<DevUseCase, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::update_use_case", {
        let conn = pool.get()?;
        let mut sets: Vec<String> = vec!["updated_at = datetime('now')".into()];
        let mut vals: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();
        let push = |sets: &mut Vec<String>,
                    col: &str,
                    v: Box<dyn rusqlite::types::ToSql>,
                    vals: &mut Vec<Box<dyn rusqlite::types::ToSql>>| {
            vals.push(v);
            sets.push(format!("{col} = ?{}", vals.len()));
        };
        if let Some(v) = name {
            let v = v.trim();
            if v.is_empty() {
                return Err(AppError::Validation("Use case name cannot be empty".into()));
            }
            push(&mut sets, "name", Box::new(v.to_string()), &mut vals);
            // The join key follows the display name — a rename re-points
            // telemetry matching at the new label.
            push(&mut sets, "slug", Box::new(slugify_use_case(v)), &mut vals);
        }
        if let Some(v) = description {
            push(
                &mut sets,
                "description",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = kind.filter(|k| USE_CASE_KINDS.contains(k)) {
            push(&mut sets, "kind", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = primary_context_id {
            push(
                &mut sets,
                "primary_context_id",
                Box::new(v.map(str::to_string)),
                &mut vals,
            );
        }
        if let Some(v) = status.filter(|s| USE_CASE_STATUSES.contains(s)) {
            push(&mut sets, "status", Box::new(v.to_string()), &mut vals);
        }
        if let Some(v) = pinned {
            push(&mut sets, "pinned", Box::new(v as i64), &mut vals);
        }
        let sql = format!(
            "UPDATE dev_use_cases SET {} WHERE id = ?{}",
            sets.join(", "),
            vals.len() + 1
        );
        vals.push(Box::new(id.to_string()));
        let n = conn.execute(
            &sql,
            rusqlite::params_from_iter(vals.iter().map(|b| b.as_ref())),
        )?;
        if n == 0 {
            return Err(AppError::NotFound(format!("Use case {id} not found")));
        }
        if let Some(ids) = context_ids {
            write_use_case_contexts(&conn, id, ids)?;
        }
        drop(conn);
        get_use_case(pool, id)
    })
}

pub fn delete_use_case(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::delete_use_case", {
        let conn = pool.get()?;
        let n = conn.execute("DELETE FROM dev_use_cases WHERE id = ?1", params![id])?;
        Ok(n > 0)
    })
}

// ---------------------------------------------------------------------------
// Rescan survival: snapshot before, reconcile after, keyed by context NAME.
//
// A full rescan DELETEs unpinned `dev_contexts` rows and recreates them under
// fresh ids. With `PRAGMA foreign_keys = ON` that (a) cascade-deletes the
// use-case slice and (b) NULLs `dev_kpis.context_id` — the latter a silent
// data-loss bug that predates this layer. Contexts are re-emitted under stable
// kebab names, so the name is the natural reconciliation key.
// ---------------------------------------------------------------------------

/// The context links that a full rescan would destroy, captured by name.
#[derive(Debug, Default, Clone)]
pub struct ContextLinkSnapshot {
    /// (use_case_id, context_name) — the slice.
    pub use_case_contexts: Vec<(String, String)>,
    /// (use_case_id, context_name) — each use case's primary context.
    pub use_case_primary: Vec<(String, String)>,
    /// (kpi_id, context_name) — context-scoped KPIs.
    pub kpi_contexts: Vec<(String, String)>,
}

impl ContextLinkSnapshot {
    pub fn is_empty(&self) -> bool {
        self.use_case_contexts.is_empty()
            && self.use_case_primary.is_empty()
            && self.kpi_contexts.is_empty()
    }
}

/// How reconciliation went: links restored vs links whose context is gone.
#[derive(Debug, Default, Clone, Copy)]
pub struct ReconcileReport {
    pub relinked: usize,
    pub dropped: usize,
}

pub fn snapshot_context_links(
    pool: &DbPool,
    project_id: &str,
) -> Result<ContextLinkSnapshot, AppError> {
    timed_query!("dev_use_cases", "dev_use_cases::snapshot_context_links", {
        let conn = pool.get()?;
        let collect = |sql: &str| -> Result<Vec<(String, String)>, AppError> {
            let mut stmt = conn.prepare(sql)?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        };
        Ok(ContextLinkSnapshot {
            use_case_contexts: collect(
                "SELECT ucc.use_case_id, c.name
                   FROM dev_use_case_contexts ucc
                   JOIN dev_contexts c ON c.id = ucc.context_id
                   JOIN dev_use_cases u ON u.id = ucc.use_case_id
                  WHERE u.project_id = ?1",
            )?,
            use_case_primary: collect(
                "SELECT u.id, c.name
                   FROM dev_use_cases u
                   JOIN dev_contexts c ON c.id = u.primary_context_id
                  WHERE u.project_id = ?1",
            )?,
            kpi_contexts: collect(
                "SELECT k.id, c.name
                   FROM dev_kpis k
                   JOIN dev_contexts c ON c.id = k.context_id
                  WHERE k.project_id = ?1",
            )?,
        })
    })
}

/// Re-resolve a snapshot's context names against the freshly-written map and
/// restore every link that still has a home. Idempotent, so a delta rescan
/// (which never deletes contexts) is a cheap no-op. Links whose context
/// genuinely disappeared are dropped honestly and counted.
///
/// Restores are conservative: `primary_context_id` / `dev_kpis.context_id` are
/// only written when currently NULL, so a user edit made during the scan wins.
pub fn reconcile_context_links(
    pool: &DbPool,
    project_id: &str,
    snap: &ContextLinkSnapshot,
) -> Result<ReconcileReport, AppError> {
    if snap.is_empty() {
        return Ok(ReconcileReport::default());
    }
    timed_query!("dev_use_cases", "dev_use_cases::reconcile_context_links", {
        let conn = pool.get()?;
        let by_name: HashMap<String, String> = {
            let mut stmt =
                conn.prepare("SELECT id, name FROM dev_contexts WHERE project_id = ?1")?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok((
                    r.get::<_, String>(1)?.to_lowercase(),
                    r.get::<_, String>(0)?,
                ))
            })?;
            rows.collect::<Result<HashMap<_, _>, _>>()?
        };
        let mut report = ReconcileReport::default();

        for (uc_id, ctx_name) in &snap.use_case_contexts {
            match by_name.get(&ctx_name.to_lowercase()) {
                Some(ctx_id) => {
                    let n = conn.execute(
                        "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id)
                         VALUES (?1, ?2)",
                        params![uc_id, ctx_id],
                    )?;
                    report.relinked += n;
                }
                None => report.dropped += 1,
            }
        }
        for (uc_id, ctx_name) in &snap.use_case_primary {
            if let Some(ctx_id) = by_name.get(&ctx_name.to_lowercase()) {
                report.relinked += conn.execute(
                    "UPDATE dev_use_cases SET primary_context_id = ?1
                      WHERE id = ?2 AND primary_context_id IS NULL",
                    params![ctx_id, uc_id],
                )?;
            }
        }
        for (kpi_id, ctx_name) in &snap.kpi_contexts {
            match by_name.get(&ctx_name.to_lowercase()) {
                Some(ctx_id) => {
                    // Restoring the context also restores the documented
                    // invariant that context_group_id is its parent group.
                    report.relinked += conn.execute(
                        "UPDATE dev_kpis
                            SET context_id = ?1,
                                context_group_id = COALESCE(
                                    (SELECT group_id FROM dev_contexts WHERE id = ?1),
                                    context_group_id)
                          WHERE id = ?2 AND context_id IS NULL",
                        params![ctx_id, kpi_id],
                    )?;
                }
                None => report.dropped += 1,
            }
        }
        Ok(report)
    })
}

/// A backfilled use case must span at least this many contexts.
///
/// Measured on a real 263-context map: 179 of 184 distinct `business_feature`
/// labels covered exactly ONE context, and 89 of them were literally the
/// context's own kebab name — the model's own doc says the label "often equals
/// the context name". Promoting those 1:1 would mint a use case per context:
/// the degenerate "use case == context" model this whole layer exists to avoid,
/// and ~49 junk proposals for a single project. A deterministic pass cannot tell
/// a genuine single-context behavior from a context's title, so it only claims
/// the labels that demonstrably cut across contexts. The LLM scan makes the
/// judgement calls.
const MIN_BACKFILL_CONTEXTS: usize = 2;
/// Backstop so a pathological map cannot flood the triage queue.
const MAX_BACKFILL_USE_CASES: usize = 25;

/// Deterministic seed for the layer: promote each `dev_contexts.business_feature`
/// label that spans **two or more** contexts into a `proposed` use case sliced
/// across them. No LLM. Existing slugs are skipped, so a re-run only adds what is
/// new. Primary context = the one with most files.
///
/// Returning an empty list is a normal, correct outcome: it means no label in
/// this map describes anything larger than a single context, and the use cases
/// have to come from the scan (or a human) instead.
pub fn backfill_use_cases_from_business_features(
    pool: &DbPool,
    project_id: &str,
) -> Result<Vec<DevUseCase>, AppError> {
    let contexts = list_contexts_by_project(pool, project_id, None)?;
    let existing: HashSet<String> = list_use_cases(pool, project_id, None)?
        .into_iter()
        .map(|u| u.slug)
        .collect();

    // business_feature label → contexts carrying it (insertion-ordered).
    let mut buckets: Vec<(String, Vec<DevContext>)> = Vec::new();
    for ctx in contexts {
        let Some(label) = ctx
            .business_feature
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        else {
            continue;
        };
        let label = label.to_string();
        match buckets
            .iter_mut()
            .find(|(l, _)| l.eq_ignore_ascii_case(&label))
        {
            Some((_, list)) => list.push(ctx),
            None => buckets.push((label, vec![ctx])),
        }
    }

    let mut created = Vec::new();
    for (label, ctxs) in buckets {
        if created.len() >= MAX_BACKFILL_USE_CASES {
            break;
        }
        // A label on one context is that context's title, not a slice through
        // contexts. Leave it to the scan.
        if ctxs.len() < MIN_BACKFILL_CONTEXTS {
            continue;
        }
        if existing.contains(&slugify_use_case(&label)) {
            continue;
        }
        let file_count = |c: &DevContext| {
            serde_json::from_str::<Vec<String>>(&c.file_paths)
                .map(|v| v.len())
                .unwrap_or(0)
        };
        let primary = ctxs
            .iter()
            .max_by_key(|c| file_count(c))
            .map(|c| c.id.clone());
        let ids: Vec<String> = ctxs.iter().map(|c| c.id.clone()).collect();
        let rationale = format!(
            "Promoted from the business_feature label on {} context{}.",
            ids.len(),
            if ids.len() == 1 { "" } else { "s" }
        );
        match create_use_case(
            pool,
            project_id,
            &label,
            None,
            "capability",
            primary.as_deref(),
            &ids,
            Some("proposed"),
            "backfill",
            Some(&rationale),
        ) {
            Ok(uc) => created.push(uc),
            // A concurrent writer took the slug — skip, don't fail the batch.
            Err(AppError::Validation(_)) => continue,
            Err(e) => return Err(e),
        }
    }
    Ok(created)
}

#[cfg(test)]
mod use_case_tests {
    use super::*;
    use crate::repos::dev::contexts::{clear_project_context_map, create_context};
    use crate::repos::dev::kpis::{create_kpi, get_kpi};
    use crate::repos::dev::projects::create_project;

    fn ctx(pool: &DbPool, project_id: &str, name: &str, files: &str) -> DevContext {
        create_context(
            pool,
            project_id,
            name,
            None,
            None,
            Some(files),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
    }

    #[test]
    fn slugify_normalizes_casing_separators_and_punctuation() {
        assert_eq!(
            slugify_use_case("Checkout Conversion"),
            "checkout-conversion"
        );
        assert_eq!(
            slugify_use_case("checkout_conversion"),
            "checkout-conversion"
        );
        assert_eq!(
            slugify_use_case("  Checkout — Conversion!  "),
            "checkout-conversion"
        );
        assert_eq!(slugify_use_case("LLM Overview v2"), "llm-overview-v2");
        assert_eq!(slugify_use_case("!!!"), "");
    }

    /// The load-bearing invariant: a FULL rescan deletes unpinned contexts,
    /// which cascades away the use-case slice and NULLs context-scoped KPIs.
    /// Snapshot-then-reconcile must restore both by context name, and must drop
    /// exactly the links whose context genuinely disappeared.
    #[test]
    fn reconcile_restores_slice_and_kpi_scope_across_a_full_rescan() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();

        let checkout_ui = ctx(&pool, &project.id, "checkout-ui", r#"["a.tsx"]"#);
        let checkout_api = ctx(&pool, &project.id, "checkout-api", r#"["b.rs"]"#);
        let doomed = ctx(&pool, &project.id, "legacy-widget", r#"["c.ts"]"#);

        let uc = create_use_case(
            &pool,
            &project.id,
            "Checkout conversion",
            None,
            "user_flow",
            Some(&checkout_ui.id),
            &[
                checkout_ui.id.clone(),
                checkout_api.id.clone(),
                doomed.id.clone(),
            ],
            Some("active"),
            "user",
            None,
        )
        .unwrap();
        assert_eq!(uc.context_ids.len(), 3);

        let kpi = create_kpi(
            &pool,
            &project.id,
            "p95 latency",
            None,
            None,
            "technical",
            "codebase",
            "{}",
            "ms",
            "down",
            None,
            None,
            None,
            "weekly",
            Some("active"),
            "user",
            None,
            None,
            None,
            Some(&checkout_api.id),
            None,
        )
        .unwrap();
        assert_eq!(kpi.context_id.as_deref(), Some(checkout_api.id.as_str()));

        // --- what a full rescan does -------------------------------------
        let snapshot = snapshot_context_links(&pool, &project.id).unwrap();
        assert_eq!(snapshot.use_case_contexts.len(), 3);
        assert_eq!(snapshot.kpi_contexts.len(), 1);

        clear_project_context_map(&pool, &project.id).unwrap();
        assert!(get_use_case(&pool, &uc.id).unwrap().context_ids.is_empty());
        assert!(get_kpi(&pool, &kpi.id).unwrap().context_id.is_none());

        // The scan re-emits the surviving features under fresh ids; the legacy
        // context is gone for good.
        let new_ui = ctx(&pool, &project.id, "checkout-ui", r#"["a.tsx"]"#);
        let new_api = ctx(&pool, &project.id, "checkout-api", r#"["b.rs"]"#);

        // --- reconcile ----------------------------------------------------
        let report = reconcile_context_links(&pool, &project.id, &snapshot).unwrap();
        // 2 slice links + 1 primary + 1 KPI restored; the legacy slice link and
        // nothing else dropped.
        assert_eq!(report.dropped, 1, "only the vanished context's link drops");

        let healed = get_use_case(&pool, &uc.id).unwrap();
        assert_eq!(healed.context_ids.len(), 2);
        assert!(healed.context_ids.contains(&new_ui.id));
        assert!(healed.context_ids.contains(&new_api.id));
        assert_eq!(
            healed.primary_context_id.as_deref(),
            Some(new_ui.id.as_str())
        );

        let healed_kpi = get_kpi(&pool, &kpi.id).unwrap();
        assert_eq!(healed_kpi.context_id.as_deref(), Some(new_api.id.as_str()));

        // Idempotent: a delta rescan re-runs this with nothing to do.
        let again = reconcile_context_links(&pool, &project.id, &snapshot).unwrap();
        assert_eq!(again.relinked, 0);
        assert_eq!(get_use_case(&pool, &uc.id).unwrap().context_ids.len(), 2);
    }

    #[test]
    fn backfill_promotes_only_multi_context_features_and_is_idempotent() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();

        // Two contexts share a business feature; the bigger one becomes primary.
        create_context(
            &pool,
            &project.id,
            "checkout-ui",
            None,
            None,
            Some(r#"["a.tsx"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("Checkout"),
        )
        .unwrap();
        let big = create_context(
            &pool,
            &project.id,
            "checkout-api",
            None,
            None,
            Some(r#"["b.rs","c.rs"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("Checkout"),
        )
        .unwrap();
        // A label on exactly ONE context is that context's title, not a slice.
        // On a real 263-context map, 179 of 184 labels looked like this.
        create_context(
            &pool,
            &project.id,
            "billing",
            None,
            None,
            Some(r#"["d.rs"]"#),
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            Some("Billing"),
        )
        .unwrap();
        // No business_feature → contributes no use case.
        ctx(&pool, &project.id, "unlabelled", r#"["e.rs"]"#);

        let created = backfill_use_cases_from_business_features(&pool, &project.id).unwrap();
        assert_eq!(
            created.len(),
            1,
            "only the label spanning >= 2 contexts is promoted"
        );

        let checkout = &created[0];
        assert_eq!(checkout.slug, "checkout");
        assert_eq!(checkout.context_ids.len(), 2);
        assert_eq!(
            checkout.primary_context_id.as_deref(),
            Some(big.id.as_str())
        );
        assert_eq!(
            checkout.status, "proposed",
            "backfill lands in the triage queue"
        );
        assert_eq!(checkout.created_by, "backfill");

        // Re-running adds nothing.
        let again = backfill_use_cases_from_business_features(&pool, &project.id).unwrap();
        assert!(again.is_empty());
        assert_eq!(list_use_cases(&pool, &project.id, None).unwrap().len(), 1);
    }

    /// The real-world shape: every label names exactly one context. The backfill
    /// must create NOTHING rather than mint a use case per context.
    #[test]
    fn backfill_creates_nothing_when_every_label_names_one_context() {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        for (name, label) in [("agent-editor", "Agent Editor"), ("vault", "Vault")] {
            create_context(
                &pool,
                &project.id,
                name,
                None,
                None,
                Some(r#"["a.rs"]"#),
                None,
                None,
                None,
                None,
                None,
                None,
                None,
                Some(label),
            )
            .unwrap();
        }
        let created = backfill_use_cases_from_business_features(&pool, &project.id).unwrap();
        assert!(
            created.is_empty(),
            "1:1 labels are context titles, not use cases"
        );
    }
}
