use rusqlite::params;

use crate::db::models::{
    validate_category, validate_importance, CreatePersonaMemoryInput, PersonaMemory,
    DEFAULT_MEMORY_CATEGORY,
};
use crate::db::query_builder::QueryBuilder;
use crate::db::repos::utils::collect_rows;
use crate::db::DbPool;
use crate::error::AppError;

/// Strip HTML/XML tags from a string to prevent stored XSS.
///
/// This is a defence-in-depth measure: persona memory content is AI-generated
/// and could contain injected HTML payloads. We strip tags before persisting
/// to SQLite so that the data is safe regardless of how the frontend renders it.
///
/// Uses the `ammonia` crate to properly distinguish real HTML tags from
/// legitimate text containing `<` / `>` (e.g. math expressions, code snippets).
/// After stripping, HTML entities are decoded back so stored content remains
/// human-readable (the frontend renders as plain text, not raw HTML).
fn strip_html_tags(input: &str) -> String {
    let cleaned = ammonia::Builder::new()
        .tags(std::collections::HashSet::new())
        .clean(input)
        .to_string();
    // Decode entities that ammonia introduced for non-tag angle brackets.
    // Order matters: &amp; must be last so we don't double-decode.
    cleaned
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&amp;", "&")
}

/// Normalize tags to a canonical JSON array string.
///
/// Accepts either a JSON array (e.g. `["a","b"]`) or comma-separated
/// values (e.g. `"a,b"`) and always returns a JSON array string.
fn normalize_tags(raw: Option<String>) -> Option<String> {
    let raw = raw?;
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    // If it already parses as a JSON array of strings, pass through
    if let Ok(arr) = serde_json::from_str::<Vec<String>>(trimmed) {
        return Some(serde_json::to_string(&arr).unwrap_or_default());
    }
    // Otherwise treat as comma-separated
    let tags: Vec<String> = trimmed
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    if tags.is_empty() {
        None
    } else {
        Some(serde_json::to_string(&tags).unwrap_or_default())
    }
}

/// Escape LIKE metacharacters (%, _) so they are matched literally.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// `tier` filter sentinel meaning "every tier except archive" — the default
/// Memories list view (archived memories are curated-out but still reachable
/// via the explicit Archived filter).
pub const TIER_NON_ARCHIVED: &str = "!archive";

fn build_memory_filters(
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    tier: Option<&str>,
) -> QueryBuilder {
    let mut qb = QueryBuilder::new();

    if let Some(pid) = persona_id {
        qb.where_eq("persona_id", pid.to_string());
    }
    if let Some(cat) = category {
        qb.where_eq("category", cat.to_string());
    }
    match tier {
        Some(TIER_NON_ARCHIVED) => {
            qb.where_raw(|i| format!("tier != ?{i}"), vec![Box::new("archive".to_string())]);
        }
        Some(t) if !t.is_empty() => {
            qb.where_eq("tier", t.to_string());
        }
        _ => {}
    }
    // Hide the raw Stop-hook "Session capture" rows (category=context, working
    // tier) from general listings — they're raw transcript/cwd telemetry, not
    // curated memories, and were flooding the user's Memories surface (~half of
    // all rows). They stay in the table for the lifecycle/compile pass; a caller
    // that explicitly asks for category='context' (a raw/debug view) still sees
    // them.
    if category != Some("context") {
        qb.where_raw(
            |i| format!("NOT (category = ?{i} AND tier = 'working')"),
            vec![Box::new("context".to_string())],
        );
    }
    if let Some(q) = search {
        let trimmed = q.trim();
        if !trimmed.is_empty() {
            let pattern = format!("%{}%", escape_like(trimmed));
            qb.where_like_escape_any(&["title", "content"], pattern);
        }
    }

    qb
}

row_mapper!(row_to_memory -> PersonaMemory {
    id, persona_id, title, content, category,
    source_execution_id, importance, tags,
    tier [opt_str],
    access_count [opt_i32],
    last_accessed_at [opt],
    created_at, updated_at,
    use_case_id [opt],
    home_team_id [opt],
    derived_from [opt],
    open_claim_count [opt_i32],
});

/// Map user-provided sort column to a safe SQL column name.
fn validated_sort_column(col: Option<&str>) -> &str {
    match col {
        Some("importance") => "importance",
        Some("title") => "title",
        Some("category") => "category",
        Some("updated_at") => "updated_at",
        // Default to created_at
        _ => "created_at",
    }
}

fn validated_sort_direction(dir: Option<&str>) -> &str {
    match dir {
        Some(d) if d.eq_ignore_ascii_case("asc") => "ASC",
        _ => "DESC",
    }
}

#[allow(clippy::too_many_arguments)]
pub fn get_all(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    tier: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_column: Option<&str>,
    sort_direction: Option<&str>,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_all", {
        let limit = limit.unwrap_or(50);
        let offset = offset.unwrap_or(0);
        let order_col = validated_sort_column(sort_column);
        let order_dir = validated_sort_direction(sort_direction);

        let conn = pool.get()?;

        let mut qb = build_memory_filters(persona_id, category, search, tier);
        qb.order_by(order_col, order_dir);
        qb.limit(limit);
        qb.offset(offset);

        let sql = qb.build_select("SELECT * FROM persona_memories");
        let mut stmt = conn.prepare_cached(&sql)?;
        let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_memory)?;
        let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_all");
        Ok(results)
    })
}

/// Bulk-fetch all memories for multiple persona IDs in a single query.
pub fn get_all_by_persona_ids(
    pool: &DbPool,
    persona_ids: &[String],
) -> Result<Vec<PersonaMemory>, AppError> {
    if persona_ids.is_empty() {
        return Ok(Vec::new());
    }
    timed_query!(
        "persona_memories",
        "persona_memories::get_all_by_persona_ids",
        {
            let conn = pool.get()?;
            let mut qb = QueryBuilder::new();
            qb.where_in(
                "persona_id",
                persona_ids.iter().map(|s| s.to_string()).collect(),
            );
            // Exclude raw Stop-hook session-captures from the bulk surface view
            // (see build_memory_filters) — telemetry, not curated memory.
            qb.where_raw(
                |i| format!("NOT (category = ?{i} AND tier = 'working')"),
                vec![Box::new("context".to_string())],
            );
            qb.order_by("created_at", "DESC");
            let sql = qb.build_select("SELECT * FROM persona_memories");
            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map(qb.params_ref().as_slice(), row_to_memory)?;
            Ok(collect_rows(rows, "memories::get_all_by_persona_ids"))
        }
    )
}

crud_get_by_id!(
    PersonaMemory,
    "persona_memories",
    "PersonaMemory",
    row_to_memory
);

pub fn get_by_persona(
    pool: &DbPool,
    persona_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_by_persona", {
        let limit = limit.unwrap_or(50);
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_memories WHERE persona_id = ?1
             ORDER BY importance DESC, created_at DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_memory)?;
        let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_by_persona");
        Ok(results)
    })
}

pub fn get_by_execution(pool: &DbPool, execution_id: &str) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_by_execution", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_memories WHERE source_execution_id = ?1
             ORDER BY created_at ASC",
        )?;
        let rows = stmt.query_map(params![execution_id], row_to_memory)?;
        let results: Vec<PersonaMemory> = collect_rows(rows, "memories::get_by_execution");
        Ok(results)
    })
}

/// Count memories linked to a specific execution (used for post-mortem dedup check).
pub fn count_by_execution(pool: &DbPool, execution_id: &str) -> Result<i64, AppError> {
    timed_query!(
        "persona_memories",
        "persona_memories::count_by_execution",
        {
            let conn = pool.get()?;
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM persona_memories WHERE source_execution_id = ?1",
                params![execution_id],
                |row| row.get(0),
            )?;
            Ok(count)
        }
    )
}

pub fn create(pool: &DbPool, input: CreatePersonaMemoryInput) -> Result<PersonaMemory, AppError> {
    timed_query!("persona_memories", "persona_memories::create", {
        let title = strip_html_tags(&input.title);
        let content = strip_html_tags(&input.content);

        if title.trim().is_empty() {
            return Err(AppError::Validation("Title cannot be empty".into()));
        }
        if content.trim().is_empty() {
            return Err(AppError::Validation("Content cannot be empty".into()));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let category = input.category.as_deref().unwrap_or(DEFAULT_MEMORY_CATEGORY);
        validate_category(category)?;
        let category = category.to_string();
        let importance = match input.importance {
            Some(v) => validate_importance(v)?,
            None => 3,
        };

        let conn = pool.get()?;

        // Write-path semantic dedup (2026-07 — supersedes the old 24h
        // exact-content guard). The original guard only skipped BYTE-identical
        // rows created within 24h; the audited Stock-Price-Logger case landed
        // identical memories from runs MORE than 24h apart, and case/whitespace
        // variants (" AAPL Closed " vs "aapl closed") slipped through exact
        // match entirely. We now normalize (trim, collapse internal whitespace,
        // lowercase — the SAME `normalize_for_dedup` the manual cleanup path
        // `find_duplicate_groups` uses) and skip the insert when the persona
        // already holds a matching NON-core, NON-archive memory in the same
        // capability scope. On hit we touch the survivor's `updated_at` (so the
        // recency clock reflects this re-observation — feeds the active-tier
        // decay in `get_for_injection_v2`) and return it, so callers
        // (dispatch.rs, batch flows) still see a normal `Ok` with a stable id.
        //
        // Merge guards (MEMORY CONTRACT §1): `core` is never a dedup target
        // (user-pinned is sacred — an identical fresh memory is inserted as a
        // normal `active` row rather than folded into a core one), and the
        // candidate query is bounded by `persona_id` so it can never cross
        // personas.
        let normalized = normalize_for_dedup(&content);
        if let Some(existing_id) = find_normalized_duplicate(
            &conn,
            &input.persona_id,
            &normalized,
            input.use_case_id.as_deref(),
        )? {
            conn.execute(
                "UPDATE persona_memories SET updated_at = ?1 WHERE id = ?2",
                params![now, existing_id],
            )?;
            tracing::info!(
                persona_id = %input.persona_id,
                title = %title,
                existing_id = %existing_id,
                "Skipping memory insert — normalized-content duplicate (write-path dedup)"
            );
            return get_by_id(pool, &existing_id);
        }

        conn.execute(
            "INSERT INTO persona_memories
             (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at, use_case_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
            params![
                id,
                input.persona_id,
                title,
                content,
                category,
                input.source_execution_id,
                importance,
                normalize_tags(input.tags.map(|j| serde_json::to_string(&j.0).unwrap_or_default())),
                now,
                input.use_case_id,
            ],
        )?;

        // Embed-on-write (MEMORY CONTRACT (7)) — fire-and-forget, ml builds
        // only, never blocks or fails the insert. The dedup early-return above
        // deliberately does NOT re-embed: the survivor's vector either exists
        // or the backfill pass will index it.
        spawn_embed_memory(id.clone(), memory_embedding_text_parts(&title, &content));

        get_by_id(pool, &id)
    })
}

/// Create a synthesized (reflection-derived) memory with provenance.
///
/// Delegates to [`create`] for validation + HTML-strip + 24h dedup, then
/// stamps `derived_from` with the source memory ids. If the dedup guard
/// returned an existing identical row, the provenance is attached to that
/// row instead — the lineage is the same either way.
///
/// `home_team_id`: set by TEAM reflection so the insight is shared with
/// every member of the team at injection time (MEMORY CONTRACT (5) — this
/// is the one sanctioned runtime writer of the column). `None` for
/// persona-scoped reflection.
pub fn create_synthesized(
    pool: &DbPool,
    input: CreatePersonaMemoryInput,
    derived_from: &[String],
    home_team_id: Option<&str>,
) -> Result<PersonaMemory, AppError> {
    let created = create(pool, input)?;
    if !derived_from.is_empty() || home_team_id.is_some() {
        let json = serde_json::to_string(derived_from)
            .map_err(|e| AppError::Internal(format!("serialize derived_from: {e}")))?;
        let conn = pool.get()?;
        conn.execute(
            "UPDATE persona_memories
             SET derived_from = ?1,
                 home_team_id = COALESCE(?2, home_team_id)
             WHERE id = ?3",
            params![json, home_team_id, created.id],
        )?;
    }
    get_by_id(pool, &created.id)
}

/// All `active`-tier memories for a persona — the candidate set for the
/// decay-based forgetting pass (`engine::memory_recall::run_decay_forgetting`).
/// `core` is user-pinned and `working`/`archive` are handled by
/// [`run_lifecycle`]'s existing rules, so only `active` decays.
pub fn get_active_for_decay(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_active_for_decay", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_memories
             WHERE persona_id = ?1 AND tier = 'active'",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_memory)?;
        Ok(collect_rows(rows, "memories::get_active_for_decay"))
    })
}

/// Why a row was rejected by `batch_create`. Stays a `&'static str` so
/// callers can match without allocating per-row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MemorySkipReason {
    /// Index into the original `inputs` vec passed to `batch_create`.
    pub index: usize,
    /// Stable token. Current values: `"empty_title_or_content"`,
    /// `"invalid_category"`, `"duplicate_content"` (normalized-content
    /// write-path dedup — see `find_normalized_duplicate`). Add new tokens
    /// here when adding new skip branches so dashboards can group on them.
    pub reason: &'static str,
}

/// Structured outcome of [`batch_create`]. Replaces the prior bare `i64` so
/// callers (and dashboards) can attribute "we passed in 100 memories and got
/// back 85" — the missing 15 used to be silently dropped.
#[derive(Debug, Clone, Default)]
pub struct BatchCreateMemoryResult {
    pub inserted: i64,
    pub skipped: Vec<MemorySkipReason>,
}

