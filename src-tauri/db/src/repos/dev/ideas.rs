use crate::models::DevIdea;
use crate::query_builder::QueryBuilder;
use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::{params, OptionalExtension, Row};
use std::collections::{HashMap, HashSet};

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
        goal_id: row.get("goal_id").unwrap_or(None),
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

/// [`find_idea_by_id_prefix`] without a project: the replay queue applies
/// outcomes workers wrote to disk, and an `outcome-2e06b79c.json` names no
/// project. Same contract otherwise — at least 8 characters, `None` for no
/// match AND for an ambiguous prefix (never a coin-flip), an exact full id
/// always wins. The reference is restricted to uuid characters so it can sit
/// in a `LIKE` pattern with nothing to escape.
pub fn find_idea_by_id_or_prefix(pool: &DbPool, id_ref: &str) -> Result<Option<DevIdea>, AppError> {
    let id_ref = id_ref.trim();
    if id_ref.len() < 8 || !id_ref.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return Ok(None);
    }
    timed_query!("dev_ideas", "dev_ideas::find_idea_by_id_or_prefix", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {IDEA_COLUMNS} FROM dev_ideas WHERE id LIKE ?1 || '%' ORDER BY id ASC LIMIT 2"
        ))?;
        let mut rows = stmt
            .query_map(params![id_ref], row_to_idea)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        match rows.len() {
            0 => Ok(None),
            1 => Ok(rows.pop()),
            _ => Ok(rows.into_iter().find(|i| i.id == id_ref)),
        }
    })
}

/// The projection [`row_to_idea`] actually consumes, named beside the mapper
/// that reads it so the two cannot drift.
///
/// Deliberately NOT retrofitted onto the pre-existing `SELECT *` queries in
/// this file: doing that in the same change would take the census's
/// `select-star-in-repo` count DOWN through its baseline, which the ratchet
/// treats as a signal to investigate, not as a free win. New queries use it;
/// converting the old ones is its own change.
const IDEA_COLUMNS: &str = "id, project_id, context_id, scan_type, category, title, description, \
     reasoning, status, effort, impact, risk, priority, provider, model, rejection_reason, \
     origin, use_case_id, evidence, dedup_key, goal_id, verify_state, verify_checked_at, \
     verify_evidence, created_at, updated_at";

/// Bind an idea to the goal it serves (G41). `None` clears the binding.
/// Returns whether a row was touched; binding an idea that does not exist is
/// `Ok(false)`, never an invented row.
pub fn set_idea_goal(
    pool: &DbPool,
    idea_id: &str,
    goal_id: Option<&str>,
) -> Result<bool, AppError> {
    timed_query!("dev_ideas", "dev_ideas::set_idea_goal", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let n = conn.execute(
            "UPDATE dev_ideas SET goal_id = ?1, updated_at = ?2 WHERE id = ?3",
            params![goal_id, now, idea_id],
        )?;
        Ok(n > 0)
    })
}

/// What [`bind_idea_goal_if_unset`] did with a filer's goal reference.
#[derive(Debug, Clone)]
pub enum IdeaGoalBinding {
    /// The reference resolved and the idea, which served no goal, now serves it.
    Bound(crate::models::DevGoal),
    /// The idea already served the goal the reference names.
    AlreadyServes(crate::models::DevGoal),
    /// The idea already served a DIFFERENT goal (its id is carried). The first
    /// binding stands: a re-filing is not a licence to move work between goals.
    KeptExisting(String),
    /// The reference named no single goal of the idea's project — nothing
    /// matched, or a prefix matched more than one.
    Unresolved,
}

/// Bind an idea to the goal a filer named, WITHOUT ever overwriting a binding
/// that is already there.
///
/// The one door both filing paths share — the protocol `propose_backlog` and
/// the bridge's `POST /dev-tools/ideas` — so a created row and a dedup hit
/// resolve a goal reference the same way: [`resolve_goal_ref`] against the
/// idea's own project (a full id, an 8+ character prefix, or the exact title).
/// An idea that already serves a goal keeps it; a row filed first without a
/// goal gains one from a later filing that names it.
///
/// [`resolve_goal_ref`]: crate::repos::dev::goals::resolve_goal_ref
pub fn bind_idea_goal_if_unset(
    pool: &DbPool,
    idea_id: &str,
    project_id: &str,
    goal_ref: &str,
) -> Result<IdeaGoalBinding, AppError> {
    let Some(goal) = crate::repos::dev::goals::resolve_goal_ref(pool, project_id, goal_ref)? else {
        return Ok(IdeaGoalBinding::Unresolved);
    };
    let idea = get_idea_by_id(pool, idea_id)?;
    match idea.goal_id.as_deref() {
        Some(held) if held == goal.id => Ok(IdeaGoalBinding::AlreadyServes(goal)),
        Some(held) => Ok(IdeaGoalBinding::KeptExisting(held.to_string())),
        None => {
            timed_query!("dev_ideas", "dev_ideas::bind_idea_goal_if_unset", {
                let conn = pool.get()?;
                let now = chrono::Utc::now().to_rfc3339();
                // `goal_id IS NULL` in the predicate, so a concurrent binder
                // that got there first is never overwritten either.
                let n = conn.execute(
                    "UPDATE dev_ideas SET goal_id = ?1, updated_at = ?2 \
                     WHERE id = ?3 AND goal_id IS NULL",
                    params![goal.id, now, idea_id],
                )?;
                if n > 0 {
                    Ok(IdeaGoalBinding::Bound(goal))
                } else {
                    let held = get_idea_by_id(pool, idea_id)?.goal_id.unwrap_or_default();
                    if held == goal.id {
                        Ok(IdeaGoalBinding::AlreadyServes(goal))
                    } else {
                        Ok(IdeaGoalBinding::KeptExisting(held))
                    }
                }
            })
        }
    }
}

