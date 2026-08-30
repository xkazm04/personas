//! Repository for `persona_episodes` — the living-agent append-only episodic
//! record (migration `e16_living_agent`).
//!
//! Read paths are keyset-paginated on `(created_at, id)` — the table grows
//! monotonically and OFFSET pagination over it would re-scan the whole tail on
//! every page. `list_after` is the consolidation reader (oldest-first from a
//! watermark); `count_chars_after` is the consolidation trigger's budget probe.

use rusqlite::params;
use uuid::Uuid;

use crate::models::PersonaEpisode;
use crate::repos::utils::collect_rows;
use crate::DbPool;
use crate::PoolExt;
use personas_core::error::AppError;

/// Every full-row read goes through this projection — exactly the columns
/// `row_to_episode` consumes, nothing else.
const COLUMNS: &str = "id, persona_id, execution_id, responsibility_id, role, \
     source, body_excerpt, file_path, content_hash, chars, created_at";

row_mapper!(row_to_episode -> PersonaEpisode {
    id, persona_id, execution_id, responsibility_id, role,
    source, body_excerpt, file_path, content_hash, chars, created_at,
});

/// Everything a new episode needs; the repo supplies id + created_at.
pub struct InsertEpisodeInput<'a> {
    pub persona_id: &'a str,
    pub execution_id: Option<&'a str>,
    pub responsibility_id: Option<&'a str>,
    pub role: &'a str,
    pub source: &'a str,
    pub body_excerpt: &'a str,
    pub file_path: Option<&'a str>,
    pub content_hash: &'a str,
    /// Character count of the ORIGINAL body (not the stored excerpt).
    pub chars: i64,
}

pub fn insert(pool: &DbPool, input: InsertEpisodeInput<'_>) -> Result<PersonaEpisode, AppError> {
    timed_query!("persona_episodes", "episodes::insert", {
        let id = format!("ep_{}", Uuid::new_v4().simple());
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.conn("episodes::insert")?;
        conn.execute(
            "INSERT INTO persona_episodes
                (id, persona_id, execution_id, responsibility_id, role, source,
                 body_excerpt, file_path, content_hash, chars, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                input.persona_id,
                input.execution_id,
                input.responsibility_id,
                input.role,
                input.source,
                input.body_excerpt,
                input.file_path,
                input.content_hash,
                input.chars,
                now,
            ],
        )?;
        Ok(PersonaEpisode {
            id,
            persona_id: input.persona_id.to_string(),
            execution_id: input.execution_id.map(str::to_string),
            responsibility_id: input.responsibility_id.map(str::to_string),
            role: input.role.to_string(),
            source: input.source.to_string(),
            body_excerpt: input.body_excerpt.to_string(),
            file_path: input.file_path.map(str::to_string),
            content_hash: input.content_hash.to_string(),
            chars: input.chars,
            created_at: now,
        })
    })
}

/// Newest first — the first page of a persona's episodic record.
pub fn list_recent(
    pool: &DbPool,
    persona_id: &str,
    limit: u32,
) -> Result<Vec<PersonaEpisode>, AppError> {
    timed_query!("persona_episodes", "episodes::list_recent", {
        let conn = pool.conn("episodes::list_recent")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_episodes
             WHERE persona_id = ?1
             ORDER BY created_at DESC, id DESC
             LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![persona_id, limit], row_to_episode)?;
        Ok(collect_rows(rows, "episodes::list_recent"))
    })
}

/// Keyset continuation of [`list_recent`]: the page strictly OLDER than the
/// `(before_created_at, before_id)` cursor (the last row of the prior page).
/// The compound tie-break makes same-timestamp rows paginate without loss.
pub fn list_before(
    pool: &DbPool,
    persona_id: &str,
    before_created_at: &str,
    before_id: &str,
    limit: u32,
) -> Result<Vec<PersonaEpisode>, AppError> {
    timed_query!("persona_episodes", "episodes::list_before", {
        let conn = pool.conn("episodes::list_before")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_episodes
             WHERE persona_id = ?1
               AND (created_at < ?2 OR (created_at = ?2 AND id < ?3))
             ORDER BY created_at DESC, id DESC
             LIMIT ?4"
        ))?;
        let rows = stmt.query_map(
            params![persona_id, before_created_at, before_id, limit],
            row_to_episode,
        )?;
        Ok(collect_rows(rows, "episodes::list_before"))
    })
}

/// Total ORIGINAL-body characters accumulated strictly after `after` — the
/// consolidation trigger's budget probe ("is there enough new material?").
pub fn count_chars_after(pool: &DbPool, persona_id: &str, after: &str) -> Result<i64, AppError> {
    timed_query!("persona_episodes", "episodes::count_chars_after", {
        let conn = pool.conn("episodes::count_chars_after")?;
        let sum: i64 = conn.query_row(
            "SELECT COALESCE(SUM(chars), 0) AS total FROM persona_episodes
             WHERE persona_id = ?1 AND created_at > ?2",
            params![persona_id, after],
            |r| r.get("total"),
        )?;
        Ok(sum)
    })
}