/// Insert multiple memories in a single transaction without read-back.
///
/// Returns the count of successfully inserted rows AND a per-row reason for
/// every skipped input. Skips are also logged at `tracing::warn!` so the
/// audit/healing infrastructure can pick them up — silent rejection of
/// AI-extracted memories is the failure mode this signature is designed
/// to prevent.
pub fn batch_create(
    pool: &DbPool,
    inputs: Vec<CreatePersonaMemoryInput>,
) -> Result<BatchCreateMemoryResult, AppError> {
    if inputs.is_empty() {
        return Ok(BatchCreateMemoryResult::default());
    }
    timed_query!("persona_memories", "persona_memories::batch_create", {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now().to_rfc3339();
        let mut count: i64 = 0;
        let mut skipped: Vec<MemorySkipReason> = Vec::new();
        // (id, embedding text) of rows actually inserted — embedded after the
        // transaction commits so a rollback can't leave vectors for rows that
        // never landed.
        let mut to_embed: Vec<(String, String)> = Vec::new();

        // Preload existing normalized-content signatures for every persona in
        // this batch so write-path dedup costs ONE query per distinct persona
        // instead of one per row. Keyed by (persona_id, use_case_id,
        // normalized_content); we also insert this batch's own rows into the
        // set as we go, so a batch that contains its OWN duplicates collapses
        // them too. Mirrors `create`'s dedup (core/archive excluded — never
        // dedup targets). See `find_normalized_duplicate` for the rationale and
        // the future embedding-dedup hook point.
        let mut seen: std::collections::HashSet<(String, Option<String>, String)> =
            std::collections::HashSet::new();
        {
            let persona_ids: std::collections::HashSet<String> =
                inputs.iter().map(|i| i.persona_id.clone()).collect();
            let mut sel = tx.prepare(
                "SELECT content, use_case_id FROM persona_memories
                 WHERE persona_id = ?1 AND tier NOT IN ('core', 'archive')",
            )?;
            for pid in &persona_ids {
                let rows = sel.query_map(params![pid], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, Option<String>>(1)?,
                    ))
                })?;
                for row in rows {
                    let (content, uc) = row?;
                    seen.insert((pid.clone(), uc, normalize_for_dedup(&content)));
                }
            }
        }

        {
            let mut stmt = tx.prepare(
                "INSERT INTO persona_memories
                 (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at, use_case_id)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10)",
            )?;

            for (index, input) in inputs.into_iter().enumerate() {
                let title = strip_html_tags(&input.title);
                let content = strip_html_tags(&input.content);
                if title.trim().is_empty() || content.trim().is_empty() {
                    let reason = "empty_title_or_content";
                    tracing::warn!(
                        index,
                        persona_id = %input.persona_id,
                        reason,
                        "memories::batch_create skipping row: title or content is empty after HTML strip"
                    );
                    skipped.push(MemorySkipReason { index, reason });
                    continue;
                }
                let id = uuid::Uuid::new_v4().to_string();
                let category = input.category.as_deref().unwrap_or(DEFAULT_MEMORY_CATEGORY);
                if validate_category(category).is_err() {
                    let reason = "invalid_category";
                    tracing::warn!(
                        index,
                        persona_id = %input.persona_id,
                        category = %category,
                        reason,
                        "memories::batch_create skipping row: category is not in the recognised set"
                    );
                    skipped.push(MemorySkipReason { index, reason });
                    continue;
                }
                let category = category.to_string();
                let importance = match input.importance {
                    Some(v) => validate_importance(v).unwrap_or(3),
                    None => 3,
                };

                // Write-path semantic dedup (mirrors `create`): skip a row whose
                // normalized content already exists for this persona in the same
                // capability scope — whether the survivor is a pre-existing row
                // (preloaded above) or an earlier row from THIS batch.
                let dedup_key = (
                    input.persona_id.clone(),
                    input.use_case_id.clone(),
                    normalize_for_dedup(&content),
                );
                if seen.contains(&dedup_key) {
                    let reason = "duplicate_content";
                    tracing::warn!(
                        index,
                        persona_id = %input.persona_id,
                        reason,
                        "memories::batch_create skipping row: normalized-content duplicate"
                    );
                    skipped.push(MemorySkipReason { index, reason });
                    continue;
                }

                stmt.execute(params![
                    id,
                    input.persona_id,
                    title,
                    content,
                    category,
                    input.source_execution_id,
                    importance,
                    normalize_tags(
                        input
                            .tags
                            .map(|j| serde_json::to_string(&j.0).unwrap_or_default())
                    ),
                    now,
                    input.use_case_id,
                ])?;
                to_embed.push((id, memory_embedding_text_parts(&title, &content)));
                seen.insert(dedup_key);
                count += 1;
            }
        }

        tx.commit()?;
        // Embed-on-write for the committed rows (MEMORY CONTRACT (7)).
        for (id, text) in to_embed {
            spawn_embed_memory(id, text);
        }
        Ok(BatchCreateMemoryResult {
            inserted: count,
            skipped,
        })
    })
}

pub fn get_total_count(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    tier: Option<&str>,
) -> Result<i64, AppError> {
    timed_query!("persona_memories", "persona_memories::get_total_count", {
        let conn = pool.get()?;

        let qb = build_memory_filters(persona_id, category, search, tier);
        let sql = format!(
            "SELECT COUNT(*) FROM persona_memories {}",
            qb.where_clause()
        );
        let count: i64 = conn.query_row(&sql, qb.params_ref().as_slice(), |row| row.get(0))?;
        Ok(count)
    })
}

/// Aggregated memory statistics computed over the full dataset (not paginated).
#[derive(Debug, serde::Serialize)]
pub struct MemoryStats {
    pub total: i64,
    pub avg_importance: f64,
    /// (category, count) pairs for every category that has at least one memory.
    pub category_counts: Vec<(String, i64)>,
    /// (persona_id, count) pairs for every persona that owns at least one memory.
    pub agent_counts: Vec<(String, i64)>,
}

/// Compute aggregate stats on a single connection using pre-built filter clause and params.
fn compute_memory_stats(
    conn: &rusqlite::Connection,
    where_clause: &str,
    params_ref: &[&dyn rusqlite::types::ToSql],
) -> Result<MemoryStats, AppError> {
    // Total + avg importance in one query
    let agg_sql = format!(
        "SELECT COUNT(*), COALESCE(AVG(importance), 0) FROM persona_memories {where_clause}"
    );
    let (total, avg_importance): (i64, f64) =
        conn.query_row(&agg_sql, params_ref, |row| Ok((row.get(0)?, row.get(1)?)))?;

    // Category breakdown
    let cat_sql = format!(
        "SELECT category, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY category ORDER BY cnt DESC"
    );
    let mut cat_stmt = conn.prepare_cached(&cat_sql)?;
    let category_rows = cat_stmt.query_map(params_ref, |row| Ok((row.get(0)?, row.get(1)?)))?;
    let category_counts: Vec<(String, i64)> = collect_rows(
        category_rows,
        "memories::compute_memory_stats/category_counts",
    );

    // Agent breakdown
    let agent_sql = format!(
        "SELECT persona_id, COUNT(*) as cnt FROM persona_memories {where_clause} GROUP BY persona_id ORDER BY cnt DESC"
    );
    let mut agent_stmt = conn.prepare_cached(&agent_sql)?;
    let agent_rows = agent_stmt.query_map(params_ref, |row| Ok((row.get(0)?, row.get(1)?)))?;
    let agent_counts: Vec<(String, i64)> =
        collect_rows(agent_rows, "memories::compute_memory_stats/agent_counts");

    Ok(MemoryStats {
        total,
        avg_importance,
        category_counts,
        agent_counts,
    })
}

/// Return aggregate stats over the full (filtered) memory dataset.
pub fn get_stats(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    tier: Option<&str>,
) -> Result<MemoryStats, AppError> {
    timed_query!("persona_memories", "persona_memories::get_stats", {
        let conn = pool.get()?;
        let qb = build_memory_filters(persona_id, category, search, tier);
        compute_memory_stats(&conn, &qb.where_clause(), &qb.params_ref())
    })
}

/// Combined result of list + count + stats in a single DB connection.
#[derive(Debug, serde::Serialize)]
pub struct MemoriesWithStats {
    pub memories: Vec<PersonaMemory>,
    pub total: i64,
    pub stats: MemoryStats,
}

/// Fetch memories, total count, and aggregate stats in a single DB connection.
/// Replaces three separate IPC calls with one.
#[allow(clippy::too_many_arguments)]
pub fn get_all_with_stats(
    pool: &DbPool,
    persona_id: Option<&str>,
    category: Option<&str>,
    search: Option<&str>,
    tier: Option<&str>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort_column: Option<&str>,
    sort_direction: Option<&str>,
) -> Result<MemoriesWithStats, AppError> {
    timed_query!(
        "persona_memories",
        "persona_memories::get_all_with_stats",
        {
            let limit_val = limit.unwrap_or(50);
            let offset_val = offset.unwrap_or(0);
            let order_col = validated_sort_column(sort_column);
            let order_dir = validated_sort_direction(sort_direction);

            let conn = pool.get()?;
            let filter_qb = build_memory_filters(persona_id, category, search, tier);
            let where_clause = filter_qb.where_clause();
            let stats = compute_memory_stats(&conn, &where_clause, &filter_qb.params_ref())?;
            let total = stats.total;

            // Paginated memories — build a new QB with same filters + pagination
            let mut qb = build_memory_filters(persona_id, category, search, tier);
            qb.order_by(order_col, order_dir);
            qb.limit(limit_val);
            qb.offset(offset_val);

            let mem_sql = qb.build_select("SELECT * FROM persona_memories");
            let mut mem_stmt = conn.prepare_cached(&mem_sql)?;
            let mem_rows = mem_stmt.query_map(qb.params_ref().as_slice(), row_to_memory)?;
            let memories: Vec<PersonaMemory> =
                collect_rows(mem_rows, "memories::get_all_with_stats");

            Ok(MemoriesWithStats {
                memories,
                total,
                stats,
            })
        }
    )
}

pub fn update_importance(pool: &DbPool, id: &str, importance: i32) -> Result<bool, AppError> {
    timed_query!("persona_memories", "persona_memories::update_importance", {
        validate_importance(importance)?;
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE persona_memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
            params![importance, now, id],
        )?;
        Ok(rows > 0)
    })
}

/// Patch the editable content fields on an existing memory.
///
/// Used by the message-rating upsert path in the Overview > Messages
/// detail modal: when a user re-rates the same message, we update the
/// existing memory row in place rather than spawning duplicate rows that
/// would all share the same `source_execution_id`. Importance is bounded
/// to the same [1, 5] range as `update_importance`. Tags are replaced
/// wholesale — pass the current set, not a delta.
pub fn update_content(
    pool: &DbPool,
    id: &str,
    title: &str,
    content: &str,
    importance: i32,
    tags: Option<&[String]>,
) -> Result<bool, AppError> {
    timed_query!("persona_memories", "persona_memories::update_content", {
        validate_importance(importance)?;
        let conn = pool.get()?;
        let now = chrono::Utc::now().to_rfc3339();
        let tags_json = tags
            .map(|t| serde_json::to_string(t).unwrap_or_else(|_| "[]".to_string()));
        let rows = conn.execute(
            "UPDATE persona_memories
             SET title = ?1, content = ?2, importance = ?3, tags = ?4, updated_at = ?5
             WHERE id = ?6",
            params![title, content, importance, tags_json, now, id],
        )?;
        if rows > 0 {
            // Content changed → the stored vector is stale; re-embed
            // (delete-then-insert, idempotent). MEMORY CONTRACT (7).
            spawn_embed_memory(id.to_string(), memory_embedding_text_parts(title, content));
        }
        Ok(rows > 0)
    })
}

/// Batch-update importance for multiple memories in a single transaction.
/// Each tuple is (id, new_importance).
pub fn batch_update_importance(pool: &DbPool, updates: &[(String, i32)]) -> Result<i64, AppError> {
    if updates.is_empty() {
        return Ok(0);
    }
    timed_query!(
        "persona_memories",
        "persona_memories::batch_update_importance",
        {
            let conn = pool.get()?;
            let tx = conn.unchecked_transaction()?;
            let now = chrono::Utc::now().to_rfc3339();
            let mut total_updated: i64 = 0;

            for (_id, importance) in updates {
                validate_importance(*importance)?;
            }

            let mut stmt = tx.prepare(
                "UPDATE persona_memories SET importance = ?1, updated_at = ?2 WHERE id = ?3",
            )?;
            for (id, importance) in updates {
                let rows = stmt.execute(params![importance, now, id])?;
                total_updated += rows as i64;
            }
            drop(stmt);

            tx.commit()?;
            Ok(total_updated)
        }
    )
}

pub fn batch_delete(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    timed_query!("persona_memories", "persona_memories::batch_delete", {
        // SQLite has a default SQLITE_MAX_VARIABLE_NUMBER of 999.
        // Chunk deletes into batches of 500 to stay well under the limit.
        const CHUNK_SIZE: usize = 500;
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let mut total_deleted: i64 = 0;

        for chunk in ids.chunks(CHUNK_SIZE) {
            let mut qb = QueryBuilder::new();
            qb.where_in("id", chunk.iter().map(|s| s.to_string()).collect());
            let sql = format!("DELETE FROM persona_memories {}", qb.where_clause());
            let rows = tx.execute(&sql, qb.params_ref().as_slice())?;
            total_deleted += rows as i64;
        }

        tx.commit()?;
        // MEMORY CONTRACT (7): drop the deleted rows' vectors (best-effort).
        spawn_delete_memory_embeddings(ids.to_vec());
        Ok(total_deleted)
    })
}

// ---------------------------------------------------------------------------
// Director-driven curation: archive (reversible) instead of delete.
// `tier = 'archive'` is the existing "not injected, still searchable" state
// (see get_for_injection_v2, which selects only core/active/working).
// ---------------------------------------------------------------------------

/// Normalize content for cross-run duplicate detection: trim, lowercase,
/// collapse internal whitespace. Mirrors the intent of the 24h dedup in
/// [`create`] but spans all time (the 24h guard misses same-content rows from
/// later runs — the documented Stock-Price-Logger case).
fn normalize_for_dedup(content: &str) -> String {
    content.split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase()
}

/// Write-path dedup lookup: does `persona_id` already hold a NON-core,
/// NON-archive memory whose normalized content equals `normalized`, in the same
/// capability scope (`use_case_id`)? Returns the survivor's id on hit.
///
/// Bounded by `persona_id` (served by `idx_persona_memories_persona`) — never a
/// full-table scan and never cross-persona. `core` is excluded so a user-pinned
/// memory is never a dedup target (MEMORY CONTRACT §1); `archive` is excluded so
/// retired rows aren't silently resurrected as the survivor. The `use_case_id`
/// equality keeps capability-scoped duplicates distinct from persona-wide ones.
/// This mirrors the scope of `find_duplicate_groups` so the write-path and the
/// manual cleanup path agree on what "duplicate" means.
///
/// SEMANTIC-DEDUP HOOK POINT — this is deliberately exact-normalized-string
/// equality today. A future embedding-based pass can widen the match here (e.g.
/// cosine distance over content embeddings under `#[cfg(feature = "ml")]`)
/// WITHOUT touching either caller (`create` / `batch_create`): keep the
/// persona-scope + non-core + scope guards and replace only the equality test
/// below with a similarity threshold.
fn find_normalized_duplicate(
    conn: &rusqlite::Connection,
    persona_id: &str,
    normalized: &str,
    use_case_id: Option<&str>,
) -> Result<Option<String>, AppError> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, content, use_case_id FROM persona_memories
         WHERE persona_id = ?1 AND tier NOT IN ('core', 'archive')",
    )?;
    let rows = stmt.query_map(params![persona_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, Option<String>>(2)?,
        ))
    })?;
    for row in rows {
        let (id, content, uc) = row?;
        if uc.as_deref() == use_case_id && normalize_for_dedup(&content) == normalized {
            return Ok(Some(id));
        }
    }
    Ok(None)
}