/// The idea holding `dedup_key` in this project, in ANY status.
///
/// The mirror of [`create_idea_deduped`]'s guard: that door answers "was this
/// already filed" with `Ok(None)`, which tells a caller it may not write but
/// not WHAT is already there. A headless filer needs the existing row to report
/// back, or a re-file is indistinguishable from a failure.
pub fn find_idea_by_dedup_key(
    pool: &DbPool,
    project_id: &str,
    dedup_key: &str,
) -> Result<Option<DevIdea>, AppError> {
    timed_query!("dev_ideas", "dev_ideas::find_idea_by_dedup_key", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {IDEA_COLUMNS} FROM dev_ideas WHERE project_id = ?1 AND dedup_key = ?2 \
             ORDER BY created_at DESC, id DESC LIMIT 1"
        ))?;
        stmt.query_row(params![project_id, dedup_key], row_to_idea)
            .optional()
            .map_err(AppError::Database)
    })
}

/// What a re-filing did to an existing backlog row's 1–5 scales.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ScaleBackfill {
    /// Nothing was filled in: every scale the re-filing carried was already
    /// set on the row, or it carried none.
    Unchanged,
    /// At least one NULL scale was filled from the re-filing.
    Rated,
}

/// Fill an existing idea's MISSING 1–5 scales from a re-filing of the same
/// dedup key.
///
/// The dedup guard makes a re-file a no-op, which is right for the TEXT of an
/// idea and wrong for its scales: `dev_ideas.risk` is nullable, and the only
/// rule that accepts an idea without a human (`dev_triage_rules`, typically
/// `risk >= 1 AND risk < 3`) cannot see an unrated row at all. Measured
/// 2026-09-08: 93 pending ideas across six projects, all but one project's
/// unrated — so every App Master opened an ask asking a human to read them.
/// A second filing that carries a score is new information; dropping it on
/// the floor is what kept the backlog unreadable by the machine.
///
/// The write is deliberately one-directional: a NULL is filled, a value that
/// is already there is NEVER overwritten. When the re-filing disagrees with a
/// score that already exists, the FIRST rating stands and the disagreement is
/// appended to `reasoning` — free text nothing parses, unlike `evidence`,
/// which the findings spine writes structured — so a human triaging the row
/// can see that two runs scored it differently.
pub fn backfill_idea_scales(
    pool: &DbPool,
    idea_id: &str,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
) -> Result<(DevIdea, ScaleBackfill), AppError> {
    let existing = get_idea_by_id(pool, idea_id)?;

    let mut fills: Vec<(&'static str, i32)> = Vec::new();
    let mut conflicts: Vec<String> = Vec::new();
    for (name, held, incoming) in [
        ("effort", existing.effort, effort),
        ("impact", existing.impact, impact),
        ("risk", existing.risk, risk),
    ] {
        match (held, incoming) {
            (None, Some(v)) => fills.push((name, v)),
            (Some(h), Some(i)) if h != i => conflicts.push(format!("{name} {h} (re-filed as {i})")),
            _ => {}
        }
    }

    if fills.is_empty() && conflicts.is_empty() {
        return Ok((existing, ScaleBackfill::Unchanged));
    }

    timed_query!("dev_ideas", "dev_ideas::backfill_idea_scales", {
        let now = chrono::Utc::now().to_rfc3339();
        let mut sets: Vec<String> = vec!["updated_at = ?1".into()];
        let mut values: Vec<Box<dyn rusqlite::types::ToSql>> = vec![Box::new(now)];
        let mut idx = 2u32;

        for (name, value) in &fills {
            // `name` is one of three literals above — never caller text.
            sets.push(format!("{name} = ?{idx}"));
            values.push(Box::new(*value));
            idx += 1;
        }
        if !conflicts.is_empty() {
            let note = format!("[re-file] kept the first rating: {}", conflicts.join(", "));
            let reasoning = match existing.reasoning.as_deref() {
                Some(r) if !r.trim().is_empty() => format!("{r}\n{note}"),
                _ => note,
            };
            sets.push(format!("reasoning = ?{idx}"));
            values.push(Box::new(reasoning));
            idx += 1;
        }

        let sql = format!("UPDATE dev_ideas SET {} WHERE id = ?{idx}", sets.join(", "));
        values.push(Box::new(idea_id.to_string()));

        let conn = pool.get()?;
        let params_ref: Vec<&dyn rusqlite::types::ToSql> =
            values.iter().map(|p| p.as_ref()).collect();
        conn.execute(&sql, params_ref.as_slice())?;

        let outcome = if fills.is_empty() {
            ScaleBackfill::Unchanged
        } else {
            ScaleBackfill::Rated
        };
        Ok((get_idea_by_id(pool, idea_id)?, outcome))
    })
}

/// How many of a project's `pending` ideas carry no `risk` score.
///
/// The decide lane renders this beside the pending count: an unrated idea is
/// invisible to the mechanical triage rule, so a backlog that is entirely
/// unrated looks like work waiting on a human when it is really work waiting
/// on a number.
pub fn count_unrated_pending_ideas(pool: &DbPool, project_id: &str) -> Result<i64, AppError> {
    timed_query!("dev_ideas", "dev_ideas::count_unrated_pending_ideas", {
        let conn = pool.get()?;
        conn.query_row(
            "SELECT COUNT(*) AS n FROM dev_ideas \
             WHERE project_id = ?1 AND status = 'pending' AND risk IS NULL",
            params![project_id],
            // Named, not positional: `positional-row-get` is a ratcheting
            // census rule and a new `row.get(0)` raises it.
            |r| r.get("n"),
        )
        .map_err(AppError::Database)
    })
}

/// Resolve an idea by an id PREFIX inside one project.
///
/// The App Master's own decision brief names an idea the way the decision
/// prompt showed it — often the 8-char prefix the UI and the ledger print, not
/// the full uuid. `Ok(None)` means either "no such idea in this project" or
/// "the prefix is ambiguous"; both are the same answer to the caller (it cannot
/// act) and collapsing them keeps the caller from acting on a coin-flip. An
/// exact full-id match always wins over a prefix, so a complete uuid is never
/// refused for being a prefix of something else.
pub fn find_idea_by_id_prefix(
    pool: &DbPool,
    project_id: &str,
    prefix: &str,
) -> Result<Option<DevIdea>, AppError> {
    let prefix = prefix.trim();
    // A very short prefix matches half the table; 8 hex chars is what the app
    // prints, so that is the shortest thing a caller can have MEANT.
    if prefix.len() < 8 {
        return Ok(None);
    }
    timed_query!("dev_ideas", "dev_ideas::find_idea_by_id_prefix", {
        let conn = pool.get()?;
        // LIMIT 2, so an ambiguous prefix is DETECTED rather than silently
        // resolved to whichever row the planner happened to visit first.
        let mut stmt = conn.prepare(&format!(
            "SELECT {IDEA_COLUMNS} FROM dev_ideas WHERE project_id = ?1 AND id LIKE ?2 || '%' \
             ORDER BY id ASC LIMIT 2"
        ))?;
        let mut rows = stmt
            .query_map(params![project_id, prefix], row_to_idea)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        match rows.len() {
            0 => Ok(None),
            1 => Ok(rows.pop()),
            _ => {
                // Ambiguous — unless one of them IS the id verbatim.
                Ok(rows.into_iter().find(|i| i.id == prefix))
            }
        }
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

// ============================================================================
// Near-duplicate filings
// ============================================================================

/// Words that carry no subject when two filings are compared for overlap. A
/// superset of [`IDEA_TITLE_STOPWORDS`]: the dedup KEY keeps its conservative
/// list (changing it would re-key every existing row), but for similarity the
/// connective tissue of a sentence ("has no", "so", "can never") is exactly
/// what two paraphrases do not share and must not count against them.
const IDEA_SIMILARITY_STOPWORDS: &[&str] = &[
    "a", "an", "the", "to", "for", "in", "of", "and", "or", "on", "with", "into", "from", "at",
    "by", "is", "are", "be", "that", "this", "its", "it", "has", "have", "had", "no", "not", "so",
    "s", "can", "cannot", "never", "every", "all", "any", "when", "which", "but", "as", "was",
    "were", "does", "do", "did", "will", "would", "should", "than", "then", "there", "their",
    "they", "we", "our", "one", "only", "also", "just",
];

/// How many description words a filing contributes to the comparison. The
/// head of a description names the finding; the tail is evidence that
/// differs between two honest write-ups of it.
const NEAR_DUPLICATE_DESCRIPTION_WORDS: usize = 40;

/// How far back a decided (`rejected`) idea still counts as "already on the
/// backlog" for a paraphrase. Pending and accepted rows always count.
const NEAR_DUPLICATE_DECIDED_WINDOW_DAYS: i64 = 60;

/// Upper bound on the rows one comparison reads. A project's live backlog is
/// in the hundreds; the cap keeps a filing's cost bounded if it is not.
const NEAR_DUPLICATE_SCAN_LIMIT: i64 = 2000;

/// Title-only rule: this much overlap, over at least this many shared words.
const NEAR_DUPLICATE_TITLE_JACCARD: f64 = 0.6;
const NEAR_DUPLICATE_TITLE_MIN_SHARED: usize = 4;
/// Title-plus-description rule.
const NEAR_DUPLICATE_BODY_JACCARD: f64 = 0.5;
const NEAR_DUPLICATE_BODY_MIN_SHARED: usize = 8;

fn similarity_words(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .map(|w| w.to_lowercase())
        .filter(|w| !w.is_empty() && !IDEA_SIMILARITY_STOPWORDS.contains(&w.as_str()))
}

/// The two word sets a filing is compared on: its title, and its title plus
/// the head of its description.
fn similarity_sets(title: &str, description: Option<&str>) -> (HashSet<String>, HashSet<String>) {
    let title_set: HashSet<String> = similarity_words(title).collect();
    let mut body = title_set.clone();
    if let Some(d) = description {
        body.extend(similarity_words(d).take(NEAR_DUPLICATE_DESCRIPTION_WORDS));
    }
    (title_set, body)
}

/// `(|a ∩ b| / |a ∪ b|, |a ∩ b|)`.
fn jaccard(a: &HashSet<String>, b: &HashSet<String>) -> (f64, usize) {
    let shared = a.intersection(b).count();
    let union = a.len() + b.len() - shared;
    if union == 0 {
        (0.0, 0)
    } else {
        (shared as f64 / union as f64, shared)
    }
}

/// How alike two filings read, or `None` when they are not near-duplicates.
///
/// Two rules, either one enough. The title rule catches a light rewording
/// ("Add retry to the ledger fetch helper" / "Add retries to the fetch helper
/// for the ledger"); its shared-word floor keeps two different changes to one
/// short subject apart ("Add retry to the fetch helper" / "Remove the retry
/// from the fetch helper" share three words and are two findings). The body
/// rule catches the paraphrase whose titles diverge but whose descriptions
/// name the same thing, which is the shape the title-slug key cannot see.
pub fn near_duplicate_score(
    title: &str,
    description: Option<&str>,
    other_title: &str,
    other_description: Option<&str>,
) -> Option<f64> {
    let (t1, b1) = similarity_sets(title, description);
    let (t2, b2) = similarity_sets(other_title, other_description);
    let (tj, tshared) = jaccard(&t1, &t2);
    let (bj, bshared) = jaccard(&b1, &b2);
    let title_hit =
        tj >= NEAR_DUPLICATE_TITLE_JACCARD && tshared >= NEAR_DUPLICATE_TITLE_MIN_SHARED;
    let body_hit = bj >= NEAR_DUPLICATE_BODY_JACCARD && bshared >= NEAR_DUPLICATE_BODY_MIN_SHARED;
    (title_hit || body_hit).then_some(tj.max(bj))
}

/// A backlog row a new filing reads as a paraphrase of.
#[derive(Debug, Clone)]
pub struct NearDuplicateIdea {
    pub idea: DevIdea,
    /// The higher of the two overlap scores, 0-1.
    pub score: f64,
}

/// Find the idea already on the project's backlog that a new filing is an
/// honest paraphrase of, or `None`.
///
/// The exact dedup key ([`scan_dedup_key`]) is built from the title's words,
/// so two write-ups of one finding filed 42 minutes apart by the same persona
/// land as two rows, and one of the pair is later rejected as a duplicate by a
/// human — which is the scarcest resource the loop spends. This reads the
/// project's pending and accepted rows, plus rows rejected within the last
/// [`NEAR_DUPLICATE_DECIDED_WINDOW_DAYS`] days (a recent "no" to the same
/// finding is still an answer), and returns the best match.
///
/// Call it only after the exact key missed: an exact hit is the dedup guard's
/// business, and it can backfill that row without a similarity judgement.
pub fn find_near_duplicate_idea(
    pool: &DbPool,
    project_id: &str,
    title: &str,
    description: Option<&str>,
) -> Result<Option<NearDuplicateIdea>, AppError> {
    if similarity_words(title).next().is_none() {
        return Ok(None);
    }
    let cutoff = (chrono::Utc::now() - chrono::Duration::days(NEAR_DUPLICATE_DECIDED_WINDOW_DAYS))
        .to_rfc3339();
    // Every candidate is scored and the best one wins, so the read needs no
    // ranking: `id` only makes the bounded scan deterministic.
    let candidates = timed_query!("dev_ideas", "dev_ideas::find_near_duplicate_idea", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {IDEA_COLUMNS} FROM dev_ideas \
             WHERE project_id = ?1 \
               AND (status IN ('pending', 'accepted') \
                    OR (status = 'rejected' AND COALESCE(updated_at, created_at) >= ?2)) \
             ORDER BY id LIMIT ?3"
        ))?;
        let rows = stmt
            .query_map(
                params![project_id, cutoff, NEAR_DUPLICATE_SCAN_LIMIT],
                row_to_idea,
            )?
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        Ok::<_, AppError>(rows)
    })?;
    let mut best: Option<NearDuplicateIdea> = None;
    for idea in candidates {
        if let Some(score) =
            near_duplicate_score(title, description, &idea.title, idea.description.as_deref())
        {
            if best.as_ref().is_none_or(|b| score > b.score) {
                best = Some(NearDuplicateIdea { idea, score });
            }
        }
    }
    Ok(best)
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

// ============================================================================
// Platform escalations — an idea about the Personas app, filed by a persona
// that works on something else
// ============================================================================

/// The `scan_type` a platform escalation carries.
///
/// NOT an `origin`: `dev_ideas.origin` is the closed `FINDING_ORIGINS` allowlist
/// (`create_finding` validates it, an exhaustive `Record<FindingOrigin, …>` in
/// `FindingBadge.tsx` renders it, and every entry needs a label in 14 locales),
/// and every origin there also publishes `signal.raised`, which the dispatch ops
/// route off — the exact auto-dispatch a platform escalation must NOT get. So
/// this follows the `APP_MASTER_SCAN_TYPE` precedent instead
/// (`commands/infrastructure/app_master_writeback.rs`): `origin` stays NULL and
/// the producer is named by `scan_type`, exactly as a scanner idea does.
///
/// It is also the token every automatic-dispatch selector excludes on — see
/// `attention::undispatched_ideas_rows` and `dispatch_ideas_core`.
pub const PLATFORM_ESCALATION_SCAN_TYPE: &str = "platform_escalation";

/// Dedup key for a platform escalation.
///
/// Its own key space (not `scan:…`) because the identity is the SUBJECT alone:
/// four App Masters on four different bank repos filing the same Personas defect
/// are one item with four witnesses, so no scope may enter the key. Measured
/// 2026-09-08: "Bind capability parameters before dispatch" was filed by four
/// personas and "Gate the improve lane on at least one completed prior episode"
/// by four more.
pub fn platform_escalation_dedup_key(title: &str) -> String {
    format!("platform:{}", normalize_idea_title(title))
}

/// What [`file_platform_escalation`] did.
#[derive(Debug, Clone)]
pub struct PlatformEscalation {
    pub idea: DevIdea,
    /// True when this filing joined an idea that already existed — the caller
    /// filed a witness, not a new item.
    pub deduped: bool,
}

/// File one platform escalation onto the platform project, or attach this filer
/// to the escalation already there.
///
/// `filing` is one JSON object naming who filed it (persona + the project they
/// work on). It is appended to `evidence.filings`, so the row records every
/// witness rather than only the first — which is what makes a four-persona
/// finding legible as one item with four witnesses.
///
/// Never `Ok(None)`: a duplicate is not a dropped item here, it is a second
/// witness on the one that exists.
pub fn file_platform_escalation(
    pool: &DbPool,
    platform_project_id: &str,
    title: &str,
    description: Option<&str>,
    category: Option<&str>,
    effort: Option<i32>,
    impact: Option<i32>,
    risk: Option<i32>,
    filing: &serde_json::Value,
) -> Result<PlatformEscalation, AppError> {
    // The shared vocabulary, not a hand-written sentence — the neighbours in
    // this file open-code it, and the census counts them (`hand-rolled-emptiness-refusal`).
    personas_core::validation::require_non_empty("Title", title)?;
    let dedup_key = platform_escalation_dedup_key(title);

    if let Some(existing) = find_idea_by_dedup_key(pool, platform_project_id, &dedup_key)? {
        let evidence = append_filing(existing.evidence.as_deref(), filing);
        let idea = set_idea_evidence(pool, &existing.id, &evidence)?;
        return Ok(PlatformEscalation {
            idea,
            deduped: true,
        });
    }

    let evidence = append_filing(None, filing);
    timed_query!("dev_ideas", "dev_ideas::file_platform_escalation", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let canonical_category = category
            .and_then(crate::models::IdeaCategory::from_token)
            .unwrap_or(crate::models::DEFAULT_IDEA_CATEGORY);
        let conn = pool.get()?;
        let inserted = conn.execute(
            "INSERT INTO dev_ideas (id, project_id, scan_type, category, title, description, status, effort, impact, risk, evidence, dedup_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
            params![
                id,
                platform_project_id,
                PLATFORM_ESCALATION_SCAN_TYPE,
                canonical_category.as_str(),
                title,
                description,
                effort,
                impact,
                risk,
                evidence,
                dedup_key,
                now
            ],
        );
        drop(conn);
        match inserted {
            Ok(_) => Ok(PlatformEscalation {
                idea: get_idea_by_id(pool, &id)?,
                deduped: false,
            }),
            // Lost the dedup race to a concurrent filer. The partial UNIQUE
            // index is the real guarantee; the lookup above is the fast path.
            // Re-read and attach the witness to whatever won.
            Err(e) => {
                let err = AppError::Database(e);
                if !is_dedup_unique_violation(&err) {
                    return Err(err);
                }
                let existing = find_idea_by_dedup_key(pool, platform_project_id, &dedup_key)?
                    .ok_or_else(|| {
                        AppError::Internal(
                            "platform escalation lost a dedup race to a row that is not there"
                                .into(),
                        )
                    })?;
                let evidence = append_filing(existing.evidence.as_deref(), filing);
                Ok(PlatformEscalation {
                    idea: set_idea_evidence(pool, &existing.id, &evidence)?,
                    deduped: true,
                })
            }
        }
    })
}

/// Append one filing to an evidence blob's `filings` array, returning the new
/// blob. Tolerates evidence that is absent, unparseable, or not an object —
/// a witness must never be lost to a malformed neighbour, so anything
/// unreadable is preserved verbatim under `priorEvidence`.
fn append_filing(existing: Option<&str>, filing: &serde_json::Value) -> String {
    let mut root = match existing.map(str::trim).filter(|s| !s.is_empty()) {
        Some(raw) => match serde_json::from_str::<serde_json::Value>(raw) {
            Ok(serde_json::Value::Object(map)) => serde_json::Value::Object(map),
            _ => serde_json::json!({ "priorEvidence": raw }),
        },
        None => serde_json::json!({}),
    };
    let filings = root
        .as_object_mut()
        .expect("root is an object by construction")
        .entry("filings")
        .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    if !filings.is_array() {
        *filings = serde_json::Value::Array(Vec::new());
    }
    if let Some(arr) = filings.as_array_mut() {
        arr.push(filing.clone());
    }
    root.to_string()
}

/// Replace an idea's `evidence` blob. Private: the only legitimate reason to
/// rewrite evidence today is attaching another witness to a platform
/// escalation, and a public setter would invite overwriting a sensor's reading.
fn set_idea_evidence(pool: &DbPool, id: &str, evidence: &str) -> Result<DevIdea, AppError> {
    timed_query!("dev_ideas", "dev_ideas::set_idea_evidence", {
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE dev_ideas SET evidence = ?1, updated_at = ?2 WHERE id = ?3",
            params![evidence, now, id],
        )?;
        drop(conn);
        get_idea_by_id(pool, id)
    })
}

