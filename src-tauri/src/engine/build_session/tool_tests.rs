//! `run_tool_tests` — LLM-driven test runner used right before promote.
//!
//! The build flow hands this module an `AgentIr` and a set of resolved
//! credentials; the module spawns a scratch Claude CLI that composes curl
//! commands for each connector-backed tool, invokes them against real APIs,
//! and returns a summary the UI renders as the test-result panel.
//!
//! Pure side-effect-free execution against the draft — no DB writes, no
//! persona events fired. The promote pipeline happens in a separate command
//! once the user approves the test results.

use tauri::Emitter;

use crate::db::DbPool;
use crate::error::AppError;

use super::super::cli_process::{read_line_limited, CliProcessDriver};
use super::super::event_registry::event_name;
use super::super::prompt;
// Aliased to avoid colliding with the sibling `build_session::runner`
// submodule (which holds `run_session`, not the persona-execution runner).
use super::super::runner as engine_runner;
use super::super::tool_runner;

/// Model driving the test-plan composition leg. Named so the same string
/// reaches both the CLI `--model` flag and the `dev_llm_spend` ledger row
/// (the ledger's model is only a fallback — the CLI's own `result` envelope
/// wins — but the two must not be allowed to drift).
const TEST_PLAN_MODEL: &str = "claude-sonnet-4-6";

/// Model driving the plain-language test-report leg. Cheap on purpose — this
/// pass only rewrites an already-computed report for a non-technical reader.
const TEST_SUMMARY_MODEL: &str = "claude-haiku-4-5-20251001";

// =============================================================================
// The promote-gate decision table
// =============================================================================
//
// Direction `a-checkmark-that-means-something` (settled with the user
// 2026-08-07). A build promoted out of the autonomous one-shot flow is armed
// with a schedule trigger and a public webhook and executes against the user's
// real credentials — so "the tools passed" has to mean a call was actually
// made. Four separate paths used to reach `tools_failed: 0` with nothing
// executed. The settled verdicts:
//
//   | plan entry                          | verdict    | why                          |
//   |-------------------------------------|------------|------------------------------|
//   | persona has zero tools              | pass       | nothing to exercise          |
//   | empty `curl`, no `cli_native` claim | skipped    | the prompt invites these (§4)|
//   | `cli_native: true`                  | UNVERIFIED | an LLM boolean is not a call |
//   | no parseable plan → cred substring  | UNVERIFIED | a vault row is not a test    |
//
// `unverified` is a THIRD outcome, distinct from both pass and fail: nothing
// went wrong, but nothing was proven either. It holds promotion (see
// `oneshot::evaluate_promote_gate`) without being reported as a failure the
// fix-pass LLM should burn retries trying to "correct".
//
// The one carve-out on `cli_native` is a platform built-in the BACKEND itself
// recognises by name (below). That pass is authored by this code from a fixed
// allow-list, not by the model, and there is no external service or credential
// behind it — the same class of defensible pass as "the persona has no tools".

/// Result status for an entry that was counted but never executed.
pub(super) const STATUS_UNVERIFIED: &str = "unverified";

/// Tool names this backend recognises as in-process platform capabilities.
/// Nothing external is called, no user credential is involved, so counting
/// these as a pass is a code-authored claim rather than a model-authored one.
///
/// Why these and not `cli_native` generally — the distinction is the whole
/// point of this file, and it is an easy one to lose:
///
///   * This list is CODE. A model cannot add to it, exactly as it can no
///     longer mint `personas_gmail` into a platform connector. Membership is
///     evidence because we put it there knowing what is behind the name.
///   * `cli_native: true` is a boolean the model writes about its own work,
///     and it can assert it of ANYTHING — including a real external connector
///     with a live endpoint and the user's credential behind it, which it
///     simply never called. That is the false green this direction removes.
///
/// `web_search` / `web_fetch` are on the list for the same reason
/// `personas_database` is: genuinely built into the Claude CLI, no external
/// service, no credential to resolve, nothing a curl could exercise. Holding
/// them would be a false HOLD — the exact mirror of the false green — and it
/// would fire on the canonical case the test prompt itself names below. A
/// gate that stops honest builds gets muted, and then it protects nothing.
pub(super) const PLATFORM_BUILTIN_TOOLS: &[&str] = &[
    "personas_database",
    "database",
    "database_query",
    "db_query",
    "db_write",
    "personas_messages",
    "messaging",
    "personas_vector_db",
    "file_read",
    "file_write",
    "web_search",
    "web_fetch",
];

/// Connector names that are platform-internal and never bind a user
/// credential. Matched EXACTLY — the previous `connector.starts_with(
/// "personas_")` prefix test let a model-authored connector name (say
/// `personas_gmail`) mint itself an auto-pass.
pub(super) const PLATFORM_CONNECTORS: &[&str] = &[
    "personas_database",
    "personas_messages",
    "personas_vector_db",
    "messaging",
    "database",
    "builtin",
];

/// Generic infrastructure tools that are conduits, not credential subjects.
/// Used only by the no-parseable-plan fallback: emitting "http_request needs
/// credentials" tells the user nothing — the connector it drives is the
/// credential subject and gets its own entry.
pub(super) const INFRASTRUCTURE_TOOLS: &[&str] = &[
    "personas_database",
    "database",
    "database_query",
    "db_query",
    "db_write",
    "personas_messages",
    "messaging",
    "personas_vector_db",
    "file_read",
    "file_write",
    "web_search",
    "web_fetch",
    "http_request",
    "data_processing",
    "nlp_parser",
    "ai_generation",
    "date_calculation",
    "notification_sender",
    "text_analysis",
    "data_enrichment",
];

pub(super) fn is_platform_connector(name: &str) -> bool {
    PLATFORM_CONNECTORS
        .iter()
        .any(|c| c.eq_ignore_ascii_case(name))
}

/// True when this backend — not the model — recognises the entry as an
/// in-process platform built-in.
pub(super) fn is_platform_builtin(tool_name: &str, connector: Option<&str>) -> bool {
    PLATFORM_BUILTIN_TOOLS
        .iter()
        .any(|t| t.eq_ignore_ascii_case(tool_name))
        || connector.is_some_and(is_platform_connector)
}

/// Did the model assert `cli_native` on this entry?
///
/// Fail closed on shape: a non-boolean value (`"true"`, `1`) is still the
/// model asserting the field, and must not fall through to the benign
/// empty-curl `skipped` branch as if the key were absent.
fn claims_cli_native(entry: &serde_json::Value) -> bool {
    match entry.get("cli_native") {
        None | Some(serde_json::Value::Null) => false,
        Some(serde_json::Value::Bool(b)) => *b,
        Some(_) => true,
    }
}

/// How one `test_plan` entry is to be counted — decided before any call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum EntryClass {
    /// Backend-recognised in-process built-in. Counts as `passed`.
    PlatformBuiltin,
    /// The model claimed `cli_native` for something this backend does not
    /// recognise as a built-in. Counted `unverified`; holds promotion.
    ClaimedCliNative,
    /// Empty curl with no `cli_native` claim — the prompt's §4 "non-testable"
    /// case. Counted `skipped`; non-blocking, by decision.
    NotTestable,
    /// Carries a curl command — execute it and take the real verdict.
    Executable,
}

