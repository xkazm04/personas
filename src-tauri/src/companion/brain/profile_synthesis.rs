//! Behavioral profile synthesis (F3 / direction 7): Athena learns from what the
//! user *does*, not only what they say.
//!
//! A weekly, gated, deterministic pass gathers BEHAVIORAL STATISTICS (numbers,
//! never raw content) — which proactive cards the user engages vs dismisses,
//! how often they ask for shorter/longer replies, whether they complete guided
//! walkthroughs, how they interact (voice vs text), which ops they approve vs
//! reject — and hands that digest to one cheap headless CLI call. Athena
//! proposes at most three evidence-cited `update_identity` diffs, which land as
//! a normal approval card (the user always reviews them). Most weeks the
//! expected output is zero diffs.
//!
//! Reads: `companion_turn` (A1), `companion_proactive_message`,
//! `companion_approval`, `companion_ux_signal` (the lightweight instrumentation
//! table). All in the companion user DB. Gated by `companion_profile_synthesis`
//! (default off); cadence tracked by `companion_profile_synthesis_last`.

use serde::Deserialize;
use tauri::{AppHandle, Emitter};

use crate::companion::athena_reaction::match_braces;
use crate::companion::dispatcher::CreatedApproval;
use crate::companion::session::{APPROVALS_EVENT, DEFAULT_SESSION_ID};
use crate::db::repos::core::settings;
use crate::db::settings_keys as keys;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

const TRIGGER_KIND: &str = "profile_synthesis";
const INTERVAL_DAYS: i64 = 7;
/// Max diffs proposed in one pass (one approval card stays reviewable).
const MAX_DIFFS: usize = 3;

/// Record one UX signal (fire-and-forget from the frontend command).
pub fn record_signal(pool: &UserDbPool, kind: &str, payload_json: &str) -> Result<(), AppError> {
    let conn = pool.get()?;
    let id = format!("uxs_{}", short_id());
    conn.execute(
        "INSERT INTO companion_ux_signal (id, kind, payload_json) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, kind, payload_json],
    )?;
    Ok(())
}

/// Check whether a synthesis pass is due and, if so, run it. Best-effort:
/// called from the proactive tick; a failure logs and is swallowed.
pub async fn maybe_run_synthesis(user_db: &UserDbPool, sys_db: &DbPool, app: &AppHandle) {
    if let Err(e) = try_run(user_db, sys_db, app).await {
        tracing::warn!(error = %e, "profile_synthesis: run failed");
    }
}

async fn try_run(user_db: &UserDbPool, sys_db: &DbPool, app: &AppHandle) -> Result<(), AppError> {
    let enabled = settings::get(sys_db, keys::COMPANION_PROFILE_SYNTHESIS)?
        .map(|v| v == "true")
        .unwrap_or(false);
    if !enabled {
        return Ok(());
    }
    // Cadence: at most once per INTERVAL_DAYS.
    if let Some(last) = settings::get(sys_db, keys::COMPANION_PROFILE_SYNTHESIS_LAST)? {
        if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&last) {
            let age = chrono::Utc::now() - dt.with_timezone(&chrono::Utc);
            if age.num_days() < INTERVAL_DAYS {
                return Ok(());
            }
        }
    }

    let digest = gather_digest(user_db)?;
    // Mark "ran" NOW so a CLI failure doesn't re-fire every tick this week.
    let _ = settings::set(
        sys_db,
        keys::COMPANION_PROFILE_SYNTHESIS_LAST,
        &chrono::Utc::now().to_rfc3339(),
    );
    if digest.trim().is_empty() {
        tracing::info!("profile_synthesis: no behavioral signal yet — skipping");
        return Ok(());
    }

    let identity = std::fs::read_to_string(
        crate::companion::disk::brain_root()?.join("identity.md"),
    )
    .unwrap_or_default();
    let prompt = build_prompt(&digest, &identity);

    let (blob, _turn_id) =
        crate::companion::athena_reaction::cli_text_tracked(prompt, user_db, TRIGGER_KIND).await?;
    let diffs = parse_diffs(&blob);
    if diffs.is_empty() {
        tracing::info!("profile_synthesis: no diffs proposed (the common case)");
        return Ok(());
    }

    propose_identity_update(
        user_db,
        app,
        &diffs,
        "From a weekly look at how you've actually been working with me — please review.",
    )?;
    tracing::info!(diffs = diffs.len(), "profile_synthesis: proposed identity diffs for review");
    Ok(())
}

