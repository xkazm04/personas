//! Self-initiated execution review — signal-economy edition.
//!
//! On each proactive tick (5-min cadence) and after debounced
//! execution-finish bursts, when autonomous mode is on, scan
//! `persona_executions` for recently-finished runs worth analyzing
//! (failures, notably slow / expensive runs) and run ONE headless triage
//! decision over the whole batch. The triage is the gatekeeper of the
//! user's attention:
//!
//!   - **drop**      — routine noise; nothing surfaces anywhere (tracing only).
//!   - **digest**    — worth one line on an aggregated proactive card
//!                     (`trigger_kind = "execution_review"`, deduped per
//!                     hour bucket) — NOT a chat turn.
//!   - **deep_dive** — at most ONE group per batch graduates to a full
//!                     `TurnOrigin::Proactive` reasoning turn (chat +
//!                     operation proposals), pre-screened as worth it.
//!
//! This replaces the original per-candidate design (≤2 full chat turns per
//! tick, each persisting a `[proactive: execution_review]` system episode
//! plus an assistant episode even when the verdict was "nothing to add").
//! Episodes are append-only by design (`brain/episodic.rs`), so the only
//! way to keep the transcript clean at high execution volume is to not
//! mint turns for chatter in the first place — the same reasoning that put
//! Athena's channel reactions on a headless decision
//! (`companion::athena_reaction`), whose `cli_text` subprocess plumbing the
//! triage reuses.
//!
//! Dedupe / rate-limit: a single settings cursor
//! (`companion_exec_review_cursor`, an ISO8601 timestamp) marks the newest
//! execution already considered. Each pass processes only rows created
//! after the cursor and advances it past the whole scanned window, so work
//! is bounded per pass and survives restarts.

use std::sync::LazyLock;
use std::time::Duration;

use super::baselines;
use crate::db::DbPool;
use crate::error::AppError;

/// Event-driven leg: the engine pings this every time a persona execution
/// reaches a terminal state; a debouncer task (spawned in `companion_init`)
/// coalesces a burst and runs the same triage pass the 5-min tick uses.
/// Decoupling via a `Notify` keeps the engine's completion hot-path free of
/// companion pools / app-handle plumbing — it just signals.
static REVIEW_SIGNAL: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);

/// Quiet window the debouncer waits for after the last execution-finish
/// signal before running a triage pass. Coalesces a flurry of scheduled
/// runs finishing together into a single pass (which is itself batched +
/// cursor-deduped). Long enough to batch a burst, short enough to feel
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
/// then runs one triage pass if autonomous mode is on. Loops forever.
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
        // Wake window set → the event-driven leg stands down entirely; the
        // gated periodic tick owns triage and the cursor keeps the queue.
        if crate::companion::wake_window::window_minutes(&sys_db) > 0 {
            continue;
        }
        let res = review_recent_executions(
            &user_db,
            &sys_db,
            &app,
            #[cfg(feature = "ml")]
            embedder.as_ref(),
        )
        .await;
        match res {
            Ok(n) if n > 0 => {
                tracing::info!(surfaced = n, "exec-review debouncer: triage surfaced finding(s)")
            }
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "exec-review debouncer: triage pass failed"),
        }
    }
}

/// Settings key holding the ISO8601 timestamp of the newest execution
/// the reviewer has already considered. MUST be allowlisted in
/// `settings_keys::ALLOWED_KEYS` or `settings::set` rejects it — in
/// which case the cursor never persists and the reviewer reseeds to
/// "now" every tick, silently finding nothing.
use crate::db::settings_keys::COMPANION_EXEC_REVIEW_CURSOR as CURSOR_KEY;

/// Scan window per pass. A pass that's been idle for a while shouldn't
/// pull thousands of rows; anything beyond this is reported as overflow
/// in the digest (no silent caps) and skipped by the advancing cursor.
const SCAN_LIMIT: usize = 200;

/// Most qualifying candidates fed into a single triage decision. Beyond
/// this the prompt stops being a triage and starts being a haystack;
/// overflow is counted and surfaced as a digest footnote instead.
const MAX_BATCH_CANDIDATES: usize = 24;

/// Most digest lines composed onto one proactive card.
const MAX_DIGEST_LINES: usize = 6;