/// The promote-gate decision table, as one pure function.
pub(super) fn classify_test_entry(entry: &serde_json::Value) -> EntryClass {
    let tool_name = entry
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    let connector = entry.get("connector").and_then(|v| v.as_str());

    if is_platform_builtin(tool_name, connector) {
        return EntryClass::PlatformBuiltin;
    }
    if claims_cli_native(entry) {
        return EntryClass::ClaimedCliNative;
    }
    if entry
        .get("curl")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .is_empty()
    {
        return EntryClass::NotTestable;
    }
    EntryClass::Executable
}

/// One line of "we counted this but never called it", carried in the report so
/// the hold the promote gate raises names something the user can act on.
fn unverified_reason(tool_name: &str, connector: Option<&str>, reason: &str) -> serde_json::Value {
    serde_json::json!({
        "tool_name": tool_name,
        "connector": connector,
        "reason": reason,
    })
}

// =============================================================================
// run_tool_tests -- LLM-driven real API testing for build drafts
// =============================================================================

/// Test an agent draft by having the LLM compose test curl commands for each
/// tool, then executing them against real APIs with resolved credentials.
///
/// Flow:
/// 1. Resolve credentials for the agent's connectors → get env var names
/// 2. Spawn a CLI process with a test-specific prompt containing the agent_ir
///    tools and available credential env var names
/// 3. CLI outputs a `test_plan` JSON with curl commands per tool
/// 4. Backend executes each curl command with real credential values
/// 5. Emits per-tool result events and returns aggregate report
pub async fn run_tool_tests(
    pool: &DbPool,
    app: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    agent_ir: &crate::db::models::AgentIr,
) -> Result<serde_json::Value, AppError> {
    // Tools may live in two places in the v3 IR:
    //   - top-level `agent_ir.tools[]`              (legacy + structured form)
    //   - per-UC `useCases[i].tool_hints: Vec<String>` (v3 advisory form)
    //
    // The build prompt encourages tool_hints; many builds produce IRs with
    // an empty top-level tools array but populated per-UC hints. The test
    // runner used to bail out with `tools_tested: 0` in that case (the
    // user saw a "report empty" gap). Backfill: union the two, dedup by
    // name, treat per-UC hints as `AgentIrTool::Simple(name)` so they
    // flow through `tool_def_from_ir` like any other tool.
    use crate::db::models::agent_ir::{AgentIrTool, AgentIrUseCase};
    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut tools: Vec<AgentIrTool> = Vec::new();
    for t in &agent_ir.tools {
        let name = t.name().to_string();
        if name.is_empty() || !seen.insert(name) {
            continue;
        }
        tools.push(t.clone());
    }
    for uc in &agent_ir.use_cases {
        if let AgentIrUseCase::Structured(d) = uc {
            if let Some(hints) = &d.tool_hints {
                for h in hints {
                    let name = h.trim().to_string();
                    if name.is_empty() || !seen.insert(name.clone()) {
                        continue;
                    }
                    tools.push(AgentIrTool::Simple(name));
                }
            }
        }
    }

    if tools.is_empty() {
        return Ok(empty_tool_report());
    }

    let persona_name = agent_ir.name.as_deref().unwrap_or("draft-agent");

    // Step 1: Resolve credentials to get env var names + values
    let tool_defs: Vec<_> = tools
        .iter()
        .filter_map(tool_runner::tool_def_from_ir)
        .collect();

    let (mut env_vars, mut hints, cred_failures, mut injected_connectors, _cred_ids) =
        engine_runner::resolve_credential_env_vars(pool, &tool_defs, persona_id, persona_name)
            .await;

    // 2026-05-04 — Connector-driven injection pass.
    //
    // The tool-driven resolution above only injects credentials when an
    // `agent_ir.tools[*].requires_credential_type` matches a vault entry.
    // Connectors that ride on generic tools (e.g. `google_calendar` used
    // via `http_request`) get missed — at build-test time the CLI then
    // sees `cred_context` with no Google env vars and the test for the
    // calendar connector reports it as unavailable, even though the
    // user authed Google Calendar yesterday.
    //
    // Mirrors the runtime `inject_design_context_credentials` pass: walk
    // `agent_ir.required_connectors`, inject anything we didn't already
    // cover, with the OAuth refresh path running for credentials that
    // store a refresh_token.
    for ir_conn in &agent_ir.required_connectors {
        let Some(name) = ir_conn.name() else {
            continue;
        };
        let name_lower = name.to_lowercase();
        if injected_connectors
            .iter()
            .any(|n| n.to_lowercase() == name_lower)
        {
            continue;
        }
        // Prefer the catalog connector definition (so `connector.label`
        // matches the user-visible name) but fall back to direct
        // service_type credential lookup when the connector isn't in the
        // catalog yet.
        let connectors = crate::db::repos::resources::connectors::get_all(pool).unwrap_or_default();
        let conn_def = connectors
            .iter()
            .find(|c| c.name.eq_ignore_ascii_case(name));
        let injected = if let Some(conn) = conn_def {
            engine_runner::inject_connector_credentials(
                pool,
                conn,
                &mut env_vars,
                &mut hints,
                persona_id,
                persona_name,
            )
            .await
            .map(|cred_id| cred_id.is_some())
            .unwrap_or(false)
        } else {
            match crate::db::repos::resources::credentials::get_by_service_type(pool, name) {
                Ok(creds) => {
                    if let Some(cred) = creds.first() {
                        engine_runner::inject_credential(
                            pool,
                            cred,
                            name,
                            name,
                            &mut env_vars,
                            &mut hints,
                            persona_id,
                            persona_name,
                        )
                        .await
                        .is_ok()
                    } else {
                        false
                    }
                }
                Err(_) => false,
            }
        };
        if injected {
            injected_connectors.push(name.to_string());
        }
    }

    // Query ALL credential service types from vault so the LLM can match intelligently
    let all_vault_types =
        crate::db::repos::resources::credentials::get_distinct_service_types(pool)
            .unwrap_or_default();

    let cred_context = {
        let mut ctx = String::new();
        if !hints.is_empty() {
            ctx.push_str("Resolved credential env vars:\n");
            for h in &hints {
                ctx.push_str(&format!("  {h}\n"));
            }
        }
        if !cred_failures.is_empty() {
            ctx.push_str(&format!(
                "\nFailed to auto-resolve credentials for: {}\n",
                cred_failures.join(", ")
            ));
        }
        if !all_vault_types.is_empty() {
            let mut sorted: Vec<_> = all_vault_types.iter().cloned().collect();
            sorted.sort();
            ctx.push_str("\nAll credential service types available in vault:\n");
            for t in &sorted {
                // Derive the env var prefix the system would use
                let prefix = t.to_uppercase().replace('-', "_");
                ctx.push_str(&format!("  {t} (env prefix: {prefix}_)\n"));
            }
            ctx.push_str("\nIMPORTANT: If a tool needs a credential that wasn't auto-resolved above, check if any vault service type matches semantically (e.g. 'github' matches a GitHub PAT, 'alpha_vantage' matches an Alpha Vantage API key). Use the env prefix format ${PREFIX_API_KEY} or ${PREFIX_TOKEN} for the matching vault entry.\n");
        }
        if ctx.is_empty() {
            ctx = "No credentials found in vault. Tools requiring auth will fail.".to_string();
        }
        ctx
    };

    // Phase 4 — scripted deterministic connector tool-tests (env-gated:
    // PERSONAS_SCRIPTED_TOOL_TESTS=1). Instead of the two LLM calls below (a
    // ~50s plan-generation + a ~50s summary), run each bound connector's
    // DECLARED healthcheck directly, in parallel via run_lanes — faster, cheaper,
    // non-flaky, and semantically the correct read-only test. Falls through to
    // the LLM path when disabled, so the default is untouched.
    // NOTE: win-verification is deferred to a connector fixture (web-research-desk
    // with Airtable/Notion) — native-only builds have no connectors to script.
    if std::env::var("PERSONAS_SCRIPTED_TOOL_TESTS")
        .ok()
        .as_deref()
        == Some("1")
    {
        return run_scripted_connector_tests(pool, agent_ir).await;
    }

    // Step 2: Build test prompt for the CLI
    let tools_json = serde_json::to_string_pretty(&tools).unwrap_or_default();
    // The connector list is what actually needs credentials — generic tools
    // like `http_request` are conduits. Pass both so the CLI can generate
    // one test entry per connector regardless of how many tools the persona
    // declares.
    let connectors_json = serde_json::to_string_pretty(&agent_ir.required_connectors)
        .unwrap_or_else(|_| "[]".to_string());
    let test_prompt = build_test_prompt(&tools_json, &connectors_json, &cred_context);

    // Step 3: Spawn CLI and get test plan
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(TEST_PLAN_MODEL.to_string());

    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "build-test")
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn test CLI: {e}")))?;

    if let Err(e) = driver.write_stdin_line(test_prompt.as_bytes()).await {
        let _ = driver.kill().await;
        return Err(AppError::Execution(format!(
            "Failed to write test prompt: {e}"
        )));
    }
    driver.close_stdin().await;

    // Read CLI output and extract test_plan
    let mut raw_output = String::new();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    // Book this leg in `dev_llm_spend` — the one-shot
                    // test/fix-pass path used to be entirely unmetered while
                    // running up to MAX_TEST_RETRIES real LLM passes. No-op for
                    // every line that is not a `result` envelope.
                    super::events::record_build_spend(
                        pool,
                        Some(persona_id),
                        super::events::SPEND_TOOL_TEST,
                        Some(TEST_PLAN_MODEL),
                        &line,
                    );
                    raw_output.push_str(&line);
                    raw_output.push('\n');
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Parse test_plan from CLI output (may be wrapped in stream-json envelope)
    let test_plan = extract_test_plan(&raw_output);

    // Build a set of resolved credential connector names for validation
    let resolved_cred_names: std::collections::HashSet<String> = env_vars
        .iter()
        .filter_map(|(k, _)| {
            // Env var names are like NOTION_API_KEY → extract prefix "notion"
            k.split('_').next().map(|p| p.to_lowercase())
        })
        .collect();

    // Build connector resolution list for the report so the frontend can show
    // which connectors were matched to user credentials.
    // Check three sources: resolved env vars, credential hints, AND vault service types.
    let vault_types_lower: std::collections::HashSet<String> =
        all_vault_types.iter().map(|t| t.to_lowercase()).collect();
    let connectors_resolved: Vec<serde_json::Value> = {
        let names: Vec<String> = agent_ir
            .required_connectors
            .iter()
            .filter_map(|c| c.name().map(|n| n.to_string()))
            .collect();
        names.iter()
            .filter(|name| !is_platform_connector(name))
            .map(|name| {
                let name_lower = name.to_lowercase();
                let matched = resolved_cred_names.contains(&name_lower)
                    || resolved_cred_names.iter().any(|cred| name_lower.contains(cred.as_str()) || cred.contains(&name_lower))
                    || hints.iter().any(|h| h.to_lowercase().contains(&name_lower))
                    // Also match against vault service types (covers connectors not matched
                    // by tool name, e.g. alpha_vantage credential for http_request tool)
                    || vault_types_lower.contains(&name_lower)
                    || vault_types_lower.iter().any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower));
                serde_json::json!({
                    "name": name,
                    "has_credential": matched,
                })
            }).collect()
    };

    let total = test_plan.len();
    if total == 0 {
        tracing::warn!(
            session_id = %session_id,
            "CLI returned no test_plan entries, falling back to credential check"
        );
        // Fallback strategy:
        //   • Generic infrastructure tools (http_request, web_search, file_read,
        //     …) never need credentials themselves — their credentials live on
        //     the connectors they target. Iterating tools here would produce
        //     meaningless "http_request needs credentials" messages that don't
        //     tell the user which external service is missing.
        //   • The right level of granularity is `agent_ir.required_connectors`
        //     — one result entry per connector, each carrying the connector
        //     name so the UI can surface "Alpha Vantage needs credentials"
        //     instead of "http_request needs credentials".
        let tool_names: Vec<String> = tools
            .iter()
            .map(|t| t.name().to_string())
            .filter(|n| !n.is_empty())
            .collect();

        // Decision-table row 4: a connector whose name merely SHARES A
        // SUBSTRING with a vault service type used to be stamped
        // "Credential available — connector verified" and counted as a pass.
        // Resolve the (fuzzy, unchanged) match here; `build_no_plan_fallback`
        // decides what it is worth — which is now `unverified`, not a pass.
        let connectors: Vec<(String, bool)> = agent_ir
            .required_connectors
            .iter()
            .filter_map(|c| c.name().map(|n| n.to_string()))
            .map(|cname| {
                let name_lower = cname.to_lowercase();
                let has_cred = resolved_cred_names.contains(&name_lower)
                    || resolved_cred_names.iter().any(|cred| {
                        name_lower.contains(cred.as_str()) || cred.contains(&name_lower)
                    })
                    || hints.iter().any(|h| h.to_lowercase().contains(&name_lower))
                    || vault_types_lower.contains(&name_lower)
                    || vault_types_lower
                        .iter()
                        .any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower));
                (cname, has_cred)
            })
            .collect();

        let mut report = build_no_plan_fallback(&tool_names, &connectors);
        if let Some(obj) = report.as_object_mut() {
            obj.insert(
                "connectors_resolved".to_string(),
                serde_json::Value::Array(connectors_resolved),
            );
        }
        return Ok(report);
    }

    // Step 4: Execute each test curl command with real credentials
    let env_map: std::collections::HashMap<&str, &str> = env_vars
        .iter()
        .map(|(k, v)| (k.as_str(), v.as_str()))
        .collect();

    let mut tally = ToolTestTally::default();

    for (idx, entry) in test_plan.iter().enumerate() {
        let tool_name = entry
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let curl_cmd = entry.get("curl").and_then(|v| v.as_str()).unwrap_or("");

        tracing::info!(
            session_id = %session_id,
            tool = %tool_name,
            "Executing test {}/{}",
            idx + 1,
            total
        );

        // The decision table (top of file), applied. `record_planned_entry`
        // is pure and returns `None` only for entries that must actually be
        // executed — which is the one thing this loop does that a test can't.
        let result = match tally.record_planned_entry(entry) {
            Some(r) => r,
            None => {
                let connector = entry
                    .get("connector")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                // Self-hosted connectors (LightTrack, Langfuse, LangSmith)
                // legitimately point at localhost/LAN; every other connector
                // gets the SSRF check. Same metadata flag the API proxy reads.
                let allow_private = tool_runner::connector_allows_private_network_by_name(
                    pool,
                    connector.as_deref(),
                );
                let r = tool_runner::execute_test_curl(curl_cmd, &env_map, allow_private).await;
                tally.record_executed(tool_name, connector, r)
            }
        };

        let result_json = serde_json::json!({
            "tool_name": result.tool_name,
            "status": result.status,
            "http_status": result.http_status,
            "latency_ms": result.latency_ms,
            "error": result.error,
            "connector": result.connector,
            "output_preview": result.output_preview,
        });

        // Emit per-tool result event
        let _ = app.emit(
            event_name::BUILD_TEST_TOOL_RESULT,
            serde_json::json!({
                "session_id": session_id,
                "tool_name": result.tool_name,
                "status": result.status,
                "http_status": result.http_status,
                "latency_ms": result.latency_ms,
                "error": result.error,
                "connector": result.connector,
                "tested": idx + 1,
                "total": total,
            }),
        );

        tally.results.push(result_json);
    }

    // Step 5: Generate human-friendly summary via CLI
    let results_json = serde_json::to_string_pretty(&tally.results).unwrap_or_default();
    let summary = generate_test_summary(
        pool,
        persona_id,
        &results_json,
        persona_name,
        tally.passed,
        tally.failed,
        tally.skipped,
        tally.unverified,
    )
    .await
    .unwrap_or_else(|_| build_fallback_summary(&tally));

    let mut report = tally.into_report();
    if let Some(obj) = report.as_object_mut() {
        obj.insert(
            "connectors_resolved".to_string(),
            serde_json::Value::Array(connectors_resolved),
        );
        obj.insert("summary".to_string(), serde_json::Value::String(summary));
    }
    Ok(report)
}