/// Archive memories by id (set `tier = 'archive'`). Never touches `core`
/// (user-pinned). Chunked + transactional like [`batch_delete`]. Reversible via
/// [`update_tier`]`(id, "active")`. Returns the number of rows archived.
pub fn archive_by_ids(pool: &DbPool, ids: &[String]) -> Result<i64, AppError> {
    if ids.is_empty() {
        return Ok(0);
    }
    timed_query!("persona_memories", "persona_memories::archive_by_ids", {
        const CHUNK_SIZE: usize = 400;
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let mut total: i64 = 0;
        for chunk in ids.chunks(CHUNK_SIZE) {
            let mut qb = QueryBuilder::new();
            qb.where_in("id", chunk.iter().map(|s| s.to_string()).collect());
            // Guard: never archive a core (user-pinned) memory, even if asked.
            qb.where_raw(|_| "tier != 'core'".to_string(), vec![]);
            let sql = format!(
                "UPDATE persona_memories SET tier = 'archive', updated_at = '{}' {}",
                now.replace('\'', "''"),
                qb.where_clause()
            );
            total += tx.execute(&sql, qb.params_ref().as_slice())? as i64;
        }
        tx.commit()?;
        // D2 (archived-vectors-leave-recall): a decayed/curated row keeps its
        // main-DB record (archive is reversible) but must NOT keep a live KNN
        // vector, or it re-surfaces in task-aware recall. Drop the embeddings of
        // exactly the ids that are now archived — the core-guarded ids are
        // excluded by the `tier = 'archive'` filter, so a user-pinned memory's
        // vector is never touched. Fire-and-forget + best-effort (a missed drop
        // is caught by the periodic GC sweep); re-tiering to a live tier
        // re-embeds (see `update_tier`).
        if total > 0 {
            let mut now_archived: Vec<String> = Vec::new();
            for chunk in ids.chunks(CHUNK_SIZE) {
                let ph = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
                let ps: Vec<&dyn rusqlite::ToSql> =
                    chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
                let mut stmt = conn.prepare(&format!(
                    "SELECT id FROM persona_memories WHERE tier = 'archive' AND id IN ({ph})"
                ))?;
                let rows = stmt.query_map(ps.as_slice(), |r| r.get::<_, String>(0))?;
                for r in rows {
                    now_archived.push(r?);
                }
            }
            spawn_delete_memory_embeddings(now_archived);
        }
        Ok(total)
    })
}

/// Groups of a persona's memories that share normalized content (≥2 rows each),
/// excluding `core` and already-`archive`d. Each group is ordered so the
/// **keeper** is first (highest importance, then oldest) — callers archive the
/// rest. Deterministic; no LLM.
pub fn find_duplicate_groups(
    pool: &DbPool,
    persona_id: &str,
) -> Result<Vec<Vec<PersonaMemory>>, AppError> {
    timed_query!("persona_memories", "persona_memories::find_duplicate_groups", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_memories
             WHERE persona_id = ?1 AND tier NOT IN ('core', 'archive')",
        )?;
        let rows = stmt.query_map(params![persona_id], row_to_memory)?;
        let all: Vec<PersonaMemory> = collect_rows(rows, "memories::find_duplicate_groups");

        let mut buckets: std::collections::HashMap<String, Vec<PersonaMemory>> =
            std::collections::HashMap::new();
        for m in all {
            buckets
                .entry(normalize_for_dedup(&m.content))
                .or_default()
                .push(m);
        }
        let mut groups: Vec<Vec<PersonaMemory>> = buckets
            .into_values()
            .filter(|g| g.len() >= 2)
            .map(|mut g| {
                // Keeper first: highest importance, then oldest (stable id tiebreak).
                g.sort_by(|a, b| {
                    b.importance
                        .cmp(&a.importance)
                        .then(a.created_at.cmp(&b.created_at))
                        .then(a.id.cmp(&b.id))
                });
                g
            })
            .collect();
        // Stable output order (largest groups first) for predictable reporting.
        groups.sort_by_key(|g| std::cmp::Reverse(g.len()));
        Ok(groups)
    })
}

/// Stale-ranked archival candidates for the LLM "won't-use" pass: `active` +
/// `working` (never `core`/`archive`), ordered most-archivable first
/// (low importance, low access, oldest). Bounded by `limit`.
pub fn get_archivable_candidates(
    pool: &DbPool,
    persona_id: &str,
    limit: i64,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!("persona_memories", "persona_memories::get_archivable_candidates", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare_cached(
            "SELECT * FROM persona_memories
             WHERE persona_id = ?1 AND tier IN ('active', 'working')
             ORDER BY importance ASC, access_count ASC, created_at ASC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_memory)?;
        Ok(collect_rows(rows, "memories::get_archivable_candidates"))
    })
}

crud_delete!("persona_memories");

/// Delete a memory only if it is NOT user-pinned `core`. Defence-in-depth
/// backstop to MEMORY CONTRACT (1) for LLM/batch apply paths (memory review,
/// curation proposals): even if a stale proposal names a since-pinned memory,
/// it cannot be hard-deleted. The generic `delete` above is retained for
/// explicit user-initiated deletion, which is allowed to remove core rows.
/// Returns `Ok(false)` when nothing was deleted (row absent OR core-protected).
pub fn delete_non_core(pool: &DbPool, id: &str) -> Result<bool, AppError> {
    timed_query!("persona_memories", "persona_memories::delete_non_core", {
        let conn = pool.get()?;
        let affected = conn.execute(
            "DELETE FROM persona_memories WHERE id = ?1 AND tier != 'core'",
            params![id],
        )?;
        Ok(affected > 0)
    })
}

/// Clear all NON-`core` memories (hard delete). **Preserves the user-pinned
/// `core` tier**, which the MEMORY CONTRACT treats as authoritative and which
/// every other batch path (`archive_by_ids`, run-lifecycle GC) deliberately
/// keeps — only the user may remove a core memory, one at a time. Without the
/// `tier != 'core'` guard this single, unscoped, workspace-wide call would
/// irreversibly nuke every persona's pinned identity memories on one click.
/// No FK children. Returns the number of rows deleted.
pub fn delete_all(pool: &DbPool) -> Result<usize, AppError> {
    timed_query!("persona_memories", "persona_memories::delete_all", {
        let conn = pool.get()?;
        let n = conn.execute("DELETE FROM persona_memories WHERE tier != 'core'", [])?;
        Ok(n)
    })
}

/// Rank a tier for "keep the stronger one" comparisons: core > active >
/// working > archive. Unknown values rank as `working` (the mid default) so a
/// malformed row can never out-rank a real `core`/`active` memory.
fn tier_rank(tier: &str) -> u8 {
    match tier {
        "core" => 3,
        "active" => 2,
        "working" => 1,
        "archive" => 0,
        _ => 1,
    }
}

/// Atomically merge two memories into one.
///
/// Inserts the merged row and deletes the two originals inside a single SQL
/// transaction. If any step fails, the transaction is rolled back and the
/// original two rows remain untouched — preventing the orphaned half-state
/// the previous frontend-orchestrated three-call flow could leave behind
/// when the second delete failed mid-way.
///
/// Skips the 24h dedup short-circuit used by [`create`]: a merge result whose
/// content happens to match `delete_id_a` or `delete_id_b` would otherwise be
/// returned via the existing row, then deleted by the same transaction —
/// leaving the caller with a valid id that points at nothing.
///
/// Safety guards (MEMORY CONTRACT §1, §2, §5):
/// - **Refuses** when either original is `tier = 'core'` — a merge hard-deletes
///   BOTH originals, so without this guard the user's pinned identity memory
///   would be silently destroyed (`keep_a`/`keep_b` already refuse this; merge
///   used not to).
/// - **Refuses** a cross-persona merge (different `persona_id`) rather than
///   silently reassigning/deleting one agent's memory.
/// - **Carries forward** the STRONGER tier (core > active > working > archive),
///   the capability scope (`use_case_id`), team-share anchor (`home_team_id`)
///   and source-execution provenance instead of defaulting to the DB tier and
///   dropping attribution.
pub fn merge(
    pool: &DbPool,
    input: CreatePersonaMemoryInput,
    delete_id_a: &str,
    delete_id_b: &str,
) -> Result<PersonaMemory, AppError> {
    timed_query!("persona_memories", "persona_memories::merge", {
        let title = strip_html_tags(&input.title);
        let content = strip_html_tags(&input.content);

        if title.trim().is_empty() {
            return Err(AppError::Validation("Title cannot be empty".into()));
        }
        if content.trim().is_empty() {
            return Err(AppError::Validation("Content cannot be empty".into()));
        }

        // Load both originals up front so we can enforce the tier/persona guards
        // and carry their scope forward. `get_by_id` errors if an id is missing.
        let mem_a = get_by_id(pool, delete_id_a)?;
        let mem_b = get_by_id(pool, delete_id_b)?;

        // (a) Never destroy a user-pinned core memory via merge.
        if mem_a.tier == "core" || mem_b.tier == "core" {
            return Err(AppError::Validation(
                "Cannot merge a core (pinned) memory — resolve this conflict manually".into(),
            ));
        }
        // (d) Never silently reassign/delete one agent's memory into another.
        if mem_a.persona_id != mem_b.persona_id {
            return Err(AppError::Validation(
                "Cannot merge memories that belong to different personas".into(),
            ));
        }

        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let category = input.category.as_deref().unwrap_or(DEFAULT_MEMORY_CATEGORY);
        validate_category(category)?;
        let category = category.to_string();
        let importance = match input.importance {
            Some(v) => validate_importance(v)?,
            None => 3,
        };
        let tags = normalize_tags(
            input
                .tags
                .map(|j| serde_json::to_string(&j.0).unwrap_or_default()),
        );

        // The merged row always belongs to the source persona — never trust the
        // input's persona_id to reassign it (the personas match, asserted above).
        let persona_id = mem_a.persona_id.clone();

        // (b) Keep the stronger tier rather than letting the merged row fall back
        // to the column default (which silently promotes/demotes the survivor).
        let tier = if tier_rank(&mem_a.tier) >= tier_rank(&mem_b.tier) {
            mem_a.tier.clone()
        } else {
            mem_b.tier.clone()
        };

        // (c) Carry capability attribution: keep it when both agree; if they
        // diverge, widen to persona-wide (NULL) so the merged memory is never
        // silently hidden from a capability that previously saw one of them.
        // An explicit input value (future callers) takes precedence.
        let use_case_id = if input.use_case_id.is_some() {
            input.use_case_id.clone()
        } else if mem_a.use_case_id == mem_b.use_case_id {
            mem_a.use_case_id.clone()
        } else {
            None
        };

        // Carry source-execution provenance and the team-share anchor forward
        // (prefer any non-null value) so the merge preserves both.
        let source_execution_id = input
            .source_execution_id
            .clone()
            .or_else(|| mem_a.source_execution_id.clone())
            .or_else(|| mem_b.source_execution_id.clone());
        let home_team_id = mem_a
            .home_team_id
            .clone()
            .or_else(|| mem_b.home_team_id.clone());

        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;

        tx.execute(
            "INSERT INTO persona_memories
             (id, persona_id, title, content, category, source_execution_id, importance, tags, created_at, updated_at, use_case_id, tier, home_team_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12)",
            params![
                id,
                persona_id,
                title,
                content,
                category,
                source_execution_id,
                importance,
                tags,
                now,
                use_case_id,
                tier,
                home_team_id,
            ],
        )?;

        tx.execute(
            "DELETE FROM persona_memories WHERE id = ?1",
            params![delete_id_a],
        )?;
        tx.execute(
            "DELETE FROM persona_memories WHERE id = ?1",
            params![delete_id_b],
        )?;

        tx.commit()?;
        // MEMORY CONTRACT (7): index the merged row, drop the two retired
        // vectors (both fire-and-forget; a miss is repaired by backfill /
        // stays an inert orphan respectively).
        spawn_embed_memory(id.clone(), memory_embedding_text_parts(&title, &content));
        spawn_delete_memory_embeddings(vec![delete_id_a.to_string(), delete_id_b.to_string()]);
        get_by_id(pool, &id)
    })
}

// -- Tier management ----------------------------------------------------------

pub fn update_tier(pool: &DbPool, id: &str, tier: &str) -> Result<bool, AppError> {
    // Validate tier value
    match tier {
        "core" | "active" | "working" | "archive" => {}
        _ => {
            return Err(AppError::Validation(format!(
                "Invalid tier '{tier}'. Valid tiers: core, active, working, archive"
            )));
        }
    }
    timed_query!("persona_memories", "persona_memories::update_tier", {
        use rusqlite::OptionalExtension;
        let conn = pool.get()?;
        // Snapshot the prior tier BEFORE the update so we can detect an
        // unarchive transition (archive → live tier). Archiving drops the KNN
        // vector (see `archive_by_ids`); un-archiving must restore it or the
        // resurfaced memory would be invisible to task-aware recall.
        let prev_tier: Option<String> = conn
            .query_row(
                "SELECT tier FROM persona_memories WHERE id = ?1",
                params![id],
                |r| r.get::<_, String>(0),
            )
            .optional()?;
        let now = chrono::Utc::now().to_rfc3339();
        let rows = conn.execute(
            "UPDATE persona_memories SET tier = ?1, updated_at = ?2 WHERE id = ?3",
            params![tier, now, id],
        )?;
        // D2 (archived-vectors-leave-recall): re-embed on un-archive. Only when
        // the row actually left the archive tier for a live one — a no-op for
        // every other tier move, so byte-identical behavior outside unarchive.
        if rows > 0 && prev_tier.as_deref() == Some("archive") && tier != "archive" {
            if let Ok((title, content)) = conn.query_row(
                "SELECT title, content FROM persona_memories WHERE id = ?1",
                params![id],
                |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
            ) {
                spawn_embed_memory(id.to_string(), memory_embedding_text_parts(&title, &content));
            }
        }
        Ok(rows > 0)
    })
}

/// Result of `get_for_injection` — memories split by tier for prompt injection.
#[derive(Debug)]
pub struct TieredMemories {
    /// Core memories: always injected (stable beliefs / preferences).
    pub core: Vec<PersonaMemory>,
    /// Active memories: scored and selected for injection.
    pub active: Vec<PersonaMemory>,
}

