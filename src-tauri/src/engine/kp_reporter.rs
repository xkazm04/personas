//! Outbound KP reporter — agent-candidate bridge, WP4 (final package).
//!
//! Personas hired through a KP hire request carry a typed
//! [`KpLink`](crate::db::models::KpLink) in `design_context.kpLink` (stamped by
//! the `kp_hire_request` approval executor, WP3). This module is the outbound
//! half: it pushes execution counters, monthly rollups, and lifecycle events to
//! `POST {base_url}/api/agents/report/{report_token}` on the KP app.
//!
//! Ground rules (shared with `approval_exec_core::notify_kp_lifecycle`):
//! - **Best-effort, always.** Every push is fire-and-forget or swallowed with a
//!   `tracing::warn` — a KP outage must never affect an execution, a promote,
//!   or a delete.
//! - **`crate::SHARED_HTTP`**, never `SSRF_SAFE_HTTP` — the KP app runs on
//!   localhost (precedent: `commands/tools/triggers.rs` webhook replay).
//! - **The URL embeds the report token (a capability): never log the URL or
//!   the token.** reqwest errors are logged via `without_url()` for the same
//!   reason.
//! - **Severed links.** ≥3 *consecutive* 404s from KP mean the token was
//!   revoked or the job is gone: stop reporting for that persona until app
//!   restart (in-memory registry). A 2xx resets the counter; transport errors
//!   and other statuses leave it unchanged (they prove nothing about the
//!   link).
//! - **Idempotency.** Per-execution events carry `Idempotency-Key:
//!   exec-<exec_id>` (KP dedupes durably on execId, so a double-fire is safe).
//!   Rollups carry no key: KP upserts a rollup by period, and re-sending the
//!   full current calendar month every tick is the self-healing design.
//!
//! The periodic [`KpReporterSubscription`] (300s tick) recomputes the current
//! calendar month per KP-linked persona with the same
//! `MONTHLY_SPEND_PREDICATE` discipline as `executions::get_monthly_spend`
//! (terminal statuses only, UTC month boundary, `_ops` chat excluded), so the
//! numbers KP shows always match the Personas budget UI — and it sweeps up the
//! accepted per-execution gaps (cancel/cloud/daemon/zombie terminal writes
//! don't push individually).

use std::collections::{BTreeMap, HashMap};
use std::sync::{LazyLock, Mutex as StdMutex};
use std::time::Duration;

use serde::Serialize;

use crate::db::models::KpLink;
use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::tool_usage as tool_usage_repo;
use crate::db::DbPool;

use super::subscription::ReactiveSubscription;

// ---------------------------------------------------------------------------
// Severed-link registry (consecutive-404 tracking)
// ---------------------------------------------------------------------------

/// Consecutive 404s after which a persona's KP link is considered severed.
const SEVER_THRESHOLD: u32 = 3;

/// Per-persona consecutive-404 counters. In-memory by design: a severed link
/// stays suppressed until app restart, at which point the next tick probes the
/// KP endpoint again (matching the wire contract's "stop reporting … until app
/// restart").
static CONSECUTIVE_404S: LazyLock<StdMutex<HashMap<String, u32>>> =
    LazyLock::new(|| StdMutex::new(HashMap::new()));

/// Is this persona's KP link severed (≥ [`SEVER_THRESHOLD`] consecutive 404s)?
pub(crate) fn is_severed(persona_id: &str) -> bool {
    CONSECUTIVE_404S
        .lock()
        .map(|m| m.get(persona_id).is_some_and(|c| *c >= SEVER_THRESHOLD))
        .unwrap_or(false)
}

/// Record a 2xx from KP: any consecutive-404 streak is broken.
fn record_success(persona_id: &str) {
    if let Ok(mut m) = CONSECUTIVE_404S.lock() {
        m.remove(persona_id);
    }
}

/// Record a 404 from KP. Returns `true` exactly when THIS call crossed the
/// sever threshold, so the caller can log the severing once (not every tick).
fn record_not_found(persona_id: &str) -> bool {
    let Ok(mut m) = CONSECUTIVE_404S.lock() else {
        return false;
    };
    let c = m.entry(persona_id.to_string()).or_insert(0);
    *c += 1;
    *c == SEVER_THRESHOLD
}