/// Running totals for one `run_tool_tests` pass.
///
/// Extracted so the promote-gate decision table is exercised by tests rather
/// than only by a live build: every counting decision that does NOT require a
/// network call happens in [`ToolTestTally::record_planned_entry`], which is
/// pure. The async loop above is left as a thin driver over it.
#[derive(Debug, Default)]
pub(super) struct ToolTestTally {
    pub results: Vec<serde_json::Value>,
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub unverified: usize,
    pub unverified_reasons: Vec<serde_json::Value>,
    pub credential_issues: Vec<serde_json::Value>,
}

impl ToolTestTally {
    /// Count one `test_plan` entry that can be decided without making a call.
    ///
    /// Returns `None` when the entry carries a real curl command — the caller
    /// must execute it and feed the verdict back through
    /// [`Self::record_executed`].
    pub(super) fn record_planned_entry(
        &mut self,
        entry: &serde_json::Value,
    ) -> Option<tool_runner::ToolTestResult> {
        let tool_name = entry
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let connector = entry
            .get("connector")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let description = entry
            .get("description")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        match classify_test_entry(entry) {
            EntryClass::Executable => None,

            EntryClass::PlatformBuiltin => {
                // Built-in platform tools are reported available rather than
                // executed: there is no live call here, so the preview must not
                // imply verification. Claiming "tested against live data" for a
                // DB/messaging tool that was never run is a trust-destroying
                // false green (UAT 2026-07-20: "a checkmark that means nothing
                // is worse than no checkmark"). These DO count toward `passed`
                // — the recognition is this backend's own, from a fixed
                // allow-list, and there is no external service or user
                // credential behind them.
                self.passed += 1;
                Some(tool_runner::ToolTestResult {
                    tool_name: tool_name.to_string(),
                    status: "passed".to_string(),
                    http_status: None,
                    latency_ms: 0,
                    error: None,
                    connector,
                    output_preview: Some(format!(
                        "{description} — available at runtime, not executed in this test"
                    )),
                })
            }

            EntryClass::ClaimedCliNative => {
                // Decision-table row 3. The model asserted `cli_native: true`
                // for something this backend does not recognise as a platform
                // built-in. No call was made, so there is nothing to report as
                // a pass — it is `unverified`, and unverified holds promotion.
                self.unverified += 1;
                self.unverified_reasons.push(unverified_reason(
                    tool_name,
                    connector.as_deref(),
                    "The build model marked this tool as CLI-native, so no call was made against it. Nothing was executed, so it could not be verified.",
                ));
                Some(tool_runner::ToolTestResult {
                    tool_name: tool_name.to_string(),
                    status: STATUS_UNVERIFIED.to_string(),
                    http_status: None,
                    latency_ms: 0,
                    error: Some(
                        "Reported as CLI-native by the build model — no call was made, so this tool is unverified.".to_string(),
                    ),
                    connector,
                    output_preview: None,
                })
            }

            EntryClass::NotTestable => {
                // Decision-table row 2. The test prompt explicitly invites
                // these (§4 "Non-testable → emit an entry with empty curl"),
                // so they stay non-blocking by decision.
                self.skipped += 1;
                Some(tool_runner::ToolTestResult {
                    tool_name: tool_name.to_string(),
                    status: "skipped".to_string(),
                    http_status: None,
                    latency_ms: 0,
                    error: Some(if description.is_empty() {
                        "No curl command generated".to_string()
                    } else {
                        description
                    }),
                    connector,
                    output_preview: None,
                })
            }
        }
    }