/// Oldest-first from a watermark — the consolidation reader. Rows with
/// `created_at` strictly greater than `after` (pass the ledger's
/// `consumed_through` to resume where the last pass stopped).
pub fn list_after(
    pool: &DbPool,
    persona_id: &str,
    after: &str,
    limit: u32,
) -> Result<Vec<PersonaEpisode>, AppError> {
    timed_query!("persona_episodes", "episodes::list_after", {
        let conn = pool.conn("episodes::list_after")?;
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {COLUMNS} FROM persona_episodes
             WHERE persona_id = ?1 AND created_at > ?2
             ORDER BY created_at ASC, id ASC
             LIMIT ?3"
        ))?;
        let rows = stmt.query_map(params![persona_id, after, limit], row_to_episode)?;
        Ok(collect_rows(rows, "episodes::list_after"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn insert_persona(pool: &DbPool, id: &str) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
            params![id],
        )?;
        Ok(())
    }

    /// Seed an episode at a CONTROLLED timestamp so ordering/keyset tests are
    /// deterministic (insert() stamps wall-clock time, which can collide).
    fn seed(
        pool: &DbPool,
        id: &str,
        persona_id: &str,
        chars: i64,
        created_at: &str,
    ) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO persona_episodes
                (id, persona_id, role, source, body_excerpt, content_hash, chars, created_at)
             VALUES (?1, ?2, 'assistant', 'execution', 'body', ?1, ?3, ?4)",
            params![id, persona_id, chars, created_at],
        )?;
        Ok(())
    }

    #[test]
    fn insert_round_trips_and_list_recent_is_newest_first() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        let ep = insert(
            &pool,
            InsertEpisodeInput {
                persona_id: "p1",
                execution_id: Some("exec-1"),
                responsibility_id: None,
                role: "assistant",
                source: "execution",
                body_excerpt: "did the thing",
                file_path: None,
                content_hash: "h1",
                chars: 13,
            },
        )?;
        assert!(ep.id.starts_with("ep_"));

        seed(&pool, "ep_old", "p1", 5, "2020-01-01T00:00:00Z")?;
        let recent = list_recent(&pool, "p1", 10)?;
        assert_eq!(recent.len(), 2);
        assert_eq!(recent[0].id, ep.id, "wall-clock row sorts newest");
        assert_eq!(recent[0].execution_id.as_deref(), Some("exec-1"));
        assert_eq!(recent[1].id, "ep_old");
        Ok(())
    }

    #[test]
    fn keyset_pagination_walks_the_whole_set_without_loss_or_overlap() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        // Five rows, two sharing one timestamp — the tie-break must carry.
        seed(&pool, "ep_a", "p1", 1, "2026-01-01T00:00:01Z")?;
        seed(&pool, "ep_b", "p1", 1, "2026-01-01T00:00:02Z")?;
        seed(&pool, "ep_c1", "p1", 1, "2026-01-01T00:00:03Z")?;
        seed(&pool, "ep_c2", "p1", 1, "2026-01-01T00:00:03Z")?;
        seed(&pool, "ep_d", "p1", 1, "2026-01-01T00:00:04Z")?;

        let mut seen: Vec<String> = Vec::new();
        let mut page = list_recent(&pool, "p1", 2)?;
        while !page.is_empty() {
            seen.extend(page.iter().map(|e| e.id.clone()));
            let last = page.last().unwrap().clone();
            page = list_before(&pool, "p1", &last.created_at, &last.id, 2)?;
        }
        assert_eq!(seen, vec!["ep_d", "ep_c2", "ep_c1", "ep_b", "ep_a"]);
        Ok(())
    }

    #[test]
    fn count_chars_after_and_list_after_respect_the_watermark() -> Result<(), AppError> {
        let pool = init_test_db()?;
        insert_persona(&pool, "p1")?;
        insert_persona(&pool, "p2")?;
        seed(&pool, "ep_1", "p1", 100, "2026-01-01T00:00:01Z")?;
        seed(&pool, "ep_2", "p1", 200, "2026-01-01T00:00:02Z")?;
        seed(&pool, "ep_3", "p1", 400, "2026-01-01T00:00:03Z")?;
        seed(&pool, "ep_other", "p2", 999, "2026-01-01T00:00:03Z")?;

        assert_eq!(
            count_chars_after(&pool, "p1", "2026-01-01T00:00:01Z")?,
            600,
            "strictly-after: the watermark row itself is consumed"
        );
        assert_eq!(count_chars_after(&pool, "p1", "2026-12-31T00:00:00Z")?, 0);

        let tail = list_after(&pool, "p1", "2026-01-01T00:00:01Z", 10)?;
        assert_eq!(
            tail.iter().map(|e| e.id.as_str()).collect::<Vec<_>>(),
            vec!["ep_2", "ep_3"],
            "oldest-first from the watermark, other personas excluded"
        );
        Ok(())
    }
}