// ---------------------------------------------------------------------------
// Wire payloads (camelCase per the KP report contract)
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct KpConnectorUse {
    pub connector: String,
    pub calls: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpExecutionEvent<'a> {
    kind: &'static str,
    exec_id: &'a str,
    persona_id: &'a str,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    status: &'a str,
    duration_ms: i64,
    connector_uses: Vec<KpConnectorUse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpRollupEvent {
    kind: &'static str,
    period: String,
    runs: i64,
    successes: i64,
    failures: i64,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    connector_uses: Vec<KpConnectorUse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct KpLifecycleEvent<'a> {
    kind: &'static str,
    event: &'a str,
    persona_id: &'a str,
    persona_name: &'a str,
}

// ---------------------------------------------------------------------------
// The shared push core
// ---------------------------------------------------------------------------

/// POST one report event to the KP app and classify the response into the
/// severed-link registry (when `persona_id` is given).
///
/// This is THE single send path for every KP report push — the WP3 lifecycle
/// notifier (`approval_exec_core::notify_kp_lifecycle`) delegates here too.
/// SHARED_HTTP (localhost-capable), 5s timeout, warn-only failures; the URL
/// embeds the token and is never logged (`err.without_url()`).
pub(crate) async fn post_kp_report(
    base_url: &str,
    report_token: &str,
    body: &serde_json::Value,
    idempotency_key: Option<&str>,
    persona_id: Option<&str>,
    what: &'static str,
) {
    let url = format!(
        "{}/api/agents/report/{report_token}",
        base_url.trim_end_matches('/')
    );
    let mut req = crate::SHARED_HTTP
        .post(&url)
        .timeout(Duration::from_secs(5))
        .json(body);
    if let Some(key) = idempotency_key {
        req = req.header("Idempotency-Key", key);
    }
    match req.send().await {
        Ok(resp) if resp.status().is_success() => {
            if let Some(pid) = persona_id {
                record_success(pid);
            }
        }
        Ok(resp) if resp.status() == reqwest::StatusCode::NOT_FOUND => {
            if let Some(pid) = persona_id {
                if record_not_found(pid) {
                    tracing::warn!(
                        persona_id = %pid,
                        what,
                        "KP report link severed after {SEVER_THRESHOLD} consecutive 404s \
                         (token revoked or job gone); suppressing KP pushes for this \
                         persona until app restart"
                    );
                }
            }
        }
        Ok(resp) if resp.status() == reqwest::StatusCode::TOO_MANY_REQUESTS => {
            // Back off silently-ish; the next tick / execution retries.
            tracing::debug!(
                what,
                "KP report rate-limited (429); will retry on the next tick"
            );
        }
        Ok(resp) => {
            tracing::warn!(what, status = %resp.status(), "KP report push rejected by the KP app");
        }
        Err(e) => {
            // without_url(): a reqwest error Display can embed the request URL,
            // which carries the report token.
            tracing::warn!(what, error = %e.without_url(), "KP report push failed");
        }
    }
}

/// Fire-and-forget wrapper over [`post_kp_report`] for call sites on the hot
/// path (execution completion, promote, delete). Mirrors the WP3 idiom:
/// `tauri::async_runtime::spawn` + warn-on-failure inside.
fn spawn_kp_report(
    link: &KpLink,
    body: serde_json::Value,
    idempotency_key: Option<String>,
    persona_id: String,
    what: &'static str,
) {
    let base_url = link.base_url.clone();
    let token = link.report_token.clone();
    tauri::async_runtime::spawn(async move {
        post_kp_report(
            &base_url,
            &token,
            &body,
            idempotency_key.as_deref(),
            Some(&persona_id),
            what,
        )
        .await;
    });
}

// ---------------------------------------------------------------------------
// Hooks (execution completion / lifecycle)
// ---------------------------------------------------------------------------

/// Aggregate `persona_tool_usage` rows into deduped, name-sorted connector
/// counters (multiple `record` calls per tool sum up).
fn aggregate_connector_uses<I: IntoIterator<Item = (String, i64)>>(rows: I) -> Vec<KpConnectorUse> {
    let mut by_tool: BTreeMap<String, i64> = BTreeMap::new();
    for (tool, calls) in rows {
        *by_tool.entry(tool).or_insert(0) += calls;
    }
    by_tool
        .into_iter()
        .map(|(connector, calls)| KpConnectorUse { connector, calls })
        .collect()
}

/// Best-effort per-execution counters push, called from the engine's
/// `handle_execution_result` right after budget enforcement. No-op unless the
/// persona carries a `kp_link`; returns before any I/O for the overwhelmingly
/// common unlinked case (one persona row read).
///
/// `status` is the KP wire value: `"success"` or `"failure"` (the caller maps
/// the `ExecutionState` and skips Cancelled entirely).
#[allow(clippy::too_many_arguments)]
pub(crate) fn push_execution_event(
    pool: &DbPool,
    persona_id: &str,
    exec_id: &str,
    status: &'static str,
    cost_usd: f64,
    tokens_in: i64,
    tokens_out: i64,
    duration_ms: i64,
) {
    let Ok(persona) = persona_repo::get_by_id(pool, persona_id) else {
        return;
    };
    let Some(link) = persona.parsed_design_context().kp_link else {
        return;
    };
    if is_severed(persona_id) {
        return;
    }
    // Connector counters for this run, if the tool-usage writers populated any
    // (best-effort; an empty list is a valid payload).
    let connector_uses = aggregate_connector_uses(
        tool_usage_repo::get_by_execution(pool, exec_id)
            .unwrap_or_default()
            .into_iter()
            .map(|u| (u.tool_name, i64::from(u.invocation_count))),
    );
    let event = KpExecutionEvent {
        kind: "execution",
        exec_id,
        persona_id,
        cost_usd,
        tokens_in,
        tokens_out,
        status,
        duration_ms,
        connector_uses,
    };
    let Ok(body) = serde_json::to_value(&event) else {
        return;
    };
    spawn_kp_report(
        &link,
        body,
        Some(format!("exec-{exec_id}")),
        persona_id.to_string(),
        "execution",
    );
}

/// Best-effort lifecycle push (`activated` on promote, `retired` on delete)
/// for a persona whose `kp_link` the caller already holds.
pub(crate) fn push_lifecycle_event(
    link: &KpLink,
    event: &'static str,
    persona_id: &str,
    persona_name: &str,
) {
    if is_severed(persona_id) {
        return;
    }
    let payload = KpLifecycleEvent {
        kind: "lifecycle",
        event,
        persona_id,
        persona_name,
    };
    let Ok(body) = serde_json::to_value(&payload) else {
        return;
    };
    spawn_kp_report(link, body, None, persona_id.to_string(), event);
}

// ---------------------------------------------------------------------------
// Periodic rollup subscription
// ---------------------------------------------------------------------------

/// Periodic monthly-rollup reporter for KP-linked personas.
///
/// Every tick recomputes and re-sends the FULL current calendar month per
/// linked persona — KP upserts by period, so this is idempotent and
/// self-healing (it also covers the terminal paths that skip the
/// per-execution push: cancel, cloud, daemon, zombie sweeps).
pub struct KpReporterSubscription {
    pub pool: DbPool,
}

#[async_trait::async_trait]
impl ReactiveSubscription for KpReporterSubscription {
    fn name(&self) -> &'static str {
        "kp_reporter"
    }

    fn interval(&self) -> Duration {
        Duration::from_secs(300)
    }

    fn initial_delay(&self) -> Duration {
        // Let launch settle; the first rollup 2 min in is the startup catch-up.
        Duration::from_secs(120)
    }

    async fn tick(&self) {
        kp_rollup_tick(&self.pool).await;
    }
}