/// Scope filter for memory injection. `persona_id` is always required —
/// a persona's own memories are always in scope. Additional optional axes
/// (capability + home-team) layer on top via OR clauses in the WHERE.
///
/// Adding a new scope axis is a 3-line change: a new `Option<&str>` field,
/// a `with_*` builder method, and a `push` line in
/// [`build_scope_predicates`]. The SQL composer and parameter binder both
/// pick up the new axis without further edits, replacing the per-arm
/// match-explosion this struct was introduced to retire (cycle 7).
#[derive(Debug, Clone, Copy)]
pub struct InjectionScope<'a> {
    pub persona_id: &'a str,
    /// When `Some(uc)`: active/working memories match `use_case_id = uc OR use_case_id IS NULL`.
    /// When `None`: active/working memories match `use_case_id IS NULL`.
    pub use_case_id: Option<&'a str>,
    /// When `Some(t)`: rows owned by ANY persona but attributed to home-team
    /// `t` also surface (team-shared injected memory, MEMORY CONTRACT §5).
    /// When `None`: only persona-private rows surface.
    pub home_team_id: Option<&'a str>,
}

impl<'a> InjectionScope<'a> {
    /// Start a scope for a single persona with no additional filters.
    pub fn for_persona(persona_id: &'a str) -> Self {
        Self {
            persona_id,
            use_case_id: None,
            home_team_id: None,
        }
    }
    pub fn with_use_case(mut self, uc: Option<&'a str>) -> Self {
        self.use_case_id = uc;
        self
    }
    pub fn with_home_team(mut self, tid: Option<&'a str>) -> Self {
        self.home_team_id = tid;
        self
    }
}

/// Compose the persona-scope and use-case-scope SQL fragments and matching
/// param vector for an [`InjectionScope`]. Returns:
///   - `persona_scope_sql`: goes into the per-tier `WHERE <persona_scope> ...`
///   - `active_uc_sql`: trailing predicate for active/working tier only
///   - `extra_params`: pushed AFTER the fixed [persona_id, core_limit, active_limit]
///     prefix; SQL uses `?{base + i + 1}` for these.
///
/// The placeholder indices in returned SQL are 1-based and ALREADY account
/// for the 3-param prefix — `?1` = persona_id, `?2` = core_limit, `?3` =
/// active_limit, `?4..` = the values in `extra_params`.
fn build_scope_predicates<'a>(
    scope: &InjectionScope<'a>,
) -> (String, String, Vec<&'a str>) {
    let mut extra: Vec<&str> = Vec::new();
    let mut next_idx: usize = 4; // ?1..?3 reserved

    let persona_scope_sql = if let Some(tid) = scope.home_team_id {
        let idx = next_idx;
        next_idx += 1;
        extra.push(tid);
        format!("(persona_id = ?1 OR home_team_id = ?{idx})")
    } else {
        "persona_id = ?1".to_string()
    };

    let active_uc_sql = if let Some(uc) = scope.use_case_id {
        let idx = next_idx;
        // next_idx += 1; // not reused, drop to silence unused mutation warning
        let _ = next_idx;
        extra.push(uc);
        format!("AND (use_case_id = ?{idx} OR use_case_id IS NULL)")
    } else {
        "AND use_case_id IS NULL".to_string()
    };

    (persona_scope_sql, active_uc_sql, extra)
}

/// Fetch memories suitable for injection into a prompt, split by tier.
///
/// Persona-wide convenience — no capability scope, no home-team scope.
/// Forwards to [`get_for_injection_v2`] with `InjectionScope::for_persona(...)`.
///
/// * `core_limit` — max number of core-tier memories to return.
/// * `active_limit` — max number of active-tier memories to return (scored by
///   importance DESC, access_count DESC, created_at DESC).
pub fn get_for_injection(
    pool: &DbPool,
    persona_id: &str,
    core_limit: i64,
    active_limit: i64,
) -> Result<TieredMemories, AppError> {
    get_for_injection_v2(pool, InjectionScope::for_persona(persona_id), core_limit, active_limit)
}

/// Capability- and home-team-aware memory fetch for prompt injection.
///
/// Tier rules:
/// - **Core** memories are always persona-wide regardless of `use_case_id`.
///   They define stable identity/principles and should be injected on every
///   execution.
/// - **Active / working** memories are scoped:
///   - When `scope.use_case_id = Some(uc)`, fetch rows where
///     `use_case_id = uc OR use_case_id IS NULL` (capability-scoped + global).
///   - When `scope.use_case_id = None`, fetch only persona-wide rows
///     (`use_case_id IS NULL`).
///
/// When `scope.home_team_id = Some(t)`, OR-in `home_team_id = t` at every
/// tier so memories authored in the home-team workspace are shared across
/// every member's prompt assembly (MEMORY CONTRACT §5).
///
/// Ordering: core = importance DESC, created_at DESC (never decays).
/// Active/working = the decay-aware score from MEMORY CONTRACT (6):
/// `importance * 10 + min(access_count, 9) / (1 + age_days/7)` — importance
/// strictly dominates (access term capped below one importance step), and the
/// access weight fades hyperbolically with time since last injection, so a
/// stale heavy-hitter no longer pins itself above fresh, equally-important
/// memories.
pub fn get_for_injection_v2(
    pool: &DbPool,
    scope: InjectionScope<'_>,
    core_limit: i64,
    active_limit: i64,
) -> Result<TieredMemories, AppError> {
    timed_query!(
        "persona_memories",
        "persona_memories::get_for_injection_v2",
        {
            let conn = pool.get()?;

            let (persona_scope_sql, active_uc_sql, extra_params) =
                build_scope_predicates(&scope);

            let sql = format!(
                "SELECT * FROM (
                 SELECT * FROM persona_memories
                 WHERE {persona_scope_sql} AND tier = 'core'
                 ORDER BY importance DESC, created_at DESC
                 LIMIT ?2
             )
             UNION ALL
             SELECT * FROM (
                 SELECT * FROM persona_memories
                 WHERE {persona_scope_sql} AND tier IN ('active', 'working')
                 {active_uc_sql}
                 ORDER BY (importance * 10.0
                           + MIN(access_count, 9)
                             / (1.0 + (julianday('now')
                                       - julianday(COALESCE(last_accessed_at, created_at))) / 7.0)
                          ) DESC,
                          created_at DESC
                 LIMIT ?3
             )"
            );

            // Assemble the final params slice in the order the SQL expects:
            // ?1 = persona_id, ?2 = core_limit, ?3 = active_limit, then the
            // extras the scope builder produced in declaration order
            // (home_team_id before use_case_id).
            let mut boxed_params: Vec<Box<dyn rusqlite::ToSql>> = Vec::with_capacity(3 + extra_params.len());
            boxed_params.push(Box::new(scope.persona_id.to_string()));
            boxed_params.push(Box::new(core_limit));
            boxed_params.push(Box::new(active_limit));
            for v in &extra_params {
                boxed_params.push(Box::new((*v).to_string()));
            }
            let params_ref: Vec<&dyn rusqlite::ToSql> =
                boxed_params.iter().map(|b| b.as_ref()).collect();

            let mut stmt = conn.prepare_cached(&sql)?;
            let rows = stmt.query_map(params_ref.as_slice(), row_to_memory)?;
            let all: Vec<PersonaMemory> =
                collect_rows(rows, "memories::get_for_injection_v2");

            let (core, active) = all.into_iter().partition(|m| m.tier == "core");

            Ok(TieredMemories { core, active })
        }
    )
}

/// Fetch memories attributed to a specific capability (use case) on a persona.
/// Phase C5 — capability-scoped memory editor view.
pub fn get_by_use_case_id(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: &str,
    limit: Option<i64>,
) -> Result<Vec<PersonaMemory>, AppError> {
    timed_query!(
        "persona_memories",
        "persona_memories::get_by_use_case_id",
        {
            let limit = limit.unwrap_or(100);
            let conn = pool.get()?;
            let mut stmt = conn.prepare_cached(
                "SELECT * FROM persona_memories
             WHERE persona_id = ?1 AND use_case_id = ?2
             ORDER BY importance DESC, created_at DESC
             LIMIT ?3",
            )?;
            let rows = stmt.query_map(params![persona_id, use_case_id, limit], row_to_memory)?;
            Ok(collect_rows(rows, "memories::get_by_use_case_id"))
        }
    )
}

/// Increment access_count and update last_accessed_at for a batch of memory IDs.
pub fn increment_access_batch(pool: &DbPool, ids: &[String]) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    timed_query!(
        "persona_memories",
        "persona_memories::increment_access_batch",
        {
            let conn = pool.get()?;
            let now = chrono::Utc::now().to_rfc3339();
            let mut qb = QueryBuilder::new();
            let p_now1 = qb.push_param(now.clone());
            let p_now2 = qb.push_param(now);
            qb.where_in("id", ids.to_vec());
            let sql = format!(
            "UPDATE persona_memories SET access_count = access_count + 1, last_accessed_at = {p_now1}, updated_at = {p_now2} {}",
            qb.where_clause()
        );
            conn.execute(&sql, qb.params_ref().as_slice())?;
            Ok(())
        }
    )
}

/// Run automatic memory lifecycle transitions for a persona.
///
/// - **Promote**: working-tier memories with access_count >= 5 are promoted to "active".
/// - **Archive**: working-tier memories older than 30 days with access_count == 0
///   are moved to "archive".
///
/// Returns `(promoted, archived)` counts.
pub fn run_lifecycle(pool: &DbPool, persona_id: &str) -> Result<(i64, i64), AppError> {
    timed_query!("persona_memories", "persona_memories::run_lifecycle", {
        let conn = pool.get()?;
        let tx = conn.unchecked_transaction()?;
        let now = chrono::Utc::now();
        let updated_at = now.to_rfc3339();

        // Promote: working memories accessed frequently -> active
        let promoted = tx.execute(
            "UPDATE persona_memories
             SET tier = 'active', updated_at = ?1
             WHERE persona_id = ?2 AND tier = 'working' AND access_count >= 5",
            params![updated_at, persona_id],
        )? as i64;

        // Archive: working memories older than 30 days with no accesses -> archive
        let cutoff = (now - chrono::Duration::days(30)).to_rfc3339();
        let mut archived = tx.execute(
            "UPDATE persona_memories
             SET tier = 'archive', updated_at = ?1
             WHERE persona_id = ?2 AND tier = 'working' AND access_count = 0 AND created_at < ?3",
            params![updated_at, persona_id, cutoff],
        )? as i64;

        // Phase 2 L1 hygiene: CAP the active tier. Active memories were never
        // demoted, so the injected pool grew unbounded run-over-run (the measured
        // cost bloat). Keep only the top ACTIVE_CAP active memories by value
        // (importance, then reuse, then recency); archive the rest. Durable
        // team knowledge now lives in the bounded L2 ledger + L3 graph, so a tight
        // per-persona working-set is correct. `core` (user-pinned) is untouched.
        const ACTIVE_CAP: i64 = 60;
        archived += tx.execute(
            "UPDATE persona_memories
             SET tier = 'archive', updated_at = ?1
             WHERE persona_id = ?2 AND tier = 'active' AND id NOT IN (
                 SELECT id FROM persona_memories
                 WHERE persona_id = ?2 AND tier = 'active'
                 ORDER BY importance DESC, access_count DESC, created_at DESC
                 LIMIT ?3
             )",
            params![updated_at, persona_id, ACTIVE_CAP],
        )? as i64;

        tx.commit()?;
        Ok((promoted, archived))
    })
}

// ===========================================================================
// Task-relevant recall: persona-memory embeddings (MEMORY CONTRACT (7))
//
// A vec0 side-table keyed by `memory_id`, 384-d AllMiniLML6V2Q — the SAME
// model + `bytemuck` blob layout `companion::brain::embeddings` uses. Created
// at RUNTIME (idempotent `CREATE VIRTUAL TABLE IF NOT EXISTS`), NOT via a
// migration, so the sqlite-vec auto-extension registration — which
// `db::init_user_db` performs BEFORE its pool is built — is guaranteed to have
// run on every connection the table is touched from. The main `personas.db`
// pool opens connections during `init_db` *before* that registration, so the
// table deliberately lives in the vec-registered **user DB** pool
// (`UserDbPool`); KNN returns bare `memory_id`s that the caller intersects with
// the live candidate set it already loaded from the main DB, so no cross-DB
// join is ever needed and an orphaned embedding (memory later deleted) is inert
// noise a backfill/GC prunes.
//
// Everything here is `ml`-gated. The value-only recall path
// (`engine::memory_recall::pack_by_budget` + `get_for_injection_v2`) is the
// untouched non-ml fallback and gains nothing from this section.
// ===========================================================================

/// Embedding dimensionality for persona-memory vectors (AllMiniLML6V2Q).
/// Mirrors `companion::brain::embeddings::COMPANION_VEC_DIMS`.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // consumers are ml-gated
pub const MEMORY_VEC_DIMS: usize = 384;

/// Text embedded for a persona memory: `title` + `content`, the same fields
/// the runner serializes into the prompt, so the vector reflects what the model
/// actually reads. Used by BOTH the write-path embed and the backfill so the
/// two index byte-identical strings.
#[cfg_attr(not(feature = "ml"), allow(dead_code))] // callers (backfill / embed-on-create) are ml-gated
pub fn memory_embedding_text(m: &PersonaMemory) -> String {
    memory_embedding_text_parts(&m.title, &m.content)
}

/// [`memory_embedding_text`] for write paths that hold the parts before a
/// `PersonaMemory` exists. Must stay in lockstep with it.
pub fn memory_embedding_text_parts(title: &str, content: &str) -> String {
    format!("{title}\n{content}")
}

/// Fire-and-forget embed for a just-written memory (embed-on-write). No-op
/// unless app setup registered the recall runtime
/// (`engine::memory_recall::init_task_recall_runtime`) AND we're inside a
/// tokio runtime (unit tests aren't — they keep today's behavior
/// byte-for-byte). Failures are logged and left for
/// [`backfill_memory_embeddings`]: an embedding problem must never fail or
/// slow a memory write, so the write path never awaits this.
#[cfg(feature = "ml")]
fn spawn_embed_memory(memory_id: String, text: String) {
    let Some((vec_pool, embedder)) = crate::engine::memory_recall::task_recall_runtime() else {
        return;
    };
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    handle.spawn(async move {
        if let Err(e) = embed_and_store_memory(&vec_pool, &embedder, &memory_id, &text).await {
            tracing::debug!(
                memory_id = %memory_id,
                error = %e,
                "memory embed-on-write failed (row persisted; backfill will cover it)"
            );
        }
    });
}

