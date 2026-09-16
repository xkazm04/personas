//! Whitelist commands — the origin gate's IPC surface (`browser_sites_*`,
//! `browser_lease_revoke`). WP3 adds `browser_scan_*`. See
//! docs/architecture/browser-control.md §2.
//!
//! Adapters, in this repo's sense: validate, make ONE repo call, map the
//! result. The policy itself lives one layer down — tighten-only overrides
//! and the deny-by-default row are enforced in `repos::browser::sites`, which
//! is also the door `browser_request_site` and the scan come through, so a
//! rule written here would only bind the UI.
//!
//! Every mutation is `#[requires(privileged)]` and listed in
//! `ipc_auth::PRIVILEGED_COMMANDS`: adding or enabling an origin is what
//! grants an agent reach into a web app, and binding a credential points the
//! vault at it. The read is `auth` so the page paints on load.

use std::sync::Arc;

use tauri::State;

use crate::browser_bridge::backend::Principal;
use crate::browser_bridge::policy;
use crate::db::models::{BrowserSite, BrowserToolClass, UpsertBrowserSiteInput};
use crate::db::repos::browser::sites as repo;
use crate::error::AppError;
use crate::AppState;
use personas_macros::requires;

#[tauri::command]
#[requires(privileged)]
pub fn browser_sites_list(state: State<'_, Arc<AppState>>) -> Result<Vec<BrowserSite>, AppError> {
    repo::list(&state.db)
}

#[tauri::command]
#[requires(privileged)]
pub fn browser_sites_upsert(
    state: State<'_, Arc<AppState>>,
    input: UpsertBrowserSiteInput,
) -> Result<BrowserSite, AppError> {
    repo::upsert(&state.db, input)
}

#[tauri::command]
#[requires(privileged)]
pub fn browser_sites_delete(
    state: State<'_, Arc<AppState>>,
    origin: String,
) -> Result<bool, AppError> {
    repo::delete(&state.db, &origin)
}

#[tauri::command]
#[requires(privileged)]
pub fn browser_sites_set_enabled(
    state: State<'_, Arc<AppState>>,
    origin: String,
    enabled: bool,
) -> Result<BrowserSite, AppError> {
    repo::set_enabled(&state.db, &origin, enabled)
}

/// Tighten one tool on one origin, or clear the override (`class: null`).
///
/// The repo refuses anything but `gated` with `AppError::Forbidden` carrying
/// `refused_loosening` — the same code the MCP surface answers an agent
/// with, so the two doors give one answer.
#[tauri::command]
#[requires(privileged)]
pub fn browser_sites_set_override(
    state: State<'_, Arc<AppState>>,
    origin: String,
    tool: String,
    class: Option<BrowserToolClass>,
) -> Result<BrowserSite, AppError> {
    repo::set_override(&state.db, &origin, &tool, class)
}

#[tauri::command]
#[requires(privileged)]
pub fn browser_sites_bind_credential(
    state: State<'_, Arc<AppState>>,
    origin: String,
    credential_id: Option<String>,
) -> Result<BrowserSite, AppError> {
    repo::bind_credential(&state.db, &origin, credential_id.as_deref())
}

/// Take a tab back from whoever holds it (rule 5's escape hatch).
///
/// Returns the principal that held it, or `None` when it was already free —
/// a revoke of a free tab is the same outcome, not an error. The operator is
/// the only principal that may do this, which is what `privileged` says.
#[tauri::command]
#[requires(privileged)]
pub fn browser_lease_revoke(
    state: State<'_, Arc<AppState>>,
    tab: u32,
) -> Result<Option<String>, AppError> {
    let _ = &state;
    Ok(policy::release_lease(tab).map(|p: Principal| p.as_wire()))
}

// ---------------------------------------------------------------------------
// The controllability scan (WP3)
// ---------------------------------------------------------------------------
//
// Three commands and one background task. The shape is `kpi_scan.rs`'s: mark
// the row `running` and return immediately, spawn a headless turn that answers
// with one JSON object per line, parse defensively, file the result as
// `proposed` for the operator to confirm. What is different here is the
// toolset — the scan turn holds the browser bridge and NOTHING else
// (`--strict-mcp-config`), under its own `scan:<origin>` session, so it can
// see the site and cannot reach the rest of the machine.

use personas_core::models::{BrowserScanStatus, BrowserSiteScan};
use tauri::{Emitter, EventTarget};

use crate::browser_bridge::policy::AllowPolicy;
use crate::commands::browser::scan_prompt::{build_scan_prompt, FINDING_MARKER};

