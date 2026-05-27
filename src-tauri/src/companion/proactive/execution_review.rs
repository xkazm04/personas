//! Goal 2 — self-initiated execution review.
//!
//! On each proactive tick (5-min cadence), when autonomous mode is on,
//! scan `persona_executions` for recently-finished runs worth analyzing
//! (failures, or notably slow / expensive runs) and spawn a real Athena
//! reasoning turn (`TurnOrigin::Proactive`) that looks at the run and
//! proposes an improvement. This is distinct from the proactive *nudge*
//! pipeline (pre-drafted strings) — here Athena actually reasons.
//!
//! Dedupe / rate-limit: a single settings cursor
//! (`companion.exec_review_cursor`, an ISO8601 timestamp) marks the
//! newest execution we've already considered. Each tick processes only
//! rows created after the cursor, reviews at most `MAX_REVIEWS_PER_TICK`
//! (newest-first), and advances the cursor past the whole window so the
//! next tick never re-reviews. Bounds work per tick and survives restarts.

use std::sync::LazyLock;
use std::time::Duration;

use crate::db::DbPool;
use crate::error::AppError;

/// Goal 1 — event-driven review. The engine pings this every time a
/// persona execution reaches a terminal state; a debouncer task (spawned
/// in `companion_init`) coalesces a burst and runs the same review pass
/// `review_recent_executions` the 5-min tick uses. Decoupling via a
/// `Notify` keeps the engine's completion hot-path free of companion
/// pools / app-handle plumbing — it just signals.
static REVIEW_SIGNAL: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);

/// Quiet window the debouncer waits for after the last execution-finish
/// signal before running a review. Coalesces a flurry of scheduled runs
/// finishing together into a single review pass (which is itself capped
/// + cursor-deduped). Long enough to batch a burst, short enough to feel
/// event-driven.
const DEBOUNCE: Duration = Duration::from_secs(20);

/// Called by the engine on every execution completion. Cheap: just wakes
/// the debouncer (or stores one permit if it's mid-window). No pools, no
/// app handle — safe to call from the engine's completion path.
pub fn signal_execution_finished() {
    REVIEW_SIGNAL.notify_one();
}

/// The debouncer loop body — `companion_init` spawns this. Waits for the
/// first finish signal, drains further signals until `DEBOUNCE` of quiet,
/// then runs one review pass if autonomous mode is on. Loops forever.
pub async fn run_execution_review_debouncer(
    user_db: crate::db::UserDbPool,
    sys_db: DbPool,
    app: tauri::AppHandle,
    #[cfg(feature = "ml")] embedder: Option<std::sync::Arc<crate::engine::embedder::EmbeddingManager>>,
) {
    loop {
        // Park until the first execution-finish since the last pass.
        REVIEW_SIGNAL.notified().await;
        // Debounce: keep resetting the window while finishes keep
        // arriving, so a burst of scheduled runs collapses into one pass.
        loop {
            match tokio::time::timeout(DEBOUNCE, REVIEW_SIGNAL.notified()).await {
                Ok(_) => continue,   // another finish landed — extend the window
                Err(_) => break,     // quiet for DEBOUNCE — go review
            }
        }
        if !crate::commands::companion::chat::autonomous_mode_enabled(&sys_db) {
            continue; // mode off — drop the signal, no reviews
        }
        let res = review_recent_executions(
            &user_db,
            &sys_db,
            &app,
            #[cfg(feature = "ml")]
            embedder.as_ref(),
        );
        match res {
            Ok(n) if n > 0 => {
                tracing::info!(reviews = n, "exec-review debouncer: spawned review turn(s)")
            }
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "exec-review debouncer: review failed"),
        }
    }
}

/// Settings key holding the ISO8601 timestamp of the newest execution
/// the reviewer has already considered. MUST be allowlisted in
/// `settings_keys::ALLOWED_KEYS` or `settings::set` rejects it — in
/// which case the cursor never persists and the reviewer reseeds to
/// "now" every tick, silently finding nothing.
use crate::db::settings_keys::COMPANION_EXEC_REVIEW_CURSOR as CURSOR_KEY;