#[cfg(not(feature = "ml"))]
fn spawn_embed_memory(_memory_id: String, _text: String) {}

/// Fire-and-forget vector cleanup for hard-deleted memory ids. Same no-op
/// conditions as [`spawn_embed_memory`]. A missed cleanup only leaves an
/// orphan vector whose id never matches a live candidate — inert for recall.
#[cfg(feature = "ml")]
fn spawn_delete_memory_embeddings(ids: Vec<String>) {
    if ids.is_empty() {
        return;
    }
    let Some((vec_pool, _)) = crate::engine::memory_recall::task_recall_runtime() else {
        return;
    };
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    handle.spawn(async move {
        if let Err(e) = delete_memory_embeddings(&vec_pool, &ids) {
            tracing::debug!(error = %e, "memory embedding cleanup failed (orphan vectors are inert)");
        }
    });
}

#[cfg(not(feature = "ml"))]
fn spawn_delete_memory_embeddings(_ids: Vec<String>) {}

/// Latched to `true` only after the vec table is created *successfully* this
/// process — same rationale as companion's `VEC_TABLE_READY` (a `Once` would
/// cache a transient first-call failure as "done" and strand the table absent
/// for the whole process).
#[cfg(feature = "ml")]
static MEMORY_VEC_TABLE_READY: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// Ensure the `persona_memory_embedding` vec0 table exists in `vec_pool` (the
/// user DB pool where sqlite-vec is registered). Idempotent + latched.
#[cfg(feature = "ml")]
pub fn ensure_memory_vec_table(vec_pool: &crate::db::UserDbPool) -> Result<(), AppError> {
    use std::sync::atomic::Ordering;
    if MEMORY_VEC_TABLE_READY.load(Ordering::Acquire) {
        return Ok(());
    }
    let conn = vec_pool.get()?;
    // The vec0 table cannot carry an auxiliary model-stamp column without a
    // destructive recreate, so the stamp lives in a plain sidecar keyed 1:1 by
    // memory_id. Created at runtime alongside the vec table (mirroring how the
    // vec0 table itself is provisioned post-sqlite-vec-registration rather than
    // at migration time) — this sidesteps a cross-DB ALTER (the memories row is
    // in the main DB; the embedding + stamp are in the user DB) and the
    // run_incremental placement gotcha entirely.
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS persona_memory_embedding \
         USING vec0(memory_id TEXT, embedding float[{MEMORY_VEC_DIMS}]);
         CREATE TABLE IF NOT EXISTS persona_memory_embedding_meta (
             memory_id       TEXT PRIMARY KEY,
             embedding_model TEXT NOT NULL,
             embedding_dims  INTEGER NOT NULL
         );"
    ))?;
    if !MEMORY_VEC_TABLE_READY.swap(true, Ordering::AcqRel) {
        tracing::info!(dims = MEMORY_VEC_DIMS, "persona_memory_embedding table ready");
    }
    Ok(())
}

/// Embed `text` and (re)store the vector for `memory_id`. Best-effort at the
/// call site: mirror `episodic::embed_and_store`'s log-and-continue — a failure
/// here must NEVER fail the surrounding memory write. Delete-then-insert makes a
/// re-embed (content edit / backfill re-run) idempotent instead of leaving two
/// rows for one id that would both surface in KNN.
#[cfg(feature = "ml")]
pub async fn embed_and_store_memory(
    vec_pool: &crate::db::UserDbPool,
    embedder: &std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
    memory_id: &str,
    text: &str,
) -> Result<(), AppError> {
    ensure_memory_vec_table(vec_pool)?;
    let vec = embedder.embed_query(text).await?;
    if vec.len() != MEMORY_VEC_DIMS {
        return Err(AppError::Internal(format!(
            "embedder produced {} dims, expected {MEMORY_VEC_DIMS}",
            vec.len()
        )));
    }
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = vec_pool.get()?;
    conn.execute(
        "DELETE FROM persona_memory_embedding WHERE memory_id = ?1",
        params![memory_id],
    )?;
    conn.execute(
        "INSERT INTO persona_memory_embedding (memory_id, embedding) VALUES (?1, ?2)",
        params![memory_id, blob],
    )?;
    // Stamp the model this vector was written under (delete-then-insert keeps
    // the 1:1 mapping idempotent on re-embed) so the recall-side model guard can
    // exclude vectors from a since-swapped embedder.
    conn.execute(
        "DELETE FROM persona_memory_embedding_meta WHERE memory_id = ?1",
        params![memory_id],
    )?;
    conn.execute(
        "INSERT INTO persona_memory_embedding_meta (memory_id, embedding_model, embedding_dims) \
         VALUES (?1, ?2, ?3)",
        params![memory_id, embedder.model_name(), embedder.dimensions() as i64],
    )?;
    Ok(())
}

/// KNN over `persona_memory_embedding`: returns `(memory_id, L2 distance)`
/// nearest-first. Empty table → empty result (not an error), matching
/// `companion::brain::embeddings::search_similar`. The caller applies
/// `crate::retrieval::filter_by_distance_floor` +
/// `crate::retrieval::MAX_VECTOR_DISTANCE` and converts distance to a
/// similarity via `engine::memory_recall::similarity_from_distance`.
#[cfg(feature = "ml")]
pub async fn search_similar_memories(
    vec_pool: &crate::db::UserDbPool,
    embedder: &std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
    query: &str,
    k: usize,
) -> Result<Vec<(String, f32)>, AppError> {
    ensure_memory_vec_table(vec_pool)?;
    let vec = embedder.embed_query(query).await?;
    let blob: &[u8] = bytemuck::cast_slice(&vec);
    let conn = vec_pool.get()?;
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM persona_memory_embedding", [], |r| {
            r.get(0)
        })
        .unwrap_or(0);
    if count == 0 {
        return Ok(Vec::new());
    }
    let mut stmt = conn.prepare(
        "SELECT memory_id, distance FROM persona_memory_embedding
         WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2",
    )?;
    let rows = stmt
        .query_map(params![blob, k as i64], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f32>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    apply_memory_model_guard(&conn, rows, embedder.model_name())
}

/// Process-cumulative count of persona-memory recall hits excluded by the
/// shared-corpus model guard — vectors whose recorded model differs from the
/// loaded embedder. Queryable diagnostic stat; also surfaced via `tracing::warn`
/// at exclusion time. Stays `0` at the current model.
#[cfg(feature = "ml")]
static MEMORY_MODEL_GUARD_EXCLUDED: std::sync::atomic::AtomicU64 =
    std::sync::atomic::AtomicU64::new(0);

/// Read the cumulative persona-memory model-guard exclusion counter.
#[cfg(feature = "ml")]
pub fn memory_model_guard_excluded_total() -> u64 {
    MEMORY_MODEL_GUARD_EXCLUDED.load(std::sync::atomic::Ordering::Relaxed)
}

