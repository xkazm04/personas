//! Moved verbatim out of the former single-file `session.rs`; the inner
//! `mod tests` wrapper became this file, so every test body is unchanged apart
//! from four columns of indentation.

use super::failure::{classify_failure, FailedTurnCtx};
use super::origin::TurnOrigin;
use crate::db::UserDbPool;
use crate::error::AppError;

use super::*;
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

/// Unique per test — libtest runs these in parallel and a bare
/// `file::memory:?cache=shared` is one database process-wide.
fn test_pool(name: &str) -> UserDbPool {
    let manager = SqliteConnectionManager::file(format!("file:{name}?mode=memory&cache=shared"))
        .with_flags(
            rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE
                | rusqlite::OpenFlags::SQLITE_OPEN_CREATE
                | rusqlite::OpenFlags::SQLITE_OPEN_URI,
        );
    let pool = Pool::builder().max_size(2).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .execute_batch(
            "CREATE TABLE IF NOT EXISTS companion_turn (
                id TEXT PRIMARY KEY, origin TEXT NOT NULL, trigger_kind TEXT, model TEXT,
                input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER,
                cache_creation_tokens INTEGER, cost_usd REAL, duration_ms INTEGER,
                num_turns INTEGER, is_error INTEGER NOT NULL DEFAULT 0,
                voice INTEGER NOT NULL DEFAULT 0, assistant_episode_id TEXT,
                outcome_json TEXT, prompt_blocks_json TEXT, total_prompt_chars INTEGER,
                error_reason TEXT, prompt_block_hashes_json TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );",
        )
        .expect("schema");
    pool
}

fn rows(pool: &UserDbPool) -> Vec<(String, i64, Option<String>)> {
    let conn = pool.get().unwrap();
    let mut stmt = conn
        .prepare("SELECT origin, is_error, error_reason FROM companion_turn")
        .unwrap();
    let out = stmt
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    out
}

/// The literal messages the failure exits in THIS file actually produce.
/// Pinning them is the point: reword one and the classifier silently
/// degrades that failure to `other`, so the ledger can no longer tell a
/// timeout from a crash. This fails instead of degrading quietly.
#[test]
fn classifies_the_real_failure_exits() {
    let cases: &[(&str, &str)] = &[
        // send_turn_inner — the plain 25-minute timeout…
        ("Turn exceeded 25-minute timeout", "timeout"),
        // …and the one that fired after the stale-session self-heal retried.
        (
            "Turn exceeded 25-minute timeout (after session reset)",
            "timeout_after_stale_resume",
        ),
        // run_cli — spawn, exit status, empty reply, and the pipe/wait IO set.
        ("spawn claude: program not found", "spawn_failed"),
        (
            "claude exited with status exit code: 1: boom",
            "cli_nonzero_exit",
        ),
        ("claude produced no assistant text", "empty_reply"),
        ("read claude stdout: broken pipe", "cli_io"),
        ("claude stdout missing", "cli_io"),
        ("write claude stdin: pipe closed", "cli_io"),
        ("wait claude: no child process", "cli_io"),
        // is_stale_session_error's patterns, reached only when there was no
        // session id to retry with (otherwise send_turn self-heals first).
        ("No conversation found with session ID: abc", "stale_resume"),
        // athena_reaction::cli_text_inner words the SAME failures
        // differently. One taxonomy has to cover both, or a headless
        // spawn failure silently degrades to `other` — which is exactly
        // what the headless test caught the first time this ran.
        (
            "Claude CLI not found. Install from https://docs.anthropic.com/en/docs/claude-code",
            "spawn_failed",
        ),
        (
            "Failed to spawn Claude CLI: permission denied",
            "spawn_failed",
        ),
        ("Missing stdout pipe", "cli_io"),
        // Everything else: the `?` exits — DB writes, prompt assembly,
        // embedding. Rare, but equally invisible before.
        ("failed to open database", "other"),
    ];
    for (msg, expected) in cases {
        assert_eq!(
            classify_failure(&AppError::Internal((*msg).into())),
            *expected,
            "message: {msg}"
        );
    }
}