/// Insert a pending `update_identity` approval carrying `diffs` and emit the
/// approvals event so the panel + hands-free decision queue surface it promptly.
/// Shared by the synthesis pass and the "that's wrong" correction loop (F4).
pub(crate) fn propose_identity_update(
    user_db: &UserDbPool,
    app: &AppHandle,
    diffs: &[serde_json::Value],
    rationale: &str,
) -> Result<(), AppError> {
    let created = insert_identity_approval(user_db, diffs, rationale)?;
    if let Err(e) = app.emit(APPROVALS_EVENT, vec![created]) {
        tracing::warn!(error = %e, "identity update: approvals event emit failed");
    }
    Ok(())
}

/// Gather behavioral statistics into a compact markdown digest — NUMBERS ONLY,
/// no raw user content. Sections with no data are omitted; an empty string means
/// "nothing worth synthesizing this week".
fn gather_digest(pool: &UserDbPool) -> Result<String, AppError> {
    let conn = pool.get()?;
    let mut out = String::new();

    // 1. Proactive cards engaged vs dismissed, by kind (30d) → notification taste.
    {
        let mut stmt = conn.prepare(
            "SELECT trigger_kind,
                    SUM(CASE WHEN status = 'engaged'   THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 'dismissed' THEN 1 ELSE 0 END)
             FROM companion_proactive_message
             WHERE created_at >= datetime('now', '-30 days')
               AND status IN ('engaged', 'dismissed')
             GROUP BY trigger_kind
             ORDER BY COUNT(*) DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        if !rows.is_empty() {
            out.push_str("Proactive cards (30d) — engaged vs dismissed by kind:\n");
            for (k, e, d) in rows {
                out.push_str(&format!("- {k}: {e} engaged, {d} dismissed\n"));
            }
            out.push('\n');
        }
    }

    // 2. Refine-chip usage (30d) → verbosity / format taste.
    {
        let counts = count_ux_variants(&conn, "refine_chip")?;
        if !counts.is_empty() {
            out.push_str("Reply refinements requested (30d):\n");
            for (v, n) in counts {
                out.push_str(&format!("- {v}: {n}×\n"));
            }
            out.push('\n');
        }
    }

    // 3. Walkthrough completion vs abandon (30d) → does guidance land.
    {
        let completed: i64 = conn.query_row(
            "SELECT COUNT(*) FROM companion_ux_signal WHERE kind = 'walkthrough_complete' AND created_at >= datetime('now', '-30 days')",
            [], |r| r.get(0))?;
        let aborted: i64 = conn.query_row(
            "SELECT COUNT(*) FROM companion_ux_signal WHERE kind = 'walkthrough_abort' AND created_at >= datetime('now', '-30 days')",
            [], |r| r.get(0))?;
        if completed + aborted > 0 {
            out.push_str(&format!(
                "Guided walkthroughs (30d): {completed} completed, {aborted} abandoned.\n\n"
            ));
        }
    }

    // 4. Interaction shape from the turn ledger (30d) → how he works.
    {
        let (chat, voice): (i64, i64) = conn.query_row(
            "SELECT COUNT(*), COALESCE(SUM(voice), 0)
             FROM companion_turn
             WHERE origin = 'chat' AND created_at >= datetime('now', '-30 days')",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        if chat > 0 {
            out.push_str(&format!(
                "Chat turns (30d): {chat} total, {voice} via voice.\n\n"
            ));
        }
    }

    // 5. Approvals approved vs rejected, by action (30d) → which ops he trusts.
    {
        let by_action = approval_rates(&conn)?;
        if !by_action.is_empty() {
            out.push_str("Approvals (30d) — approved vs rejected by action:\n");
            for (action, approved, rejected) in by_action {
                out.push_str(&format!(
                    "- {action}: {approved} approved, {rejected} rejected\n"
                ));
            }
            out.push('\n');
        }
    }

    Ok(out)
}

/// Count `variant` field occurrences across `companion_ux_signal` rows of one
/// kind (30d). Parsed in Rust to avoid a hard JSON1 dependency.
fn count_ux_variants(
    conn: &rusqlite::Connection,
    kind: &str,
) -> Result<Vec<(String, i64)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT payload_json FROM companion_ux_signal
         WHERE kind = ?1 AND created_at >= datetime('now', '-30 days')",
    )?;
    let rows = stmt
        .query_map([kind], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let mut counts: std::collections::HashMap<String, i64> = std::collections::HashMap::new();
    for payload in rows {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&payload) {
            if let Some(variant) = v.get("variant").and_then(|x| x.as_str()) {
                *counts.entry(variant.to_string()).or_insert(0) += 1;
            }
        }
    }
    let mut out: Vec<_> = counts.into_iter().collect();
    out.sort_by(|a, b| b.1.cmp(&a.1));
    Ok(out)
}