/// Drop KNN hits whose `persona_memory_embedding_meta.embedding_model` differs
/// from the loaded embedder. Ids with no meta row (embedded before the stamp
/// shipped) are grandfathered as current-model by
/// [`crate::retrieval::filter_by_model`], so at the current model this is a
/// no-op and recall is byte-identical. Exclusions are counted + logged.
#[cfg(feature = "ml")]
fn apply_memory_model_guard(
    conn: &rusqlite::Connection,
    hits: Vec<(String, f32)>,
    current_model: &str,
) -> Result<Vec<(String, f32)>, AppError> {
    if hits.is_empty() {
        return Ok(hits);
    }
    let ids_json =
        serde_json::to_string(&hits.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>())
            .map_err(|e| AppError::Internal(format!("memory model guard id serialize: {e}")))?;
    let mut stmt = conn.prepare(
        "SELECT memory_id, embedding_model FROM persona_memory_embedding_meta
         WHERE memory_id IN (SELECT value FROM json_each(?1))",
    )?;
    let mut model_of = std::collections::HashMap::new();
    let rows = stmt.query_map(params![ids_json], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    for row in rows {
        let (id, model) = row?;
        model_of.insert(id, model);
    }
    let (kept, excluded) = crate::retrieval::filter_by_model(&hits, current_model, &model_of);
    if excluded > 0 {
        MEMORY_MODEL_GUARD_EXCLUDED
            .fetch_add(excluded as u64, std::sync::atomic::Ordering::Relaxed);
        tracing::warn!(
            excluded,
            current_model,
            "persona-memory recall: excluded embeddings recorded under a different model (re-embed to restore them)"
        );
    }
    Ok(kept)
}

/// Embed-on-create wrapper: [`create`] + best-effort [`embed_and_store_memory`].
///
/// The write path mirrors `companion::brain::episodic`'s log-and-continue
/// posture: the memory row is ALWAYS persisted; a failed embedding is logged
/// and left for [`backfill_memory_embeddings`] to repair — an embedding
/// problem must never fail a memory write. Also correct on the dedup path:
/// when [`create`] returns an existing survivor instead of inserting, the
/// (idempotent, delete-then-insert) embed simply refreshes that survivor's
/// vector. Callers that hold no embedder (non-ml builds, or an `AppState`
/// without one) keep calling [`create`]; adoption is per-call-site.
#[cfg(feature = "ml")]
pub async fn create_with_embedding(
    pool: &DbPool,
    vec_pool: &crate::db::UserDbPool,
    embedder: &std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
    input: CreatePersonaMemoryInput,
) -> Result<PersonaMemory, AppError> {
    let created = create(pool, input)?;
    let text = memory_embedding_text(&created);
    if let Err(e) = embed_and_store_memory(vec_pool, embedder, &created.id, &text).await {
        tracing::warn!(
            memory_id = %created.id,
            error = %e,
            "memory embed-on-create failed (memory persisted; backfill will cover it)"
        );
    }
    Ok(created)
}

/// Ids that already have an embedding (backfill diff source).
#[cfg(feature = "ml")]
pub fn embedded_memory_ids(
    vec_pool: &crate::db::UserDbPool,
) -> Result<std::collections::HashSet<String>, AppError> {
    ensure_memory_vec_table(vec_pool)?;
    let conn = vec_pool.get()?;
    let mut stmt = conn.prepare("SELECT memory_id FROM persona_memory_embedding")?;
    let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut set = std::collections::HashSet::new();
    for r in rows {
        set.insert(r?);
    }
    Ok(set)
}

/// Drop embeddings for `ids` (lifecycle cleanup when memories are hard-deleted).
/// Chunked to stay under SQLite's variable limit; idempotent.
#[cfg(feature = "ml")]
pub fn delete_memory_embeddings(
    vec_pool: &crate::db::UserDbPool,
    ids: &[String],
) -> Result<(), AppError> {
    if ids.is_empty() {
        return Ok(());
    }
    ensure_memory_vec_table(vec_pool)?;
    let conn = vec_pool.get()?;
    const CHUNK: usize = 400;
    for chunk in ids.chunks(CHUNK) {
        let placeholders = chunk.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let params: Vec<&dyn rusqlite::ToSql> =
            chunk.iter().map(|s| s as &dyn rusqlite::ToSql).collect();
        conn.execute(
            &format!("DELETE FROM persona_memory_embedding WHERE memory_id IN ({placeholders})"),
            params.as_slice(),
        )?;
        // Keep the model-stamp sidecar in lockstep with the vectors it describes.
        conn.execute(
            &format!(
                "DELETE FROM persona_memory_embedding_meta WHERE memory_id IN ({placeholders})"
            ),
            params.as_slice(),
        )?;
    }
    Ok(())
}

/// Bounded, idempotent GC sweep for archived-memory embedding leftovers.
///
/// The incremental path ([`archive_by_ids`] + [`update_tier`]) keeps vectors in
/// lockstep with the archive tier going forward, but rows archived BEFORE that
/// shipped still carry a live KNN vector. This sweeps them: enumerate up to
/// `limit` `tier = 'archive'` rows from the main DB, intersect with the vectors
/// actually present in the user DB, and drop those. Returns the number of
/// leftover embeddings cleaned this call — 0 on a clean corpus, so it is safe to
/// call on every decay tick (idempotent) and never scans the whole table
/// (bounded). Hard-delete is unaffected — it still drops vectors via
/// [`batch_delete`] → [`spawn_delete_memory_embeddings`].
#[cfg(feature = "ml")]
pub fn gc_archived_memory_embeddings(
    main_pool: &DbPool,
    vec_pool: &crate::db::UserDbPool,
    limit: usize,
) -> Result<usize, AppError> {
    ensure_memory_vec_table(vec_pool)?;
    let archived_ids: Vec<String> = {
        let conn = main_pool.get()?;
        let mut stmt =
            conn.prepare("SELECT id FROM persona_memories WHERE tier = 'archive' LIMIT ?1")?;
        let ids = stmt
            .query_map(params![limit as i64], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };
    if archived_ids.is_empty() {
        return Ok(0);
    }
    // Only the ids that actually have a vector count as "leftovers" — this keeps
    // the return value honest (already-clean archived rows return 0) and the
    // sweep idempotent across repeated ticks.
    let ids_json = serde_json::to_string(&archived_ids)
        .map_err(|e| AppError::Internal(format!("gc archived ids serialize: {e}")))?;
    let present: Vec<String> = {
        let conn = vec_pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT memory_id FROM persona_memory_embedding
             WHERE memory_id IN (SELECT value FROM json_each(?1))",
        )?;
        let ids = stmt
            .query_map(params![ids_json], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };
    if present.is_empty() {
        return Ok(0);
    }
    delete_memory_embeddings(vec_pool, &present)?;
    tracing::info!(
        cleaned = present.len(),
        "archived-memory embedding GC swept leftover vectors"
    );
    Ok(present.len())
}

/// Fire-and-forget bounded GC of archived-memory embedding leftovers. No-op
/// unless the recall runtime is registered AND we're inside a tokio runtime
/// (unit tests aren't — they call [`gc_archived_memory_embeddings`] directly).
/// Runs on the blocking pool since it issues synchronous rusqlite queries.
#[cfg(feature = "ml")]
pub fn spawn_gc_archived_memory_embeddings(main_pool: &DbPool) {
    /// Per-tick sweep bound — small enough to be cheap, large enough to drain a
    /// backlog over a handful of decay ticks.
    const GC_BATCH: usize = 256;
    let Some((vec_pool, _)) = crate::engine::memory_recall::task_recall_runtime() else {
        return;
    };
    let Ok(handle) = tokio::runtime::Handle::try_current() else {
        return;
    };
    let main_pool = main_pool.clone();
    handle.spawn_blocking(move || {
        if let Err(e) = gc_archived_memory_embeddings(&main_pool, &vec_pool, GC_BATCH) {
            tracing::debug!(error = %e, "archived-embedding GC sweep failed (leftovers are inert)");
        }
    });
}

#[cfg(not(feature = "ml"))]
pub fn spawn_gc_archived_memory_embeddings(_main_pool: &DbPool) {}

/// Idempotent, batched backfill: embed every recall-eligible memory
/// (`tier != 'archive'`) that lacks a vector, up to `batch_limit` this call.
/// Reads candidates from the main DB (`main_pool`) and writes vectors to the
/// user DB (`vec_pool`); the two DBs are joined in-memory by id. Best-effort
/// per row — a single embedding failure is logged and skipped, never aborting
/// the pass. Returns the number embedded this call, so a caller can loop until
/// it returns 0. Wire it to a lifecycle tick or a maintenance command (that
/// wiring lives outside this module — see the recall builder's report).
#[cfg(feature = "ml")]
pub async fn backfill_memory_embeddings(
    main_pool: &DbPool,
    vec_pool: &crate::db::UserDbPool,
    embedder: &std::sync::Arc<crate::engine::embedder::EmbeddingManager>,
    batch_limit: usize,
) -> Result<usize, AppError> {
    ensure_memory_vec_table(vec_pool)?;
    let already = embedded_memory_ids(vec_pool)?;
    let candidates: Vec<PersonaMemory> = {
        let conn = main_pool.get()?;
        let mut stmt = conn.prepare("SELECT * FROM persona_memories WHERE tier != 'archive'")?;
        let rows = stmt.query_map([], row_to_memory)?;
        collect_rows(rows, "memories::backfill_memory_embeddings")
    };
    let mut embedded = 0usize;
    for m in candidates {
        if embedded >= batch_limit {
            break;
        }
        if already.contains(&m.id) {
            continue;
        }
        let text = memory_embedding_text(&m);
        match embed_and_store_memory(vec_pool, embedder, &m.id, &text).await {
            Ok(()) => embedded += 1,
            Err(e) => {
                tracing::warn!(memory_id = %m.id, error = %e, "memory embedding backfill: skipped one row")
            }
        }
    }
    Ok(embedded)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use crate::db::models::{CreatePersonaInput, CreatePersonaMemoryInput, Json};
    use crate::db::repos::core::personas;

    #[test]
    fn test_strip_html_tags() {
        // Plain text passes through unchanged
        assert_eq!(strip_html_tags("hello world"), "hello world");
        assert_eq!(strip_html_tags(""), "");

        // Actual HTML tags are stripped
        assert_eq!(strip_html_tags("<b>bold</b>"), "bold");
        assert_eq!(
            strip_html_tags("<img src=x onerror=alert(1)>payload"),
            "payload"
        );
        assert_eq!(
            strip_html_tags("<script>alert('xss')</script>safe text"),
            "safe text"
        );

        // Comparison operators and math expressions are preserved
        assert_eq!(strip_html_tags("a < b and c > d"), "a < b and c > d");
        assert_eq!(strip_html_tags("no < tags > here"), "no < tags > here");
        assert_eq!(strip_html_tags("if x < 10"), "if x < 10");
        assert_eq!(strip_html_tags("latency > 500ms"), "latency > 500ms");

        // Valid-looking HTML tags are still stripped (e.g. Vec<String> looks like a tag)
        assert_eq!(strip_html_tags("Vec<String>"), "Vec");

        // Ampersands preserved
        assert_eq!(strip_html_tags("a & b"), "a & b");
    }

    #[test]
    fn test_memory_crud() {
        let pool = init_test_db().unwrap();

        // Create a persona first (required as parent)
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Memory Agent".into(),
                system_prompt: "You remember things.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        // Create memories
        let m1 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "User prefers dark mode".into(),
                content: "The user mentioned they always use dark mode.".into(),
                category: Some("preference".into()),
                source_execution_id: None,
                importance: Some(5),
                tags: Some(Json(vec!["ui".to_string(), "preference".to_string()])),
                use_case_id: None,
            
            
            },
        )
        .unwrap();
        assert_eq!(m1.title, "User prefers dark mode");
        assert_eq!(m1.category, "preference");
        assert_eq!(m1.importance, 5);

        let m2 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Project uses Rust".into(),
                content: "The project backend is written in Rust.".into(),
                category: None, // defaults to "fact"
                source_execution_id: None,
                importance: None, // defaults to 3
                tags: None,
                use_case_id: None,
            
            
            },
        )
        .unwrap();
        assert_eq!(m2.category, "fact");
        assert_eq!(m2.importance, 3);

        // Read by id
        let fetched = get_by_id(&pool, &m1.id).unwrap();
        assert_eq!(fetched.title, "User prefers dark mode");
        assert_eq!(
            fetched.tags,
            Some(Json(vec!["ui".to_string(), "preference".to_string()]))
        );

        // Get all (no filters)
        let all = get_all(&pool, None, None, None, None, None, None, None, None).unwrap();
        assert_eq!(all.len(), 2);

        // Get all filtered by persona_id
        let by_persona =
            get_all(&pool, Some(&persona.id), None, None, None, None, None, None, None).unwrap();
        assert_eq!(by_persona.len(), 2);

        // Get all filtered by category
        let by_category = get_all(
            &pool,
            None,
            Some("preference"),
            None,
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        assert_eq!(by_category.len(), 1);
        assert_eq!(by_category[0].title, "User prefers dark mode");

        // Get all with limit
        let limited = get_all(&pool, None, None, None, None, Some(1), None, None, None).unwrap();
        assert_eq!(limited.len(), 1);

        // Get by persona (ordered by importance DESC)
        let by_persona_sorted = get_by_persona(&pool, &persona.id, None).unwrap();
        assert_eq!(by_persona_sorted.len(), 2);
        assert_eq!(by_persona_sorted[0].title, "User prefers dark mode"); // importance 5
        assert_eq!(by_persona_sorted[1].title, "Project uses Rust"); // importance 3

        // Delete
        let deleted = delete(&pool, &m1.id).unwrap();
        assert!(deleted);
        assert!(get_by_id(&pool, &m1.id).is_err());

        let remaining = get_all(&pool, None, None, None, None, None, None, None, None).unwrap();
        assert_eq!(remaining.len(), 1);
    }

    #[test]
    fn test_importance_boundary_validation() {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Boundary Agent".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        let make_input = |importance: Option<i32>| CreatePersonaMemoryInput {
            persona_id: persona.id.clone(),
            title: "test".into(),
            content: "test content".into(),
            category: None,
            source_execution_id: None,
            importance,
            tags: None,
            use_case_id: None,
        
        
        };

        // Valid boundaries
        assert!(create(&pool, make_input(Some(1))).is_ok());
        assert!(create(&pool, make_input(Some(5))).is_ok());
        assert!(create(&pool, make_input(None)).is_ok()); // defaults to 3

        // Out-of-range values rejected
        assert!(create(&pool, make_input(Some(0))).is_err());
        assert!(create(&pool, make_input(Some(6))).is_err());
        assert!(create(&pool, make_input(Some(-1))).is_err());
        assert!(create(&pool, make_input(Some(999))).is_err());

        // update_importance boundaries
        let m = create(&pool, make_input(Some(3))).unwrap();
        assert!(update_importance(&pool, &m.id, 1).is_ok());
        assert!(update_importance(&pool, &m.id, 5).is_ok());
        assert!(update_importance(&pool, &m.id, 0).is_err());
        assert!(update_importance(&pool, &m.id, 6).is_err());
        assert!(update_importance(&pool, &m.id, -1).is_err());
    }

    #[test]
    fn test_batch_update_importance_validates_range() {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Batch Agent".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        let m1 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "mem1".into(),
                content: "content1".into(),
                category: None,
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            
            
            },
        )
        .unwrap();

        let m2 = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "mem2".into(),
                content: "content2".into(),
                category: None,
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            
            
            },
        )
        .unwrap();

        // Valid batch update succeeds
        let result = batch_update_importance(&pool, &[(m1.id.clone(), 5), (m2.id.clone(), 1)]);
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 2);

        // Out-of-range value in batch is rejected (no partial writes)
        assert!(batch_update_importance(
            &pool,
            &[
                (m1.id.clone(), 3),
                (m2.id.clone(), 0), // invalid
            ]
        )
        .is_err());
        assert!(batch_update_importance(
            &pool,
            &[
            (m1.id.clone(), 6), // invalid
        ]
        )
        .is_err());
        assert!(batch_update_importance(
            &pool,
            &[
            (m1.id.clone(), -1), // invalid
        ]
        )
        .is_err());

        // Verify no partial write happened — m1 should still be 5 from the valid batch
        let m1_after = get_by_id(&pool, &m1.id).unwrap();
        assert_eq!(m1_after.importance, 5);
    }

    // ========================================================================
    // Phase C5 — capability-scoped memory injection
    // ========================================================================

    fn make_persona(pool: &DbPool, name: &str) -> String {
        personas::create(
            pool,
            CreatePersonaInput {
                name: name.into(),
                system_prompt: "scope test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap()
        .id
    }

    fn insert_scoped_memory(
        pool: &DbPool,
        persona_id: &str,
        title: &str,
        tier: &str,
        use_case_id: Option<&str>,
    ) -> String {
        let mem = create(
            pool,
            CreatePersonaMemoryInput {
                persona_id: persona_id.to_string(),
                title: title.to_string(),
                content: format!("content for {title}"),
                category: Some("fact".to_string()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: use_case_id.map(|s| s.to_string()),
            },
        )
        .unwrap();
        // Tier defaults to "active" — promote/demote as needed.
        if tier != "active" {
            update_tier(pool, &mem.id, tier).unwrap();
        }
        mem.id
    }

    /// v2 scoping (use_case_id = Some): core ALWAYS injected, active filtered
    /// to capability-scoped + persona-wide.
    #[test]
    fn test_get_for_injection_v2_scoped_capability() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 Scoped");
        let core_global = insert_scoped_memory(&pool, &persona_id, "core global", "core", None);
        let core_scoped = insert_scoped_memory(
            &pool,
            &persona_id,
            "core other-uc",
            "core",
            Some("other-uc"),
        );
        let active_match =
            insert_scoped_memory(&pool, &persona_id, "active match", "active", Some("uc-a"));
        let active_global =
            insert_scoped_memory(&pool, &persona_id, "active global", "active", None);
        let active_other =
            insert_scoped_memory(&pool, &persona_id, "active other", "active", Some("uc-b"));

        let tiered = get_for_injection_v2(&pool, InjectionScope::for_persona(&persona_id).with_use_case(Some("uc-a")), 10, 40).unwrap();

        let core_ids: Vec<&str> = tiered.core.iter().map(|m| m.id.as_str()).collect();
        // Both core memories surface regardless of use_case_id (rule: core is
        // always persona-wide).
        assert!(core_ids.contains(&core_global.as_str()));
        assert!(core_ids.contains(&core_scoped.as_str()));

        let active_ids: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert!(
            active_ids.contains(&active_match.as_str()),
            "scoped match missing"
        );
        assert!(
            active_ids.contains(&active_global.as_str()),
            "global active missing"
        );
        assert!(
            !active_ids.contains(&active_other.as_str()),
            "other capability's active memory leaked"
        );
    }

    /// v2 scoping (use_case_id = None): persona-wide active memories only.
    #[test]
    fn test_get_for_injection_v2_unscoped_persona_wide() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 Unscoped");
        let core_global = insert_scoped_memory(&pool, &persona_id, "core global", "core", None);
        let active_global =
            insert_scoped_memory(&pool, &persona_id, "active global", "active", None);
        let active_scoped =
            insert_scoped_memory(&pool, &persona_id, "active scoped", "active", Some("uc-a"));

        let tiered = get_for_injection_v2(&pool, InjectionScope::for_persona(&persona_id), 10, 40).unwrap();

        assert_eq!(tiered.core.len(), 1);
        assert_eq!(tiered.core[0].id, core_global);

        let active_ids: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert!(active_ids.contains(&active_global.as_str()));
        assert!(
            !active_ids.contains(&active_scoped.as_str()),
            "scoped active memory leaked into persona-wide injection"
        );
    }

    /// Legacy `get_for_injection` is a thin wrapper that delegates to v2 with
    /// use_case_id=None — verify behaviour matches.
    #[test]
    fn test_get_for_injection_v1_matches_v2_unscoped() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 V1Compat");
        insert_scoped_memory(&pool, &persona_id, "global", "active", None);
        insert_scoped_memory(&pool, &persona_id, "scoped", "active", Some("uc-a"));

        let v1 = get_for_injection(&pool, &persona_id, 10, 40).unwrap();
        let v2 = get_for_injection_v2(&pool, InjectionScope::for_persona(&persona_id), 10, 40).unwrap();
        assert_eq!(v1.core.len(), v2.core.len());
        assert_eq!(v1.active.len(), v2.active.len());
    }

    /// Home-team-scoped injection: when running persona X (home team T), the
    /// active-tier fetch should include persona-private rows AND team-shared
    /// rows attributed to T (authored by ANY member), but not memories
    /// attributed to another home team or to personas with no team.
    ///
    /// Memory home-team attribution has no runtime writer post Groups→Teams
    /// retire (it arrives only via the groups_to_teams data migration), so the
    /// test seeds `home_team_id` with a direct UPDATE, mirroring the migration.
    #[test]
    fn test_get_for_injection_v2_home_team_scoped() {
        let pool = init_test_db().unwrap();
        let persona_a = make_persona(&pool, "team-A persona 1");
        let persona_b = make_persona(&pool, "team-A persona 2");
        let outsider = make_persona(&pool, "outsider");

        let mk = |persona: &str, title: &str| -> String {
            create(
                &pool,
                CreatePersonaMemoryInput {
                    persona_id: persona.to_string(),
                    title: title.into(),
                    content: "x".into(),
                    category: Some("fact".into()),
                    source_execution_id: None,
                    importance: Some(3),
                    tags: None,
                    use_case_id: None,
                },
            )
            .unwrap()
            .id
        };
        let set_team = |id: &str, team: &str| {
            pool.get()
                .unwrap()
                .execute(
                    "UPDATE persona_memories SET home_team_id = ?1 WHERE id = ?2",
                    params![team, id],
                )
                .unwrap();
        };

        // persona_a's private memory (no team)
        let priv_a = mk(&persona_a, "private to A");
        // persona_b authors a team-shared memory attributed to team-X
        let shared_in_x = mk(&persona_b, "shared in X");
        set_team(&shared_in_x, "team-X");
        // outsider's team-Y memory should NEVER leak into team-X queries
        let shared_in_y = mk(&outsider, "shared in Y");
        set_team(&shared_in_y, "team-Y");

        // Run injection for persona_a as if their home team were team-X.
        let tiered = get_for_injection_v2(
            &pool,
            InjectionScope::for_persona(&persona_a).with_home_team(Some("team-X")),
            10,
            40,
        )
        .unwrap();
        let ids: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert!(ids.contains(&priv_a.as_str()), "persona's own memory missing");
        assert!(
            ids.contains(&shared_in_x.as_str()),
            "team-X shared memory not surfaced for member"
        );
        assert!(
            !ids.contains(&shared_in_y.as_str()),
            "team-Y memory leaked into team-X injection"
        );
    }

    /// `get_by_use_case_id` returns only memories attributed to the capability.
    #[test]
    fn test_get_by_use_case_id_filters() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 ByUC");
        insert_scoped_memory(&pool, &persona_id, "global", "active", None);
        let scoped = insert_scoped_memory(&pool, &persona_id, "scoped", "active", Some("uc-a"));
        insert_scoped_memory(&pool, &persona_id, "other", "active", Some("uc-b"));

        let rows = get_by_use_case_id(&pool, &persona_id, "uc-a", None).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, scoped);
        assert_eq!(rows[0].use_case_id.as_deref(), Some("uc-a"));
    }

    /// Verify `create()` round-trips `use_case_id` through the new column.
    #[test]
    fn test_create_persists_use_case_id() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "C5 Persist");
        let mem = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona_id.clone(),
                title: "scoped".into(),
                content: "scoped content".into(),
                category: None,
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: Some("uc-x".into()),
            
            
            },
        )
        .unwrap();
        assert_eq!(mem.use_case_id.as_deref(), Some("uc-x"));
        let fetched = get_by_id(&pool, &mem.id).unwrap();
        assert_eq!(fetched.use_case_id.as_deref(), Some("uc-x"));
    }

    /// `batch_create` must report every rejected row with a stable reason
    /// token, and the inserted count must match the number of valid inputs.
    /// Silent rejection of AI-extracted memories was the failure mode this
    /// diagnostic surface is meant to prevent.
    #[test]
    fn batch_create_reports_skipped_rows_with_reasons() {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Batch Diag Agent".into(),
                system_prompt: "You batch.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        let inputs = vec![
            // 0: valid
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Valid 1".into(),
                content: "Valid content".into(),
                category: Some("fact".into()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            
            
            },
            // 1: empty content after strip → empty_title_or_content
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Title only".into(),
                content: "   ".into(),
                category: Some("fact".into()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            
            
            },
            // 2: bogus category → invalid_category
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Bad cat".into(),
                content: "Body".into(),
                category: Some("not_a_real_category".into()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            
            
            },
            // 3: valid
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Valid 2".into(),
                content: "Body".into(),
                category: None,
                source_execution_id: None,
                importance: None,
                tags: None,
                use_case_id: None,
            
            
            },
        ];

        let result = batch_create(&pool, inputs).unwrap();
        assert_eq!(result.inserted, 2, "two valid rows should be inserted");
        assert_eq!(
            result.skipped.len(),
            2,
            "two rows should be reported as skipped"
        );

        let by_index: std::collections::HashMap<usize, &'static str> =
            result.skipped.iter().map(|s| (s.index, s.reason)).collect();
        assert_eq!(by_index.get(&1).copied(), Some("empty_title_or_content"));
        assert_eq!(by_index.get(&2).copied(), Some("invalid_category"));
    }

    /// Regression for MEMORY CONTRACT (2): a memory whose `use_case_id`
    /// references a use case that no longer exists must NOT crash injection,
    /// must NOT leak into capability-scoped fetches for other use cases, and
    /// must still be readable via persona-wide list/`get_by_id` calls. The
    /// orphan is functionally archived for injection — it only matches the
    /// scope predicate when the caller passes the same orphan use_case_id,
    /// which by definition no live capability will request.
    #[test]
    fn orphan_use_case_memory_is_safely_invisible_to_other_capabilities() {
        let pool = init_test_db().unwrap();
        let persona = personas::create(
            &pool,
            CreatePersonaInput {
                name: "Orphan Test Agent".into(),
                system_prompt: "You handle orphans.".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        // Create one memory attached to a (now-defunct) use case and one
        // persona-wide memory to act as a control.
        let orphan = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Capability-scoped fact".into(),
                content: "Belongs to a use case that was later deleted.".into(),
                category: Some("fact".into()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: Some("uc-deleted-on-purpose".into()),
            
            
            },
        )
        .unwrap();
        let global = create(
            &pool,
            CreatePersonaMemoryInput {
                persona_id: persona.id.clone(),
                title: "Persona-wide fact".into(),
                content: "Has no use_case attribution.".into(),
                category: Some("fact".into()),
                source_execution_id: None,
                importance: Some(3),
                tags: None,
                use_case_id: None,
            
            
            },
        )
        .unwrap();

        // 1. get_by_id still returns the orphan (read paths don't care).
        let fetched = get_by_id(&pool, &orphan.id).unwrap();
        assert_eq!(
            fetched.use_case_id.as_deref(),
            Some("uc-deleted-on-purpose"),
            "orphan attribution must survive use_case deletion (no FK cascade)",
        );

        // 2. Capability-scoped injection for a DIFFERENT use_case must not
        //    surface the orphan. The persona-wide memory must surface (it has
        //    use_case_id IS NULL).
        let scoped =
            get_for_injection_v2(&pool, InjectionScope::for_persona(&persona.id).with_use_case(Some("uc-something-else")), 10, 10).unwrap();
        let active_ids: Vec<_> = scoped.active.iter().map(|m| m.id.as_str()).collect();
        assert!(
            !active_ids.contains(&orphan.id.as_str()),
            "orphan use_case_id must NOT match a different live capability",
        );
        assert!(
            active_ids.contains(&global.id.as_str()),
            "persona-wide memory must still match capability-scoped injection",
        );

        // 3. Unscoped injection (use_case_id = None) must also exclude the
        //    orphan — see CONTRACT (2): "use_case_id IS NULL only".
        let unscoped = get_for_injection_v2(&pool, InjectionScope::for_persona(&persona.id), 10, 10).unwrap();
        let unscoped_ids: Vec<_> = unscoped.active.iter().map(|m| m.id.as_str()).collect();
        assert!(
            !unscoped_ids.contains(&orphan.id.as_str()),
            "orphan attribution must NOT leak into unscoped injection either",
        );
        assert!(
            unscoped_ids.contains(&global.id.as_str()),
            "persona-wide memory must surface in unscoped injection",
        );
    }

    #[test]
    fn test_delete_all_memories() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Delete All Agent");

        for i in 0..3 {
            create(
                &pool,
                CreatePersonaMemoryInput {
                    persona_id: persona_id.clone(),
                    title: format!("mem {i}"),
                    content: format!("content {i}"),
                    category: Some("fact".into()),
                    source_execution_id: None,
                    importance: Some(3),
                    tags: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }
        let all = get_all(&pool, None, None, None, None, None, None, None, None).unwrap();
        assert_eq!(all.len(), 3);

        let n = delete_all(&pool).unwrap();
        assert_eq!(n, 3);
        let after = get_all(&pool, None, None, None, None, None, None, None, None).unwrap();
        assert_eq!(after.len(), 0);
    }

    #[test]
    fn test_delete_all_preserves_core_tier() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Core Keeper Agent");

        for i in 0..3 {
            create(
                &pool,
                CreatePersonaMemoryInput {
                    persona_id: persona_id.clone(),
                    title: format!("mem {i}"),
                    content: format!("content {i}"),
                    category: Some("fact".into()),
                    source_execution_id: None,
                    importance: Some(3),
                    tags: None,
                    use_case_id: None,
                },
            )
            .unwrap();
        }
        let all = get_all(&pool, None, None, None, None, None, None, None, None).unwrap();
        assert_eq!(all.len(), 3);

        // Pin one as the user-pinned, authoritative `core` tier.
        update_tier(&pool, &all[0].id, "core").unwrap();

        // delete_all must clear only the two non-core memories.
        let n = delete_all(&pool).unwrap();
        assert_eq!(n, 2, "delete_all must hard-delete non-core memories only");

        let after = get_all(&pool, None, None, None, None, None, None, None, None).unwrap();
        assert_eq!(after.len(), 1, "the pinned core memory must survive a clear-all");
        assert_eq!(after[0].id, all[0].id);
        assert_eq!(after[0].tier, "core");
    }

    // ========================================================================
    // merge() — tier / scope / persona guards
    // ========================================================================

    /// Build the merged-row input the way the real call site does (store +
    /// conflictHelpers): it carries NO tier / use_case_id / source_execution_id
    /// — the repo derives those from the two originals.
    fn merge_input(persona_id: &str, importance: i32) -> CreatePersonaMemoryInput {
        CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: "merged".into(),
            content: "merged content".into(),
            category: Some("fact".into()),
            source_execution_id: None,
            importance: Some(importance),
            tags: None,
            use_case_id: None,
        }
    }

    /// MEMORY CONTRACT (1): a merge hard-deletes BOTH originals, so it must
    /// refuse when either is the user-pinned `core` tier (the `keep_a`/`keep_b`
    /// path already refuses this; merge used not to).
    #[test]
    fn merge_refuses_core_pinned_memory() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Merge Core Guard");
        let a = insert_scoped_memory(&pool, &persona_id, "keep core", "core", None);
        let b = insert_scoped_memory(&pool, &persona_id, "other", "active", None);

        assert!(
            merge(&pool, merge_input(&persona_id, 4), &a, &b).is_err(),
            "merge must refuse a core-tier original",
        );
        // Both originals survive the refusal (transaction never ran).
        assert!(get_by_id(&pool, &a).is_ok());
        assert!(get_by_id(&pool, &b).is_ok());
    }

    /// A merge must never silently reassign/delete one agent's memory into
    /// another — cross-persona merges are refused.
    #[test]
    fn merge_refuses_cross_persona() {
        let pool = init_test_db().unwrap();
        let p1 = make_persona(&pool, "Merge Persona 1");
        let p2 = make_persona(&pool, "Merge Persona 2");
        let a = insert_scoped_memory(&pool, &p1, "a", "active", None);
        let b = insert_scoped_memory(&pool, &p2, "b", "active", None);

        assert!(
            merge(&pool, merge_input(&p1, 4), &a, &b).is_err(),
            "merge must refuse a cross-persona merge",
        );
        assert!(get_by_id(&pool, &a).is_ok());
        assert!(get_by_id(&pool, &b).is_ok());
    }

    /// A normal same-persona, non-core merge still works AND now preserves the
    /// stronger tier + the shared capability scope instead of dropping them.
    #[test]
    fn merge_same_persona_preserves_stronger_tier_and_use_case() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Merge Preserve");
        // active + working, both attributed to the same capability.
        let a = insert_scoped_memory(&pool, &persona_id, "a", "active", Some("uc-shared"));
        let b = insert_scoped_memory(&pool, &persona_id, "b", "working", Some("uc-shared"));

        let merged = merge(&pool, merge_input(&persona_id, 4), &a, &b).unwrap();
        // Stronger tier wins (active > working) — no demotion.
        assert_eq!(merged.tier, "active");
        // Shared capability attribution survives.
        assert_eq!(merged.use_case_id.as_deref(), Some("uc-shared"));
        assert_eq!(merged.persona_id, persona_id);
        // Both originals are gone.
        assert!(get_by_id(&pool, &a).is_err());
        assert!(get_by_id(&pool, &b).is_err());
    }

    /// When the two originals disagree on capability scope, the merge widens to
    /// persona-wide (use_case_id = NULL) so the result is never hidden from a
    /// capability that previously saw one of them.
    #[test]
    fn merge_widens_diverging_use_case_to_persona_wide() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Merge Diverge");
        let a = insert_scoped_memory(&pool, &persona_id, "a", "active", Some("uc-a"));
        let b = insert_scoped_memory(&pool, &persona_id, "b", "active", None);

        let merged = merge(&pool, merge_input(&persona_id, 4), &a, &b).unwrap();
        assert_eq!(
            merged.use_case_id, None,
            "diverging capability scope must widen to persona-wide",
        );
        assert_eq!(merged.tier, "active");
    }

    // ========================================================================
    // Direction 1 — write-path semantic (normalized-content) dedup
    // ========================================================================

    fn dedup_input(persona_id: &str, content: &str) -> CreatePersonaMemoryInput {
        CreatePersonaMemoryInput {
            persona_id: persona_id.to_string(),
            title: "t".into(),
            content: content.into(),
            category: Some("fact".into()),
            source_execution_id: None,
            importance: Some(3),
            tags: None,
            use_case_id: None,
        }
    }

    /// The Stock-Price-Logger case: two runs land byte-identical content. The
    /// old 24h guard only caught same-day exact dupes; the write-path
    /// normalized dedup collapses them regardless of when they arrive, and
    /// returns the SAME surviving row (stable id) instead of a second row.
    #[test]
    fn write_path_dedup_collapses_cross_run_duplicate() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Dedup Repeat");
        let first = create(&pool, dedup_input(&persona_id, "AAPL closed at 150.00")).unwrap();
        let second = create(&pool, dedup_input(&persona_id, "AAPL closed at 150.00")).unwrap();

        assert_eq!(first.id, second.id, "duplicate must fold into the survivor");
        let all = get_by_persona(&pool, &persona_id, None).unwrap();
        assert_eq!(all.len(), 1, "only one row should exist");
    }

    /// Near-duplicates that differ only by case / surrounding + internal
    /// whitespace normalize to the same content and are deduped — the exact
    /// variants the old byte-equality guard let through.
    #[test]
    fn write_path_dedup_collapses_whitespace_and_case_variants() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Dedup Variants");
        let a = create(&pool, dedup_input(&persona_id, "The user prefers dark mode")).unwrap();
        let b = create(
            &pool,
            dedup_input(&persona_id, "  the   USER prefers   Dark Mode "),
        )
        .unwrap();

        assert_eq!(a.id, b.id, "case/whitespace variant must dedup");
        assert_eq!(get_by_persona(&pool, &persona_id, None).unwrap().len(), 1);
    }

    /// MEMORY CONTRACT §1: `core` is never a dedup target. An identical-content
    /// memory arriving after one has been pinned to core must be inserted as a
    /// normal `active` row — the user's pinned memory is never silently folded
    /// into or replaced.
    #[test]
    fn write_path_dedup_never_targets_core_tier() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Dedup Core Immune");
        let pinned = create(&pool, dedup_input(&persona_id, "Ship on Fridays")).unwrap();
        update_tier(&pool, &pinned.id, "core").unwrap();

        let fresh = create(&pool, dedup_input(&persona_id, "Ship on Fridays")).unwrap();
        assert_ne!(
            fresh.id, pinned.id,
            "must NOT dedup against a core memory"
        );
        assert_eq!(fresh.tier, "active");
        assert_eq!(
            get_by_persona(&pool, &persona_id, None).unwrap().len(),
            2,
            "core memory + new active row = two rows"
        );
    }

    /// Dedup is bounded by persona_id: identical content authored by two
    /// different personas stays two independent memories (cross-persona
    /// isolation).
    #[test]
    fn write_path_dedup_is_per_persona() {
        let pool = init_test_db().unwrap();
        let persona_a = make_persona(&pool, "Dedup Persona A");
        let persona_b = make_persona(&pool, "Dedup Persona B");
        let a = create(&pool, dedup_input(&persona_a, "Deploy target is prod")).unwrap();
        let b = create(&pool, dedup_input(&persona_b, "Deploy target is prod")).unwrap();

        assert_ne!(a.id, b.id, "different personas must not dedup against each other");
        assert_eq!(get_by_persona(&pool, &persona_a, None).unwrap().len(), 1);
        assert_eq!(get_by_persona(&pool, &persona_b, None).unwrap().len(), 1);
    }

    /// `batch_create` dedups both against pre-existing rows AND within the same
    /// batch, reporting each collapsed row with the `duplicate_content` token.
    #[test]
    fn batch_create_dedups_within_and_against_existing() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Batch Dedup");
        // Pre-existing row the batch will collide with.
        create(&pool, dedup_input(&persona_id, "Rate limit is 100 rps")).unwrap();

        let inputs = vec![
            dedup_input(&persona_id, "Rate limit is 100 rps"), // dup of pre-existing
            dedup_input(&persona_id, "Cache TTL is 60s"),      // new
            dedup_input(&persona_id, "cache   TTL is 60s"),    // dup within-batch (normalized)
            dedup_input(&persona_id, "Region is eu-west-1"),   // new
        ];
        let result = batch_create(&pool, inputs).unwrap();

        assert_eq!(result.inserted, 2, "only the two distinct rows insert");
        let dup_indices: Vec<usize> = result
            .skipped
            .iter()
            .filter(|s| s.reason == "duplicate_content")
            .map(|s| s.index)
            .collect();
        assert_eq!(dup_indices, vec![0, 2], "rows 0 and 2 are duplicates");
        // Persona now holds: pre-existing + 2 new = 3 rows.
        assert_eq!(get_by_persona(&pool, &persona_id, None).unwrap().len(), 3);
    }

    // ========================================================================
    // Direction 2 — decay-aware active-tier injection ranking
    // ========================================================================

    /// MEMORY CONTRACT (6): a stale heavy-hitter (huge access_count, untouched
    /// for months) must rank BELOW a fresh memory of equal importance, because
    /// the access term is time-windowed. Under the old monotonic sort the
    /// heavy-hitter would win on `access_count DESC` forever.
    #[test]
    fn injection_ranking_decays_stale_heavy_hitters() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Decay Rank");
        let stale = insert_scoped_memory(&pool, &persona_id, "stale heavy", "active", None);
        let fresh = insert_scoped_memory(&pool, &persona_id, "fresh modest", "active", None);
        let conn = pool.get().unwrap();
        // Stale heavy-hitter: injected 500×, last touched 90 days ago.
        conn.execute(
            "UPDATE persona_memories SET access_count = 500,
             last_accessed_at = datetime('now', '-90 days') WHERE id = ?1",
            params![stale],
        )
        .unwrap();
        // Fresh memory: injected a few times, touched today.
        conn.execute(
            "UPDATE persona_memories SET access_count = 3,
             last_accessed_at = datetime('now') WHERE id = ?1",
            params![fresh],
        )
        .unwrap();
        drop(conn);

        let tiered =
            get_for_injection_v2(&pool, InjectionScope::for_persona(&persona_id), 10, 40).unwrap();
        let order: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            order,
            vec![fresh.as_str(), stale.as_str()],
            "fresh memory must outrank the stale heavy-hitter at equal importance"
        );
    }

    /// Importance strictly dominates the decay term: a fresh, heavily-accessed
    /// importance-3 memory must never outrank an importance-4 one, however
    /// stale. (The access term is capped at 9 < one 10-point importance step.)
    #[test]
    fn injection_ranking_importance_dominates_decay() {
        let pool = init_test_db().unwrap();
        let persona_id = make_persona(&pool, "Decay Importance");
        let important = insert_scoped_memory(&pool, &persona_id, "important old", "active", None);
        let busy = insert_scoped_memory(&pool, &persona_id, "busy lesser", "active", None);
        let conn = pool.get().unwrap();
        conn.execute(
            "UPDATE persona_memories SET importance = 4, access_count = 0,
             last_accessed_at = datetime('now', '-120 days') WHERE id = ?1",
            params![important],
        )
        .unwrap();
        conn.execute(
            "UPDATE persona_memories SET importance = 3, access_count = 400,
             last_accessed_at = datetime('now') WHERE id = ?1",
            params![busy],
        )
        .unwrap();
        drop(conn);

        let tiered =
            get_for_injection_v2(&pool, InjectionScope::for_persona(&persona_id), 10, 40).unwrap();
        let order: Vec<&str> = tiered.active.iter().map(|m| m.id.as_str()).collect();
        assert_eq!(
            order,
            vec![important.as_str(), busy.as_str()],
            "importance must dominate the decayed access term"
        );
    }
}

