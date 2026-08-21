use crate::models::DevIdea;
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, Row};
use std::collections::HashMap;

pub(crate) fn row_to_idea(row: &Row) -> rusqlite::Result<DevIdea> {
    Ok(DevIdea {
        id: row.get("id")?,
        project_id: row.get("project_id")?,
        context_id: row.get("context_id")?,
        scan_type: row.get("scan_type")?,
        category: row.get("category")?,
        title: row.get("title")?,
        description: row.get("description")?,
        reasoning: row.get("reasoning")?,
        status: row.get("status")?,
        effort: row.get("effort")?,
        impact: row.get("impact")?,
        risk: row.get("risk")?,
        priority: row.get("priority")?,
        provider: row.get("provider")?,
        model: row.get("model")?,
        rejection_reason: row.get("rejection_reason")?,
        // Findings-spine columns — `unwrap_or(None)` so a row read through a
        // pre-migration connection (or a SELECT that omits them) still maps.
        origin: row.get("origin").unwrap_or(None),
        use_case_id: row.get("use_case_id").unwrap_or(None),
        evidence: row.get("evidence").unwrap_or(None),
        dedup_key: row.get("dedup_key").unwrap_or(None),
        verify_state: row.get("verify_state").unwrap_or(None),
        verify_checked_at: row.get("verify_checked_at").unwrap_or(None),
        verify_evidence: row.get("verify_evidence").unwrap_or(None),
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

// ============================================================================
// Ideas
// ============================================================================

pub fn list_ideas(
    pool: &DbPool,
    project_id: Option<&str>,
    status: Option<&str>,
    category: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
) -> Result<Vec<DevIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::list_ideas", {
        let conn = pool.get()?;
        let mut qb = QueryBuilder::new();

        if let Some(v) = project_id {
            qb.where_eq("project_id", v.to_string());
        }
        if let Some(v) = status {
            qb.where_eq("status", v.to_string());
        }
        if let Some(v) = category {
            qb.where_eq("category", v.to_string());
        }

        qb.order_by("created_at", "DESC");
        qb.limit(limit.unwrap_or(100));
        qb.offset(offset.unwrap_or(0));

        let sql = qb.build_select("SELECT * FROM dev_ideas");
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_idea)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

// ----------------------------------------------------------------------------
// Triage page — keyset pagination + facet counts
//
// `list_ideas` is OFFSET-paginated and count-blind; the triage surface needs a
// stable cursor (rows are inserted while a human triages) and bucket counts
// that survive pagination. Both live here rather than in the command layer so
// the SQL is testable without a Tauri app handle.
// ----------------------------------------------------------------------------

/// Pseudo-origin the triage UI uses for classic Idea-Scanner ideas: only
/// findings-spine sensors stamp a real `origin`, so "scanner" means
/// `origin IS NULL`. Kept as a constant so the filter and the count bucket
/// label can never drift apart.
pub const TRIAGE_SCANNER_ORIGIN: &str = "scanner";

/// Default / maximum page size for `triage_ideas`.
const TRIAGE_DEFAULT_LIMIT: i64 = 50;
const TRIAGE_MAX_LIMIT: i64 = 200;

/// Filters for one triage page. All optional; `project_id: None` is an
/// explicit cross-project read (the unified Backlog default), NOT "no filter
/// chosen yet".
#[derive(Debug, Clone, Default)]
pub struct TriageFilter {
    pub project_id: Option<String>,
    /// Defaults to `pending` when unset.
    pub status: Option<String>,
    /// `scanner` is the pseudo-value for `origin IS NULL`.
    pub origin: Option<String>,
    pub category: Option<String>,
}

/// Bucket counts for the triage surface. Scoped to the NON-status filters, so
/// the status tabs can show every bucket's size while one status is displayed.
#[derive(Debug, Clone, Default, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriageCounts {
    pub total: u32,
    pub pending: u32,
    pub accepted: u32,
    pub rejected: u32,
    pub archived: u32,
    /// Keyed by origin, with `scanner` standing in for `origin IS NULL`.
    pub by_origin: HashMap<String, u32>,
    pub by_category: HashMap<String, u32>,
}

/// One keyset page of triage ideas plus the counts the facet rail renders.
#[derive(Debug, Clone, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct TriagePage {
    pub ideas: Vec<DevIdea>,
    /// `"{created_at}|{id}"` of the last row, or `None` when the page is last.
    pub cursor: Option<String>,
    pub has_more: bool,
    pub counts: TriageCounts,
}