// Phase 1 backlog memory spine tests (docs/plans/backlog-memory-loop.md) live in
// their own file for size; `#[path]` keeps them a child module of this one, so
// `use super::*` still reaches the repo's private items.
#[cfg(test)]
#[path = "ideas_backlog_tests.rs"]
mod backlog_memory_tests;

#[cfg(test)]
mod platform_escalation_tests {
    use super::*;
    use crate::repos::dev::projects::create_project;

    fn filing(persona: &str, project: &str) -> serde_json::Value {
        serde_json::json!({
            "personaName": persona,
            "projectName": project,
        })
    }

    /// Four App Masters filing the same Personas defect are ONE item with four
    /// witnesses — the measured case ("Bind capability parameters before
    /// dispatch", filed by four different App Masters on 2026-09-08).
    #[test]
    fn a_second_filer_joins_the_escalation_instead_of_stacking_a_duplicate() {
        let pool = crate::init_test_db().unwrap();
        let platform = create_project(
            &pool,
            "Personas",
            "/repo/personas",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let first = file_platform_escalation(
            &pool,
            &platform.id,
            "Bind capability parameters before dispatch",
            Some("they arrive as literal {{param.*}} placeholders"),
            None,
            None,
            None,
            None,
            &filing("App Master Aurora", "aurora-bank"),
        )
        .unwrap();
        assert!(!first.deduped, "the first filing creates the item");

        // A reworded second filing — `normalize_idea_title` drops the filler
        // words, so the two collapse onto one key.
        let second = file_platform_escalation(
            &pool,
            &platform.id,
            "Bind the capability parameters before a dispatch",
            None,
            None,
            None,
            None,
            None,
            &filing("App Master Meridian", "meridian-bank"),
        )
        .unwrap();
        assert!(second.deduped, "the second filing joins the first");
        assert_eq!(second.idea.id, first.idea.id, "one row, not two");

        assert_eq!(
            list_ideas(&pool, Some(&platform.id), None, None, None, None)
                .unwrap()
                .len(),
            1,
            "the platform backlog holds exactly one item"
        );

        let evidence: serde_json::Value =
            serde_json::from_str(second.idea.evidence.as_deref().unwrap()).unwrap();
        let filings = evidence["filings"].as_array().unwrap();
        assert_eq!(filings.len(), 2, "both witnesses are recorded");
        assert_eq!(filings[0]["personaName"], "App Master Aurora");
        assert_eq!(filings[1]["projectName"], "meridian-bank");
    }

    /// The escalation is tagged so every automatic-dispatch selector can see it.
    #[test]
    fn an_escalation_carries_the_platform_scan_type_and_a_null_origin() {
        let pool = crate::init_test_db().unwrap();
        let platform = create_project(
            &pool,
            "Personas",
            "/repo/personas",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let filed = file_platform_escalation(
            &pool,
            &platform.id,
            "Fix personas_get — broken column reference",
            None,
            None,
            None,
            None,
            None,
            &filing("App Master Aurora", "aurora-bank"),
        )
        .unwrap();

        assert_eq!(filed.idea.scan_type, PLATFORM_ESCALATION_SCAN_TYPE);
        assert_eq!(filed.idea.origin, None, "origin is a closed allowlist");
        assert_eq!(filed.idea.status, "pending");
    }

    /// The mechanical triage rule may still ACCEPT a platform escalation — but
    /// the undispatched-idea sensor, which is what the App Master's decide lane
    /// reads to pick work, must never offer it. A normal accepted idea on the
    /// same project still shows, so the exclusion is the scan_type and not the
    /// query going blind.
    #[test]
    fn an_accepted_escalation_is_invisible_to_the_undispatched_sensor() {
        let pool = crate::init_test_db().unwrap();
        let platform = create_project(
            &pool,
            "Personas",
            "/repo/personas",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let escalation = file_platform_escalation(
            &pool,
            &platform.id,
            "Harden the attention-pass runner against the AmbientContextFusion panic",
            None,
            None,
            None,
            None,
            None,
            &filing("App Master Aurora", "aurora-bank"),
        )
        .unwrap();
        update_idea(
            &pool,
            &escalation.idea.id,
            None,
            None,
            Some("accepted"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let ordinary = create_idea(
            &pool,
            Some(&platform.id),
            None,
            "team_proposed",
            None,
            "Ship the release notes generator",
            None,
            None,
            Some("accepted"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let offered =
            crate::repos::dev::attention::list_undispatched_ideas(&pool, Some(&platform.id), None)
                .unwrap();
        let ids: Vec<&str> = offered.iter().map(|i| i.id.as_str()).collect();
        assert!(
            !ids.contains(&escalation.idea.id.as_str()),
            "a platform escalation is never auto-dispatched, got {ids:?}"
        );
        assert!(
            ids.contains(&ordinary.id.as_str()),
            "an ordinary accepted idea is still offered, got {ids:?}"
        );
    }

    #[test]
    fn unreadable_prior_evidence_is_preserved_rather_than_dropped() {
        let merged = append_filing(Some("not json at all"), &filing("A", "p"));
        let parsed: serde_json::Value = serde_json::from_str(&merged).unwrap();
        assert_eq!(parsed["priorEvidence"], "not json at all");
        assert_eq!(parsed["filings"].as_array().unwrap().len(), 1);
    }
}

#[cfg(test)]
mod goal_binding_tests {
    use super::*;
    use crate::repos::dev::goals::create_goal;
    use crate::repos::dev::projects::create_project;

    fn seeded() -> (DbPool, String, DevIdea) {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(
            &pool,
            "goal-bind",
            "/repo/goal-bind",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let idea = create_idea(
            &pool,
            Some(&project.id),
            None,
            "app-master",
            None,
            "Cache the rate lookup",
            None,
            None,
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        (pool, project.id, idea)
    }

    #[test]
    fn an_unbound_idea_gains_the_goal_its_filer_names_by_title() {
        let (pool, pid, idea) = seeded();
        let goal = create_goal(
            &pool,
            &pid,
            "Settle in under a second",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let out =
            bind_idea_goal_if_unset(&pool, &idea.id, &pid, "settle in under a second").unwrap();
        assert!(
            matches!(out, IdeaGoalBinding::Bound(ref g) if g.id == goal.id),
            "{out:?}"
        );
        assert_eq!(
            get_idea_by_id(&pool, &idea.id).unwrap().goal_id,
            Some(goal.id.clone())
        );

        // Naming it again is not a second binding.
        let again = bind_idea_goal_if_unset(&pool, &idea.id, &pid, &goal.id).unwrap();
        assert!(
            matches!(again, IdeaGoalBinding::AlreadyServes(_)),
            "{again:?}"
        );
    }

    #[test]
    fn a_binding_that_is_already_there_is_never_overwritten() {
        let (pool, pid, idea) = seeded();
        let first = create_goal(&pool, &pid, "First goal", None, None, None, None, None).unwrap();
        let second = create_goal(&pool, &pid, "Second goal", None, None, None, None, None).unwrap();
        set_idea_goal(&pool, &idea.id, Some(&first.id)).unwrap();

        let out = bind_idea_goal_if_unset(&pool, &idea.id, &pid, &second.id).unwrap();
        assert!(
            matches!(out, IdeaGoalBinding::KeptExisting(ref held) if *held == first.id),
            "{out:?}"
        );
        assert_eq!(
            get_idea_by_id(&pool, &idea.id).unwrap().goal_id,
            Some(first.id)
        );
    }

    #[test]
    fn a_reference_naming_no_goal_binds_nothing() {
        let (pool, pid, idea) = seeded();
        create_goal(&pool, &pid, "Real goal", None, None, None, None, None).unwrap();
        let out = bind_idea_goal_if_unset(&pool, &idea.id, &pid, "imaginary goal").unwrap();
        assert!(matches!(out, IdeaGoalBinding::Unresolved), "{out:?}");
        assert_eq!(get_idea_by_id(&pool, &idea.id).unwrap().goal_id, None);
    }
}

#[cfg(test)]
mod near_duplicate_tests {
    use super::*;
    use crate::repos::dev::projects::create_project;

    const REMOTE_A_TITLE: &str = "bank-edge has no git remote, so every delivery ends branch-ready";
    const REMOTE_A_BODY: &str = "The bank-edge repository has no git remote configured, so a \
        delivery run can never open a pull request and every delivery ends at a ready branch.";
    const REMOTE_B_TITLE: &str =
        "bank-edge has no git remote, so the project's charter can never open a pull request";
    const REMOTE_B_BODY: &str = "bank-edge has no git remote. The charter asks for a pull request \
        on every delivery, but with no remote configured the run can never open one.";

    fn seeded(title: &str, description: Option<&str>, status: &str) -> (DbPool, String, DevIdea) {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(
            &pool,
            "near-dup",
            "/repo/near-dup",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        let idea = create_idea(
            &pool,
            Some(&project.id),
            None,
            "app-master",
            None,
            title,
            description,
            None,
            Some(status),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        (pool, project.id, idea)
    }

    /// The two bank-edge filings of 2026-09-08 (eedcf532 / 329ad800): one
    /// finding, two titles, two dedup keys.
    #[test]
    fn the_bank_edge_paraphrases_are_one_finding() {
        assert_ne!(
            scan_dedup_key("app-master", None, REMOTE_A_TITLE),
            scan_dedup_key("app-master", None, REMOTE_B_TITLE),
            "the exact key cannot see this pair; that is the defect"
        );
        let score = near_duplicate_score(
            REMOTE_B_TITLE,
            Some(REMOTE_B_BODY),
            REMOTE_A_TITLE,
            Some(REMOTE_A_BODY),
        );
        assert!(score.is_some(), "the paraphrase must match");

        let (pool, pid, first) = seeded(REMOTE_A_TITLE, Some(REMOTE_A_BODY), "pending");
        let hit = find_near_duplicate_idea(&pool, &pid, REMOTE_B_TITLE, Some(REMOTE_B_BODY))
            .unwrap()
            .expect("the backlog already holds it");
        assert_eq!(hit.idea.id, first.id);
    }

    #[test]
    fn a_light_rewording_of_the_title_matches_without_a_description() {
        assert!(near_duplicate_score(
            "Add retry with backoff to the ledger fetch helper",
            None,
            "Add retry and backoff to ledger fetch helper calls",
            None,
        )
        .is_some());
    }

    /// Same subject, opposite change: two findings, not one.
    #[test]
    fn two_different_changes_to_one_subject_do_not_match() {
        assert!(near_duplicate_score(
            "Add retry to the fetch helper",
            Some("Transient 503s from the rates API fail the whole sync; retry with backoff."),
            "Remove the retry from the fetch helper",
            Some("The retry doubles writes on the ledger endpoint because it is not idempotent."),
        )
        .is_none());
        assert!(
            near_duplicate_score("Cache the rate lookup", None, "Cache the rate table", None)
                .is_none()
        );
    }

    #[test]
    fn an_old_rejection_and_another_project_are_out_of_scope() {
        let (pool, pid, first) = seeded(REMOTE_A_TITLE, Some(REMOTE_A_BODY), "rejected");
        // A fresh rejection still answers.
        assert!(
            find_near_duplicate_idea(&pool, &pid, REMOTE_B_TITLE, Some(REMOTE_B_BODY))
                .unwrap()
                .is_some()
        );
        // An old one does not.
        pool.get()
            .unwrap()
            .execute(
                "UPDATE dev_ideas SET updated_at = '2020-01-01T00:00:00+00:00' WHERE id = ?1",
                params![first.id],
            )
            .unwrap();
        assert!(
            find_near_duplicate_idea(&pool, &pid, REMOTE_B_TITLE, Some(REMOTE_B_BODY))
                .unwrap()
                .is_none()
        );
        // Another project's backlog is never read.
        let other =
            create_project(&pool, "other", "/repo/other", None, None, None, None, None).unwrap();
        assert!(
            find_near_duplicate_idea(&pool, &other.id, REMOTE_A_TITLE, Some(REMOTE_A_BODY))
                .unwrap()
                .is_none()
        );
    }
}