#[cfg(all(test, feature = "ml"))]
mod vec_tests {
    //! Persona-memory embedding side-table (MEMORY CONTRACT (7)) — verifies
    //! the vec0 mechanics without an embedder: table provisioning, KNN MATCH
    //! ordering with the SAME SQL `search_similar_memories` issues,
    //! delete-then-insert idempotence, the id/delete helpers, and that the
    //! shared retrieval floor drops off-topic hits. Vectors are hand-crafted
    //! 384-d unit vectors so distances are exact and deterministic.
    use super::*;

    fn vec_pool() -> crate::db::UserDbPool {
        crate::engine::vector_store::ensure_vec_registered_pub();
        let dir = std::env::temp_dir().join(format!("pm-vec-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let manager = r2d2_sqlite::SqliteConnectionManager::file(dir.join("vec-test.db"));
        r2d2::Pool::builder().max_size(2).build(manager).unwrap()
    }

    fn unit_vec(axis: usize) -> Vec<f32> {
        let mut v = vec![0.0f32; MEMORY_VEC_DIMS];
        v[axis] = 1.0;
        v
    }

    fn insert_vec(pool: &crate::db::UserDbPool, id: &str, v: &[f32]) {
        let blob: &[u8] = bytemuck::cast_slice(v);
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO persona_memory_embedding (memory_id, embedding) VALUES (?1, ?2)",
                params![id, blob],
            )
            .unwrap();
    }

    fn knn(pool: &crate::db::UserDbPool, q: &[f32], k: i64) -> Vec<(String, f32)> {
        let blob: &[u8] = bytemuck::cast_slice(q);
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare(
                "SELECT memory_id, distance FROM persona_memory_embedding
                 WHERE embedding MATCH ?1 ORDER BY distance LIMIT ?2",
            )
            .expect("vec0 MATCH must prepare (sqlite-vec registered)");
        stmt.query_map(params![blob, k], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn memory_vec_table_knn_floor_and_lifecycle() {
        let pool = vec_pool();
        ensure_memory_vec_table(&pool).expect("provision vec table");
        // Latched fast-path must also succeed and be idempotent.
        ensure_memory_vec_table(&pool).expect("second ensure is a no-op");

        // on-topic: identical (d=0); related: mixed vector (0 < d < floor);
        // off-topic: orthogonal unit vector (d = √2 ≈ 1.414 > 1.30 floor).
        let query = unit_vec(0);
        let mut related = vec![0.0f32; MEMORY_VEC_DIMS];
        related[0] = 0.8;
        related[1] = 0.6; // normalized: d² = (1-0.8)² + 0.6² = 0.4 → d ≈ 0.632
        insert_vec(&pool, "on_topic", &unit_vec(0));
        insert_vec(&pool, "related", &related);
        insert_vec(&pool, "off_topic", &unit_vec(7));

        let hits = knn(&pool, &query, 10);
        let ids: Vec<&str> = hits.iter().map(|(id, _)| id.as_str()).collect();
        assert_eq!(
            ids,
            vec!["on_topic", "related", "off_topic"],
            "KNN must order nearest-first"
        );

        // The shared lane's floor drops the orthogonal hit entirely.
        let (kept, dropped) = crate::retrieval::filter_by_distance_floor(
            &hits,
            crate::retrieval::MAX_VECTOR_DISTANCE,
        );
        assert_eq!(dropped, 1, "off-topic (√2) must fall past the 1.30 floor");
        assert!(kept.iter().all(|(id, _)| id != "off_topic"));

        // embedded_memory_ids sees all three.
        let ids = embedded_memory_ids(&pool).unwrap();
        assert_eq!(ids.len(), 3);

        // Delete-then-insert idempotence: re-storing the same id leaves ONE row.
        let conn = pool.get().unwrap();
        conn.execute(
            "DELETE FROM persona_memory_embedding WHERE memory_id = ?1",
            params!["on_topic"],
        )
        .unwrap();
        drop(conn);
        insert_vec(&pool, "on_topic", &unit_vec(0));
        let n: i64 = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT COUNT(*) FROM persona_memory_embedding WHERE memory_id = 'on_topic'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(n, 1);

        // delete_memory_embeddings removes exactly the requested ids.
        delete_memory_embeddings(&pool, &["on_topic".into(), "related".into()]).unwrap();
        let rest = embedded_memory_ids(&pool).unwrap();
        assert_eq!(rest.len(), 1);
        assert!(rest.contains("off_topic"));
    }

    #[test]
    fn model_guard_excludes_foreign_stamp_and_grandfathers_unstamped() {
        let pool = vec_pool();
        ensure_memory_vec_table(&pool).expect("provision vec + meta table");
        let conn = pool.get().unwrap();
        // cur = current model, old = swapped-away model, leg = no meta row.
        for (id, model) in [("cur", "AllMiniLML6V2Q"), ("old", "BGESmallENV15")] {
            conn.execute(
                "INSERT INTO persona_memory_embedding_meta (memory_id, embedding_model, embedding_dims) VALUES (?1, ?2, 384)",
                params![id, model],
            )
            .unwrap();
        }
        let hits = vec![
            ("cur".to_string(), 0.1_f32),
            ("old".to_string(), 0.2_f32),
            ("leg".to_string(), 0.3_f32),
        ];
        let before = memory_model_guard_excluded_total();
        let kept = apply_memory_model_guard(&conn, hits, "AllMiniLML6V2Q").expect("guard");
        assert_eq!(
            kept.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>(),
            vec!["cur", "leg"],
            "foreign-model vector dropped; current + unstamped-legacy kept"
        );
        assert_eq!(memory_model_guard_excluded_total() - before, 1);
    }

    #[test]
    fn embed_stamp_written_and_guard_inert_at_current_model() {
        // Zero behavior change at the current model: all stamps match, nothing
        // excluded. Uses the meta table the way embed_and_store_memory writes it.
        let pool = vec_pool();
        ensure_memory_vec_table(&pool).expect("provision");
        let conn = pool.get().unwrap();
        for id in ["a", "b", "c"] {
            conn.execute(
                "INSERT INTO persona_memory_embedding_meta (memory_id, embedding_model, embedding_dims) VALUES (?1, 'AllMiniLML6V2Q', 384)",
                params![id],
            )
            .unwrap();
        }
        let hits = vec![
            ("a".to_string(), 0.1_f32),
            ("b".to_string(), 0.2_f32),
            ("c".to_string(), 0.3_f32),
        ];
        let before = memory_model_guard_excluded_total();
        let kept = apply_memory_model_guard(&conn, hits.clone(), "AllMiniLML6V2Q").unwrap();
        assert_eq!(kept, hits, "inert when every stamp matches the current model");
        assert_eq!(memory_model_guard_excluded_total(), before);
    }

    // ── D2: archived vectors leave recall (GC sweep) ────────────────────────

    #[test]
    fn gc_sweeps_only_archived_leftover_vectors_and_is_idempotent() {
        use crate::db::init_test_db;
        use crate::db::models::{CreatePersonaInput, CreatePersonaMemoryInput};
        use crate::db::repos::core::personas;

        let main = init_test_db().unwrap();
        let vp = vec_pool();
        ensure_memory_vec_table(&vp).expect("provision vec + meta");

        let persona = personas::create(
            &main,
            CreatePersonaInput {
                name: "Recall Agent".into(),
                system_prompt: "test".into(),
                project_id: None,
                description: None,
                structured_prompt: None,
                icon: None,
                color: None,
                enabled: Some(true),
                max_concurrent: None,
                timeout_ms: None,
                model_profile: None,
                max_budget_usd: None,
                max_turns: None,
                design_context: None,
                notification_channels: None,
                lifecycle: None,
            },
        )
        .unwrap();

        let mk = |title: &str| {
            create(
                &main,
                CreatePersonaMemoryInput {
                    persona_id: persona.id.clone(),
                    title: title.into(),
                    content: format!("{title} content"),
                    category: None,
                    source_execution_id: None,
                    importance: Some(3),
                    tags: None,
                    use_case_id: None,
                },
            )
            .unwrap()
        };
        let archived = mk("archived one");
        let live = mk("live one");

        // Archive one; both keep a hand-seeded vector (the test stands in for the
        // fire-and-forget drop that a tokio runtime would have done on archive).
        update_tier(&main, &archived.id, "archive").unwrap();
        insert_vec(&vp, &archived.id, &unit_vec(0));
        insert_vec(&vp, &live.id, &unit_vec(1));

        // Sweep: exactly the archived row's leftover vector is cleaned.
        let cleaned = gc_archived_memory_embeddings(&main, &vp, 100).unwrap();
        assert_eq!(cleaned, 1, "only the archived row's leftover vector is swept");

        let remaining = embedded_memory_ids(&vp).unwrap();
        assert!(
            !remaining.contains(&archived.id),
            "archived memory's vector removed → it can no longer surface in KNN recall"
        );
        assert!(
            remaining.contains(&live.id),
            "a live memory's vector is never touched by the archive GC"
        );

        // Idempotent: a second sweep on the now-clean corpus cleans nothing.
        assert_eq!(gc_archived_memory_embeddings(&main, &vp, 100).unwrap(), 0);
    }
}