/// The literal messages `brain::oneshot::call_claude_text` produces — the
/// THIRD module wording these failures, and the one whose legs now write
/// `origin='maintenance'` rows.
///
/// This test earned its keep on its first run: oneshot says
/// `"claude {leg} exited {code}: {stderr}"`, which matched neither
/// `"exited with status"` (run_cli's phrasing) nor any of the IO patterns,
/// so every crashed maintenance leg was classifying as `other` — precisely
/// the silent degradation the headless case caught last round. Reword any
/// message in `oneshot.rs` and this fails loudly instead.
#[test]
fn classifies_the_oneshot_leg_failure_exits() {
    let cases: &[(&str, &str)] = &[
        (
            "spawn claude (consolidation): program not found",
            "spawn_failed",
        ),
        ("write stdin (reflection): pipe closed", "cli_io"),
        ("claude stdout missing (briefing)", "cli_io"),
        ("claude stderr missing (tours)", "cli_io"),
        ("read stdout (night_planner): broken pipe", "cli_io"),
        (
            "await claude (night_unattended): no child process",
            "cli_io",
        ),
        ("recall_synthesis timed out after 180s", "timeout"),
        (
            "claude consolidation exited 1: model overloaded",
            "cli_nonzero_exit",
        ),
        // Exit code unavailable (killed by signal) — the "?" branch.
        ("claude briefing exited ?: ", "cli_nonzero_exit"),
    ];
    for (msg, expected) in cases {
        assert_eq!(
            classify_failure(&AppError::Internal((*msg).into())),
            *expected,
            "message: {msg}"
        );
    }
}

/// A turn-lock SKIP must record NOTHING. Background ticks self-skip
/// constantly by design, and a full fleet queue is backpressure — counting
/// either would make the error rate dishonest in the opposite direction
/// from the structural zero this whole change exists to fix.
#[test]
fn a_lock_skip_records_no_row() {
    let pool = test_pool("session_skip");
    let ctx = FailedTurnCtx::new(&TurnOrigin::Autonomous { chain_index: 1 }, false);
    // Never armed: the turn never got past `try_lock`.
    ctx.record(
        &pool,
        &AppError::Internal(
            "A companion turn is already in progress; background turn skipped".into(),
        ),
        None,
    );
    assert!(
        rows(&pool).is_empty(),
        "a skip is backpressure, not a failed turn"
    );
}

/// An armed turn that fails records exactly one flagged row carrying the
/// origin and the reason — with no usage at all, which is the common shape
/// for a timeout (the CLI never got to emit a `result` event).
#[test]
fn an_armed_failure_records_one_flagged_row() {
    let pool = test_pool("session_failed");
    let ctx = FailedTurnCtx::new(
        &TurnOrigin::External {
            source: "Fleet".into(),
        },
        false,
    );
    ctx.arm();
    ctx.record(
        &pool,
        &AppError::Internal("Turn exceeded 25-minute timeout".into()),
        None,
    );
    let r = rows(&pool);
    assert_eq!(r.len(), 1, "exactly one row per failed turn");
    assert_eq!(r[0].0, "external", "the origin survives the failure");
    assert_eq!(r[0].1, 1, "and it is visible to the health query");
    assert_eq!(r[0].2.as_deref(), Some("timeout"));
}

/// Once the turn wrote its own success row it disarms, so a later error
/// cannot add a second row for the same turn.
#[test]
fn disarm_prevents_a_second_row_for_the_same_turn() {
    let pool = test_pool("session_disarm");
    let ctx = FailedTurnCtx::new(&TurnOrigin::User, false);
    ctx.arm();
    ctx.disarm();
    ctx.record(&pool, &AppError::Internal("late failure".into()), None);
    assert!(rows(&pool).is_empty());
}