    /// Count the verdict of a curl that actually ran.
    pub(super) fn record_executed(
        &mut self,
        tool_name: &str,
        connector: Option<String>,
        r: tool_runner::ToolTestResult,
    ) -> tool_runner::ToolTestResult {
        match r.status.as_str() {
            "passed" => self.passed += 1,
            "credential_missing" => {
                self.failed += 1;
                self.credential_issues.push(serde_json::json!({
                    "connector": connector,
                    "issue": r.error,
                }));
            }
            _ => self.failed += 1,
        }
        tool_runner::ToolTestResult {
            tool_name: tool_name.to_string(),
            connector,
            ..r
        }
    }

    pub(super) fn into_report(self) -> serde_json::Value {
        serde_json::json!({
            "results": self.results,
            "tools_tested": self.passed + self.failed,
            "tools_passed": self.passed,
            "tools_failed": self.failed,
            "tools_skipped": self.skipped,
            "tools_unverified": self.unverified,
            "unverified_reasons": self.unverified_reasons,
            "credential_issues": self.credential_issues,
        })
    }
}

/// The report a persona with no tools at all produces.
///
/// Decision-table row 1: there is nothing to exercise, so an empty report is
/// an honest pass rather than a fail-open. Kept as its own constructor so the
/// test that names this carve-out as intentional
/// (`zero_tool_persona_report_promotes`) runs against the real shape.
pub(super) fn empty_tool_report() -> serde_json::Value {
    ToolTestTally::default().into_report()
}