/// How long a scan turn may run. A survey reads pages; it does not build
/// anything, and a scan still going after this is a scan that got lost.
const SCAN_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(600);

/// The model the scan turn runs on. A survey is a reading task with a fixed
/// output shape — the balanced tier, the same one `kpi_scan` picks for the
/// same reason. Named through `model_ids` rather than spelled inline: a model
/// retirement is then a one-file diff instead of a tree-wide grep
/// (census `bare-model-id-literal`).
const SCAN_MODEL: &str = personas_core::model_ids::DEFAULT_BALANCED;

/// The scan session's principal for one origin.
fn scan_principal(origin: &str) -> Principal {
    Principal::Session(format!("scan:{origin}"))
}

/// Publish the scan's state for one origin.
///
/// Emitted to the `main` window only, never `app.emit`: `app.emit` broadcasts
/// into the page webviews as well, and a page webview is whatever site an
/// agent navigated to. Same reasoning and the same target as
/// `webview::tabs::announce`.
fn announce_scan(
    app: &tauri::AppHandle,
    origin: &str,
    status: BrowserScanStatus,
    tier: Option<u8>,
) {
    // `if let Err` rather than `let _ =`: `emit` fails PERMANENTLY when a
    // payload cannot be serialise, so discarding the Result would make "this
    // event has never once been delivered" look exactly like "delivered" —
    // and the Whitelist page would sit on `running` forever with nothing in
    // any log saying why (census `unverified-effect-dispatch`).
    if let Err(e) = app.emit_to(
        EventTarget::AnyLabel {
            label: crate::browser_bridge::webview::layout::MAIN_WINDOW.to_string(),
        },
        personas_core::events::event_name::BROWSER_SCAN,
        serde_json::json!({
            "origin": origin,
            "status": status.as_str(),
            "tier": tier,
        }),
    ) {
        tracing::warn!(
            origin = %origin,
            status = %status.as_str(),
            error = %e,
            "browser scan: the scan-state event was not delivered (the row is still authoritative)"
        );
    }
}

/// Parse one stream line into a scan report.
///
/// Defensive in three separate ways, each of which has bitten a scan in this
/// repo before: the marker is REQUIRED (the CLI's verbose stream delivers each
/// turn as both a JSON event and a plain text line, so a blind parse
/// double-counts), the object is located by its first `{` (models prefix
/// prose), and `tier` is CLAMPED rather than trusted (the column carries a
/// CHECK, so a 7 would fail the write and turn a good survey into a failed
/// row — losing the whole report over one integer).
pub(crate) fn parse_site_finding(line: &str) -> Option<BrowserSiteScan> {
    let trimmed = line.trim();
    if !trimmed.contains(FINDING_MARKER) {
        return None;
    }
    let start = trimmed.find('{')?;
    #[derive(serde::Deserialize)]
    struct Envelope {
        site_finding: BrowserSiteScan,
    }
    let mut scan = serde_json::from_str::<Envelope>(&trimmed[start..])
        .ok()
        .map(|e| e.site_finding)?;
    if scan.tier > 2 {
        tracing::warn!(
            tier = scan.tier,
            "browser scan: tier out of range; clamped to 2"
        );
        scan.tier = 2;
    }
    Some(scan)
}

/// File a terminal scan result. ONE place, so the `proposed` and `failed`
/// paths cannot drift in what they write or what they announce.
fn finish_scan(
    app: &tauri::AppHandle,
    pool: &crate::db::DbPool,
    origin: &str,
    status: BrowserScanStatus,
    scan: Option<&BrowserSiteScan>,
) {
    let tier = scan.map(|s| s.tier);
    let report = scan.and_then(|s| serde_json::to_string(s).ok());
    if let Err(e) = repo::set_scan(pool, origin, status, tier, report.as_deref(), None) {
        tracing::error!(origin = %origin, error = %e, "browser scan: could not file the result");
    }
    announce_scan(app, origin, status, tier);
}