/// WHERE fragments for everything EXCEPT status — shared by the page query and
/// all three count rollups so a filtered page and its counts can't disagree.
fn triage_scope_clauses(
    filter: &TriageFilter,
) -> (Vec<String>, Vec<Box<dyn rusqlite::types::ToSql>>) {
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<Box<dyn rusqlite::types::ToSql>> = Vec::new();

    if let Some(pid) = &filter.project_id {
        clauses.push("project_id = ?".to_string());
        params.push(Box::new(pid.clone()));
    }
    match filter.origin.as_deref() {
        Some(TRIAGE_SCANNER_ORIGIN) => clauses.push("origin IS NULL".to_string()),
        Some(origin) => {
            clauses.push("origin = ?".to_string());
            params.push(Box::new(origin.to_string()));
        }
        None => {}
    }
    if let Some(category) = &filter.category {
        clauses.push("category = ?".to_string());
        params.push(Box::new(category.clone()));
    }

    (clauses, params)
}

fn triage_counts(
    conn: &rusqlite::Connection,
    filter: &TriageFilter,
) -> Result<TriageCounts, AppError> {
    let (clauses, params) = triage_scope_clauses(filter);
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!(" WHERE {}", clauses.join(" AND "))
    };
    let params_ref: Vec<&dyn rusqlite::types::ToSql> = params.iter().map(|p| p.as_ref()).collect();

    let group = |expr: &str| -> Result<HashMap<String, u32>, AppError> {
        let sql = format!(
            "SELECT {expr} AS bucket, COUNT(*) AS n FROM dev_ideas{where_sql} GROUP BY bucket"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt.query_map(params_ref.as_slice(), |row| {
            Ok((
                row.get::<_, String>("bucket")?,
                row.get::<_, i64>("n")?.max(0) as u32,
            ))
        })?;
        rows.collect::<Result<HashMap<_, _>, _>>()
            .map_err(AppError::Database)
    };

    let by_status = group("status")?;
    let by_origin = group(&format!("COALESCE(origin, '{TRIAGE_SCANNER_ORIGIN}')"))?;
    let by_category = group("category")?;

    let bucket = |name: &str| by_status.get(name).copied().unwrap_or(0);
    Ok(TriageCounts {
        total: by_status.values().sum(),
        pending: bucket("pending"),
        accepted: bucket("accepted"),
        rejected: bucket("rejected"),
        archived: bucket("archived"),
        by_origin,
        by_category,
    })
}