/// Build the report for the no-parseable-plan fallback.
///
/// Pure by construction — the caller does the vault lookups and hands in, per
/// connector, whether a credential NAME matched. Decision-table row 4: that
/// fuzzy substring match used to be stamped `"Credential available —
/// connector verified"` and counted as a pass. A vault row sharing a substring
/// with a connector name is not a test, and nothing here executed, so the
/// verdict is `unverified` — and the word "verified" is gone from the copy.
///
/// Infrastructure tools (`http_request`, `web_search`, …) still auto-pass:
/// they own no credential and are conduits to the connectors, which get their
/// own entry. Platform connectors likewise — recognised from this backend's
/// own allow-list, with nothing external behind them.
pub(super) fn build_no_plan_fallback(
    tool_names: &[String],
    connectors: &[(String, bool)],
) -> serde_json::Value {
    let mut tally = ToolTestTally::default();

    for name in tool_names {
        if INFRASTRUCTURE_TOOLS
            .iter()
            .any(|t| t.eq_ignore_ascii_case(name))
        {
            tally.passed += 1;
            tally.results.push(serde_json::json!({
                "tool_name": name,
                "status": "passed",
                "http_status": null,
                "latency_ms": 0,
                "error": null,
                "connector": null,
                "output_preview": "Built-in platform tool — available at runtime, not executed in this test",
            }));
        }
    }

    // One result per connector: the connector name is the credential subject,
    // so the UI can say "Alpha Vantage needs credentials" rather than
    // "http_request needs credentials".
    for (cname, has_cred) in connectors {
        if is_platform_connector(cname) {
            tally.passed += 1;
            tally.results.push(serde_json::json!({
                "tool_name": cname,
                "status": "passed",
                "http_status": null,
                "latency_ms": 0,
                "error": null,
                "connector": cname,
                "output_preview": "Built-in platform connector — available at runtime, not executed in this test",
            }));
        } else if *has_cred {
            tally.unverified += 1;
            tally.unverified_reasons.push(unverified_reason(
                cname,
                Some(cname),
                "A credential in the vault matches this connector's name, but the build model produced no test plan, so no call was made against it.",
            ));
            tally.results.push(serde_json::json!({
                "tool_name": cname,
                "status": STATUS_UNVERIFIED,
                "http_status": null,
                "latency_ms": 0,
                "error": "A matching credential exists, but no call was made against this connector — it is unverified, not verified.",
                "connector": cname,
                "output_preview": null,
            }));
        } else {
            tally.failed += 1;
            tally.credential_issues.push(serde_json::json!({
                "connector": cname,
                "issue": format!("No credential found for connector '{cname}'. Add it in Keys section."),
            }));
            tally.results.push(serde_json::json!({
                "tool_name": cname,
                "status": "credential_missing",
                "http_status": null,
                "latency_ms": 0,
                "error": format!("No credential configured for '{cname}'"),
                "connector": cname,
                "output_preview": null,
            }));
        }
    }

    let mut report = tally.into_report();
    if let Some(obj) = report.as_object_mut() {
        // The build model returned nothing parseable, so this report is the
        // degraded path — surfaced so a hold can say WHY nothing ran.
        obj.insert(
            "test_plan_parsed".to_string(),
            serde_json::Value::Bool(false),
        );
    }
    report
}

/// Ask the CLI to generate a human-friendly summary of test results.
/// Phase 4: run each bound connector's declared healthcheck in parallel and
/// build the same result shape as the LLM/fallback path — no LLM turns. Env-gated
/// by the caller (`PERSONAS_SCRIPTED_TOOL_TESTS=1`).
async fn run_scripted_connector_tests(
    pool: &DbPool,
    agent_ir: &crate::db::models::AgentIr,
) -> Result<serde_json::Value, AppError> {
    use super::orchestrator::{lane, run_lanes, LaneOutcome, LaneTask};

    let connector_names: Vec<String> = agent_ir
        .required_connectors
        .iter()
        .filter_map(|c| c.name().map(|n| n.to_string()))
        .collect();
    if connector_names.is_empty() {
        return Ok(serde_json::json!({
            "results": [], "tools_tested": 0, "tools_passed": 0, "tools_failed": 0,
            "tools_skipped": 0, "tools_unverified": 0, "unverified_reasons": [],
            "credential_issues": [], "connectors_resolved": []
        }));
    }

    // connector -> credential_id (unique-bind resolution, the authoritative link)
    let links = {
        let conn = pool.get()?;
        crate::commands::design::connector_readiness::resolve_credential_links(
            &conn,
            connector_names.iter().map(|s| s.as_str()),
        )
    };

    // One lane per connector: run its healthcheck (or credential_missing).
    let mut tasks: Vec<LaneTask<serde_json::Value>> = Vec::new();
    for cname in &connector_names {
        let cred_id = links.get(cname).cloned();
        let name = cname.clone();
        let pool_c = pool.clone();
        tasks.push(lane(cname.clone(), async move {
            match cred_id {
                None => serde_json::json!({
                    "tool_name": name, "status": "credential_missing", "http_status": null,
                    "latency_ms": 0, "error": format!("No credential bound for connector '{name}'"),
                    "connector": name, "output_preview": null
                }),
                Some(cid) => {
                    let started = std::time::Instant::now();
                    let (status, error, preview) =
                        match super::super::healthcheck::run_healthcheck(&pool_c, &cid).await {
                            Ok(hr) if hr.success => (
                                "passed",
                                serde_json::Value::Null,
                                serde_json::Value::String(hr.message),
                            ),
                            Ok(hr) => (
                                "failed",
                                serde_json::Value::String(hr.message),
                                serde_json::Value::Null,
                            ),
                            Err(e) => (
                                "failed",
                                serde_json::Value::String(e.to_string()),
                                serde_json::Value::Null,
                            ),
                        };
                    serde_json::json!({
                        "tool_name": name, "status": status, "http_status": null,
                        "latency_ms": started.elapsed().as_millis() as u64,
                        "error": error, "connector": name, "output_preview": preview
                    })
                }
            }
        }));
    }

    let mut results = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut credential_issues: Vec<serde_json::Value> = Vec::new();
    for LaneOutcome { lane, result } in run_lanes(3, tasks).await {
        let r = match result {
            Ok(v) => v,
            Err(e) => serde_json::json!({
                "tool_name": lane.clone(), "status": "failed", "http_status": null,
                "latency_ms": 0, "error": e, "connector": lane, "output_preview": null
            }),
        };
        match r.get("status").and_then(|s| s.as_str()) {
            Some("passed") => passed += 1,
            Some("credential_missing") => {
                failed += 1;
                credential_issues.push(serde_json::json!({
                    "connector": r.get("connector").cloned().unwrap_or(serde_json::Value::Null),
                    "issue": r.get("error").cloned().unwrap_or(serde_json::Value::Null),
                }));
            }
            _ => failed += 1,
        }
        results.push(r);
    }

    Ok(serde_json::json!({
        "results": results,
        "tools_tested": passed + failed,
        "tools_passed": passed,
        "tools_failed": failed,
        "tools_skipped": 0usize,
        // Every lane here runs the connector's DECLARED healthcheck, so each
        // result is a real call — there is nothing unverified to report.
        "tools_unverified": 0usize,
        "unverified_reasons": [],
        "credential_issues": credential_issues,
        "connectors_resolved": connector_names,
    }))
}

