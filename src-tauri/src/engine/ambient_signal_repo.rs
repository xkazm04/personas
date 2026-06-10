//! SQL projection of ambient signals — the cross-process bridge
//! between the windowed app's in-memory `AmbientContextFusion` and
//! the daemon's per-execution snapshot reader.
//!
//! The windowed app captures signals (clipboard / file_watcher /
//! app_focus) into an in-memory rolling window. The daemon binary
//! runs as a separate process with no access to that window. This
//! module is the bridge: capture-side writers persist redacted rows
//! here, daemon-side reads them at execution time, and a TTL evictor
//! keeps the table bounded.
//!
//! Capture-side writes intentionally happen ONE LEVEL UP from
//! `AmbientContextFusion` (in `clipboard_monitor::clipboard_tick`,
//! `FileWatcherSubscription::tick`, and the app_focus tick) — keeps
//! the fusion a pure in-memory cache with no DB awareness.
//!
//! Daemon-side reads happen in `daemon/runtime.rs::run_one` just
//! before `runner::run_execution`. The daemon applies the persona
//! policy and renders the prompt block via the same `Phase 3 c v1`
//! `prepend_ambient_to_system_prompt` helper used by the windowed
//! runner.
//!
//! # Privacy posture
//!
//! Stored rows are POST-redaction (capture-time gate from Phase 3 v1
//! strips JWT/AWS/Stripe/GitHub/Slack/Bearer/email patterns before
//! the row is written). The threat surface widens in *time* (24h TTL
//! by default) not in *kind* — a redaction false-negative would leak
//! in-memory or via SQL identically. Eviction is the durability
//! bound; see `evict_older_than`.

use crate::db::DbPool;
use crate::engine::ambient_context::AmbientSignalEntry;
use crate::error::AppError;
use rusqlite::params;

/// Insert one signal row. `INSERT OR IGNORE` makes duplicate inserts
/// safe — capture-side writers fire-and-forget; if the same `id`
/// were ever to be written twice (e.g. a recovery after a partial
/// flush) the second write is a no-op rather than an error.
pub fn insert_signal(
    pool: &DbPool,
    id: &str,
    source: &str,
    summary: &str,
    captured_at_secs: u64,
    redacted_content: Option<&str>,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    conn.execute(
        "INSERT OR IGNORE INTO ambient_signal
            (id, source, summary, captured_at, redacted_content)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            id,
            source,
            summary,
            captured_at_secs as i64,
            redacted_content
        ],
    )?;
    Ok(())
}