/// One keyset page of ideas for the triage surface, newest first.
///
/// Ordering is `created_at DESC, id DESC` and the cursor is the last row's
/// `"{created_at}|{id}"`; `id` breaks ties so two ideas written in the same
/// millisecond can never hide each other across a page boundary. `limit + 1`
/// rows are fetched to learn `has_more` without a second COUNT.
pub fn triage_ideas(
    pool: &DbPool,
    filter: &TriageFilter,
    limit: Option<i64>,
    cursor: Option<&str>,
) -> Result<TriagePage, AppError> {
    timed_query!("dev_ideas", "dev_ideas::triage_ideas", {
        let limit = limit
            .unwrap_or(TRIAGE_DEFAULT_LIMIT)
            .clamp(1, TRIAGE_MAX_LIMIT);
        let status = filter.status.as_deref().unwrap_or("pending");

        let (mut clauses, mut params) = triage_scope_clauses(filter);
        clauses.push("status = ?".to_string());
        params.push(Box::new(status.to_string()));

        if let Some(raw) = cursor.filter(|c| !c.is_empty()) {
            let (created_at, id) = raw
                .split_once('|')
                .ok_or_else(|| AppError::Validation(format!("Malformed triage cursor: {raw}")))?;
            clauses.push("(created_at < ? OR (created_at = ? AND id < ?))".to_string());
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(created_at.to_string()));
            params.push(Box::new(id.to_string()));
        }

        let sql = format!(
            "SELECT * FROM dev_ideas WHERE {} ORDER BY created_at DESC, id DESC LIMIT {}",
            clauses.join(" AND "),
            limit + 1
        );

        let conn = pool.get()?;
        let mut ideas: Vec<DevIdea> = {
            let mut stmt = conn.prepare(&sql)?;
            let params_ref: Vec<&dyn rusqlite::types::ToSql> =
                params.iter().map(|p| p.as_ref()).collect();
            let rows = stmt
                .query_map(params_ref.as_slice(), row_to_idea)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(AppError::Database)?;
            rows
        };

        let has_more = ideas.len() as i64 > limit;
        if has_more {
            ideas.truncate(limit as usize);
        }
        let next_cursor = if has_more {
            ideas.last().map(|i| format!("{}|{}", i.created_at, i.id))
        } else {
            None
        };

        let counts = triage_counts(&conn, filter)?;
        Ok(TriagePage {
            ideas,
            cursor: next_cursor,
            has_more,
            counts,
        })
    })
}

pub fn get_idea_by_id(pool: &DbPool, id: &str) -> Result<DevIdea, AppError> {
    timed_query!("dev_ideas", "dev_ideas::get_idea_by_id", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT * FROM dev_ideas WHERE id = ?1",
            params![id],
            row_to_idea,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => AppError::NotFound(format!("Dev idea {id}")),
            other => AppError::Database(other),
        })
    })
}

#[allow(clippy::too_many_arguments)]
/// Filler words dropped when normalizing an idea title into a dedup token.
/// Deliberately conservative — only words that never carry the *subject* of an
/// idea. Verbs ("add", "fix", "extract") stay: dropping them would collapse
/// "add retry" and "remove retry" onto the same key.
const IDEA_TITLE_STOPWORDS: &[&str] = &[
    "a", "an", "the", "to", "for", "in", "of", "and", "or", "on", "with", "into", "from", "at",
    "by", "is", "are", "be", "that", "this", "its", "it",
];

/// Normalize an idea title into a stable dedup token: lowercased, split on
/// non-alphanumerics, filler words dropped, first 12 significant words joined
/// with `-`. Two rewordings of the same idea ("Add retry to the fetch helper" /
/// "Add retry to fetch helper") collapse to one token, so a re-scan cannot
/// re-surface an item the backlog already holds under a slightly new phrasing.
pub fn normalize_idea_title(title: &str) -> String {
    let mut words: Vec<String> = title
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !IDEA_TITLE_STOPWORDS.contains(w))
        .map(|w| w.to_string())
        .collect();
    words.truncate(12);
    words.join("-")
}

/// Stable dedup key for an LLM-scanner idea. Shares the findings spine's
/// `<producer>:<signal>` key space (see `create_finding`) so BOTH writers into
/// `dev_ideas` are governed by the same idempotency guard — the scanner is no
/// longer a second, unguarded door into the backlog.
///
/// `scope` is the context scoping of the scan (a context id, or `all` for a
/// whole-project scan): the same title raised for two different areas of the
/// codebase is genuinely two ideas, so the scope is part of the identity.
pub fn scan_dedup_key(scan_type: &str, scope: Option<&str>, title: &str) -> String {
    format!(
        "scan:{}:{}:{}",
        scan_type,
        scope.unwrap_or("all"),
        normalize_idea_title(title)
    )
}