#[allow(clippy::too_many_arguments)]
async fn generate_test_summary(
    pool: &DbPool,
    persona_id: &str,
    results_json: &str,
    agent_name: &str,
    passed: usize,
    failed: usize,
    skipped: usize,
    unverified: usize,
) -> Result<String, AppError> {
    let prompt = format!(
        r#"You are writing a test report for a non-technical user who just built an AI agent called "{agent_name}".

## Test Results (raw data)
{results_json}

## Stats
- {passed} passed, {failed} failed, {skipped} skipped, {unverified} unverified

## Instructions
Write a structured report in this EXACT markdown format:

### Overview
One paragraph (2-3 sentences) summarizing the overall result in plain, friendly language.

### Results
For EACH tool tested, write exactly one entry:
- **Tool Name** — ✅ One sentence describing what was verified and that it works. OR
- **Tool Name** — ❌ One sentence explaining in plain language what went wrong and how to fix it. OR
- **Tool Name** — ⚠️ One sentence saying nothing was run against it, so it is unverified.

### Next Steps
If all passed: One encouraging sentence.
If some failed: 2-3 bullet points with specific, actionable steps the user should take (e.g., "Go to **Keys** section and refresh your Gmail credentials").
If some are unverified: say that this build will not be promoted automatically until those tools can actually be exercised.

## Rules
- Use ONLY the markdown format above (###, **, -, ✅, ❌)
- Write for a NON-TECHNICAL user — no HTTP codes, no API jargon, no JSON
- A tool with status `unverified` was NEVER CALLED. Never write that it works,
  is available, or was verified — say plainly that nothing was run against it,
  so we cannot tell you whether it works. Use ⚠️ for these, never ✅.
- For credential failures: always mention the **Keys** section
- Keep each tool summary to exactly ONE sentence"#
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(TEST_SUMMARY_MODEL.to_string());

    let mut driver = CliProcessDriver::spawn_temp(&cli_args, "test-summary")
        .map_err(|e| AppError::ProcessSpawn(format!("Failed to spawn summary CLI: {e}")))?;

    if let Err(e) = driver.write_stdin_line(prompt.as_bytes()).await {
        let _ = driver.kill().await;
        return Err(AppError::Execution(format!(
            "Failed to write summary prompt: {e}"
        )));
    }
    driver.close_stdin().await;

    let mut raw_output = String::new();
    if let Some(mut reader) = driver.take_stdout_reader() {
        loop {
            match read_line_limited(&mut reader).await {
                Ok(Some(line)) => {
                    super::events::record_build_spend(
                        pool,
                        Some(persona_id),
                        super::events::SPEND_TEST_SUMMARY,
                        Some(TEST_SUMMARY_MODEL),
                        &line,
                    );
                    raw_output.push_str(&line);
                    raw_output.push('\n');
                }
                Ok(None) => break,
                Err(_) => break,
            }
        }
    }
    let _ = driver.finish().await;

    // Extract plain text from CLI output (unwrap stream-json envelopes)
    let text = extract_llm_text_from_output(&raw_output);
    let cleaned = text.replace("```", "").trim().to_string();

    if cleaned.is_empty() {
        return Err(AppError::Execution("Empty summary from CLI".to_string()));
    }

    Ok(cleaned)
}

/// Build a basic fallback summary when CLI summary generation fails.
fn build_fallback_summary(tally: &ToolTestTally) -> String {
    let ToolTestTally {
        results,
        passed,
        failed,
        skipped,
        unverified,
        ..
    } = tally;
    let (passed, failed, skipped, unverified) = (*passed, *failed, *skipped, *unverified);
    let mut lines = Vec::new();

    if failed == 0 && unverified == 0 && passed > 0 {
        lines.push(format!(
            "All {} tool connections were verified successfully.",
            passed
        ));
    } else if passed == 0 && failed > 0 {
        lines.push(format!(
            "None of the {} tools could connect to their services.",
            failed
        ));
    } else {
        lines.push(format!(
            "{} of {} tools connected successfully, {} had issues.",
            passed,
            passed + failed,
            failed
        ));
    }

    if unverified > 0 {
        lines.push(format!(
            "{unverified} tool(s) were never actually called, so they are unverified — this build won't be promoted automatically until they can be exercised."
        ));
    }

    for r in results {
        let status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
        // Prefer the connector name (e.g. "alpha_vantage") over the tool
        // name (e.g. "http_request") so the user sees which external
        // service is failing, not the generic tool that drove the call.
        let connector = r
            .get("connector")
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty());
        let tool = r
            .get("tool_name")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        let subject = connector.unwrap_or(tool);
        let friendly = subject.replace('_', " ");

        if status == STATUS_UNVERIFIED {
            lines.push(format!(
                "\"{}\" was never called, so we can't tell you whether it works.",
                friendly
            ));
        } else if status == "credential_missing" {
            lines.push(format!(
                "\"{}\" needs credentials — add them in the Keys section.",
                friendly
            ));
        } else if status == "failed" {
            let code = r.get("http_status").and_then(|v| v.as_u64());
            match code {
                Some(401) | Some(403) => {
                    lines.push(format!(
                        "\"{}\" authentication failed — try refreshing credentials in Keys.",
                        friendly
                    ));
                }
                Some(404) => {
                    lines.push(format!(
                        "\"{}\" endpoint not found — the API configuration may need updating.",
                        friendly
                    ));
                }
                _ => {
                    lines.push(format!(
                        "\"{}\" could not connect to the service.",
                        friendly
                    ));
                }
            }
        }
    }

    if skipped > 0 {
        lines.push(format!(
            "{} tools were skipped (read-only verification not available).",
            skipped
        ));
    }

    lines.join(" ")
}

/// Build the test prompt sent to the CLI to generate executable curl commands.
fn build_test_prompt(tools_json: &str, connectors_json: &str, cred_context: &str) -> String {
    format!(
        r#"You are a tool-testing agent. Compose one `test_plan` entry PER CONNECTOR the persona relies on — plus one entry per non-connector tool that might need verification.

## Connectors the persona uses
These are the external services the persona binds to. EVERY connector needs its own test_plan entry so the user sees per-service status.
{connectors_json}

## Tools the persona uses
Generic tools (http_request, web_search, file_read, …) are conduits — they don't own credentials. Do NOT emit a separate "http_request needs credentials" entry; the connectors above are the credential subjects.
{tools_json}

## Credentials
{cred_context}

## Strategy

### 1. Per-connector API test (MUST emit one per external connector)
For each connector in the list above whose category is an external service (not a platform builtin), compose a minimal safe curl. Set `tool_name` to the connector name (same as `connector`), or to the persona tool that drives the call when that's clearer. ALWAYS set `connector` to the connector's `name` so the UI can surface "Alpha Vantage" instead of "http_request".

### 2. CLI-native tools (Claude built-ins, no external API)
Text summarization, reasoning and similar capabilities are powered by the Claude CLI with no endpoint to hit. Mark these with `"cli_native": true` and `"curl": ""`.

`cli_native` is NOT a shortcut and is NOT a pass. It records that nothing was called, and for any name the backend does not itself recognise as a built-in (§3) the entry is counted as **unverified**, which HOLDS the build from being promoted automatically. If the tool talks to an external service, emit a real curl in §1 instead — a `cli_native` claim on something that has an API is a false green and will block the build rather than help it.

### 3. Built-in platform capabilities (recognised by name, always available)
`personas_database` / `database` / `database_query` / `db_query` / `db_write` / `personas_messages` / `messaging` / `personas_vector_db` / `file_read` / `file_write` / `web_search` / `web_fetch` are in-process capabilities with no external service and no user credential behind them. Set `tool_name` (or `connector`) to EXACTLY one of those names and leave `curl` empty; the backend recognises them by name and does not need a `cli_native` claim to accept them. Do not invent `personas_*` names for third-party services — only the names listed here are built-ins.

### 4. Non-testable (write-only or no endpoint)
Tools that only mutate state — emit an entry with empty curl, NO `cli_native` field, and a description explaining the skip. These are recorded as skipped and do not block the build.

## Rules for API tests
1. Use GET endpoints or read-only operations only — NO writes, deletes, or mutations.
2. Minimal params (limit=1, maxResults=1, per_page=1).
3. Use $ENV_VAR placeholders for credential values; match the env prefix of the credential from the list above.
4. Always include `-s` (silent) and `-w '\n%{{http_code}}'` to capture HTTP status.
5. The runner validates every curl against an ALLOWLIST of flags before executing it. Use only: `-s -S -L -f -i -I -G --compressed -H -X -A -u -m --max-time --connect-timeout --retry -d --data --data-raw --data-urlencode -w --url`, plus exactly ONE http/https URL. Anything else (`-o`, `-O`, `-T`, `-K`, `-D`, `-c`, `-b`, `-k`, `-F`, `--trace`, `--proto`, …) is rejected and the test fails before it runs. A `-d`/`--data` value may NOT begin with `@` — curl would read a local file and POST it.

## Output Format
Output EXACTLY one JSON object — a test_plan array. No markdown, no commentary, raw JSON only:
{{"test_plan": [
  {{"tool_name": "alpha_vantage", "connector": "alpha_vantage", "curl": "curl -s 'https://www.alphavantage.co/query?function=MARKET_STATUS&apikey=$ALPHA_VANTAGE_API_KEY' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Alpha Vantage API key via MARKET_STATUS"}},
  {{"tool_name": "gmail", "connector": "gmail", "curl": "curl -s -H 'Authorization: Bearer $GMAIL_ACCESS_TOKEN' 'https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=1' -w '\\n%{{http_code}}'", "cli_native": false, "description": "Verify Gmail API access"}},
  {{"tool_name": "web_search", "connector": null, "curl": "", "cli_native": true, "description": "Uses Claude CLI built-in web search — auto-verified"}},
  {{"tool_name": "messaging", "connector": "personas_messages", "curl": "", "cli_native": true, "description": "Built-in platform connector — auto-verified"}}
]}}

Generate the test_plan now."#
    )
}

/// Extract test_plan entries from CLI output (handles stream-json envelopes).
fn extract_test_plan(raw_output: &str) -> Vec<serde_json::Value> {
    // First try to parse from LLM text content (unwrap envelopes)
    let text_content = extract_llm_text_from_output(raw_output);
    let search_text = if text_content.is_empty() {
        raw_output.to_string()
    } else {
        text_content
    };

    // Look for test_plan JSON object in the text
    // Strategy: find a JSON object containing "test_plan" key
    let cleaned = search_text.replace("```json", "").replace("```", "");

    for line in cleaned.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with('{') {
            continue;
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            if let Some(plan) = val.get("test_plan").and_then(|v| v.as_array()) {
                return plan.clone();
            }
        }
    }

    // Try multi-line parse (test_plan might span multiple lines)
    if let Ok(val) = serde_json::from_str::<serde_json::Value>(&cleaned) {
        if let Some(plan) = val.get("test_plan").and_then(|v| v.as_array()) {
            return plan.clone();
        }
    }

    // Try to find test_plan in any JSON object in the raw output
    for chunk in raw_output.split('\n') {
        let trimmed = chunk.trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            // Check stream-json result envelope
            if let Some(result_text) = val.get("result").and_then(|v| v.as_str()) {
                let inner_cleaned = result_text.replace("```json", "").replace("```", "");
                if let Ok(inner) = serde_json::from_str::<serde_json::Value>(&inner_cleaned) {
                    if let Some(plan) = inner.get("test_plan").and_then(|v| v.as_array()) {
                        return plan.clone();
                    }
                }
            }
            // Check assistant envelope
            if let Some(content) = val
                .get("message")
                .and_then(|m| m.get("content"))
                .and_then(|c| c.as_array())
            {
                for item in content {
                    if let Some(text) = item.get("text").and_then(|t| t.as_str()) {
                        let inner_cleaned = text.replace("```json", "").replace("```", "");
                        if let Ok(inner) = serde_json::from_str::<serde_json::Value>(&inner_cleaned)
                        {
                            if let Some(plan) = inner.get("test_plan").and_then(|v| v.as_array()) {
                                return plan.clone();
                            }
                        }
                    }
                }
            }
        }
    }

    vec![]
}