/// The deterministic fallback when no `claude` CLI is installed.
///
/// It answers only the subset a backend can answer without a model — the
/// page's declared tools (which decide `transport`) and a snapshot it can
/// count refs in — and says so in `notes`. A probe reported as a scan would be
/// the worse failure: the tier would look measured when it was assumed.
async fn probe_only_scan(origin: &str) -> BrowserSiteScan {
    use crate::browser_bridge::backend::{self, Action, CallContext};

    let mut scan = BrowserSiteScan {
        notes: "probe-only: no CLI".to_string(),
        ..Default::default()
    };
    let token =
        crate::browser_bridge::register_session(scan_principal(origin), AllowPolicy::Whitelist);
    crate::browser_bridge::set_session_origin(&token, origin);
    let ctx = CallContext {
        principal: scan_principal(origin),
        policy: AllowPolicy::Whitelist,
    };

    if let Some(b) = backend::preferred_backend() {
        if let Ok(outcome) = b
            .call(None, Action::PageTools(serde_json::json!({})), &ctx)
            .await
        {
            let raw = outcome
                .output
                .get("tools")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            if let Ok(tools) =
                serde_json::from_value::<Vec<personas_core::models::BrowserPageTool>>(raw)
            {
                if !tools.is_empty() {
                    scan.transport = personas_core::models::BrowserScanTransport::WebmcpPolyfill;
                }
                scan.page_tools = tools;
            }
        }
        if let Ok(outcome) = b
            .call(None, Action::Snapshot(serde_json::json!({})), &ctx)
            .await
        {
            let text = match &outcome.output {
                serde_json::Value::String(s) => s.clone(),
                other => other.to_string(),
            };
            // A ref is what makes an element addressable at all, so counting
            // refs IS the operable count for a generic-hands tier. No
            // heuristic, and nothing invented.
            scan.operable_count = u32::try_from(text.matches("ref_").count()).unwrap_or(u32::MAX);
        }
    }
    scan.tier = if !scan.page_tools.is_empty() {
        2
    } else if scan.operable_count > 0 {
        1
    } else {
        0
    };
    crate::browser_bridge::revoke_session(&token);
    scan
}

