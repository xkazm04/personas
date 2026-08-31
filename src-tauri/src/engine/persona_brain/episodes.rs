//! Episode minting: one call writes the disk markdown AND the indexed excerpt
//! row in `persona_episodes`.
//!
//! **Deviation from the disk-truth doctrine, on purpose (v1):** the companion
//! brain treats disk as the source of truth and the DB as an index. Here the
//! disk write is BEST-EFFORT — when it fails (permissions, full disk, an
//! unwritable `PERSONAS_HOME`) we log a warning and still insert the row with
//! `file_path = NULL`, so the index survives and consolidation keeps working
//! off `body_excerpt`. The alternative (failing the mint) would let a disk
//! hiccup silently lobotomize a persona's episodic record, and every call
//! site is a best-effort hook that must never affect the run it observes.

use crate::db::repos::core::episodes as episodes_repo;
use crate::db::DbPool;
use crate::error::AppError;
use crate::retrieval::EPISODE_EXCERPT_CAP;

/// Who/what produced an episode. Serialized into `persona_episodes.role`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EpisodeRole {
    /// A persona execution's outcome (status, cost, IO excerpts).
    Run,
    /// A channel exchange (inbound message + the persona's reply).
    Channel,
    /// Something the operator did to/with the persona. Part of the WP4 wire
    /// contract (`run|channel|operator|system`); its first minting call site
    /// (operator chat/setting acts) is a follow-up WP.
    #[allow(dead_code)]
    Operator,
    /// System-originated events (migrations, lifecycle acts). Same contract
    /// note as `Operator`.
    #[allow(dead_code)]
    System,
}

impl EpisodeRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            EpisodeRole::Run => "run",
            EpisodeRole::Channel => "channel",
            EpisodeRole::Operator => "operator",
            EpisodeRole::System => "system",
        }
    }
}

/// Mint one episode: disk markdown at
/// `~/.personas/personas/<persona_id>/episodes/YYYY/MM/DD/pep_<short>_<role>.md`
/// (best-effort — see module doc), then the `persona_episodes` row (excerpt
/// capped at [`EPISODE_EXCERPT_CAP`], `content_hash` = sha256 of the FULL
/// markdown, `chars` = ORIGINAL body chars). Returns the DB row id.
pub fn record(
    pool: &DbPool,
    persona_id: &str,
    role: EpisodeRole,
    source: &str,
    execution_id: Option<&str>,
    responsibility_id: Option<&str>,
    content: &str,
) -> Result<String, AppError> {
    let now = chrono::Utc::now();
    let created_at = now.to_rfc3339();
    // Disk file id — distinct from the DB row id (the repo mints its own
    // `ep_*` id at insert); `content_hash` ties the two records together.
    let file_id = format!(
        "pep_{}_{}",
        crate::companion::brain::util::short_id(8),
        role.as_str()
    );

    let markdown = format!(
        "---\nid: {file_id}\npersona_id: {persona_id}\nrole: {role}\nsource: {source}\ncreated_at: {created_at}\n---\n\n{content}\n",
        role = role.as_str(),
    );
    let content_hash = crate::companion::brain::util::sha256_hex(&markdown);

    // Best-effort disk write (see module doc for the deviation rationale).
    let file_path: Option<String> = (|| -> Result<String, AppError> {
        let dir = super::persona_root(persona_id)?
            .join("episodes")
            .join(now.format("%Y").to_string())
            .join(now.format("%m").to_string())
            .join(now.format("%d").to_string());
        std::fs::create_dir_all(&dir)?;
        let path = dir.join(format!("{file_id}.md"));
        std::fs::write(&path, &markdown)?;
        Ok(path.to_string_lossy().to_string())
    })()
    .map_err(|e| {
        tracing::warn!(
            persona_id,
            role = role.as_str(),
            error = %e,
            "persona episode disk write failed; indexing the row with file_path NULL"
        );
        e
    })
    .ok();

    let excerpt = crate::companion::brain::util::excerpt(content, EPISODE_EXCERPT_CAP);
    let episode = episodes_repo::insert(
        pool,
        episodes_repo::InsertEpisodeInput {
            persona_id,
            execution_id,
            responsibility_id,
            role: role.as_str(),
            source,
            body_excerpt: &excerpt,
            file_path: file_path.as_deref(),
            content_hash: &content_hash,
            chars: content.chars().count() as i64,
        },
    )?;
    Ok(episode.id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn seed_persona(pool: &DbPool, id: &str) {
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
                 VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
                rusqlite::params![id],
            )
            .unwrap();
    }

    #[test]
    fn record_writes_disk_and_index_row() {
        // PERSONAS_HOME is process-global — take the brain module's one
        // sanctioned lock (companion::brain::test_home) rather than racing it.
        let home = crate::companion::brain::test_home::TestHome::new("persona_episodes");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");

        let long_body = "x".repeat(EPISODE_EXCERPT_CAP + 100);
        let id = record(
            &pool,
            "p1",
            EpisodeRole::Run,
            "execution",
            Some("exec-1"),
            None,
            &long_body,
        )
        .unwrap();
        let _ = home.path();

        let rows = crate::db::repos::core::episodes::list_recent(&pool, "p1", 10).unwrap();
        assert_eq!(rows.len(), 1);
        let ep = &rows[0];
        assert_eq!(ep.id, id);
        assert_eq!(ep.role, "run");
        assert_eq!(ep.source, "execution");
        assert_eq!(ep.chars, long_body.chars().count() as i64);
        assert!(ep.body_excerpt.len() <= EPISODE_EXCERPT_CAP);
        assert!(ep.content_hash.starts_with("sha256:"));
        let path = ep.file_path.as_deref().expect("disk write succeeded");
        let on_disk = std::fs::read_to_string(path).unwrap();
        assert!(on_disk.contains("role: run"));
        assert!(on_disk.ends_with(&format!("{long_body}\n")));
    }
}