/// One rollup pass: find KP-linked personas, compute the current month, push.
///
/// Persona discovery: a SQL `LIKE '%"kpLink"%'` prefilter on the JSON column
/// (the typed field serializes camelCase on the wire), then a proper
/// `parse_design_context` on each hit — the LIKE only bounds the scan, the
/// typed parse decides.
async fn kp_rollup_tick(pool: &DbPool) {
    let candidates: Vec<(String, Option<String>)> = {
        let conn = match pool.get() {
            Ok(c) => c,
            Err(e) => {
                tracing::warn!(error = %e, "kp_reporter: pool unavailable; skipping tick");
                return;
            }
        };
        let mut stmt = match conn.prepare(
            "SELECT id, design_context FROM personas WHERE design_context LIKE '%\"kpLink\"%'",
        ) {
            Ok(s) => s,
            Err(e) => {
                tracing::warn!(error = %e, "kp_reporter: prefilter query failed; skipping tick");
                return;
            }
        };
        match stmt
            .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .and_then(|rows| rows.collect::<Result<Vec<_>, _>>())
        {
            Ok(rows) => rows,
            Err(e) => {
                tracing::warn!(error = %e, "kp_reporter: prefilter scan failed; skipping tick");
                return;
            }
        }
    };

    let period = chrono::Utc::now().format("%Y-%m").to_string();

    for (persona_id, design_context) in candidates {
        let Some(link) = crate::db::models::parse_design_context(design_context.as_deref()).kp_link
        else {
            continue; // LIKE false-positive — the typed parse is authoritative.
        };
        if is_severed(&persona_id) {
            continue;
        }

        let rollup = match exec_repo::get_monthly_rollup(pool, &persona_id) {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(persona_id = %persona_id, error = %e, "kp_reporter: monthly rollup query failed");
                continue;
            }
        };
        let connector_uses = aggregate_connector_uses(
            tool_usage_repo::get_monthly_totals_by_tool(pool, &persona_id).unwrap_or_default(),
        );

        let event = KpRollupEvent {
            kind: "rollup",
            period: period.clone(),
            runs: rollup.runs,
            successes: rollup.successes,
            failures: rollup.failures,
            cost_usd: rollup.cost_usd,
            tokens_in: rollup.tokens_in,
            tokens_out: rollup.tokens_out,
            connector_uses,
        };
        let Ok(body) = serde_json::to_value(&event) else {
            continue;
        };
        // No Idempotency-Key: a rollup is an authoritative upsert by period.
        post_kp_report(
            &link.base_url,
            &link.report_token,
            &body,
            None,
            Some(&persona_id),
            "rollup",
        )
        .await;
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -- payload serialization pins the KP wire contract exactly --------------

    #[test]
    fn execution_payload_matches_wire_contract() {
        let event = KpExecutionEvent {
            kind: "execution",
            exec_id: "exec-1",
            persona_id: "p-1",
            cost_usd: 0.12,
            tokens_in: 5200,
            tokens_out: 900,
            status: "success",
            duration_ms: 8300,
            connector_uses: vec![KpConnectorUse {
                connector: "gmail".into(),
                calls: 3,
            }],
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "execution",
                "execId": "exec-1",
                "personaId": "p-1",
                "costUsd": 0.12,
                "tokensIn": 5200,
                "tokensOut": 900,
                "status": "success",
                "durationMs": 8300,
                "connectorUses": [{"connector": "gmail", "calls": 3}],
            })
        );
    }

    #[test]
    fn rollup_payload_matches_wire_contract() {
        let event = KpRollupEvent {
            kind: "rollup",
            period: "2026-08".into(),
            runs: 41,
            successes: 39,
            failures: 2,
            cost_usd: 4.87,
            tokens_in: 210_000,
            tokens_out: 36_000,
            connector_uses: vec![],
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "rollup",
                "period": "2026-08",
                "runs": 41,
                "successes": 39,
                "failures": 2,
                "costUsd": 4.87,
                "tokensIn": 210000,
                "tokensOut": 36000,
                "connectorUses": [],
            })
        );
    }

    #[test]
    fn lifecycle_payload_matches_wire_contract() {
        let event = KpLifecycleEvent {
            kind: "lifecycle",
            event: "activated",
            persona_id: "p-1",
            persona_name: "Invoice Chaser",
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({
                "kind": "lifecycle",
                "event": "activated",
                "personaId": "p-1",
                "personaName": "Invoice Chaser",
            })
        );
    }

    // -- 404-severing state machine -------------------------------------------

    #[test]
    fn severing_takes_three_consecutive_404s_and_success_resets() {
        let pid = "sever-test-persona";
        assert!(!is_severed(pid));

        assert!(!record_not_found(pid)); // 1
        assert!(!record_not_found(pid)); // 2
        assert!(!is_severed(pid));

        // A success breaks the streak.
        record_success(pid);
        assert!(!record_not_found(pid)); // back to 1
        assert!(!is_severed(pid));

        assert!(!record_not_found(pid)); // 2
        assert!(record_not_found(pid)); // 3 — crossing returns true exactly once
        assert!(is_severed(pid));

        // Further 404s keep it severed but never re-report the crossing.
        assert!(!record_not_found(pid));
        assert!(is_severed(pid));

        // Cleanup so other tests never see this id as severed.
        record_success(pid);
        assert!(!is_severed(pid));
    }

    #[test]
    fn severing_is_per_persona() {
        let a = "sever-a";
        let b = "sever-b";
        record_not_found(a);
        record_not_found(a);
        record_not_found(a);
        assert!(is_severed(a));
        assert!(!is_severed(b));
        record_success(a);
    }

    // -- connector aggregation -------------------------------------------------

    #[test]
    fn connector_uses_aggregate_and_sort_by_name() {
        let uses = aggregate_connector_uses(vec![
            ("slack".to_string(), 1),
            ("gmail".to_string(), 3),
            ("gmail".to_string(), 2),
        ]);
        assert_eq!(
            uses,
            vec![
                KpConnectorUse {
                    connector: "gmail".into(),
                    calls: 5
                },
                KpConnectorUse {
                    connector: "slack".into(),
                    calls: 1
                },
            ]
        );
    }

    // -- no-kp_link personas: pinned no-op ------------------------------------

    #[tokio::test]
    async fn execution_push_is_a_no_op_without_kp_link() {
        let pool = crate::db::init_test_db().unwrap();
        let persona = crate::db::repos::core::personas::create(
            &pool,
            crate::db::models::CreatePersonaInput {
                name: "No KP Link".into(),
                system_prompt: "You are a test agent.".into(),
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
        // Returns before any spawn/network (a spawn would panic here — no
        // tauri runtime in tests — so completing at all proves the early
        // return, i.e. zero behavior change for personas without kp_link).
        push_execution_event(&pool, &persona.id, "exec-x", "success", 0.1, 10, 5, 100);
        // Unknown persona: also a silent no-op.
        push_execution_event(&pool, "missing", "exec-x", "success", 0.1, 10, 5, 100);
    }
}