pub fn create_idea(
    pool: &DbPool,
    project_id: Option<&str>,
    context_id: Option<&str>,
    scan_type: &str,
    category: Option<&str>,
    title: &str,
    description: Option<&str>,
    reasoning: Option<&str>,
    status: Option<&str>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<DevIdea, AppError> {
    #[allow(clippy::too_many_arguments)]
    insert_idea(
        pool,
        project_id,
        context_id,
        scan_type,
        category,
        title,
        description,
        reasoning,
        status,
        effort,
        impact,
        risk,
        provider,
        model,
        None,
    )
}

/// `create_idea` + the findings spine's idempotency guard. Returns `Ok(None)`
/// when an idea with this `dedup_key` already exists for the project **in ANY
/// status** — including `rejected` and `archived`, so a human "no" and an aged
/// -out item both stay durable and are never re-proposed.
///
/// This is the gate every *generated* idea goes through (LLM scanner, static
/// scan, reflection product-findings, Strategist proposals). Hand-written ideas
/// (`dev_tools_create_idea`) keep the ungated `create_idea` — a human typing a
/// duplicate on purpose is a decision, not a defect.
#[allow(clippy::too_many_arguments)]
pub fn create_idea_deduped(
    pool: &DbPool,
    project_id: &str,
    context_id: Option<&str>,
    scan_type: &str,
    category: Option<&str>,
    title: &str,
    description: Option<&str>,
    reasoning: Option<&str>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<&str>,
    model: Option<&str>,
    dedup_key: &str,
) -> Result<Option<DevIdea>, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if dedup_key.trim().is_empty() {
        return Err(AppError::Validation(
            "Idea dedup_key cannot be empty".into(),
        ));
    }

    {
        let conn = pool.get()?;
        let existing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND dedup_key = ?2",
            params![project_id, dedup_key],
            |r| r.get(0),
        )?;
        if existing > 0 {
            return Ok(None);
        }
    }

    match insert_idea(
        pool,
        Some(project_id),
        context_id,
        scan_type,
        category,
        title,
        description,
        reasoning,
        Some("pending"),
        effort,
        impact,
        risk,
        provider,
        model,
        Some(dedup_key),
    ) {
        Ok(idea) => Ok(Some(idea)),
        // Lost the race to a concurrent writer — same contract as the COUNT
        // guard above: the key exists, so this creation is a no-op.
        Err(e) if is_dedup_unique_violation(&e) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Whether an error is the partial-unique `idx_dev_ideas_dedup_unique` firing —
/// i.e. we lost a dedup race another writer won. The COUNT pre-checks in the
/// guarded doors are a fast-path courtesy; THIS is the actual guarantee.
fn is_dedup_unique_violation(err: &AppError) -> bool {
    matches!(
        err,
        AppError::Database(rusqlite::Error::SqliteFailure(e, _))
            if e.code == rusqlite::ErrorCode::ConstraintViolation
    )
}

/// The single INSERT both `create_idea` and `create_idea_deduped` go through,
/// so the column set can never drift between the guarded and unguarded doors.
#[allow(clippy::too_many_arguments)]
fn insert_idea(
    pool: &DbPool,
    project_id: Option<&str>,
    context_id: Option<&str>,
    scan_type: &str,
    category: Option<&str>,
    title: &str,
    description: Option<&str>,
    reasoning: Option<&str>,
    status: Option<&str>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    provider: Option<&str>,
    model: Option<&str>,
    dedup_key: Option<&str>,
) -> Result<DevIdea, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }

    timed_query!("dev_ideas", "dev_ideas::create_idea", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        // Normalize the incoming category through the canonical vocabulary
        // (see `IdeaCategory` for the mapping). Legacy values from older code
        // paths or LLM hallucinations collapse to the canonical default
        // rather than poisoning the column with a third vocabulary.
        let canonical_category = category
            .and_then(crate::models::IdeaCategory::from_token)
            .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
        let category = canonical_category.as_str();
        let status = status.unwrap_or("pending");

        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, reasoning, status, effort, impact, risk, provider, model, dedup_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?16)",
            params![id, project_id, context_id, scan_type, category, title, description, reasoning, status, effort, impact, risk, provider, model, dedup_key, now],
        )?;

        get_idea_by_id(pool, &id)
    })
}