/// Extract the LLM's text content from raw CLI stream-json output.
/// Prefers the `result` event (final complete output) over `assistant` events
/// (streaming fragments) to avoid duplication.
fn extract_llm_text_from_output(raw: &str) -> String {
    let mut result_text: Option<String> = None;
    let mut assistant_text: Option<String> = None;
    for line in raw.lines() {
        let trimmed = line.trim();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(trimmed) {
            let obj = match val.as_object() {
                Some(o) => o,
                None => continue,
            };
            let etype = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");
            match etype {
                "assistant" => {
                    if let Some(text) = obj
                        .get("message")
                        .and_then(|m| m.get("content"))
                        .and_then(|c| c.as_array())
                        .and_then(|arr| {
                            arr.iter()
                                .find(|i| i.get("type").and_then(|t| t.as_str()) == Some("text"))
                                .and_then(|i| i.get("text").and_then(|t| t.as_str()))
                        })
                    {
                        assistant_text = Some(text.to_string());
                    }
                }
                "result" => {
                    if let Some(text) = obj.get("result").and_then(|v| v.as_str()) {
                        result_text = Some(text.to_string());
                    }
                }
                _ => {}
            }
        }
    }
    // Prefer result (complete output) over assistant (may be partial/duplicate)
    result_text.or(assistant_text).unwrap_or_default()
}