/// Most reviews to spawn in a single tick. A burst of failures
/// shouldn't spawn 20 CLI turns at once; cap it and let the cursor
/// advance past the rest (we care about recency, not exhaustive
/// coverage of a flood).
const MAX_REVIEWS_PER_TICK: usize = 2;

/// A run is "slow enough to flag" past this wall-clock duration.
const SLOW_MS: i64 = 120_000; // 2 minutes

/// A run is "expensive enough to flag" past this USD cost.
const EXPENSIVE_USD: f64 = 0.50;

/// One finished execution worth reviewing, with the persona name joined
/// in and the error/output tail truncated for the directive.
struct ReviewCandidate {
    execution_id: String,
    persona_name: String,
    status: String,
    duration_ms: Option<i64>,
    cost_usd: f64,
    error_tail: Option<String>,
    output_tail: Option<String>,
    created_at: String,
    reason: &'static str,
}

/// Scan for qualifying executions after the cursor. Returns
/// `(candidates_to_review, newest_created_at_seen)`. `newest_created_at`
/// is `None` when no rows at all landed after the cursor (nothing to do,
/// cursor unchanged).
fn collect_candidates(
    sys_db: &DbPool,
    cursor: &str,
) -> Result<(Vec<ReviewCandidate>, Option<String>), AppError> {
    let conn = sys_db.get()?;
    // Pull every terminal execution after the cursor (newest first) so we
    // can both pick review candidates AND learn the newest timestamp to
    // advance the cursor to. Cap the scan generously — a tick that's been
    // idle for a while shouldn't pull thousands of rows.
    let mut stmt = conn.prepare(
        "SELECT e.id, COALESCE(p.name, e.persona_id) AS persona_name, e.status,
                e.duration_ms, COALESCE(e.cost_usd, 0.0), e.error_message,
                e.output_data, e.created_at
         FROM persona_executions e
         LEFT JOIN personas p ON p.id = e.persona_id
         WHERE e.created_at > ?1
           AND e.status IN ('completed', 'failed', 'incomplete', 'cancelled')
         ORDER BY e.created_at DESC
         LIMIT 200",
    )?;
    let rows = stmt
        .query_map([cursor], |row| {
            let status: String = row.get(2)?;
            let duration_ms: Option<i64> = row.get(3)?;
            let cost_usd: f64 = row.get(4)?;
            let error_message: Option<String> = row.get(5)?;
            let output_data: Option<String> = row.get(6)?;
            Ok((
                row.get::<_, String>(0)?,   // id
                row.get::<_, String>(1)?,   // persona_name
                status,
                duration_ms,
                cost_usd,
                error_message,
                output_data,
                row.get::<_, String>(7)?,   // created_at
            ))
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let newest = rows.first().map(|r| r.7.clone());

    let mut candidates = Vec::new();
    for (id, persona_name, status, duration_ms, cost_usd, error_message, output_data, created_at) in
        rows
    {
        if candidates.len() >= MAX_REVIEWS_PER_TICK {
            break; // newest-first, so we keep the most recent qualifying
        }
        let failed = matches!(status.as_str(), "failed" | "incomplete");
        let slow = duration_ms.is_some_and(|d| d >= SLOW_MS);
        let expensive = cost_usd >= EXPENSIVE_USD;
        let reason = if failed {
            "failed"
        } else if expensive {
            "expensive"
        } else if slow {
            "slow"
        } else {
            continue; // clean, cheap, fast — nothing to review
        };
        candidates.push(ReviewCandidate {
            execution_id: id,
            persona_name,
            status,
            duration_ms,
            cost_usd,
            error_tail: error_message.map(|s| truncate_tail(&s, 600)),
            output_tail: output_data.map(|s| truncate_tail(&s, 600)),
            created_at,
            reason,
        });
    }
    Ok((candidates, newest))
}

/// Build the synthetic directive Athena receives for one review. It's a
/// real instruction, not a marker — `TurnOrigin::Proactive` passes it
/// straight to the CLI. The directive demands grounding (reference the
/// specific run) and a concrete proposal on failure, and explicitly
/// licenses a one-line "nothing to add" stop on a clean run so Athena
/// doesn't manufacture busywork.
fn build_directive(c: &ReviewCandidate) -> String {
    let dur = c
        .duration_ms
        .map(|d| format!("{:.1}s", d as f64 / 1000.0))
        .unwrap_or_else(|| "unknown".into());
    let mut body = format!(
        "A persona execution just finished and is worth a look (flagged: {reason}).\n\n\
         - Persona: {persona}\n\
         - Execution id: {exec}\n\
         - Status: {status}\n\
         - Duration: {dur}\n\
         - Cost: ${cost:.4}\n\
         - Finished: {created}\n",
        reason = c.reason,
        persona = c.persona_name,
        exec = c.execution_id,
        status = c.status,
        dur = dur,
        cost = c.cost_usd,
        created = c.created_at,
    );
    if let Some(err) = &c.error_tail {
        body.push_str(&format!("\nError (tail):\n{err}\n"));
    }
    if let Some(out) = &c.output_tail {
        body.push_str(&format!("\nOutput (tail):\n{out}\n"));
    }
    body.push_str(
        "\nAnalyze this run. If there's a concrete improvement, propose it — a system-prompt \
         tweak, a guardrail, a model-tier change, a missing tool, or an observability fix. \
         Reference THIS run specifically (the persona and what happened); don't give generic \
         advice. If the run is clean and there's genuinely nothing to improve, say so in one \
         line and stop — don't manufacture work.",
    );
    body
}

fn truncate_tail(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    // Keep the TAIL — for errors and outputs the end is usually the
    // informative part (the actual failure, the final answer).
    let tail: String = s.chars().rev().take(max).collect::<Vec<_>>().into_iter().rev().collect();
    format!("…{tail}")
}

/// Persist the new cursor value. Best-effort: a write failure means we
/// might re-review next tick (the dedupe degrades, it doesn't break).
fn advance_cursor(sys_db: &DbPool, newest: &str) {
    if let Err(e) =
        crate::db::repos::core::settings::set(sys_db, CURSOR_KEY, newest)
    {
        tracing::warn!(error = %e, "exec_review: failed to advance cursor");
    }
}

fn read_cursor(sys_db: &DbPool) -> String {
    match crate::db::repos::core::settings::get(sys_db, CURSOR_KEY) {
        Ok(Some(v)) => v,
        _ => {
            // First ever run: start the cursor at "now" so we don't
            // retroactively review the entire execution history on the
            // first tick after the feature ships. Only runs that finish
            // AFTER autonomous mode is first enabled get reviewed.
            chrono::Utc::now().to_rfc3339()
        }
    }
}

/// Entry point called from the proactive tick. Reviews qualifying recent
/// executions by spawning `TurnOrigin::Proactive` turns. Returns the
/// number of reviews spawned (for telemetry). The caller must have
/// already confirmed autonomous mode is on.
pub fn review_recent_executions(
    user_db: &crate::db::UserDbPool,
    sys_db: &DbPool,
    app: &tauri::AppHandle,
    #[cfg(feature = "ml")] embedder: Option<&std::sync::Arc<crate::engine::embedder::EmbeddingManager>>,
) -> Result<usize, AppError> {
    // Seed the cursor on first run so we don't backfill history.
    let cursor = read_cursor(sys_db);
    if crate::db::repos::core::settings::get(sys_db, CURSOR_KEY)
        .ok()
        .flatten()
        .is_none()
    {
        advance_cursor(sys_db, &cursor);
    }

    let (candidates, newest) = collect_candidates(sys_db, &cursor)?;
    if let Some(newest) = newest {
        // Advance past the whole window we scanned, not just reviewed
        // rows — bounds work and prevents an unreviewable backlog from
        // re-scanning forever.
        advance_cursor(sys_db, &newest);
    }
    let spawned = candidates.len();
    for c in candidates {
        let directive = build_directive(&c);
        crate::companion::session::spawn_proactive_turn(
            app.clone(),
            std::sync::Arc::new(user_db.clone()),
            std::sync::Arc::new(sys_db.clone()),
            #[cfg(feature = "ml")]
            embedder.cloned(),
            "execution_review".to_string(),
            Some(c.execution_id),
            directive,
        );
    }
    Ok(spawned)
}