/// A run is "slow enough to flag" past this wall-clock duration.
const SLOW_MS: i64 = 120_000; // 2 minutes

/// A run is "expensive enough to flag" past this USD cost.
const EXPENSIVE_USD: f64 = 0.50;

/// One finished execution worth triaging, with the persona name joined
/// in and the error/output tail truncated for the prompt.
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
    /// The persona's learned expected cost band (p95 / declared), when it has
    /// enough history — lets the digest say "3.2× this persona's p95". `None`
    /// when the persona is on the global fallback.
    baseline_cost_band: Option<f64>,
    /// Learned expected duration band (ms), same shape.
    baseline_duration_band: Option<i64>,
}

/// Result of one cursor-window scan.
struct CandidateScan {
    candidates: Vec<ReviewCandidate>,
    /// Newest `created_at` seen in the window (cursor advance target);
    /// `None` when no rows at all landed after the cursor.
    newest: Option<String>,
    /// Qualifying rows beyond [`MAX_BATCH_CANDIDATES`] — counted so the
    /// digest can say "+N more", never silently dropped.
    qualifying_overflow: usize,
    /// The scan hit [`SCAN_LIMIT`] — there may be rows we never saw.
    window_saturated: bool,
}

/// Scan for qualifying executions after the cursor. Flag thresholds are
/// per-persona-adaptive (see `baselines`): a run flags when it deviates from
/// *its persona's* learned cost/duration norm, falling back to the global
/// constants for personas without enough history.
fn collect_candidates(
    sys_db: &DbPool,
    user_db: &crate::db::UserDbPool,
    cursor: &str,
) -> Result<CandidateScan, AppError> {
    // Pull every terminal execution after the cursor (newest first) so we
    // can both pick triage candidates AND learn the newest timestamp to
    // advance the cursor to. Scope the borrow so the connection is released
    // before the baseline pass opens its own.
    let rows: Vec<(
        String,
        String,
        String,
        String,
        Option<i64>,
        f64,
        Option<String>,
        Option<String>,
        String,
    )> = {
        let conn = sys_db.get()?;
        let mut stmt = conn.prepare(
            "SELECT e.id, e.persona_id, COALESCE(p.name, e.persona_id) AS persona_name, e.status,
                    e.duration_ms, COALESCE(e.cost_usd, 0.0), e.error_message,
                    e.output_data, e.created_at
             FROM persona_executions e
             LEFT JOIN personas p ON p.id = e.persona_id
             WHERE e.created_at > ?1
               AND e.status IN ('completed', 'failed', 'incomplete', 'cancelled')
             ORDER BY e.created_at DESC
             LIMIT ?2",
        )?;
        let collected = stmt
            .query_map(rusqlite::params![cursor, SCAN_LIMIT as i64], |row| {
                Ok((
                    row.get::<_, String>(0)?,         // id
                    row.get::<_, String>(1)?,         // persona_id
                    row.get::<_, String>(2)?,         // persona_name
                    row.get::<_, String>(3)?,         // status
                    row.get::<_, Option<i64>>(4)?,    // duration_ms
                    row.get::<_, f64>(5)?,            // cost_usd
                    row.get::<_, Option<String>>(6)?, // error_message
                    row.get::<_, Option<String>>(7)?, // output_data
                    row.get::<_, String>(8)?,         // created_at
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        collected
    };

    let newest = rows.first().map(|r| r.8.clone());
    let window_saturated = rows.len() >= SCAN_LIMIT;

    // Lazily refresh + load each persona's baseline so flagging uses its own
    // norm. Best-effort: a persona without a baseline keeps the global
    // constants (refresh_stale / load both degrade silently).
    let persona_ids: Vec<String> = {
        let mut seen = std::collections::HashSet::new();
        rows.iter()
            .filter(|r| seen.insert(r.1.clone()))
            .map(|r| r.1.clone())
            .collect()
    };
    baselines::refresh_stale(user_db, sys_db, &persona_ids);
    let baseline_map = baselines::load(user_db, &persona_ids);

    let mut candidates = Vec::new();
    let mut qualifying_overflow = 0usize;
    for (id, persona_id, persona_name, status, duration_ms, cost_usd, error_message, output_data, created_at) in
        rows
    {
        let b = baseline_map.get(&persona_id);
        let expensive_threshold = baselines::PersonaBaseline::expensive_threshold(b, EXPENSIVE_USD);
        let slow_threshold = baselines::PersonaBaseline::slow_threshold(b, SLOW_MS);

        let failed = matches!(status.as_str(), "failed" | "incomplete");
        let expensive = cost_usd >= expensive_threshold;
        let slow = duration_ms.is_some_and(|d| d >= slow_threshold);
        let reason = if failed {
            "failed"
        } else if expensive {
            "expensive"
        } else if slow {
            "slow"
        } else {
            continue; // within this persona's norms — nothing to triage
        };
        if candidates.len() >= MAX_BATCH_CANDIDATES {
            qualifying_overflow += 1; // counted, surfaced in the digest
            continue;
        }
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
            baseline_cost_band: b.and_then(|x| x.cost_band()),
            baseline_duration_band: b.and_then(|x| x.duration_band()),
        });
    }
    Ok(CandidateScan {
        candidates,
        newest,
        qualifying_overflow,
        window_saturated,
    })
}

/// Candidates collapsed by (persona, flag reason) — the aggregation that
/// makes a flood legible: 14 identical PAT failures become one group with
/// `count = 14` and the newest run as exemplar.
struct CandidateGroup {
    persona_name: String,
    reason: &'static str,
    count: usize,
    total_cost: f64,
    exemplar: ReviewCandidate,
}

fn group_candidates(candidates: Vec<ReviewCandidate>) -> Vec<CandidateGroup> {
    let mut groups: Vec<CandidateGroup> = Vec::new();
    for c in candidates {
        // candidates arrive newest-first, so the first member of a group
        // is its newest run — keep it as the exemplar.
        if let Some(g) = groups
            .iter_mut()
            .find(|g| g.persona_name == c.persona_name && g.reason == c.reason)
        {
            g.count += 1;
            g.total_cost += c.cost_usd;
        } else {
            groups.push(CandidateGroup {
                persona_name: c.persona_name.clone(),
                reason: c.reason,
                count: 1,
                total_cost: c.cost_usd,
                exemplar: c,
            });
        }
    }
    // Failures first, then expensive, then slow; bigger groups first
    // within a tier — the order the triage should spend its attention in.
    let tier = |r: &str| match r {
        "failed" => 0,
        "expensive" => 1,
        _ => 2,
    };
    groups.sort_by(|a, b| {
        tier(a.reason)
            .cmp(&tier(b.reason))
            .then(b.count.cmp(&a.count))
    });
    groups
}

/// Athena's execution-triage protocol — the single JSON object she must emit.
#[derive(Debug, serde::Deserialize)]
struct ExecTriageEnvelope {
    athena_exec_triage: ExecTriageDecision,
}

#[derive(Debug, serde::Deserialize)]
struct ExecTriageDecision {
    /// One verdict per presented group (`id` is the 1-based group number).
    #[serde(default)]
    groups: Vec<ExecGroupVerdict>,
    /// One-line batch summary — becomes the digest card's first line.
    #[serde(default)]
    headline: String,
    /// True only when the user should look TODAY (desktop notification).
    #[serde(default)]
    escalate_to_user: bool,
}

#[derive(Debug, serde::Deserialize)]
struct ExecGroupVerdict {
    id: usize,
    /// `drop` | `digest` | `deep_dive`
    verdict: String,
    /// The digest line for `digest`/`deep_dive` verdicts (≤140 chars).
    #[serde(default)]
    line: String,
}

fn build_triage_prompt(groups: &[CandidateGroup], overflow: usize, saturated: bool) -> String {
    let mut listing = String::new();
    for (i, g) in groups.iter().enumerate() {
        let e = &g.exemplar;
        let dur = e
            .duration_ms
            .map(|d| format!("{:.1}s", d as f64 / 1000.0))
            .unwrap_or_else(|| "unknown".into());
        listing.push_str(&format!(
            "{n}. Persona \"{persona}\" — {count} run(s) flagged `{reason}` (combined cost ${total:.2})\n   \
             Exemplar (newest): execution {exec}, status {status}, duration {dur}, cost ${cost:.4}, finished {created}\n",
            n = i + 1,
            persona = g.persona_name,
            count = g.count,
            reason = g.reason,
            total = g.total_cost,
            exec = e.execution_id,
            status = e.status,
            dur = dur,
            cost = e.cost_usd,
            created = e.created_at,
        ));
        // Per-persona baseline context (D1) — makes "expensive"/"slow" concrete:
        // the flag is relative to THIS persona's learned norm, not a global cutoff.
        match e.reason {
            "expensive" => {
                if let Some(band) = e.baseline_cost_band {
                    if band > 0.0 {
                        listing.push_str(&format!(
                            "   Baseline: {:.1}× this persona's typical p95 of ${:.4}\n",
                            e.cost_usd / band,
                            band,
                        ));
                    }
                }
            }
            "slow" => {
                if let (Some(band), Some(d)) = (e.baseline_duration_band, e.duration_ms) {
                    if band > 0 {
                        listing.push_str(&format!(
                            "   Baseline: {:.1}× this persona's typical p95 of {:.1}s\n",
                            d as f64 / band as f64,
                            band as f64 / 1000.0,
                        ));
                    }
                }
            }
            _ => {}
        }
        if let Some(err) = &e.error_tail {
            listing.push_str(&format!("   Error (tail): {err}\n"));
        } else if let Some(out) = &e.output_tail {
            listing.push_str(&format!("   Output (tail): {out}\n"));
        }
    }
    let mut footnotes = String::new();
    if overflow > 0 {
        footnotes.push_str(&format!(
            "\nNote: {overflow} further qualifying run(s) in this window were not listed (batch cap)."
        ));
    }
    if saturated {
        footnotes.push_str(
            "\nNote: the scan window was saturated — there may be additional unexamined runs.",
        );
    }

    format!(
        r#"You are **Athena**, the autonomous orchestrator of this Personas workspace. You are running unattended. Finished persona executions were flagged for triage (failed / slow / expensive), already grouped by persona and flag reason. Hundreds of executions can flow through here per hour, so you are the gatekeeper of the user's attention: almost everything should pass quietly; only real signal may surface.

Flagged groups:
{listing}{footnotes}

YOUR TRIAGE — one verdict per group:
- "drop": routine noise — a one-off transient failure the retry machinery already owns (rate/usage/session limits, app-restart kills), expected slowness for that workload, cost within that persona's norms. THE DEFAULT. Most groups should be dropped.
- "digest": worth exactly one line of the user's aggregated review card. Use for recurring patterns (same persona failing the same way repeatedly), a new kind of failure, or a notable cost/duration anomaly. Write `line` as one concrete sentence ≤140 chars naming the persona and the pattern (e.g. "Dev Clone failed 14× on the same GitHub 401 — PAT likely expired"). No filler.
- "deep_dive": AT MOST ONE group in the whole batch — and only when a concrete, fixable problem would benefit from full analysis and a proposal (prompt tweak, guardrail, model-tier change, missing tool, observability fix). This spawns a real reasoning turn, so spend it well. Also provide its `line`.
- `headline`: one short sentence summarizing the batch for the card title.
- `escalate_to_user`: true ONLY if something needs the user TODAY (a whole team blocked on credentials, runaway spend, data at risk). This fires a desktop notification — be conservative.

Respond with the analysis you need, then emit EXACTLY ONE line that is this JSON object and nothing else on that line:
{{"athena_exec_triage": {{"groups": [{{"id": 1, "verdict": "drop"|"digest"|"deep_dive", "line": ""}}], "headline": "...", "escalate_to_user": false}}}}
"#,
        listing = listing,
        footnotes = footnotes,
    )
}

/// Extract the `{"athena_exec_triage": {...}}` object (same tolerant
/// brace-matching as the channel-reaction parser; last occurrence wins).
fn parse_exec_triage(blob: &str) -> Option<ExecTriageDecision> {
    let marker = "\"athena_exec_triage\"";
    let mut result = None;
    let mut search_from = 0;
    while let Some(rel) = blob[search_from..].find(marker) {
        let marker_pos = search_from + rel;
        search_from = marker_pos + marker.len();
        let Some(open) = blob[..marker_pos].rfind('{') else {
            continue;
        };
        if let Some(close) = crate::companion::athena_reaction::match_braces(&blob[open..]) {
            if let Ok(env) =
                serde_json::from_str::<ExecTriageEnvelope>(&blob[open..open + close + 1])
            {
                result = Some(env.athena_exec_triage);
            }
        }
    }
    result
}

/// The directive for the single deep-dive turn — pre-screened by the
/// triage, so it IS worth a chat entry; the format contract keeps that
/// entry tight instead of essay-shaped.
fn build_deep_directive(g: &CandidateGroup, triage_line: &str) -> String {
    let e = &g.exemplar;
    let dur = e
        .duration_ms
        .map(|d| format!("{:.1}s", d as f64 / 1000.0))
        .unwrap_or_else(|| "unknown".into());
    let mut body = format!(
        "Your execution triage flagged ONE group of finished runs as worth a deep look:\n\
         {line}\n\n\
         - Persona: {persona}\n\
         - Occurrences this window: {count} (flagged: {reason}, combined cost ${total:.2})\n\
         - Exemplar execution id: {exec}\n\
         - Status: {status}\n\
         - Duration: {dur}\n\
         - Cost: ${cost:.4}\n\
         - Finished: {created}\n",
        line = triage_line,
        persona = g.persona_name,
        count = g.count,
        reason = g.reason,
        total = g.total_cost,
        exec = e.execution_id,
        status = e.status,
        dur = dur,
        cost = e.cost_usd,
        created = e.created_at,
    );
    if let Some(err) = &e.error_tail {
        body.push_str(&format!("\nError (tail):\n{err}\n"));
    }
    if let Some(out) = &e.output_tail {
        body.push_str(&format!("\nOutput (tail):\n{out}\n"));
    }
    body.push_str(
        "\nAnalyze this and, if there's a concrete improvement, propose it — a system-prompt \
         tweak, a guardrail, a model-tier change, a missing tool, or an observability fix — \
         referencing THIS persona and what happened. FORMAT CONTRACT: lead with a one-line \
         verdict; keep the whole reply under ~120 words unless you emit an operation; no \
         headers, no restating the data above. If on closer inspection nothing is actionable \
         after all, say so in one line and stop.",
    );
    body
}

/// Compose the aggregated digest card body.
fn compose_digest_message(
    headline: &str,
    lines: &[String],
    overflow: usize,
    saturated: bool,
) -> String {
    let mut msg = String::new();
    let headline = headline.trim();
    if !headline.is_empty() {
        msg.push_str(headline);
    }
    for line in lines.iter().take(MAX_DIGEST_LINES) {
        if !msg.is_empty() {
            msg.push('\n');
        }
        msg.push_str(&format!("• {}", line.trim()));
    }
    let dropped_lines = lines.len().saturating_sub(MAX_DIGEST_LINES);
    let mut more = overflow + dropped_lines;
    if saturated {
        more += 1; // window saturation means "at least one more"
    }
    if more > 0 {
        msg.push_str(&format!(
            "\n(+{more} more flagged run(s) this window — see Overview → Executions)"
        ));
    }
    msg
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

/// Entry point called from the proactive tick and the debouncer. Runs one
/// batched triage pass over qualifying recent executions. Returns the
/// number of surfaced findings (digest lines + deep dives) for telemetry.
/// The caller must have already confirmed autonomous mode is on.
pub async fn review_recent_executions(
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

    let scan = collect_candidates(sys_db, user_db, &cursor)?;
    // Wake window (docs/plans/athena-wake-window.md): gate BEFORE the cursor
    // advance so a skipped tick leaves the backlog accumulating. Exec triage
    // is observability — no priority bypass.
    let wake = crate::companion::wake_window::gate(
        sys_db,
        "exec_triage",
        scan.candidates.len(),
        false,
    );
    if !wake.due {
        return Ok(0);
    }
    let wake_started = std::time::Instant::now();
    let wake_pending = scan.candidates.len();
    if let Some(newest) = &scan.newest {
        // Advance past the whole window we scanned, not just triaged
        // rows — bounds work and prevents an unreviewable backlog from
        // re-scanning forever.
        advance_cursor(sys_db, newest);
    }
    if scan.candidates.is_empty() {
        return Ok(0);
    }

    let overflow = scan.qualifying_overflow;
    let saturated = scan.window_saturated;
    let groups = group_candidates(scan.candidates);
    tracing::info!(
        groups = groups.len(),
        overflow,
        saturated,
        "exec_review: running batched triage decision"
    );

    let prompt = build_triage_prompt(&groups, overflow, saturated);
    let (blob, turn_id) =
        crate::companion::athena_reaction::cli_text_tracked(prompt, user_db, "exec_triage").await?;
    let Some(decision) = parse_exec_triage(&blob) else {
        tracing::warn!("exec_review: no triage decision parsed from CLI output");
        if let Some(tid) = &turn_id {
            crate::companion::turn_ledger::update_outcome(
                user_db,
                tid,
                r#"{"parse_failure":true}"#,
            );
        }
        crate::companion::wake_window::log_wake(
            sys_db, "exec_triage", wake.reason, wake_pending, 1, 0,
            wake_started.elapsed().as_millis() as u64,
        );
        return Ok(0);
    };
    // Record the triage verdict distribution on the ledger row so the Athena
    // health funnel (A4) can show drop / digest / deep-dive at a glance.
    if let Some(tid) = &turn_id {
        let deep_dive = decision.groups.iter().filter(|v| v.verdict == "deep_dive").count();
        let digest = decision.groups.iter().filter(|v| v.verdict == "digest").count();
        let drop = decision.groups.len().saturating_sub(deep_dive + digest);
        let outcome = serde_json::json!({
            "groups": decision.groups.len(),
            "drop": drop,
            "digest": digest,
            "deep_dive": deep_dive,
            "escalate": decision.escalate_to_user,
        })
        .to_string();
        crate::companion::turn_ledger::update_outcome(user_db, tid, &outcome);
    }
    crate::companion::wake_window::log_wake(
        sys_db, "exec_triage", wake.reason, wake_pending, 1, decision.groups.len(),
        wake_started.elapsed().as_millis() as u64,
    );

    // Apply verdicts. Restraint is the default: anything unmatched or
    // malformed is treated as drop.
    let mut digest_lines: Vec<String> = Vec::new();
    let mut deep: Option<(&CandidateGroup, String)> = None;
    for v in &decision.groups {
        let Some(g) = v.id.checked_sub(1).and_then(|i| groups.get(i)) else {
            continue; // hallucinated group id — ignore
        };
        match v.verdict.as_str() {
            "deep_dive" => {
                let line = if v.line.trim().is_empty() {
                    format!("{} — {} run(s) flagged {}", g.persona_name, g.count, g.reason)
                } else {
                    v.line.trim().to_string()
                };
                if deep.is_none() {
                    deep = Some((g, line.clone()));
                }
                // The deep-dive group still earns its digest line so the
                // card stays the one complete summary of the batch.
                digest_lines.push(line);
            }
            "digest" => {
                if !v.line.trim().is_empty() {
                    digest_lines.push(v.line.trim().to_string());
                }
            }
            _ => {
                tracing::debug!(
                    persona = %g.persona_name,
                    reason = %g.reason,
                    count = g.count,
                    "exec_review: triage dropped group (restraint)"
                );
            }
        }
    }

    let mut surfaced = 0usize;

    if let Some((g, line)) = &deep {
        let directive = build_deep_directive(g, line);
        crate::companion::session::spawn_proactive_turn(
            app.clone(),
            std::sync::Arc::new(user_db.clone()),
            std::sync::Arc::new(sys_db.clone()),
            #[cfg(feature = "ml")]
            embedder.cloned(),
            "execution_review".to_string(),
            Some(g.exemplar.execution_id.clone()),
            directive,
        );
        surfaced += 1;
    }

    if !digest_lines.is_empty() {
        surfaced += digest_lines.len();
        let message =
            compose_digest_message(&decision.headline, &digest_lines, overflow, saturated);
        // Hour-bucketed dedupe ref: at most one execution-review card per
        // hour can be pending — a flood aggregates instead of stacking.
        let bucket = chrono::Utc::now().format("%Y-%m-%dT%H").to_string();
        let nudge = super::Nudge {
            trigger_kind: "execution_review".to_string(),
            trigger_ref: Some(format!("bucket:{bucket}")),
            message,
        };
        match super::enqueue_external(user_db, &nudge) {
            Ok(Some(msg)) => super::deliver_now(user_db, app, msg),
            Ok(None) => tracing::info!(
                "exec_review: digest deduped — an unresolved card for this hour already exists"
            ),
            Err(e) => tracing::warn!(error = %e, "exec_review: digest nudge enqueue failed"),
        }
    }

    // Desktop notification ONLY on explicit escalation, and never during
    // the user's quiet hours — the card waits, the ping doesn't fire.
    if decision.escalate_to_user && !super::quiet::is_quiet_now(user_db).unwrap_or(false) {
        let headline = if decision.headline.trim().is_empty() {
            "Execution review needs your attention".to_string()
        } else {
            decision.headline.trim().to_string()
        };
        crate::notifications::send(app, "Athena · execution review", &headline);
    }

    Ok(surfaced)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_candidate(persona: &str, reason: &'static str, cost: f64) -> ReviewCandidate {
        ReviewCandidate {
            execution_id: format!("exec-{persona}-{reason}"),
            persona_name: persona.to_string(),
            status: if reason == "failed" { "failed" } else { "completed" }.to_string(),
            duration_ms: Some(1_000),
            cost_usd: cost,
            error_tail: None,
            output_tail: None,
            created_at: "2026-06-10T12:00:00Z".to_string(),
            reason,
            baseline_cost_band: None,
            baseline_duration_band: None,
        }
    }

    #[test]
    fn parses_triage_with_mixed_verdicts() {
        let blob = r#"Thinking it through…
{"athena_exec_triage": {"groups": [{"id": 1, "verdict": "digest", "line": "Dev Clone failed 14x on the same 401"}, {"id": 2, "verdict": "drop", "line": ""}, {"id": 3, "verdict": "deep_dive", "line": "RM loops on a closed PR"}], "headline": "One credential failure pattern, one stuck loop", "escalate_to_user": true}}
trailing"#;
        let d = parse_exec_triage(blob).expect("should parse");
        assert_eq!(d.groups.len(), 3);
        assert_eq!(d.groups[0].verdict, "digest");
        assert_eq!(d.groups[2].verdict, "deep_dive");
        assert!(d.escalate_to_user);
        assert!(d.headline.contains("credential"));
    }

    #[test]
    fn parses_minimal_all_drop() {
        let blob = r#"{"athena_exec_triage": {"groups": [{"id": 1, "verdict": "drop"}]}}"#;
        let d = parse_exec_triage(blob).expect("should parse");
        assert_eq!(d.groups.len(), 1);
        assert!(d.headline.is_empty());
        assert!(!d.escalate_to_user);
    }

    #[test]
    fn triage_parser_ignores_other_protocols() {
        let blob = r#"{"athena_channel": {"react": true, "message": "x"}}"#;
        assert!(parse_exec_triage(blob).is_none());
    }

    #[test]
    fn last_triage_occurrence_wins() {
        let blob = r#"{"athena_exec_triage":{"groups":[{"id":1,"verdict":"drop"}]}}
corrected: {"athena_exec_triage":{"groups":[{"id":1,"verdict":"digest","line":"final"}]}}"#;
        let d = parse_exec_triage(blob).expect("should parse");
        assert_eq!(d.groups[0].verdict, "digest");
        assert_eq!(d.groups[0].line, "final");
    }

    #[test]
    fn groups_collapse_by_persona_and_reason_failures_first() {
        let groups = group_candidates(vec![
            mk_candidate("Slow Persona", "slow", 0.01),
            mk_candidate("Dev Clone", "failed", 0.10),
            mk_candidate("Dev Clone", "failed", 0.20),
            mk_candidate("Dev Clone", "failed", 0.30),
            mk_candidate("Costly", "expensive", 1.50),
        ]);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0].persona_name, "Dev Clone");
        assert_eq!(groups[0].count, 3);
        assert!((groups[0].total_cost - 0.60).abs() < 1e-9);
        assert_eq!(groups[1].reason, "expensive");
        assert_eq!(groups[2].reason, "slow");
    }

    #[test]
    fn digest_message_reports_overflow_not_silence() {
        let lines: Vec<String> = (0..8).map(|i| format!("line {i}")).collect();
        let msg = compose_digest_message("Headline", &lines, 3, true);
        // 6 lines rendered, 2 dropped + 3 overflow + 1 saturation = +6 more
        assert!(msg.starts_with("Headline"));
        assert_eq!(msg.matches("• ").count(), MAX_DIGEST_LINES);
        assert!(msg.contains("+6 more"), "got: {msg}");
    }
}