/// Reversible aging for the backlog: pending SCANNER ideas older than
/// `older_than_days` that never became work (no linked task) move to
/// `archived`. Mirrors the memory engine's `run_decay_forgetting` — nothing is
/// deleted, the row keeps its `dedup_key` (so archiving can never reopen the
/// duplication door), and a human can restore it by setting the status back to
/// `pending`.
///
/// Sensor FINDINGS (`origin IS NOT NULL`) are excluded: their lifecycle
/// belongs to the sensors — every sweep re-measures them — and because dedup
/// blocks re-emission in ANY status, aging one out would silence that sensor
/// signal permanently on a 30-day timer nobody chose.
///
/// Returns the number of ideas archived.
pub fn archive_stale_ideas(
    pool: &DbPool,
    project_id: Option<&str>,
    older_than_days: i64,
) -> Result<i64, AppError> {
    if older_than_days <= 0 {
        return Err(AppError::Validation(
            "archive_stale_ideas: older_than_days must be positive".into(),
        ));
    }

    timed_query!("dev_ideas", "dev_ideas::archive_stale_ideas", {
        let cutoff = (chrono::Utc::now() - chrono::Duration::days(older_than_days)).to_rfc3339();
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let affected = match project_id {
            Some(pid) => conn.execute(
                "UPDATE dev_ideas SET status = 'archived', updated_at = ?1
                 WHERE status = 'pending' AND created_at < ?2 AND project_id = ?3
                   AND origin IS NULL
                   AND NOT EXISTS (SELECT 1 FROM dev_tasks WHERE dev_tasks.source_idea_id = dev_ideas.id)",
                params![now, cutoff, pid],
            )?,
            None => conn.execute(
                "UPDATE dev_ideas SET status = 'archived', updated_at = ?1
                 WHERE status = 'pending' AND created_at < ?2
                   AND origin IS NULL
                   AND NOT EXISTS (SELECT 1 FROM dev_tasks WHERE dev_tasks.source_idea_id = dev_ideas.id)",
                params![now, cutoff],
            )?,
        };

        Ok(affected as i64)
    })
}

/// Create an idea raised by a SENSOR rather than the Idea Scanner — the findings
/// spine (`docs/plans/dev-findings-loop.md`). Separate from `create_idea` so the
/// scanner's 14-arg signature and every existing call site stay untouched.
///
/// `dedup_key` is the idempotency guard: if a non-deleted idea already carries it
/// for this project, nothing is inserted and `Ok(None)` comes back. That includes
/// `rejected` ideas — a human "no" is durable, and only deleting the idea frees
/// the key for re-emission.
#[allow(clippy::too_many_arguments)]
pub fn create_finding(
    pool: &DbPool,
    project_id: &str,
    origin: &str,
    title: &str,
    description: Option<&str>,
    category: Option<&str>,
    context_id: Option<&str>,
    use_case_id: Option<&str>,
    evidence: Option<&str>,
    dedup_key: &str,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
) -> Result<Option<DevIdea>, AppError> {
    if title.trim().is_empty() {
        return Err(AppError::Validation("Title cannot be empty".into()));
    }
    if !crate::models::FINDING_ORIGINS.contains(&origin) {
        return Err(AppError::Validation(format!(
            "Unknown finding origin: {origin}"
        )));
    }
    if dedup_key.trim().is_empty() {
        return Err(AppError::Validation(
            "Finding dedup_key cannot be empty".into(),
        ));
    }

    timed_query!("dev_ideas", "dev_ideas::create_finding", {
        let conn = pool.get()?;

        let existing: i64 = conn.query_row(
            "SELECT COUNT(*) FROM dev_ideas WHERE project_id = ?1 AND dedup_key = ?2",
            params![project_id, dedup_key],
            |r| r.get(0),
        )?;
        if existing > 0 {
            return Ok(None);
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let canonical_category = category
            .and_then(crate::models::IdeaCategory::from_token)
            .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);

        let inserted = conn.execute(
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, description, status, effort, impact, risk, origin, use_case_id, evidence, dedup_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            params![
                id,
                project_id,
                context_id,
                origin, // scan_type doubles as the sensor tag, so the Scoreboard groups findings too
                canonical_category.as_str(),
                title,
                description,
                effort,
                impact,
                risk,
                origin,
                use_case_id,
                evidence,
                dedup_key,
                now
            ],
        );
        match inserted {
            Ok(_) => {}
            // Lost the dedup race to a concurrent sweep — same contract as the
            // COUNT guard above (the partial UNIQUE index is the real guarantee).
            Err(e) => {
                let err = AppError::Database(e);
                if is_dedup_unique_violation(&err) {
                    return Ok(None);
                }
                return Err(err);
            }
        }

        drop(conn);
        let idea = get_idea_by_id(pool, &id)?;
        // A sensor raised something — tell the bus. `signal.raised` is what the
        // dispatch ops (Task Runner vs Fleet) will route off.
        publish_signal_event(
            pool,
            &idea,
            personas_core::events::event_name::SIGNAL_RAISED,
        );
        Ok(Some(idea))
    })
}