/// Fetch the most recent signals captured at or after `since_secs`
/// (unix epoch seconds), newest first, capped at `max_count`.
///
/// `age_secs` on each returned entry is computed against
/// `SystemTime::now()` at the time of the query — the daemon's
/// "age" therefore reflects time-since-capture as observed at read
/// time, not relative to a fixed snapshot, which matches what the
/// in-memory `format_for_prompt` does.
///
/// The caller applies any per-persona `SensoryPolicy` filtering on
/// top of these results — this query is policy-agnostic.
pub fn recent_signals(
    pool: &DbPool,
    since_secs: u64,
    max_count: u32,
) -> Result<Vec<AmbientSignalEntry>, AppError> {
    let conn = pool.get()?;
    let mut stmt = conn.prepare(
        "SELECT id, source, summary, captured_at, redacted_content
         FROM ambient_signal
         WHERE captured_at >= ?1
         ORDER BY captured_at DESC
         LIMIT ?2",
    )?;
    let now_secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let rows = stmt
        .query_map(
            params![since_secs as i64, max_count as i64],
            |row| {
                let captured_at_signed: i64 = row.get(3)?;
                let captured_at = captured_at_signed.max(0) as u64;
                let age_secs = now_secs.saturating_sub(captured_at);
                Ok(AmbientSignalEntry {
                    id: row.get(0)?,
                    source: row.get(1)?,
                    summary: row.get(2)?,
                    captured_at,
                    age_secs,
                    redacted_content: row.get(4)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Delete signals captured before `cutoff_secs` (unix epoch
/// seconds). Returns the number of rows deleted.
///
/// Caller chooses the cutoff from the TTL config — typically
/// `now - 24h` for the rolling buffer. Eviction is the privacy
/// bound: stored rows are POST-redaction, but the durability
/// envelope shouldn't grow without bound.
pub fn evict_older_than(pool: &DbPool, cutoff_secs: u64) -> Result<usize, AppError> {
    let conn = pool.get()?;
    let n = conn.execute(
        "DELETE FROM ambient_signal WHERE captured_at < ?1",
        params![cutoff_secs as i64],
    )?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Local in-memory pool — same pattern as the helpers in
    /// `db/repos/resources/*` (kept local per-file because the one in
    /// `db/migrations` is private). Each call gets a uniquely-named
    /// shared-cache DB so parallel tests don't collide.
    fn test_pool() -> crate::db::DbPool {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let id = COUNTER.fetch_add(1, Ordering::Relaxed);
        let uri = format!("file:ambient_signal_testdb_{id}?mode=memory&cache=shared");
        let manager = r2d2_sqlite::SqliteConnectionManager::file(&uri);
        let pool = r2d2::Pool::builder()
            .max_size(4)
            .build(manager)
            .expect("test pool build");
        {
            let conn = pool.get().expect("conn");
            conn.execute_batch("PRAGMA foreign_keys = ON;").unwrap();
            crate::db::migrations::run(&conn).expect("migrations");
        }
        pool
    }

    fn now_secs() -> u64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    #[test]
    fn insert_and_recent_round_trip() {
        let pool = test_pool();
        let now = now_secs();
        insert_signal(&pool, "sig_1", "clipboard", "copied snippet", now, Some("hello world")).unwrap();
        insert_signal(&pool, "sig_2", "app_focus", "VS Code — main.rs", now, None).unwrap();

        let rows = recent_signals(&pool, now - 60, 10).unwrap();
        assert_eq!(rows.len(), 2);
        // Newest-first ordering: same captured_at, but PRIMARY KEY
        // tiebreaker is implementation-defined in SQLite — both rows
        // present is what matters for the contract.
        assert!(rows.iter().any(|r| r.id == "sig_1" && r.redacted_content.as_deref() == Some("hello world")));
        assert!(rows.iter().any(|r| r.id == "sig_2" && r.redacted_content.is_none()));
    }

    #[test]
    fn recent_signals_respects_since_cutoff() {
        let pool = test_pool();
        let now = now_secs();
        insert_signal(&pool, "old", "clipboard", "ancient", now - 3600, None).unwrap();
        insert_signal(&pool, "new", "clipboard", "fresh", now, None).unwrap();

        let rows = recent_signals(&pool, now - 60, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "new");
    }

    #[test]
    fn recent_signals_respects_max_count() {
        let pool = test_pool();
        let now = now_secs();
        for i in 0..5 {
            insert_signal(
                &pool,
                &format!("sig_{i}"),
                "clipboard",
                "x",
                now - (i as u64),
                None,
            )
            .unwrap();
        }
        let rows = recent_signals(&pool, 0, 3).unwrap();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn insert_or_ignore_is_idempotent() {
        let pool = test_pool();
        let now = now_secs();
        insert_signal(&pool, "sig_dup", "clipboard", "first", now, None).unwrap();
        // Second insert of the same id is a no-op (no error, no
        // overwrite). Capture-side writers can re-fire safely.
        insert_signal(&pool, "sig_dup", "clipboard", "second", now, Some("oops")).unwrap();
        let rows = recent_signals(&pool, 0, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].summary, "first");
        assert_eq!(rows[0].redacted_content, None);
    }

    #[test]
    fn evict_older_than_drops_only_old_rows() {
        let pool = test_pool();
        let now = now_secs();
        insert_signal(&pool, "old1", "clipboard", "x", now - 7200, None).unwrap();
        insert_signal(&pool, "old2", "clipboard", "x", now - 3601, None).unwrap();
        insert_signal(&pool, "fresh", "clipboard", "x", now - 1800, None).unwrap();

        let n = evict_older_than(&pool, now - 3600).unwrap();
        assert_eq!(n, 2);
        let rows = recent_signals(&pool, 0, 10).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, "fresh");
    }

    #[test]
    fn age_secs_reflects_now_at_query_time() {
        let pool = test_pool();
        let now = now_secs();
        insert_signal(&pool, "sig_age", "clipboard", "x", now - 30, None).unwrap();
        let rows = recent_signals(&pool, 0, 10).unwrap();
        assert_eq!(rows.len(), 1);
        // Allow a small clock-tick window — the test only verifies
        // age is computed (non-zero, in the right ballpark) rather
        // than asserting an exact value the test runner can't
        // guarantee.
        assert!(rows[0].age_secs >= 30 && rows[0].age_secs < 60);
    }

    /// End-to-end test of the daemon's cross-process ambient path.
    ///
    /// Exercises the contract that motivates the entire Phase 3 c v3
    /// work: signals captured in process A (windowed app) reach
    /// process B (daemon) through SQL with the same rendered shape.
    ///
    /// Path: insert_signal (capture-side mirror)
    ///     → recent_signals (daemon-side load)
    ///     → format_signals_for_prompt (shared renderer, step 4)
    ///     → prepend_ambient_to_system_prompt (Phase 3 c v1)
    ///     → assert the persona's system_prompt contains the
    ///       expected ambient block at the front.
    ///
    /// Regression target: anything that breaks this round trip
    /// silently leaves daemon-fired personas blind to user activity.
    #[test]
    fn daemon_path_round_trip_renders_ambient_into_persona_prompt() {
        use crate::engine::ambient_context::{
            format_signals_for_prompt, prepend_ambient_to_system_prompt,
        };

        let pool = test_pool();
        let now = now_secs();

        // Capture-side: simulate what clipboard_monitor and
        // AppFocusSubscription would write.
        insert_signal(
            &pool,
            "sig_0",
            "app_focus",
            "Focused: Code.exe — main.rs",
            now - 5,
            None,
        )
        .unwrap();
        insert_signal(
            &pool,
            "sig_1",
            "clipboard",
            "Clipboard: text (42 chars)",
            now - 2,
            Some("a redacted snippet"),
        )
        .unwrap();

        // Daemon-side: load + render + prepend.
        let signals = recent_signals(&pool, now - 60, 30).unwrap();
        assert_eq!(signals.len(), 2, "both inserts should be visible");
        let md = format_signals_for_prompt(&signals, None)
            .expect("non-empty signal list should render");

        // Sanity-check the rendered shape — same contract the
        // windowed runner relies on.
        assert!(md.starts_with("## Ambient Desktop Context"));
        assert!(md.contains("[clipboard] Clipboard: text (42 chars)"));
        assert!(md.contains("[app_focus] Focused: Code.exe"));

        // Build a minimal persona and inject. Mirrors what
        // daemon::runtime::inject_ambient_for_daemon does.
        let mut persona = crate::db::models::Persona {
            id: "p_e2e".into(),
            project_id: "proj_e2e".into(),
            name: "E2E".into(),
            description: None,
            system_prompt: "You are a helpful assistant.".into(),
            structured_prompt: None,
            icon: None,
            color: None,
            enabled: true,
            sensitive: false,
            headless: true,
            starred: false,
            max_concurrent: 1,
            timeout_ms: 60_000,
            notification_channels: None,
            last_design_result: None,
            last_test_report: None,
            model_profile: None,
            max_budget_usd: None,
            max_turns: None,
            design_context: None,
            home_team_id: None,
            source_review_id: None,
            trust_level: crate::db::models::PersonaTrustLevel::Verified,
            trust_origin: crate::db::models::PersonaTrustOrigin::default(),
            trust_verified_at: None,
            trust_score: 1.0,
            parameters: None,
            gateway_exposure: Default::default(),
            template_category: None,
            cli_awareness_enabled: false,
            setup_status: "ready".to_string(),
            setup_detail: None,
            disabled_dims_json: None,
            created_at: "2026-05-09T00:00:00Z".into(),
            updated_at: "2026-05-09T00:00:00Z".into(),
        };

        prepend_ambient_to_system_prompt(&mut persona, &md);
        assert!(persona.system_prompt.starts_with("## Ambient Desktop Context"));
        assert!(persona.system_prompt.ends_with("You are a helpful assistant."));
        assert!(
            persona.system_prompt.contains("\n\nYou are a helpful assistant."),
            "ambient block separated from existing prompt by a blank line"
        );
    }

    /// Daemon path correctly returns no-injection when nothing was
    /// captured. Equivalent to the empty-window None case the
    /// windowed path tests in `format_ambient_for_persona_returns_
    /// none_when_empty`.
    #[test]
    fn daemon_path_renders_none_when_table_empty() {
        use crate::engine::ambient_context::format_signals_for_prompt;
        let pool = test_pool();
        let signals = recent_signals(&pool, 0, 30).unwrap();
        assert!(signals.is_empty());
        assert!(format_signals_for_prompt(&signals, None).is_none());
    }
}