/// Run one scan turn end to end. `Ok` is the report; `Err` is the reason
/// there is none, which the caller files verbatim into `notes`. An `Err`
/// prefixed `no-cli:` means the machine has no Claude CLI and the caller
/// should fall back to the probe.
async fn run_scan_turn(
    origin: &str,
    label: &str,
    tier_hint: Option<u8>,
) -> Result<BrowserSiteScan, String> {
    let token =
        crate::browser_bridge::register_session(scan_principal(origin), AllowPolicy::Whitelist);
    let config = match crate::commands::browser::bridge_mcp_config_json(&token) {
        Some(c) => c,
        None => {
            crate::browser_bridge::revoke_session(&token);
            return Err("the local bridge server is not up; the scan has no toolset".to_string());
        }
    };
    let mut tmp = match tempfile::Builder::new()
        .prefix("personas_browser_scan_")
        .suffix(".json")
        .tempfile()
    {
        Ok(t) => t,
        Err(e) => {
            crate::browser_bridge::revoke_session(&token);
            return Err(format!("scan config: {e}"));
        }
    };
    {
        use std::io::Write;
        let body = match serde_json::to_string_pretty(&config) {
            Ok(b) => b,
            Err(e) => {
                crate::browser_bridge::revoke_session(&token);
                return Err(format!("scan config: {e}"));
            }
        };
        if let Err(e) = tmp.write_all(body.as_bytes()).and_then(|()| tmp.flush()) {
            crate::browser_bridge::revoke_session(&token);
            return Err(format!("scan config: {e}"));
        }
    }

    // `--strict-mcp-config` is what makes the bridge the turn's ONLY toolset:
    // without it the CLI also loads whatever `.mcp.json` sits in the cwd, and
    // a survey turn would silently acquire a shell.
    let extra = vec![
        "--mcp-config".to_string(),
        tmp.path().display().to_string(),
        "--strict-mcp-config".to_string(),
    ];
    let prompt = build_scan_prompt(origin, label, tier_hint);

    let mut child = match crate::engine::cli_process::spawn_headless_claude(
        prompt, SCAN_MODEL, &extra, None, true,
    ) {
        Ok(c) => c,
        Err(e) => {
            crate::browser_bridge::revoke_session(&token);
            return Err(format!("no-cli: {e}"));
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => {
            crate::browser_bridge::revoke_session(&token);
            return Err("the scan turn produced no output pipe".to_string());
        }
    };
    use tokio::io::AsyncBufReadExt;
    let mut reader = tokio::io::BufReader::new(stdout).lines();

    // The LAST well-formed finding wins: the verbose stream repeats a turn as
    // both an event and a text line, and a model that corrects itself emits
    // the better answer second.
    let mut found: Option<BrowserSiteScan> = None;
    let streamed = tokio::time::timeout(SCAN_TIMEOUT, async {
        while let Ok(Some(line)) = reader.next_line().await {
            let Some(text) = crate::commands::design::analysis::extract_display_text(&line) else {
                continue;
            };
            for candidate in text.lines() {
                if let Some(scan) = parse_site_finding(candidate) {
                    found = Some(scan);
                }
            }
        }
    })
    .await;

    let _ = child.kill().await;
    crate::browser_bridge::revoke_session(&token);
    drop(tmp);

    if streamed.is_err() {
        return Err(format!(
            "the scan did not finish within {}s",
            SCAN_TIMEOUT.as_secs()
        ));
    }
    found.ok_or_else(|| "the scan turn answered with no `site_finding` line".to_string())
}

/// Start the controllability scan for one whitelisted origin.
///
/// Returns the row in its `running` state immediately; the survey runs in a
/// spawned task and lands as `proposed` (or `failed`). The operator confirms
/// it with [`browser_scan_confirm`] — a scan is a PROPOSAL about how much
/// reach a site should have, and nothing acts on a tier nobody looked at.
#[tauri::command]
#[requires(privileged)]
pub fn browser_scan_site(
    state: State<'_, Arc<AppState>>,
    app: tauri::AppHandle,
    origin: String,
) -> Result<BrowserSite, AppError> {
    let site = repo::get(&state.db, &origin)?
        .ok_or_else(|| AppError::NotFound(format!("BrowserSite {origin}")))?;
    if site.scan_status == BrowserScanStatus::Running {
        return Err(AppError::Validation(format!(
            "a scan of {origin} is already running"
        )));
    }
    let running = repo::set_scan(
        &state.db,
        &origin,
        BrowserScanStatus::Running,
        site.scan_tier,
        None,
        None,
    )?;
    announce_scan(&app, &origin, BrowserScanStatus::Running, site.scan_tier);

    let pool = state.db.clone();
    let label = if site.label.trim().is_empty() {
        origin.clone()
    } else {
        site.label.clone()
    };
    let tier_hint = site.scan_tier;
    let origin_task = origin.clone();
    // Every spawn decides who waits. Nothing waits on this one, so each of its
    // exits — answer, refusal, timeout, panic — ends in a DURABLE `set_scan`.
    // A row stuck on `running` forever is the failure this shape prevents, and
    // it is the failure a discarded handle would produce.
    let panic_app = app.clone();
    let panic_pool = pool.clone();
    let panic_origin = origin.clone();
    crate::background_job::spawn_guarded(
        "browser scan",
        origin.clone(),
        async move {
            let result = run_scan_turn(&origin_task, &label, tier_hint).await;
            match result {
                Ok(scan) => finish_scan(
                    &app,
                    &pool,
                    &origin_task,
                    BrowserScanStatus::Proposed,
                    Some(&scan),
                ),
                // No CLI on this machine: answer with the deterministic subset a
                // backend can prove, labelled as exactly that.
                Err(reason) if reason.starts_with("no-cli:") => {
                    let scan = probe_only_scan(&origin_task).await;
                    finish_scan(
                        &app,
                        &pool,
                        &origin_task,
                        BrowserScanStatus::Proposed,
                        Some(&scan),
                    );
                }
                Err(reason) => {
                    tracing::warn!(origin = %origin_task, %reason, "browser scan failed");
                    let scan = BrowserSiteScan {
                        notes: reason,
                        ..Default::default()
                    };
                    finish_scan(
                        &app,
                        &pool,
                        &origin_task,
                        BrowserScanStatus::Failed,
                        Some(&scan),
                    );
                }
            }
        },
        // The panic arm is the whole reason this uses the shared primitive:
        // a row stuck on `running` forever is the failure mode, and a panic
        // is the one exit `run_scan_turn` cannot report itself.
        move |msg| async move {
            let scan = BrowserSiteScan {
                notes: format!("the scan task panicked: {msg}"),
                ..Default::default()
            };
            finish_scan(
                &panic_app,
                &panic_pool,
                &panic_origin,
                BrowserScanStatus::Failed,
                Some(&scan),
            );
        },
    );

    Ok(running)
}

/// Where the scan of `origin` stands.
///
/// Returns the whole row rather than a bespoke status struct: `scan_status`,
/// `scan_tier`, `scan_report` and `scan_at` are four fields of ONE record, and
/// a second shape carrying three of them is a shape that can disagree with the
/// first.
#[tauri::command]
#[requires(privileged)]
pub fn browser_scan_status(
    state: State<'_, Arc<AppState>>,
    origin: String,
) -> Result<BrowserSite, AppError> {
    repo::get(&state.db, &origin)?
        .ok_or_else(|| AppError::NotFound(format!("BrowserSite {origin}")))
}

/// Accept a proposed scan.
///
/// Moves `scan_status` to `confirmed` and changes NOTHING else — in
/// particular it never flips `enabled`. Confirming a survey is agreeing with
/// what it found; granting the site reach is a separate decision the operator
/// makes with the Whitelist's own switch, and collapsing the two would make
/// "yes, that is what the page is" silently mean "yes, go ahead".
#[tauri::command]
#[requires(privileged)]
pub fn browser_scan_confirm(
    state: State<'_, Arc<AppState>>,
    origin: String,
) -> Result<BrowserSite, AppError> {
    let site = repo::get(&state.db, &origin)?
        .ok_or_else(|| AppError::NotFound(format!("BrowserSite {origin}")))?;
    if site.scan_status != BrowserScanStatus::Proposed {
        return Err(AppError::Validation(format!(
            "{origin}'s scan is `{}`, not `proposed`; there is nothing to confirm",
            site.scan_status.as_str()
        )));
    }
    let report = site
        .scan_report
        .as_ref()
        .and_then(|r| serde_json::to_string(&r.0).ok());
    repo::set_scan(
        &state.db,
        &origin,
        BrowserScanStatus::Confirmed,
        site.scan_tier,
        report.as_deref(),
        site.scan_at,
    )
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    const GOOD: &str = r#"{"site_finding": {"transport": "webmcp-polyfill", "page_tools": [], "operable_count": 12, "landmarks": ["main"], "forms": [], "login_form": null, "blockers": [], "tier": 2, "notes": "ok"}}"#;

    #[test]
    fn parse_site_finding_takes_a_well_formed_line() {
        let scan = parse_site_finding(GOOD).expect("the canonical line parses");
        assert_eq!(scan.operable_count, 12);
        assert_eq!(scan.tier, 2);
        assert_eq!(
            scan.transport,
            personas_core::models::BrowserScanTransport::WebmcpPolyfill
        );
        // Prose before the object is normal model output, not a failure.
        assert!(parse_site_finding(&format!("Here is what I found: {GOOD}")).is_some());
    }

    #[test]
    fn parse_site_finding_rejects_malformed_lines() {
        for bad in [
            "",
            "   ",
            "I looked at the site and it seems fine.",
            // The marker with no object behind it.
            "\"site_finding\"",
            // Marker, object, wrong field types.
            r#"{"site_finding": {"tier": "two"}}"#,
            // A DIFFERENT envelope that is perfectly valid JSON. The scan must
            // never adopt another scanner's line.
            r#"{"kpi_proposal": {"name": "x"}}"#,
            // Truncated: the stream was cut mid-line.
            r#"{"site_finding": {"transport": "none", "page_tools": ["#,
        ] {
            assert!(parse_site_finding(bad).is_none(), "must reject: {bad}");
        }
    }

    /// A tier outside 0..=2 is clamped, not refused: the column's CHECK would
    /// turn an otherwise-good survey into a `failed` row, losing the whole
    /// report over one integer.
    #[test]
    fn an_out_of_range_tier_is_clamped_rather_than_losing_the_report() {
        let line = GOOD.replace("\"tier\": 2", "\"tier\": 7");
        let scan = parse_site_finding(&line).expect("still parses");
        assert_eq!(scan.tier, 2);
        assert_eq!(scan.operable_count, 12, "the rest of the report survives");
    }

    /// Confirming moves only the status, and refuses anything but a proposal.
    #[test]
    fn confirm_only_moves_a_proposal_and_never_grants_reach() {
        let pool = crate::db::init_test_db().expect("test db");
        let origin = "https://confirm.example";
        repo::upsert(
            &pool,
            UpsertBrowserSiteInput {
                origin: origin.into(),
                ..Default::default()
            },
        )
        .unwrap();
        let scan = parse_site_finding(GOOD).unwrap();
        let json = serde_json::to_string(&scan).unwrap();
        repo::set_scan(
            &pool,
            origin,
            BrowserScanStatus::Proposed,
            Some(scan.tier),
            Some(&json),
            None,
        )
        .unwrap();

        let site = repo::get(&pool, origin).unwrap().unwrap();
        assert!(!site.enabled, "the row was never enabled");

        // The command body, minus the Tauri `State` wrapper.
        let report = site
            .scan_report
            .as_ref()
            .and_then(|r| serde_json::to_string(&r.0).ok());
        let after = repo::set_scan(
            &pool,
            origin,
            BrowserScanStatus::Confirmed,
            site.scan_tier,
            report.as_deref(),
            site.scan_at,
        )
        .unwrap();

        assert_eq!(after.scan_status, BrowserScanStatus::Confirmed);
        assert_eq!(after.scan_tier, Some(2));
        assert!(
            !after.enabled,
            "confirming a survey must never grant the site reach"
        );
        assert!(
            after.scan_report.is_some(),
            "the report survives the status move"
        );
    }
}