// =============================================================================
// Tests
// =============================================================================
//
// The promote-gate consequences of this file live in `oneshot.rs`'s test
// module (the four decision-table rows). What is covered here is the
// classification itself and the plan extraction that feeds it.
//
// Run with: node scripts/build/run-rust-tests.mjs -- build_session

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // ── classify_test_entry ──────────────────────────────────────────────

    #[test]
    fn a_real_curl_is_executable() {
        assert_eq!(
            classify_test_entry(&json!({
                "tool_name": "alpha_vantage",
                "connector": "alpha_vantage",
                "curl": "curl -s 'https://example.test/ping'",
            })),
            EntryClass::Executable
        );
    }

    #[test]
    fn platform_builtins_are_recognised_by_this_backend_not_the_model() {
        for name in PLATFORM_BUILTIN_TOOLS {
            assert_eq!(
                classify_test_entry(&json!({ "tool_name": name, "curl": "" })),
                EntryClass::PlatformBuiltin,
                "{name} is on the backend's own allow-list"
            );
        }
        // …and via the connector field, matched EXACTLY.
        assert_eq!(
            classify_test_entry(&json!({
                "tool_name": "notify", "connector": "personas_messages", "curl": ""
            })),
            EntryClass::PlatformBuiltin
        );
    }

    #[test]
    fn a_model_invented_personas_connector_cannot_mint_itself_a_pass() {
        // The old test was `connector.starts_with("personas_")`, so the model
        // could name a third-party service `personas_gmail` and auto-pass it.
        assert_eq!(
            classify_test_entry(&json!({
                "tool_name": "gmail", "connector": "personas_gmail",
                "curl": "", "cli_native": true
            })),
            EntryClass::ClaimedCliNative
        );
    }

    #[test]
    fn cli_native_on_a_non_builtin_is_an_unverified_claim() {
        // A real external service with a live endpoint and the user's
        // credential behind it, which the model simply declared it did not
        // need to call. This is the false green the direction removes.
        assert_eq!(
            classify_test_entry(&json!({
                "tool_name": "gmail", "connector": "gmail", "curl": "", "cli_native": true
            })),
            EntryClass::ClaimedCliNative
        );
    }

    /// `web_search` / `web_fetch` are on `PLATFORM_BUILTIN_TOOLS` DELIBERATELY,
    /// not incidentally. They are Claude CLI built-ins: no external service, no
    /// credential to resolve, nothing a curl could exercise. Holding them would
    /// be a false HOLD — the mirror of the false green — on the case the test
    /// prompt itself names, and a gate that stops honest builds gets muted.
    ///
    /// The safety property survives because this list is CODE: the model cannot
    /// add to it, for the same reason `personas_gmail` can no longer mint itself
    /// a pass. What it must never become is a general amnesty for `cli_native`.
    #[test]
    fn claude_cli_builtins_are_on_the_allow_list_on_purpose() {
        for name in ["web_search", "web_fetch"] {
            assert!(
                PLATFORM_BUILTIN_TOOLS.contains(&name),
                "{name} must stay a code-authored built-in"
            );
            assert_eq!(
                classify_test_entry(&json!({
                    "tool_name": name, "curl": "", "cli_native": true
                })),
                EntryClass::PlatformBuiltin,
                "{name} is recognised by this backend, so the model's claim is not what carries it"
            );
        }
        // The allow-list is not a general amnesty: an unrecognised name with
        // the same `cli_native` claim still holds.
        assert_eq!(
            classify_test_entry(&json!({
                "tool_name": "web_scrape_pro", "curl": "", "cli_native": true
            })),
            EntryClass::ClaimedCliNative
        );
    }

    #[test]
    fn a_non_boolean_cli_native_still_counts_as_a_claim() {
        // Fail closed on shape: `"true"` / `1` must not fall through to the
        // benign `skipped` branch as if the key were absent.
        for weird in [json!("true"), json!(1), json!("yes"), json!({})] {
            assert_eq!(
                classify_test_entry(&json!({
                    "tool_name": "gmail", "curl": "", "cli_native": weird
                })),
                EntryClass::ClaimedCliNative,
                "cli_native={weird} is still the model asserting the field"
            );
        }
        // An explicit false, or a null, is not a claim.
        for benign in [json!(false), json!(null)] {
            assert_eq!(
                classify_test_entry(&json!({
                    "tool_name": "gmail", "curl": "", "cli_native": benign
                })),
                EntryClass::NotTestable,
                "cli_native={benign} is not a claim"
            );
        }
    }

    #[test]
    fn empty_curl_without_a_claim_is_merely_not_testable() {
        assert_eq!(
            classify_test_entry(&json!({
                "tool_name": "crm_create_lead",
                "connector": "salesforce",
                "curl": "",
                "description": "Write-only",
            })),
            EntryClass::NotTestable
        );
    }

    // ── the no-plan fallback ─────────────────────────────────────────────

    #[test]
    fn fallback_still_fails_a_connector_with_no_credential() {
        let report = build_no_plan_fallback(&[], &[("gmail".to_string(), false)]);
        assert_eq!(report["tools_failed"], json!(1));
        assert_eq!(report["tools_unverified"], json!(0));
        assert_eq!(report["results"][0]["status"], json!("credential_missing"));
        assert_eq!(
            report["credential_issues"].as_array().map(|a| a.len()),
            Some(1)
        );
    }

    #[test]
    fn fallback_keeps_platform_connectors_and_infrastructure_tools_passing() {
        let report = build_no_plan_fallback(
            &["http_request".to_string(), "web_search".to_string()],
            &[("personas_database".to_string(), false)],
        );
        assert_eq!(report["tools_passed"], json!(3));
        assert_eq!(report["tools_failed"], json!(0));
        assert_eq!(report["tools_unverified"], json!(0));
    }

    #[test]
    fn fallback_never_calls_an_unexercised_connector_verified() {
        let report = build_no_plan_fallback(&[], &[("notion".to_string(), true)]);
        let text = serde_json::to_string(&report).unwrap();
        assert!(
            !text.contains("Credential available") && !text.contains("connector verified"),
            "the old 'Credential available — connector verified' copy is a lie: {text}"
        );
        assert_eq!(report["results"][0]["status"], json!(STATUS_UNVERIFIED));
        assert_eq!(report["tools_passed"], json!(0));
    }

    // ── the report shape the promote gate depends on ─────────────────────

    #[test]
    fn every_report_shape_carries_the_fields_the_promote_gate_requires() {
        // `evaluate_promote_gate` HOLDS on a report missing either counter, so
        // a producer that forgets one stops every build. Pin all the shapes
        // this module can return that are reachable without a DB.
        for (label, report) in [
            ("zero tools", empty_tool_report()),
            (
                "no-plan fallback",
                build_no_plan_fallback(&["http_request".to_string()], &[]),
            ),
            ("executed plan", ToolTestTally::default().into_report()),
        ] {
            for field in ["tools_failed", "tools_unverified", "tools_passed"] {
                assert!(
                    report.get(field).and_then(|v| v.as_u64()).is_some(),
                    "{label} report is missing a whole-number `{field}`: {report}"
                );
            }
        }
    }

    // ── extract_test_plan ────────────────────────────────────────────────

    #[test]
    fn extracts_a_plan_from_a_stream_json_result_envelope() {
        let raw = r#"{"type":"system","subtype":"init"}
{"type":"result","result":"{\"test_plan\":[{\"tool_name\":\"gmail\",\"curl\":\"curl -s x\"}]}"}
"#;
        let plan = extract_test_plan(raw);
        assert_eq!(plan.len(), 1);
        assert_eq!(plan[0]["tool_name"], json!("gmail"));
    }

    #[test]
    fn extracts_a_pretty_printed_multi_line_plan() {
        let raw = "{\"type\":\"result\",\"result\":\"```json\\n{\\n  \\\"test_plan\\\": [\\n    {\\\"tool_name\\\": \\\"notion\\\", \\\"curl\\\": \\\"curl -s y\\\"}\\n  ]\\n}\\n```\"}\n";
        let plan = extract_test_plan(raw);
        assert_eq!(plan.len(), 1, "multi-line plans must still parse");
        assert_eq!(plan[0]["tool_name"], json!("notion"));
    }

    #[test]
    fn an_unparseable_response_yields_no_plan_which_routes_to_the_fallback() {
        assert!(extract_test_plan("I could not compose a plan, sorry.").is_empty());
    }
}