/// Publish a findings-loop SIGNAL onto the persona-event bus.
///
/// Called from `create_finding` and `set_finding_verify_state` — i.e. from the repo,
/// not from the sweep — so every path that raises a finding or lands a verdict emits,
/// and no future caller can silently starve a route by forgetting to. These events are
/// what the dispatch ops route off (`signal.raised` → run it; `signal.verified` → learn
/// from it), and they surface in the Live Stream for free.
///
/// Best-effort: a bus failure must never fail the write that triggered it. The finding
/// is the source of truth; the event is a notification.
fn publish_signal_event(pool: &DbPool, idea: &DevIdea, event_type: &str) {
    let payload = serde_json::json!({
        "idea_id": idea.id,
        "origin": idea.origin,
        "dedup_key": idea.dedup_key,
        "title": idea.title,
        "project_id": idea.project_id,
        "context_id": idea.context_id,
        "use_case_id": idea.use_case_id,
        "impact": idea.impact,
        "effort": idea.effort,
        "risk": idea.risk,
        "verify_state": idea.verify_state,
        "evidence": idea.evidence,
    });
    let input = crate::models::CreatePersonaEventInput {
        event_type: event_type.to_string(),
        source_type: "findings".into(),
        source_id: Some(idea.id.clone()),
        // No target persona: a signal is an observation, not an instruction. A trigger
        // (or a dispatch op) decides who — if anyone — acts on it.
        target_persona_id: None,
        project_id: idea.project_id.clone(),
        payload: Some(payload.to_string()),
        use_case_id: idea.use_case_id.clone(),
    };
    if let Err(e) = crate::repos::communication::events::publish(pool, input) {
        tracing::warn!(error = %e, event_type, "failed to publish findings signal event");
    }
}

/// Record a verification verdict on a finding (Phase 3A). `verify_evidence` is the
/// re-measured reading, so the verdict can be audited against the original
/// `evidence` instead of taken on trust.
pub fn set_finding_verify_state(
    pool: &DbPool,
    id: &str,
    verify_state: &str,
    verify_evidence: Option<&str>,
) -> Result<(), AppError> {
    if !crate::models::VERIFY_STATES.contains(&verify_state) {
        return Err(AppError::Validation(format!(
            "Unknown verify_state: {verify_state}"
        )));
    }
    timed_query!("dev_ideas", "dev_ideas::set_verify_state", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_ideas SET verify_state = ?1, verify_evidence = ?2, verify_checked_at = ?3, updated_at = ?3 WHERE id = ?4",
            params![verify_state, verify_evidence, now, id],
        )?;
        drop(conn);

        // A verdict landed — tell the bus. This is what B-side learning and any
        // future "the fix regressed, re-open it" route hang off.
        //
        // `pending` is NOT a verdict: the sweep writes it when a sensor did not
        // probe, and `finalize_task` writes it to ARM a re-check when work
        // ships. Publishing `signal.verified` for either would announce a
        // judgement nobody made and put a "verified" row in the Live Stream for
        // an unjudged finding. Arming is silent; only real verdicts speak.
        if verify_state != "pending" {
            if let Ok(idea) = get_idea_by_id(pool, id) {
                publish_signal_event(
                    pool,
                    &idea,
                    personas_core::events::event_name::SIGNAL_VERIFIED,
                );
            }
        }
        Ok(())
    })
}