/// Approved/rejected counts per op action (30d), parsing the action out of each
/// approval's payload JSON in Rust.
fn approval_rates(conn: &rusqlite::Connection) -> Result<Vec<(String, i64, i64)>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT payload, status FROM companion_approval
         WHERE created_at >= datetime('now', '-30 days')
           AND status IN ('approved', 'approved_failed', 'rejected')",
    )?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    // action -> (approved, rejected)
    let mut by: std::collections::HashMap<String, (i64, i64)> = std::collections::HashMap::new();
    for (payload, status) in rows {
        let action = serde_json::from_str::<serde_json::Value>(&payload)
            .ok()
            .and_then(|v| v.get("action").and_then(|a| a.as_str()).map(String::from))
            .unwrap_or_else(|| "unknown".into());
        let e = by.entry(action).or_insert((0, 0));
        if status == "rejected" {
            e.1 += 1;
        } else {
            e.0 += 1;
        }
    }
    let mut out: Vec<_> = by.into_iter().map(|(a, (ap, rj))| (a, ap, rj)).collect();
    out.sort_by(|a, b| (b.1 + b.2).cmp(&(a.1 + a.2)));
    Ok(out)
}

fn build_prompt(digest: &str, identity: &str) -> String {
    format!(
        r#"You are **Athena**, looking back over how Michal has actually worked with you this week — not what he said, but what he DID. Below is a digest of behavioral statistics, then his current identity profile.

Your job: propose AT MOST {MAX_DIFFS} small, evidence-cited edits to his identity profile that these numbers justify — or ZERO if nothing is clearly supported. Zero is the normal, expected answer most weeks. Only propose a diff when a number genuinely tells you something durable about how he works or what helps him. Never infer a preference from a single data point; look for a clear, repeated pattern.

Rules:
- Each diff targets ONE bullet under an EXISTING section (use the exact heading path from the profile below, e.g. "About Michal / What helps").
- `op` is "append" (add a bullet), "replace" (swap a bullet — give `anchor_text` = the exact existing bullet), or "remove" (give `anchor_text`).
- Every `new_text` bullet MUST end by citing the statistic that motivated it, e.g. "prefers terse replies — asked 'shorter' 9× in 30d".
- An anti-pattern goes under "What doesn't help" ONLY if the numbers clearly show it (e.g. a card kind dismissed every time).
- Do not touch the "About me" sections — those are your self-model, not his profile.

--- BEHAVIORAL DIGEST (30 days) ---
{digest}
--- CURRENT IDENTITY PROFILE ---
{identity}
--- END ---

After any reasoning, emit EXACTLY ONE line that is this JSON object and nothing else on that line (empty `diffs` if nothing is justified):
{{"profile_synthesis": {{"diffs": [{{"section": "About Michal / What helps", "op": "append", "new_text": "<bullet ending with the stat that justifies it>", "rationale": "<which number, one sentence>"}}]}}}}
"#,
    )
}

#[derive(Deserialize)]
struct SynthesisEnvelope {
    profile_synthesis: SynthesisBody,
}
#[derive(Deserialize)]
struct SynthesisBody {
    #[serde(default)]
    diffs: Vec<serde_json::Value>,
}

/// Extract the `{"profile_synthesis": {...}}` envelope (same tolerant
/// brace-matching as the channel-reaction parser; last occurrence wins), keep
/// only structurally-valid diffs, capped at [`MAX_DIFFS`].
fn parse_diffs(blob: &str) -> Vec<serde_json::Value> {
    let marker = "\"profile_synthesis\"";
    let mut found: Vec<serde_json::Value> = Vec::new();
    let mut search_from = 0;
    while let Some(rel) = blob[search_from..].find(marker) {
        let marker_pos = search_from + rel;
        search_from = marker_pos + marker.len();
        let Some(open) = blob[..marker_pos].rfind('{') else {
            continue;
        };
        if let Some(close) = match_braces(&blob[open..]) {
            if let Ok(env) = serde_json::from_str::<SynthesisEnvelope>(&blob[open..open + close + 1])
            {
                found = env.profile_synthesis.diffs;
            }
        }
    }
    // Keep only diffs that parse structurally (the executor re-validates anchors
    // at approval time). Cap the batch.
    found
        .into_iter()
        .filter(|d| super::identity::IdentityDiff::from_json(d).is_ok())
        .take(MAX_DIFFS)
        .collect()
}