/// Every dedup key already spoken for on this project — the sweep's pre-filter,
/// so N drafts cost one query instead of N existence checks.
pub fn list_finding_dedup_keys(pool: &DbPool, project_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::list_dedup_keys", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT dedup_key FROM dev_ideas WHERE project_id = ?1 AND dedup_key IS NOT NULL",
        )?;
        let rows = stmt.query_map(params![project_id], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    })
}

#[allow(clippy::too_many_arguments)]
/// Strategist triage: set (or clear) an idea's rank. 1 = do next.
pub fn set_idea_priority(pool: &DbPool, id: &str, priority: Option<i32>) -> Result<(), AppError> {
    timed_query!("dev_ideas", "dev_ideas::set_priority", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_ideas SET priority = ?1, updated_at = ?2 WHERE id = ?3",
            params![priority, now, id],
        )?;
        Ok(())
    })
}

pub fn update_idea(
    pool: &DbPool,
    id: &str,
    title: Option<&str>,
    description: Option<Option<&str>>,
    status: Option<&str>,
    category: Option<&str>,
    effort: Option<Option<i32>>,
    impact: Option<Option<i32>>,
    risk: Option<Option<i32>>,
    rejection_reason: Option<Option<&str>>,
) -> Result<DevIdea, AppError> {
    timed_query!("dev_ideas", "dev_ideas::update_idea", {
        get_idea_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut param_idx = 2u32;

        push_field!(title, "title", sets, param_idx);
        push_field!(description, "description", sets, param_idx);
        push_field!(status, "status", sets, param_idx);
        push_field!(category, "category", sets, param_idx);
        push_field!(effort, "effort", sets, param_idx);
        push_field!(impact, "impact", sets, param_idx);
        push_field!(risk, "risk", sets, param_idx);
        push_field!(rejection_reason, "rejection_reason", sets, param_idx);

        let sql = format!(
            "UPDATE dev_ideas SET {} WHERE id = ?{}",
            sets.join(", "),
            param_idx
        );

        let mut param_values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
        if let Some(v) = title {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = description {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        if let Some(v) = status {
            param_values.push(Box::new(v.to_string()));
        }
        if let Some(v) = category {
            // Normalize through the canonical vocabulary so callers writing
            // legacy values can't reintroduce vocabulary drift via update.
            let canonical = crate::models::IdeaCategory::from_token(v)
                .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
            param_values.push(Box::new(canonical.as_str().to_string()));
        }
        if let Some(v) = effort {
            param_values.push(Box::new(v));
        }
        if let Some(v) = impact {
            param_values.push(Box::new(v));
        }
        if let Some(v) = risk {
            param_values.push(Box::new(v));
        }
        if let Some(v) = rejection_reason {
            param_values.push(Box::new(v.map(|s| s.to_string())));
        }
        param_values.push(Box::new(id.to_string()));

        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            param_values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        get_idea_by_id(pool, id)
    })
}

/// Compare-and-swap a backlog idea's triage status.
///
/// The status write behind [`crate::repos::dev_tools`]-fed verdicts, with the
/// `AND status = ?expected` predicate that `update_idea` never had. Reviews got
/// this in `manual_reviews::update_status`; ideas did not, so two surfaces
/// holding the same row could each write a verdict and each fire its own side
/// effects (the decision memory, the workspace adoption sync) — leaving a
/// `rejected` constraint memory attached to an `accepted` idea with nothing
/// warning anyone.
///
/// `expected` is the status the CALLER SAW, not a re-read: that is the whole
/// point. A deck that dealt a `pending` row passes `pending`, so a verdict
/// written from a stale card loses to whoever already decided. A reviewer
/// deliberately changing their mind from the Backlog table passes the status
/// the row actually shows and still wins — reversing a decision you can see is
/// a decision; overwriting one you never saw is data loss.
///
/// Returns [`AppError::Validation`] on a lost swap. The MESSAGE is a contract:
/// `src/lib/decisions/rowWrites.ts` (`isDecisionConflict`) and the error registry
/// both match `/already (decided|resolved) … by a concurrent action/` to tell a
/// lost swap apart from a failed write — the two make optimistic surfaces behave
/// differently, so reword it and they silently degrade to "could not record that
/// decision". `src/lib/decisions/__tests__/rowWrites.test.ts` pins the exact
/// strings all three row types emit.
pub fn decide_idea_cas(
    pool: &DbPool,
    id: &str,
    expected: &str,
    new_status: &str,
    rejection_reason: Option<Option<&str>>,
) -> Result<DevIdea, AppError> {
    timed_query!("dev_ideas", "dev_ideas::decide_idea_cas", {
        // Existence check: a missing row must read as NotFound, never as a
        // conflict.
        get_idea_by_id(pool, id)?;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;

        // Two statements rather than one COALESCE: a reject that carries no
        // reason must be able to write NULL (matching `update_idea`'s
        // `Option<Option<_>>` contract), while an accept must not touch the
        // column at all.
        let rows = match rejection_reason {
            Some(reason) => conn.execute(
                "UPDATE dev_ideas SET status = ?1, rejection_reason = ?2, updated_at = ?3
                 WHERE id = ?4 AND status = ?5",
                params![new_status, reason, now, id, expected],
            )?,
            None => conn.execute(
                "UPDATE dev_ideas SET status = ?1, updated_at = ?2 WHERE id = ?3 AND status = ?4",
                params![new_status, now, id, expected],
            )?,
        };

        if rows == 0 {
            // Re-read so the message names the status that actually won, not
            // the one the loser was holding.
            let actual = get_idea_by_id(pool, id)?;
            return Err(AppError::Validation(format!(
                "Backlog idea {id} was already decided as '{}' by a concurrent action",
                actual.status
            )));
        }

        get_idea_by_id(pool, id)
    })
}

pub fn delete_idea(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("dev_ideas", "dev_ideas::delete_idea", {
        let conn = pool.get()?;
        let rows = conn.execute("DELETE FROM dev_ideas WHERE id = ?1", params![id])?;
        Ok(rows > 0)
    })
}

pub fn bulk_delete_ideas(pool: &DbPool, ids: &[String]) -> Result<usize, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    timed_query!("dev_ideas", "dev_ideas::bulk_delete_ideas", {
        let conn = pool.get()?;
        let placeholders: Vec<String> = ids
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect();
        let sql = format!(
            "DELETE FROM dev_ideas WHERE id IN ({})",
            placeholders.join(", ")
        );
        let params_ref: Vec<&dyn rusqlite::types::ToSql> = ids
            .iter()
            .map(|s| s as &dyn rusqlite::types::ToSql)
            .collect();
        let rows = conn.execute(&sql, params_ref.as_slice())?;
        Ok(rows)
    })
}

// Phase 1 backlog memory spine tests (docs/plans/backlog-memory-loop.md) live in
// their own file for size; `#[path]` keeps them a child module of this one, so
// `use super::*` still reaches the repo's private items.
#[cfg(test)]
#[path = "ideas_backlog_tests.rs"]
mod backlog_memory_tests;