/// Insert one pending `update_identity` approval carrying the diffs (mirrors the
/// dispatcher's `insert_approval` INSERT, but from a headless/UI-driven path).
fn insert_identity_approval(
    pool: &UserDbPool,
    diffs: &[serde_json::Value],
    rationale: &str,
) -> Result<CreatedApproval, AppError> {
    let id = format!("appr_{}", short_id());
    let params = serde_json::json!({ "diffs": diffs });
    let payload = serde_json::json!({
        "action": "update_identity",
        "params": params,
        "rationale": rationale,
    })
    .to_string();
    let conn = pool.get()?;
    conn.execute(
        "INSERT INTO companion_approval (id, session_id, kind, payload, status, human_review_id, created_at)
         VALUES (?1, ?2, 'op_execute', ?3, 'pending', NULL, datetime('now'))",
        rusqlite::params![id, DEFAULT_SESSION_ID, payload],
    )?;
    Ok(CreatedApproval {
        id,
        action: "update_identity".to_string(),
        params_json: params.to_string(),
        rationale: rationale.to_string(),
    })
}

fn short_id() -> String {
    uuid::Uuid::new_v4().simple().to_string().chars().take(12).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use r2d2_sqlite::SqliteConnectionManager;

    fn pool() -> UserDbPool {
        let m = SqliteConnectionManager::memory();
        let p = r2d2::Pool::builder().max_size(1).build(m).unwrap();
        p.get()
            .unwrap()
            .execute_batch(
                "CREATE TABLE companion_ux_signal (id TEXT, kind TEXT, payload_json TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE companion_proactive_message (id TEXT, trigger_kind TEXT, status TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE companion_approval (id TEXT, session_id TEXT, kind TEXT,
                    payload TEXT, status TEXT, human_review_id TEXT,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));
                 CREATE TABLE companion_turn (id TEXT, origin TEXT, voice INTEGER,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')));",
            )
            .unwrap();
        p
    }

    #[test]
    fn empty_when_no_signal() {
        let p = pool();
        assert!(gather_digest(&p).unwrap().trim().is_empty());
    }

    #[test]
    fn digest_summarizes_behavior() {
        let p = pool();
        let c = p.get().unwrap();
        c.execute_batch(
            "INSERT INTO companion_proactive_message (id,trigger_kind,status) VALUES
                ('1','execution_review','dismissed'),('2','execution_review','dismissed'),('3','incident_blocker','engaged');
             INSERT INTO companion_ux_signal (id,kind,payload_json) VALUES
                ('a','refine_chip','{\"variant\":\"shorter\"}'),('b','refine_chip','{\"variant\":\"shorter\"}'),
                ('c','walkthrough_complete','{}');
             INSERT INTO companion_turn (id,origin,voice) VALUES ('t','chat',1);
             INSERT INTO companion_approval (id,payload,status) VALUES
                ('p1','{\"action\":\"write_fact\"}','approved'),('p2','{\"action\":\"run_persona\"}','rejected');",
        ).unwrap();
        drop(c); // release the single pooled connection before gather_digest
        let d = gather_digest(&p).unwrap();
        assert!(d.contains("execution_review: 0 engaged, 2 dismissed"));
        assert!(d.contains("shorter: 2×"));
        assert!(d.contains("1 completed"));
        assert!(d.contains("via voice"));
        assert!(d.contains("write_fact: 1 approved"));
    }

    #[test]
    fn parse_caps_and_filters_diffs() {
        let blob = r#"reasoning
{"profile_synthesis": {"diffs": [
  {"section":"About Michal / What helps","op":"append","new_text":"terse — asked shorter 9x","rationale":"stat"},
  {"section":"x","op":"append"},
  {"section":"About Michal / What helps","op":"append","new_text":"b","rationale":"r"},
  {"section":"About Michal / What helps","op":"append","new_text":"c","rationale":"r"},
  {"section":"About Michal / What helps","op":"append","new_text":"d","rationale":"r"}
]}}"#;
        let diffs = parse_diffs(blob);
        // Malformed one dropped; capped at MAX_DIFFS.
        assert_eq!(diffs.len(), MAX_DIFFS);
    }

    #[test]
    fn parse_empty_diffs() {
        assert!(parse_diffs(r#"{"profile_synthesis": {"diffs": []}}"#).is_empty());
        assert!(parse_diffs("no json here").is_empty());
    }

    #[test]
    fn inserts_pending_approval() {
        let p = pool();
        let diffs = vec![serde_json::json!({"section":"About Michal / What helps","op":"append","new_text":"x","rationale":"y"})];
        let created = insert_identity_approval(&p, &diffs, "test").unwrap();
        assert_eq!(created.action, "update_identity");
        let (status, action): (String, String) = p
            .get()
            .unwrap()
            .query_row(
                "SELECT status, json_extract(payload,'$.action') FROM companion_approval LIMIT 1",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(status, "pending");
        assert_eq!(action, "update_identity");
    }
}
