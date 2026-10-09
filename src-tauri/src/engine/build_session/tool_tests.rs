//! `run_tool_tests` — the connector test runner used right before promote.
//!
//! The build flow hands this module an `AgentIr` and a set of resolved
//! credentials. Every connector that can be checked without a model is
//! checked by its own declared healthcheck, in parallel lanes; only what
//! cannot be scripted goes to a scratch Claude CLI that composes curl
//! commands, which are then invoked against real APIs. The module returns a
//! report (and a plain-language summary) the UI renders as the test-result
//! panel. See "Strategy" below for the routing table.
//!
//! Pure side-effect-free execution against the draft — no DB writes, no
//! persona events fired. The promote pipeline happens in a separate command
//! once the user approves the test results.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use futures_util::future::BoxFuture;
use tauri::Emitter;

use crate::db::DbPool;
use crate::error::AppError;

use super::super::cli_process::{read_line_limited, CliProcessDriver};
use super::super::event_registry::event_name;
// Aliased to avoid colliding with the sibling `build_session::runner`
// submodule (which holds `run_session`, not the persona-execution runner).
use super::super::runner as engine_runner;
use super::super::tool_runner;

/// Call class of the test-plan composition leg. Model and effort come from
/// the class table (`personas_core::model_class`); the same route reaches
/// both the CLI `--model` flag and the `dev_llm_spend` ledger row (the
/// ledger's model is only a fallback — the CLI's own `result` envelope wins —
/// but the two must not be allowed to drift).
const TEST_PLAN_CLASS: personas_core::model_class::CallClass =
    personas_core::model_class::CallClass::Build;

/// Call class of the plain-language test-report leg: this pass only rewrites
/// an already-computed report for a non-technical reader. Model and effort
/// come from the class table (`personas_core::model_class`); the same route
/// reaches both the CLI flags and the `dev_llm_spend` row. No escalation —
/// a failed summary already falls back to `build_fallback_summary`.
const TEST_SUMMARY_CLASS: personas_core::model_class::CallClass =
    personas_core::model_class::CallClass::Summarize;

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
// Strategy: scripted first, the LLM only for what cannot be scripted
// =============================================================================
//
// Until 2026-09-25 every test ran three serial steps: a Sonnet call composed a
// curl plan (~50 s), each curl ran one after another, then a Haiku call wrote
// the summary (~50 s). A parallel scripted path existed but only behind
// `PERSONAS_SCRIPTED_TOOL_TESTS=1`, and it was not safe to turn on as it stood:
//
//   * it counted an `Unverifiable` healthcheck (a connector with no probe at
//     all, which `HealthcheckResult::unverifiable` reports as `success: true`)
//     as `passed`: the exact false green the decision table above removes;
//   * any connector without a uniquely bound vault credential, INCLUDING
//     platform connectors (`personas_messages`) and ZeroConfig / GlobalProbe
//     ones, came back `credential_missing`: a false red;
//   * it looked only at `required_connectors` and dropped every tool;
//   * `connectors_resolved` was a list of strings where the frontend
//     (`TestReportModal`'s ConnectorHandshakeCard) reads `{name, has_credential}`;
//   * it emitted no `BUILD_TEST_TOOL_RESULT` events and wrote no `summary`;
//   * it had no per-test timeout of its own.
//
// What runs now, per subject (see `plan_scripted_tests`):
//
//   | subject                                              | how it is decided                |
//   |------------------------------------------------------|----------------------------------|
//   | platform built-in connector / tool (code allow-list) | `passed`, "available at runtime" |
//   | infrastructure conduit tool (`http_request`, …)      | `passed`, as the no-plan fallback|
//   | connector uniquely bound to a vault credential       | its declared healthcheck, 3 lanes|
//   | Credential connector, no vault type matches at all   | `credential_missing`             |
//   | tool backed by a connector listed above              | covered by that connector's row  |
//   |   (declared connector > catalog `services` > prefix; |   (`backing_connector`)          |
//   |   see `backing_connector`)                           |                                  |
//   | anything else, OR a probe that could not run         | the LLM plan, for that subset    |
//
// "Could not run" is: no healthcheck of any kind (`Unverifiable`), an error
// before a verdict (no connector definition, decrypt/OAuth failure), or a
// panicking lane. A probe that RAN and failed (401, 429, 5xx, unreachable,
// timeout) is a real verdict and is reported, never retried through the LLM,
// so no subject is ever tested twice.
//
// `PERSONAS_SCRIPTED_TOOL_TESTS=0` (or `false` / `off` / `no`) forces the old
// all-LLM path; that path is the same code with every subject routed to the
// LLM, so its report is unchanged.

/// Env override. Unset or any other value → scripted-first (the default).
const SCRIPTED_TOOL_TESTS_ENV: &str = "PERSONAS_SCRIPTED_TOOL_TESTS";

/// Concurrent healthcheck lanes. Same budget as the vault's bulk sweep
/// (`HEALTHCHECK_SWEEP_CONCURRENCY`), for the same reason: probes that share
/// an API host must not trip that provider's rate limit.
pub(super) const SCRIPTED_TEST_LANES: usize = 3;

/// Ceiling for one connector's scripted check. The healthcheck's own HTTP
/// client gives up at 10 s (30 s for allow-private connectors); this also
/// bounds the OAuth refresh and CLI probes that can run before the request.
pub(super) const SCRIPTED_TEST_TIMEOUT: Duration = Duration::from_secs(20);

/// Hard ceilings on the two model legs. Their read loops used to wait for EOF
/// with no deadline, so a stalled CLI (network drop, a starved or suspended
/// machine) held the whole test step in `testing` forever: measured live on
/// 2026-09-28, a build sat 15 minutes after its last row. On expiry the CLI is
/// killed and the existing fallbacks take over (the leftover subset degrades,
/// the summary falls back to `build_fallback_summary`).
const TEST_PLAN_TIMEOUT: Duration = Duration::from_secs(240);
const TEST_SUMMARY_TIMEOUT: Duration = Duration::from_secs(120);

/// Shared tail of every "counted but not called" pass preview. The
/// deterministic summary keys on it, so the wording must not drift apart.
const AVAILABLE_AT_RUNTIME: &str = "available at runtime, not executed in this test";

/// `true` unless the override explicitly turns scripted tests off.
pub(super) fn scripted_tool_tests_enabled(raw: Option<&str>) -> bool {
    !matches!(
        raw.map(|s| s.trim().to_ascii_lowercase()).as_deref(),
        Some("0" | "false" | "off" | "no")
    )
}

// =============================================================================
// What a draft asks to be tested
// =============================================================================
//
// Measured 2026-09-28 against the seven drafts of the 2026-09-26 live check:
// NONE carried a top-level `tools[]` or `required_connectors[]`. A build
// draft's `agent_ir` is v3-shaped (`persona.tools[]`, `persona.connectors[]`,
// `use_cases[i].tool_hints[]`); the flat keys are only hoisted by
// `template_v3::normalize_v3_to_flat`, which the test path never runs. So
// this module saw zero connectors on every build: no connector was ever
// probed, `connectors_resolved` was always `[]`, every connector-backed tool
// became an LLM leftover (`hybrid` in 6 of 7 builds), and a draft whose
// connector tools were absent from `tool_hints` (the GitHub + Airtable PR
// reviewer) ran `scripted` with its connectors never tested at all.

/// The subjects one test pass covers.
#[derive(Debug, Default)]
pub(super) struct DraftSubjects {
    pub tools: Vec<crate::db::models::agent_ir::AgentIrTool>,
    pub connectors: Vec<crate::db::models::agent_ir::AgentIrConnector>,
}

/// Read every tool and connector the draft declares, in whichever shape it
/// declares them.
///
/// * Tools: top-level `tools[]` ∪ `persona.tools[]` ∪ every use case's
///   `tool_hints[]`, deduplicated by name (first declaration wins). A
///   `persona.tools[]` object that names its connector (`connector` /
///   `service_type` / `requires_credential_type`) keeps it as
///   `requires_credential_type`, which is what `plan_scripted_tests` reads as
///   the tool's declared connector.
/// * Connectors: top-level `required_connectors[]` when present, else
///   `persona.connectors[]`. Never the union: after adoption,
///   `apply_credential_bindings_to_connectors` rewrites the flat list's role
///   names (`email`) to bound services (`gmail`) while `persona.connectors`
///   keeps the role, so a union would test an unbound role as a second,
///   falsely missing connector.
pub(super) fn draft_test_subjects(agent_ir: &crate::db::models::AgentIr) -> DraftSubjects {
    use crate::db::models::agent_ir::{
        AgentIrConnector, AgentIrTool, AgentIrToolData, AgentIrUseCase,
    };

    let mut out = DraftSubjects::default();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push_tool = |tool: AgentIrTool, out: &mut DraftSubjects| {
        let key = tool.name().trim().to_lowercase();
        if !key.is_empty() && seen.insert(key) {
            out.tools.push(tool);
        }
    };

    for t in &agent_ir.tools {
        push_tool(t.clone(), &mut out);
    }
    let persona_list = |key: &str| -> Vec<serde_json::Value> {
        agent_ir
            .persona
            .as_ref()
            .and_then(|p| p.get(key))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default()
    };
    for raw in persona_list("tools") {
        let tool = match &raw {
            serde_json::Value::String(s) => AgentIrTool::Simple(s.trim().to_string()),
            serde_json::Value::Object(obj) => {
                let Ok(mut data) = serde_json::from_value::<AgentIrToolData>(raw.clone()) else {
                    continue;
                };
                if data.requires_credential_type.is_none() {
                    data.requires_credential_type = ["connector", "service_type"]
                        .iter()
                        .find_map(|k| obj.get(*k).and_then(|v| v.as_str()))
                        .map(|s| s.trim().to_string())
                        .filter(|s| !s.is_empty());
                }
                AgentIrTool::Structured(data)
            }
            _ => continue,
        };
        push_tool(tool, &mut out);
    }
    for uc in &agent_ir.use_cases {
        if let AgentIrUseCase::Structured(d) = uc {
            for h in d.tool_hints.iter().flatten() {
                push_tool(AgentIrTool::Simple(h.trim().to_string()), &mut out);
            }
        }
    }

    let connectors: Vec<AgentIrConnector> = if agent_ir.required_connectors.is_empty() {
        persona_list("connectors")
            .into_iter()
            .filter_map(|v| serde_json::from_value::<AgentIrConnector>(v).ok())
            .collect()
    } else {
        agent_ir.required_connectors.clone()
    };
    let mut seen_conn: HashSet<String> = HashSet::new();
    out.connectors = connectors
        .into_iter()
        .filter(|c| {
            c.name()
                .map(|n| n.trim().to_lowercase())
                .is_some_and(|n| !n.is_empty() && seen_conn.insert(n))
        })
        .collect();
    out
}

// =============================================================================
// run_tool_tests -- real API testing for build drafts
// =============================================================================

/// Test an agent draft against real APIs with the user's resolved credentials.
///
/// Flow:
/// 1. Resolve credentials for the agent's connectors → env var names + values
/// 2. Script every subject that can be scripted (see the table above): run
///    each bound connector's declared healthcheck in parallel lanes
/// 3. For the rest only, spawn a CLI that writes a curl `test_plan`, and run it
/// 4. Emit per-tool result events and return the aggregate report
pub async fn run_tool_tests(
    pool: &DbPool,
    app: &tauri::AppHandle,
    session_id: &str,
    persona_id: &str,
    agent_ir: &crate::db::models::AgentIr,
) -> Result<serde_json::Value, AppError> {
    let DraftSubjects { tools, connectors } = draft_test_subjects(agent_ir);

    // Decision-table row 1 is "the persona has nothing to exercise". A draft
    // that binds connectors but names no tool still has something to test:
    // each connector gets its own health-check row.
    if tools.is_empty() && connectors.is_empty() {
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
    // the draft's connectors (`draft_test_subjects`), inject anything we
    // didn't already cover, with the OAuth refresh path running for
    // credentials that store a refresh_token.
    for ir_conn in &connectors {
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

    let matcher = CredentialMatcher::new(&env_vars, &hints, all_vault_types.iter());
    let scripted =
        scripted_tool_tests_enabled(std::env::var(SCRIPTED_TOOL_TESTS_ENV).ok().as_deref());

    // Production seams. The orchestrator below never touches the CLI or the
    // AppHandle directly, which is what lets its tests drive it end to end.
    let compose_pool = pool.clone();
    let compose_persona = persona_id.to_string();
    let compose_plan =
        move |test_prompt: String| -> BoxFuture<'static, Result<Vec<serde_json::Value>, AppError>> {
            let pool = compose_pool.clone();
            let persona_id = compose_persona.clone();
            Box::pin(
                async move { compose_test_plan_via_cli(&pool, &persona_id, test_prompt).await },
            )
        };
    let summary_pool = pool.clone();
    let summary_persona = persona_id.to_string();
    let summary_agent = persona_name.to_string();
    let write_summary = move |results_json: String,
                              c: SummaryCounts|
          -> BoxFuture<'static, Result<String, AppError>> {
        let pool = summary_pool.clone();
        let persona_id = summary_persona.clone();
        let agent = summary_agent.clone();
        Box::pin(async move {
            generate_test_summary(
                &pool,
                &persona_id,
                &results_json,
                &agent,
                c.passed,
                c.failed,
                c.skipped,
                c.unverified,
            )
            .await
        })
    };
    let emit_app = app.clone();
    let emit_session = session_id.to_string();
    let emit = move |r: &tool_runner::ToolTestResult, tested: usize, total: usize| {
        let _ = emit_app.emit(
            event_name::BUILD_TEST_TOOL_RESULT,
            serde_json::json!({
                "session_id": emit_session,
                "tool_name": r.tool_name,
                "status": r.status,
                "http_status": r.http_status,
                "latency_ms": r.latency_ms,
                "error": r.error,
                "connector": r.connector,
                "tested": tested,
                "total": total,
            }),
        );
    };

    run_resolved_tests(
        pool,
        &ResolvedTestContext {
            session_id,
            tools: &tools,
            required_connectors: &connectors,
            cred_context: &cred_context,
            env_vars: &env_vars,
            matcher: &matcher,
        },
        &TestSeams {
            compose_plan: &compose_plan,
            write_summary: &write_summary,
            emit: &emit,
        },
        TestStrategy {
            scripted,
            lanes: SCRIPTED_TEST_LANES,
            per_test_timeout: SCRIPTED_TEST_TIMEOUT,
        },
    )
    .await
}

/// Spawn the plan-composition CLI and parse its `test_plan`.
async fn compose_test_plan_via_cli(
    pool: &DbPool,
    persona_id: &str,
    test_prompt: String,
) -> Result<Vec<serde_json::Value>, AppError> {
    let route = TEST_PLAN_CLASS.route();
    let cli_args = super::super::cli_process::headless_claude_args(route.model, route.effort, &[]);

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
        let read = tokio::time::timeout(TEST_PLAN_TIMEOUT, async {
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
                            Some(route.model),
                            &line,
                        );
                        raw_output.push_str(&line);
                        raw_output.push('\n');
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        })
        .await;
        if read.is_err() {
            let _ = driver.kill().await;
            return Err(AppError::Execution(format!(
                "Test plan CLI did not finish within {}s",
                TEST_PLAN_TIMEOUT.as_secs()
            )));
        }
    }
    let _ = driver.finish().await;

    // Parse test_plan from CLI output (may be wrapped in stream-json envelope)
    Ok(extract_test_plan(&raw_output))
}

// =============================================================================
// The orchestrator (no AppHandle, no CLI: both arrive as seams)
// =============================================================================

/// Composes a `test_plan` from a prompt. Production: the Sonnet CLI.
pub(super) type ComposePlanFn =
    dyn Fn(String) -> BoxFuture<'static, Result<Vec<serde_json::Value>, AppError>> + Send + Sync;
/// Writes the plain-language report. Production: the Haiku CLI.
pub(super) type WriteSummaryFn =
    dyn Fn(String, SummaryCounts) -> BoxFuture<'static, Result<String, AppError>> + Send + Sync;
/// Reports one finished row: `(result, tested_so_far, expected_total)`.
/// Production: a `BUILD_TEST_TOOL_RESULT` event.
pub(super) type EmitFn = dyn Fn(&tool_runner::ToolTestResult, usize, usize) + Send + Sync;

pub(super) struct TestSeams<'a> {
    pub compose_plan: &'a ComposePlanFn,
    pub write_summary: &'a WriteSummaryFn,
    pub emit: &'a EmitFn,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct TestStrategy {
    /// `false` = the old path: every subject goes to the LLM plan.
    pub scripted: bool,
    pub lanes: usize,
    pub per_test_timeout: Duration,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct SummaryCounts {
    pub passed: usize,
    pub failed: usize,
    pub skipped: usize,
    pub unverified: usize,
}

pub(super) struct ResolvedTestContext<'a> {
    pub session_id: &'a str,
    pub tools: &'a [crate::db::models::agent_ir::AgentIrTool],
    pub required_connectors: &'a [crate::db::models::agent_ir::AgentIrConnector],
    pub cred_context: &'a str,
    pub env_vars: &'a [(String, String)],
    pub matcher: &'a CredentialMatcher,
}

/// The fuzzy "does the vault plausibly hold a credential for this connector"
/// match the report has always used for `connectors_resolved` and for the
/// no-plan fallback. Extracted unchanged so the scripted path decides
/// `credential_missing` by the SAME rule the LLM path's fallback does.
pub(super) struct CredentialMatcher {
    resolved_cred_names: HashSet<String>,
    hints_lower: Vec<String>,
    vault_types_lower: HashSet<String>,
}

impl CredentialMatcher {
    pub(super) fn new<I, S>(env_vars: &[(String, String)], hints: &[String], vault_types: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: AsRef<str>,
    {
        Self {
            // Env var names are like NOTION_API_KEY → extract prefix "notion"
            resolved_cred_names: env_vars
                .iter()
                .filter_map(|(k, _)| k.split('_').next().map(|p| p.to_lowercase()))
                .collect(),
            hints_lower: hints.iter().map(|h| h.to_lowercase()).collect(),
            vault_types_lower: vault_types
                .into_iter()
                .map(|t| t.as_ref().to_lowercase())
                .collect(),
        }
    }

    pub(super) fn matches(&self, connector: &str) -> bool {
        let name_lower = connector.to_lowercase();
        self.resolved_cred_names.contains(&name_lower)
            || self
                .resolved_cred_names
                .iter()
                .any(|cred| name_lower.contains(cred.as_str()) || cred.contains(&name_lower))
            || self.hints_lower.iter().any(|h| h.contains(&name_lower))
            // Also match against vault service types (covers connectors not matched
            // by tool name, e.g. alpha_vantage credential for http_request tool)
            || self.vault_types_lower.contains(&name_lower)
            || self
                .vault_types_lower
                .iter()
                .any(|vt| name_lower.contains(vt.as_str()) || vt.contains(&name_lower))
    }
}

/// The `connectors_resolved` block the frontend's ConnectorHandshakeCard
/// renders: one `{name, has_credential}` per non-platform connector.
pub(super) fn connectors_resolved_report(
    connector_names: &[String],
    matcher: &CredentialMatcher,
) -> Vec<serde_json::Value> {
    connector_names
        .iter()
        .filter(|name| !is_platform_connector(name))
        .map(|name| {
            serde_json::json!({
                "name": name,
                "has_credential": matcher.matches(name),
            })
        })
        .collect()
}

/// Run every subject: scripted where possible, the LLM plan for the rest.
pub(super) async fn run_resolved_tests(
    pool: &DbPool,
    ctx: &ResolvedTestContext<'_>,
    seams: &TestSeams<'_>,
    strategy: TestStrategy,
) -> Result<serde_json::Value, AppError> {
    let connector_names: Vec<String> = ctx
        .required_connectors
        .iter()
        .filter_map(|c| c.name().map(|n| n.to_string()))
        .collect();
    let tool_names: Vec<String> = ctx
        .tools
        .iter()
        .map(|t| t.name().to_string())
        .filter(|n| !n.is_empty())
        .collect();
    let connectors_resolved = connectors_resolved_report(&connector_names, ctx.matcher);

    let mut tally = ToolTestTally::default();
    let mut tested = 0usize;
    // Subjects the scripted phase already reported. An LLM plan entry for
    // one of these is dropped: no subject is ever tested twice.
    let mut scripted_connectors: HashSet<String> = HashSet::new();
    let mut scripted_tools: HashSet<String> = HashSet::new();

    let (llm_tools, llm_connectors) = if strategy.scripted {
        let plan = {
            let links = {
                let conn = pool.get()?;
                crate::commands::design::connector_readiness::resolve_credential_links(
                    &conn,
                    connector_names.iter().map(|s| s.as_str()),
                )
            };
            let catalog =
                crate::db::repos::resources::connectors::get_all(pool).unwrap_or_default();
            let metadata_by_name: HashMap<String, Option<String>> = catalog
                .iter()
                .map(|c| (c.name.to_lowercase(), c.metadata.clone()))
                .collect();
            let services_by_name: HashMap<String, Vec<String>> = catalog
                .iter()
                .map(|c| (c.name.to_lowercase(), catalog_service_tools(&c.services)))
                .collect();
            let class_of = |name: &str| {
                crate::db::models::classify_connector(
                    name,
                    metadata_by_name
                        .get(&name.trim().to_lowercase())
                        .and_then(|m| m.as_deref()),
                )
            };
            let has_cli_auth_route = |name: &str| crate::db::models::cli_probe_spec(name).is_some();
            let connector_keys: Vec<ConnectorKeys> = ctx
                .required_connectors
                .iter()
                .filter_map(|c| {
                    let name = c.name()?.trim().to_string();
                    let service_type = match c {
                        crate::db::models::agent_ir::AgentIrConnector::Structured(d) => {
                            d.service_type.clone()
                        }
                        crate::db::models::agent_ir::AgentIrConnector::Simple(_) => None,
                    };
                    let mut catalog_tools = Vec::new();
                    for key in std::iter::once(name.as_str()).chain(service_type.as_deref()) {
                        if let Some(tools) = services_by_name.get(&key.trim().to_lowercase()) {
                            catalog_tools.extend(tools.iter().cloned());
                        }
                    }
                    Some(ConnectorKeys {
                        name,
                        service_type,
                        catalog_tools,
                    })
                })
                .collect();
            // The tool's DECLARED connector only: a structured tool's
            // `requires_credential_type`. `tool_def_from_ir`'s inference for a
            // plain name (which falls back to the name itself) is a guess, and
            // guessing is `backing_connector`'s job, done against the draft's
            // own connectors rather than a fixed list.
            let tool_entries: Vec<(String, Option<String>)> = ctx
                .tools
                .iter()
                .filter(|t| !t.name().is_empty())
                .map(|t| {
                    (
                        t.name().to_string(),
                        t.data().and_then(|d| d.requires_credential_type.clone()),
                    )
                })
                .collect();
            plan_scripted_tests(
                &connector_keys,
                &tool_entries,
                &ConnectorFacts {
                    links: &links,
                    class_of: &class_of,
                    has_cli_auth_route: &has_cli_auth_route,
                    matcher: ctx.matcher,
                },
            )
        };

        let expected_total = plan.decided.len()
            + plan.probes.len()
            + plan.llm_tools.len()
            + plan.llm_connectors.len();
        tracing::info!(
            session_id = %ctx.session_id,
            decided = plan.decided.len(),
            probes = plan.probes.len(),
            llm_connectors = plan.llm_connectors.len(),
            llm_tools = plan.llm_tools.len(),
            "tool tests: scripted plan"
        );

        for row in &plan.decided {
            let r = tally.record_decided(row);
            note_scripted_subject(&r, &mut scripted_connectors, &mut scripted_tools);
            tested += 1;
            (seams.emit)(&r, tested, expected_total);
            tally.push(&r);
        }

        let mut llm_connectors = plan.llm_connectors;
        let probes =
            run_scripted_probes(pool, plan.probes, strategy.lanes, strategy.per_test_timeout).await;
        for (connector, outcome, latency_ms) in probes {
            match verdict_from_probe(&connector, outcome, latency_ms, strategy.per_test_timeout) {
                ProbeVerdict::Reported(r) => {
                    let r = tally.record_executed(&connector, Some(connector.clone()), r);
                    note_scripted_subject(&r, &mut scripted_connectors, &mut scripted_tools);
                    tested += 1;
                    (seams.emit)(&r, tested, expected_total);
                    tally.push(&r);
                }
                ProbeVerdict::Unscriptable(reason) => {
                    tracing::info!(
                        session_id = %ctx.session_id,
                        connector = %connector,
                        reason = %reason,
                        "tool tests: connector could not be scripted, falling back to the LLM plan"
                    );
                    llm_connectors.push(connector);
                }
            }
        }
        (plan.llm_tools, llm_connectors)
    } else {
        (tool_names, connector_names)
    };

    let scripted_rows = tally.results.len();
    // None = the LLM was never asked; Some(parsed) = it was.
    let mut llm_plan_parsed: Option<bool> = None;

    if !llm_tools.is_empty() || !llm_connectors.is_empty() {
        // The legacy path sends the IR lists untouched; the fallback sends
        // only the subset nothing else covered.
        let (tools_json, connectors_json) = if strategy.scripted {
            let want_tools: HashSet<String> = llm_tools.iter().map(|t| t.to_lowercase()).collect();
            let want_conns: HashSet<String> = llm_connectors
                .iter()
                .map(|c| c.trim().to_lowercase())
                .collect();
            let tools: Vec<_> = ctx
                .tools
                .iter()
                .filter(|t| want_tools.contains(&t.name().to_lowercase()))
                .collect();
            let conns: Vec<_> = ctx
                .required_connectors
                .iter()
                .filter(|c| {
                    c.name()
                        .is_some_and(|n| want_conns.contains(&n.trim().to_lowercase()))
                })
                .collect();
            (
                serde_json::to_string_pretty(&tools).unwrap_or_default(),
                serde_json::to_string_pretty(&conns).unwrap_or_else(|_| "[]".to_string()),
            )
        } else {
            (
                serde_json::to_string_pretty(ctx.tools).unwrap_or_default(),
                serde_json::to_string_pretty(ctx.required_connectors)
                    .unwrap_or_else(|_| "[]".to_string()),
            )
        };
        let test_prompt = build_test_prompt(&tools_json, &connectors_json, ctx.cred_context);

        let test_plan = match (seams.compose_plan)(test_prompt).await {
            Ok(plan) => plan,
            // With scripted rows already in hand, a CLI that will not start
            // degrades the leftover subset to the no-plan fallback instead of
            // throwing away real verdicts. With nothing scripted this is the
            // old path, and the old path propagated the error.
            Err(e) if scripted_rows > 0 => {
                tracing::warn!(
                    session_id = %ctx.session_id,
                    error = %e,
                    "tool tests: LLM plan for the unscriptable subset failed; reporting it without a plan"
                );
                Vec::new()
            }
            Err(e) => return Err(e),
        };

        if test_plan.is_empty() {
            tracing::warn!(
                session_id = %ctx.session_id,
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
            //
            // Decision-table row 4: a connector whose name merely SHARES A
            // SUBSTRING with a vault service type used to be stamped
            // "Credential available — connector verified" and counted as a pass.
            // Resolve the (fuzzy, unchanged) match here; `record_no_plan_fallback`
            // decides what it is worth — which is now `unverified`, not a pass.
            let connectors: Vec<(String, bool)> = llm_connectors
                .iter()
                .map(|c| (c.clone(), ctx.matcher.matches(c)))
                .collect();
            record_no_plan_fallback(&mut tally, &llm_tools, &connectors);
            llm_plan_parsed = Some(false);
        } else {
            // Execute each test curl command with real credentials
            let env_map: HashMap<&str, &str> = ctx
                .env_vars
                .iter()
                .map(|(k, v)| (k.as_str(), v.as_str()))
                .collect();
            let total = tested + test_plan.len();

            for entry in &test_plan {
                if plan_entry_already_scripted(entry, &scripted_connectors, &scripted_tools) {
                    tracing::debug!(
                        session_id = %ctx.session_id,
                        entry = %entry,
                        "tool tests: dropping LLM plan entry for a subject the scripted phase already reported"
                    );
                    continue;
                }
                let tool_name = entry
                    .get("tool_name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown");
                let curl_cmd = entry.get("curl").and_then(|v| v.as_str()).unwrap_or("");

                tracing::info!(
                    session_id = %ctx.session_id,
                    tool = %tool_name,
                    "Executing test {}/{}",
                    tested + 1,
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
                        let r =
                            tool_runner::execute_test_curl(curl_cmd, &env_map, allow_private).await;
                        tally.record_executed(tool_name, connector, r)
                    }
                };

                tested += 1;
                (seams.emit)(&result, tested, total);
                tally.push(&result);
            }
            llm_plan_parsed = Some(true);
        }
    }

    // The summary. A parsed LLM plan keeps the Haiku report (and its
    // deterministic fallback); a fully scripted run writes the same
    // ### Overview / ### Results / ### Next Steps shape without a model.
    let summary = match llm_plan_parsed {
        Some(true) => {
            let results_json = serde_json::to_string_pretty(&tally.results).unwrap_or_default();
            Some(
                (seams.write_summary)(results_json, tally.counts())
                    .await
                    .unwrap_or_else(|_| build_fallback_summary(&tally)),
            )
        }
        None => Some(build_scripted_summary(&tally)),
        Some(false) if scripted_rows > 0 => Some(build_scripted_summary(&tally)),
        // The old no-plan report carried no summary; keep it that way.
        Some(false) => None,
    };

    let test_mode = match (strategy.scripted, llm_plan_parsed.is_some()) {
        (false, _) => "llm",
        (true, false) => "scripted",
        (true, true) => "hybrid",
    };

    let mut report = tally.into_report();
    if let Some(obj) = report.as_object_mut() {
        obj.insert(
            "connectors_resolved".to_string(),
            serde_json::Value::Array(connectors_resolved),
        );
        if let Some(summary) = summary {
            obj.insert("summary".to_string(), serde_json::Value::String(summary));
        }
        if llm_plan_parsed == Some(false) {
            // The build model returned nothing parseable, so this report is the
            // degraded path — surfaced so a hold can say WHY nothing ran.
            obj.insert(
                "test_plan_parsed".to_string(),
                serde_json::Value::Bool(false),
            );
        }
        // Additive and informational: which strategy produced this report.
        // Nothing gates on it; it is what a live check reads to confirm the
        // scripted path actually ran.
        obj.insert(
            "test_mode".to_string(),
            serde_json::Value::String(test_mode.to_string()),
        );
    }
    Ok(report)
}

fn note_scripted_subject(
    r: &tool_runner::ToolTestResult,
    connectors: &mut HashSet<String>,
    tools: &mut HashSet<String>,
) {
    match r.connector.as_deref().filter(|c| !c.is_empty()) {
        Some(c) => {
            connectors.insert(c.trim().to_lowercase());
        }
        None => {
            tools.insert(r.tool_name.trim().to_lowercase());
        }
    }
}

/// Did the scripted phase already report this plan entry's subject?
///
/// Keyed on the entry's connector when it names one — an entry
/// `{tool_name: "http_request", connector: "alpha_vantage"}` is about Alpha
/// Vantage, not about the `http_request` conduit, and must still run when
/// only the conduit was scripted.
pub(super) fn plan_entry_already_scripted(
    entry: &serde_json::Value,
    scripted_connectors: &HashSet<String>,
    scripted_tools: &HashSet<String>,
) -> bool {
    let connector = entry
        .get("connector")
        .and_then(|v| v.as_str())
        .map(|c| c.trim().to_lowercase())
        .filter(|c| !c.is_empty());
    match connector {
        Some(c) => scripted_connectors.contains(&c),
        None => {
            let tool = entry
                .get("tool_name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            !tool.is_empty()
                && (scripted_tools.contains(&tool) || scripted_connectors.contains(&tool))
        }
    }
}

// =============================================================================
// The scripted plan (pure)
// =============================================================================

/// A row decided without any call.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum DecidedRow {
    /// On this backend's own allow-list (`is_platform_builtin`). `passed`.
    PlatformBuiltin {
        tool_name: String,
        connector: Option<String>,
    },
    /// An infrastructure conduit tool (`INFRASTRUCTURE_TOOLS`). `passed`,
    /// exactly as the no-plan fallback has always counted it.
    Conduit { tool_name: String },
    /// A credential connector with no vault credential even fuzzily matching.
    CredentialMissing { connector: String },
}

#[derive(Debug, Default)]
pub(super) struct ScriptedPlan {
    pub decided: Vec<DecidedRow>,
    /// `(connector, credential_id)` to run the declared healthcheck for.
    pub probes: Vec<(String, String)>,
    /// Connector names only the LLM plan can cover.
    pub llm_connectors: Vec<String>,
    /// Tool names only the LLM plan can cover.
    pub llm_tools: Vec<String>,
}

/// What the planner needs to know about connectors, injected so the routing
/// is a pure function of it.
pub(super) struct ConnectorFacts<'a> {
    /// `connector -> credential_id` for connectors uniquely bound to one vault
    /// credential (`resolve_credential_links`, keyed by the trimmed name).
    pub links: &'a HashMap<String, String>,
    pub class_of: &'a dyn Fn(&str) -> crate::db::models::ConnectorClass,
    /// Whether an authenticated provider CLI can stand in for a vault
    /// credential (`cli_probe_spec`). Those go to the LLM rather than being
    /// declared missing.
    pub has_cli_auth_route: &'a dyn Fn(&str) -> bool,
    pub matcher: &'a CredentialMatcher,
}

/// One connector the draft binds, with every key a tool can be tied to it by.
#[derive(Debug, Clone, Default)]
pub(super) struct ConnectorKeys {
    /// The connector name as the draft declares it (the row's subject).
    pub name: String,
    /// The draft's `service_type`, when it differs from the name.
    pub service_type: Option<String>,
    /// The tool names the connector CATALOG declares for it
    /// (`connector_definitions.services[].toolName`).
    pub catalog_tools: Vec<String>,
}

/// Tool names a catalog connector declares in its `services` JSON
/// (`[{"toolName": "send_message", "label": …}, …]`). Anything unparseable is
/// no declaration at all.
pub(super) fn catalog_service_tools(services_json: &str) -> Vec<String> {
    serde_json::from_str::<Vec<serde_json::Value>>(services_json)
        .unwrap_or_default()
        .iter()
        .filter_map(|s| s.get("toolName").and_then(|v| v.as_str()))
        .map(|s| s.trim().to_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Trailing vendor-suffix tokens a catalog connector name carries that its
/// tools drop: `leonardo_ai` → `leonardo_generate_image`, `cal_com` →
/// `cal_list_bookings`, `fly_io`, `news_api`. Derived from the builtin catalog
/// (`scripts/connectors/builtin/*.json`) — every multi-token name ending in
/// one of these is a brand plus a domain/"api" suffix.
const CONNECTOR_NAME_SUFFIXES: &[&str] = &["ai", "io", "com", "api", "app", "hq"];

/// Which of the draft's connectors backs `tool`, or `None` when the draft
/// does not tie it to exactly one of them.
///
/// In order, first rule that decides wins:
///   1. the tool's DECLARED connector (`requires_credential_type`): matches a
///      connector's name or service_type, or nothing — a tool the draft ties
///      to an unbound service is never re-assigned to a bound one by name;
///   2. the tool IS a connector's name / service_type;
///   3. the connector catalog declares the tool (`services[].toolName`) for
///      exactly one of the draft's connectors;
///   4. the tool name is `<key>_…` for a connector key (name, service_type, or
///      the name without a `CONNECTOR_NAME_SUFFIXES` token). Longest key wins,
///      an exact key beats a stem of the same length, and a tie between two
///      connectors decides nothing.
pub(super) fn backing_connector<'a>(
    tool: &str,
    declared: Option<&str>,
    connectors: &'a [ConnectorKeys],
) -> Option<&'a str> {
    let tool = tool.trim().to_lowercase();
    let keys_of = |c: &ConnectorKeys| -> Vec<String> {
        std::iter::once(c.name.as_str())
            .chain(c.service_type.as_deref())
            .map(|k| k.trim().to_lowercase())
            .filter(|k| !k.is_empty())
            .collect()
    };

    if let Some(declared) = declared
        .map(|d| d.trim().to_lowercase())
        .filter(|d| !d.is_empty())
    {
        return connectors
            .iter()
            .find(|c| keys_of(c).contains(&declared))
            .map(|c| c.name.as_str());
    }

    if let Some(c) = connectors.iter().find(|c| keys_of(c).contains(&tool)) {
        return Some(c.name.as_str());
    }

    let mut claimed = connectors
        .iter()
        .filter(|c| c.catalog_tools.contains(&tool));
    if let (Some(only), None) = (claimed.next(), claimed.next()) {
        return Some(only.name.as_str());
    }

    // (key length, exact key) per connector — the best prefix it can claim.
    let mut best: Option<((usize, bool), &ConnectorKeys)> = None;
    let mut tied = false;
    for c in connectors {
        let mut score: Option<(usize, bool)> = None;
        for key in keys_of(c) {
            let stem = key
                .rsplit_once('_')
                .filter(|(head, suffix)| {
                    !head.is_empty() && CONNECTOR_NAME_SUFFIXES.contains(suffix)
                })
                .map(|(head, _)| head.to_string());
            for (candidate, exact) in [(Some(key.clone()), true), (stem, false)] {
                let Some(candidate) = candidate else { continue };
                if tool.starts_with(&format!("{candidate}_")) {
                    let s = (candidate.len(), exact);
                    score = Some(score.map_or(s, |cur| cur.max(s)));
                }
            }
        }
        let Some(score) = score else { continue };
        match &best {
            Some((b, _)) if score < *b => {}
            Some((b, _)) if score == *b => tied = true,
            _ => {
                best = Some((score, c));
                tied = false;
            }
        }
    }
    match best {
        Some((_, c)) if !tied => Some(c.name.as_str()),
        _ => None,
    }
}

/// Route every connector and tool to exactly one of: decided, probed, LLM.
///
/// Every connector gets exactly one row, whether or not any tool names it.
/// A tool the draft ties to one of those connectors (`backing_connector`)
/// gets no row of its own: the connector's row is its verdict. `tools` is
/// `(name, declared connector)`.
pub(super) fn plan_scripted_tests(
    connectors: &[ConnectorKeys],
    tools: &[(String, Option<String>)],
    facts: &ConnectorFacts<'_>,
) -> ScriptedPlan {
    use crate::db::models::ConnectorClass;

    let mut plan = ScriptedPlan::default();
    let mut seen: HashSet<String> = HashSet::new();
    let mut covered: Vec<ConnectorKeys> = Vec::new();

    for keys in connectors {
        let name = keys.name.trim();
        if name.is_empty() || !seen.insert(name.to_lowercase()) {
            continue;
        }
        covered.push(keys.clone());
        if is_platform_builtin(name, Some(name)) {
            plan.decided.push(DecidedRow::PlatformBuiltin {
                tool_name: name.to_string(),
                connector: Some(name.to_string()),
            });
        } else if let Some(cred_id) = facts.links.get(name) {
            plan.probes.push((name.to_string(), cred_id.clone()));
        } else if (facts.class_of)(name) != ConnectorClass::Credential
            || (facts.has_cli_auth_route)(name)
            || facts.matcher.matches(name)
        {
            // ZeroConfig / GlobalProbe (local services with no vault entry
            // and no declared healthcheck), a provider whose CLI can hold the
            // auth, or a credential that exists but is not uniquely bindable:
            // nothing scripted can decide these honestly.
            plan.llm_connectors.push(name.to_string());
        } else {
            plan.decided.push(DecidedRow::CredentialMissing {
                connector: name.to_string(),
            });
        }
    }

    let mut seen_tools: HashSet<String> = HashSet::new();
    for (raw, declared) in tools {
        let name = raw.trim();
        let name_l = name.to_lowercase();
        if name.is_empty() || !seen_tools.insert(name_l) {
            continue;
        }
        if backing_connector(name, declared.as_deref(), &covered).is_some() {
            // The connector's own row is this tool's verdict — the LLM prompt
            // asks for the same thing: one entry per connector.
            continue;
        }
        if is_platform_builtin(name, None) {
            plan.decided.push(DecidedRow::PlatformBuiltin {
                tool_name: name.to_string(),
                connector: None,
            });
        } else if INFRASTRUCTURE_TOOLS
            .iter()
            .any(|t| t.eq_ignore_ascii_case(name))
        {
            plan.decided.push(DecidedRow::Conduit {
                tool_name: name.to_string(),
            });
        } else {
            plan.llm_tools.push(name.to_string());
        }
    }

    plan
}

// =============================================================================
// Scripted probes
// =============================================================================

/// What one healthcheck lane came back with.
#[derive(Debug)]
pub(super) enum ProbeOutcome {
    Checked(super::super::healthcheck::HealthcheckResult),
    /// `run_healthcheck` returned an error before any verdict.
    Errored(String),
    /// The lane hit `per_test_timeout`.
    TimedOut,
    /// The lane panicked (isolated by `run_lanes`).
    Panicked(String),
}

#[derive(Debug)]
pub(super) enum ProbeVerdict {
    /// A real call ran and produced a verdict. Reported as is.
    Reported(tool_runner::ToolTestResult),
    /// Nothing could run; the subject goes to the LLM plan.
    Unscriptable(String),
}

/// Run each `(connector, credential_id)` healthcheck, at most `lanes` at a
/// time, each under `per_test_timeout`. Results come back in input order.
pub(super) async fn run_scripted_probes(
    pool: &DbPool,
    probes: Vec<(String, String)>,
    lanes: usize,
    per_test_timeout: Duration,
) -> Vec<(String, ProbeOutcome, u64)> {
    use super::orchestrator::{lane, run_lanes, LaneOutcome, LaneTask};

    let tasks: Vec<LaneTask<(ProbeOutcome, u64)>> = probes
        .into_iter()
        .map(|(connector, credential_id)| {
            let pool = pool.clone();
            lane(connector, async move {
                let started = std::time::Instant::now();
                let outcome = match tokio::time::timeout(
                    per_test_timeout,
                    super::super::healthcheck::run_healthcheck(&pool, &credential_id),
                )
                .await
                {
                    Ok(Ok(hr)) => ProbeOutcome::Checked(hr),
                    Ok(Err(e)) => ProbeOutcome::Errored(e.to_string()),
                    Err(_) => ProbeOutcome::TimedOut,
                };
                (outcome, started.elapsed().as_millis() as u64)
            })
        })
        .collect();

    run_lanes(lanes, tasks)
        .await
        .into_iter()
        .map(|LaneOutcome { lane, result }| match result {
            Ok((outcome, ms)) => (lane, outcome, ms),
            Err(panic) => (lane, ProbeOutcome::Panicked(panic), 0),
        })
        .collect()
}

/// The HTTP status a healthcheck message names. Coupled to the format strings
/// in `healthcheck::execute_healthcheck_request_with_strategy`
/// (`"Connection successful (HTTP 200)"`, `"Service returned HTTP 401"`); a
/// message without one yields `None`, which only loses the modal's HTTP hint.
pub(super) fn http_status_from_message(msg: &str) -> Option<u16> {
    let idx = msg.find("HTTP ")?;
    let digits: String = msg[idx + 5..]
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    if digits.len() == 3 {
        digits.parse().ok()
    } else {
        None
    }
}

/// Turn one lane's outcome into a report row, or send it to the LLM.
pub(super) fn verdict_from_probe(
    connector: &str,
    outcome: ProbeOutcome,
    latency_ms: u64,
    per_test_timeout: Duration,
) -> ProbeVerdict {
    use super::super::healthcheck::HealthProbeState;

    let row = |status: &str, error: Option<String>, preview: Option<String>, http: Option<u16>| {
        tool_runner::ToolTestResult {
            tool_name: connector.to_string(),
            status: status.to_string(),
            http_status: http,
            latency_ms,
            error,
            connector: Some(connector.to_string()),
            output_preview: preview,
        }
    };

    match outcome {
        ProbeOutcome::Checked(hr) => {
            let http = http_status_from_message(&hr.message);
            match hr.state {
                HealthProbeState::Verified => ProbeVerdict::Reported(row(
                    "passed",
                    None,
                    Some(format!(
                        "{} — checked with the connector's own read-only health check",
                        hr.message
                    )),
                    http,
                )),
                HealthProbeState::Failed | HealthProbeState::Unreachable => {
                    ProbeVerdict::Reported(row("failed", Some(hr.message), None, http))
                }
                // `success: true` but NOTHING was called. Counting this as a
                // pass is the false green; the LLM plan gets a chance instead.
                HealthProbeState::Unverifiable => ProbeVerdict::Unscriptable(format!(
                    "no health check is declared for this connector ({})",
                    hr.message
                )),
            }
        }
        ProbeOutcome::TimedOut => ProbeVerdict::Reported(row(
            "failed",
            Some(format!(
                "The health check did not answer within {per_test_timeout:?}, so the service may be slow or unreachable."
            )),
            None,
            None,
        )),
        ProbeOutcome::Errored(e) => ProbeVerdict::Unscriptable(format!("health check could not run: {e}")),
        ProbeOutcome::Panicked(p) => ProbeVerdict::Unscriptable(format!("health check lane panicked: {p}")),
    }
}

// =============================================================================
// The tally
// =============================================================================

/// One report row, in the exact key set the frontend's `ToolTestResult` reads.
fn result_json(r: &tool_runner::ToolTestResult) -> serde_json::Value {
    serde_json::json!({
        "tool_name": r.tool_name,
        "status": r.status,
        "http_status": r.http_status,
        "latency_ms": r.latency_ms,
        "error": r.error,
        "connector": r.connector,
        "output_preview": r.output_preview,
    })
}

fn uncalled_row(
    tool_name: &str,
    status: &str,
    error: Option<String>,
    connector: Option<String>,
    output_preview: Option<String>,
) -> tool_runner::ToolTestResult {
    tool_runner::ToolTestResult {
        tool_name: tool_name.to_string(),
        status: status.to_string(),
        http_status: None,
        latency_ms: 0,
        error,
        connector,
        output_preview,
    }
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
                Some(self.record_available(
                    tool_name,
                    connector,
                    format!("{description} — {AVAILABLE_AT_RUNTIME}"),
                ))
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
                Some(uncalled_row(
                    tool_name,
                    STATUS_UNVERIFIED,
                    Some(
                        "Reported as CLI-native by the build model — no call was made, so this tool is unverified.".to_string(),
                    ),
                    connector,
                    None,
                ))
            }

            EntryClass::NotTestable => {
                // Decision-table row 2. The test prompt explicitly invites
                // these (§4 "Non-testable → emit an entry with empty curl"),
                // so they stay non-blocking by decision.
                self.skipped += 1;
                Some(uncalled_row(
                    tool_name,
                    "skipped",
                    Some(if description.is_empty() {
                        "No curl command generated".to_string()
                    } else {
                        description
                    }),
                    connector,
                    None,
                ))
            }
        }
    }

    /// Count the verdict of a call that actually ran (a curl or a healthcheck).
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

    /// A code-recognised built-in or conduit: counted `passed`, never called.
    fn record_available(
        &mut self,
        tool_name: &str,
        connector: Option<String>,
        preview: String,
    ) -> tool_runner::ToolTestResult {
        self.passed += 1;
        uncalled_row(tool_name, "passed", None, connector, Some(preview))
    }

    /// A connector with no credential to test with.
    fn record_credential_missing(&mut self, cname: &str) -> tool_runner::ToolTestResult {
        self.failed += 1;
        self.credential_issues.push(serde_json::json!({
            "connector": cname,
            "issue": format!("No credential found for connector '{cname}'. Add it in Keys section."),
        }));
        uncalled_row(
            cname,
            "credential_missing",
            Some(format!("No credential configured for '{cname}'")),
            Some(cname.to_string()),
            None,
        )
    }

    /// Count a row the scripted planner decided without a call.
    fn record_decided(&mut self, row: &DecidedRow) -> tool_runner::ToolTestResult {
        match row {
            DecidedRow::PlatformBuiltin {
                tool_name,
                connector,
            } => self.record_available(
                tool_name,
                connector.clone(),
                format!("Built-in platform capability — {AVAILABLE_AT_RUNTIME}"),
            ),
            DecidedRow::Conduit { tool_name } => self.record_available(
                tool_name,
                None,
                format!("Built-in platform tool — {AVAILABLE_AT_RUNTIME}"),
            ),
            DecidedRow::CredentialMissing { connector } => {
                self.record_credential_missing(connector)
            }
        }
    }

    fn push(&mut self, r: &tool_runner::ToolTestResult) {
        self.results.push(result_json(r));
    }

    pub(super) fn counts(&self) -> SummaryCounts {
        SummaryCounts {
            passed: self.passed,
            failed: self.failed,
            skipped: self.skipped,
            unverified: self.unverified,
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

/// Count the no-parseable-plan fallback into `tally`.
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
pub(super) fn record_no_plan_fallback(
    tally: &mut ToolTestTally,
    tool_names: &[String],
    connectors: &[(String, bool)],
) {
    for name in tool_names {
        if INFRASTRUCTURE_TOOLS
            .iter()
            .any(|t| t.eq_ignore_ascii_case(name))
        {
            let r = tally.record_available(
                name,
                None,
                format!("Built-in platform tool — {AVAILABLE_AT_RUNTIME}"),
            );
            tally.push(&r);
        }
    }

    // One result per connector: the connector name is the credential subject,
    // so the UI can say "Alpha Vantage needs credentials" rather than
    // "http_request needs credentials".
    for (cname, has_cred) in connectors {
        let r = if is_platform_connector(cname) {
            tally.record_available(
                cname,
                Some(cname.clone()),
                format!("Built-in platform connector — {AVAILABLE_AT_RUNTIME}"),
            )
        } else if *has_cred {
            tally.unverified += 1;
            tally.unverified_reasons.push(unverified_reason(
                cname,
                Some(cname),
                "A credential in the vault matches this connector's name, but the build model produced no test plan, so no call was made against it.",
            ));
            uncalled_row(
                cname,
                STATUS_UNVERIFIED,
                Some("A matching credential exists, but no call was made against this connector — it is unverified, not verified.".to_string()),
                Some(cname.clone()),
                None,
            )
        } else {
            tally.record_credential_missing(cname)
        };
        tally.push(&r);
    }
}

/// Build the report for the no-parseable-plan fallback (see
/// [`record_no_plan_fallback`]). Test-only since the orchestrator counts the
/// fallback into its running tally; kept as the standalone shape the
/// promote-gate tests in `oneshot.rs` and the legacy-parity test pin.
#[cfg(test)]
pub(super) fn build_no_plan_fallback(
    tool_names: &[String],
    connectors: &[(String, bool)],
) -> serde_json::Value {
    let mut tally = ToolTestTally::default();
    record_no_plan_fallback(&mut tally, tool_names, connectors);
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

// =============================================================================
// The deterministic summary
// =============================================================================

/// The subject the modal keys a result on: connector if present, else the
/// tool, underscores as spaces (`TestReportModal.tsx` `toolSubject`).
fn row_subject(r: &serde_json::Value) -> String {
    let connector = r
        .get("connector")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty());
    let tool = r
        .get("tool_name")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    connector.unwrap_or(tool).replace('_', " ")
}

/// Title-case, as the modal's `toolLabel` does.
fn title_case(s: &str) -> String {
    s.split(' ')
        .map(|w| {
            let mut chars = w.chars();
            match chars.next() {
                Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// The plain-language report for a run the LLM did not write, in the exact
/// `### Overview` / `### Results` / `### Next Steps` shape `TestReportModal`
/// parses (`parseReportSections`), one `- **Subject** — icon sentence` line
/// per result so `ToolDetailView` can find each row's line by its subject.
/// Same rules the Haiku prompt is given: no HTTP codes or JSON, ⚠️ for
/// anything never called, the **Keys** section for credential problems.
pub(super) fn build_scripted_summary(tally: &ToolTestTally) -> String {
    let SummaryCounts {
        passed,
        failed,
        skipped,
        unverified,
    } = tally.counts();
    let checked = passed + failed;

    let mut overview = if failed == 0 && unverified == 0 && passed > 0 {
        format!("All {passed} checks passed — every connection this agent relies on answered correctly or is built in.")
    } else if passed == 0 && failed > 0 {
        format!("None of the {failed} checks passed, so this agent cannot reach the services it needs yet.")
    } else if checked == 0 {
        "Nothing could be checked for this agent yet.".to_string()
    } else {
        format!("{passed} of {checked} checks passed and {failed} need attention before this agent is ready.")
    };
    if unverified > 0 {
        overview.push_str(&format!(
            " {unverified} could not be run at all, so they are unverified."
        ));
    }
    if skipped > 0 {
        overview.push_str(&format!(
            " {skipped} had no safe read-only check and were skipped."
        ));
    }

    let mut results = Vec::new();
    let mut next_steps = Vec::new();
    for r in &tally.results {
        let label = title_case(&row_subject(r));
        let status = r.get("status").and_then(|v| v.as_str()).unwrap_or("");
        let http = r.get("http_status").and_then(|v| v.as_u64());
        let preview = r
            .get("output_preview")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let line = match status {
            "passed" if preview.contains(AVAILABLE_AT_RUNTIME) => {
                "✅ Built into Personas, so it is available whenever the agent runs — there is nothing external to call.".to_string()
            }
            "passed" => "✅ Connected with your saved credential and answered its read-only check.".to_string(),
            "credential_missing" => {
                next_steps.push(format!("- Add a credential for **{label}** in the **Keys** section."));
                "❌ No credential is set up for it yet — add one in the **Keys** section.".to_string()
            }
            STATUS_UNVERIFIED => {
                "⚠️ Nothing was run against it, so we cannot tell you whether it works.".to_string()
            }
            "skipped" => "⚠️ Skipped — there is no safe read-only way to check it.".to_string(),
            _ => match http {
                Some(401) | Some(403) => {
                    next_steps.push(format!(
                        "- Refresh the **{label}** credential in the **Keys** section."
                    ));
                    "❌ The service turned the saved credential down — it may have expired or be missing a permission.".to_string()
                }
                Some(429) => {
                    next_steps.push(format!("- Wait a minute, then test **{label}** again."));
                    "❌ The service asked us to slow down, so the check could not finish — try again shortly.".to_string()
                }
                Some(404) => {
                    next_steps.push(format!(
                        "- Check the **{label}** connection settings in the **Keys** section."
                    ));
                    "❌ The service could not find what the check asked for — the connection settings may need updating.".to_string()
                }
                _ => {
                    next_steps.push(format!(
                        "- Make sure **{label}** is reachable from this computer, then test again."
                    ));
                    "❌ The service could not be reached or reported a problem on its side.".to_string()
                }
            },
        };
        results.push(format!("- **{label}** — {line}"));
    }

    if next_steps.is_empty() && unverified == 0 {
        next_steps.push("Everything checked out — this agent is ready to go.".to_string());
    }
    if unverified > 0 {
        next_steps.push(
            "- This build will not be promoted automatically until the unverified tools can actually be exercised."
                .to_string(),
        );
    }

    format!(
        "### Overview\n{overview}\n\n### Results\n{}\n\n### Next Steps\n{}",
        results.join("\n"),
        next_steps.join("\n")
    )
}

/// Ask the CLI to generate a human-friendly summary of test results.
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

    let route = TEST_SUMMARY_CLASS.route();
    let cli_args = super::super::cli_process::headless_claude_args(route.model, route.effort, &[]);

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
        let read = tokio::time::timeout(TEST_SUMMARY_TIMEOUT, async {
            loop {
                match read_line_limited(&mut reader).await {
                    Ok(Some(line)) => {
                        super::events::record_build_spend(
                            pool,
                            Some(persona_id),
                            super::events::SPEND_TEST_SUMMARY,
                            Some(route.model),
                            &line,
                        );
                        raw_output.push_str(&line);
                        raw_output.push('\n');
                    }
                    Ok(None) => break,
                    Err(_) => break,
                }
            }
        })
        .await;
        if read.is_err() {
            // The caller falls back to `build_fallback_summary`.
            let _ = driver.kill().await;
            return Err(AppError::Execution(format!(
                "Test summary CLI did not finish within {}s",
                TEST_SUMMARY_TIMEOUT.as_secs()
            )));
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

    // =====================================================================
    // Scripted-first strategy
    // =====================================================================
    //
    // Offline evidence for the default path: routing (pure), probe verdicts
    // (pure), the deterministic summary against a mirror of the modal's own
    // parser, and end-to-end runs through `run_resolved_tests` on the
    // production schema (`init_test_db`) with REAL `run_healthcheck` calls
    // against a local bearer-auth mock API. Only the two CLI legs are faked.

    use crate::db::init_test_db;
    use crate::db::models::agent_ir::{AgentIrConnector, AgentIrTool};
    use crate::db::models::{
        ConnectorClass, CreateConnectorDefinitionInput, CreateCredentialInput,
    };
    use crate::engine::healthcheck::HealthcheckResult;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    const ROW_KEYS: [&str; 7] = [
        "tool_name",
        "status",
        "http_status",
        "latency_ms",
        "error",
        "connector",
        "output_preview",
    ];

    #[test]
    fn scripted_is_the_default_and_only_an_explicit_off_value_disables_it() {
        for on in [None, Some("1"), Some(""), Some("true"), Some("yes")] {
            assert!(
                scripted_tool_tests_enabled(on),
                "{on:?} must keep scripted on"
            );
        }
        for off in ["0", "false", "OFF", " no "] {
            assert!(
                !scripted_tool_tests_enabled(Some(off)),
                "{off:?} must force the LLM path"
            );
        }
    }

    fn vault_matcher(types: &[&str]) -> CredentialMatcher {
        CredentialMatcher::new(&[], &[], types.iter())
    }

    fn keys(names: &[&str]) -> Vec<ConnectorKeys> {
        names
            .iter()
            .map(|n| ConnectorKeys {
                name: n.to_string(),
                ..Default::default()
            })
            .collect()
    }

    #[test]
    fn every_subject_is_routed_to_exactly_one_lane() {
        let connectors = keys(&[
            "notion",
            "personas_messages",
            "vercel",
            "google_calendar",
            "stripe",
            "local_drive",
            "Notion",
            "  ",
        ]);
        let tools: Vec<(String, Option<String>)> = vec![
            ("notion_search".into(), Some("notion".into())),
            ("web_search".into(), None),
            ("http_request".into(), None),
            ("summarize_text".into(), None),
            ("stripe_charges".into(), None),
        ];
        let links: HashMap<String, String> = [("notion".to_string(), "cred-1".to_string())]
            .into_iter()
            .collect();
        let class_of = |n: &str| {
            if n == "local_drive" {
                ConnectorClass::ZeroConfig
            } else {
                ConnectorClass::Credential
            }
        };
        let has_cli = |n: &str| n == "vercel";
        let matcher = vault_matcher(&["google"]);
        let plan = plan_scripted_tests(
            &connectors,
            &tools,
            &ConnectorFacts {
                links: &links,
                class_of: &class_of,
                has_cli_auth_route: &has_cli,
                matcher: &matcher,
            },
        );

        assert_eq!(
            plan.decided,
            vec![
                DecidedRow::PlatformBuiltin {
                    tool_name: "personas_messages".into(),
                    connector: Some("personas_messages".into())
                },
                DecidedRow::CredentialMissing {
                    connector: "stripe".into()
                },
                DecidedRow::PlatformBuiltin {
                    tool_name: "web_search".into(),
                    connector: None
                },
                DecidedRow::Conduit {
                    tool_name: "http_request".into()
                },
            ]
        );
        assert_eq!(
            plan.probes,
            vec![("notion".to_string(), "cred-1".to_string())]
        );
        // CLI-auth provider, a fuzzy-but-unbound credential, a ZeroConfig local
        // service: nothing scripted can decide these honestly.
        assert_eq!(
            plan.llm_connectors,
            vec!["vercel", "google_calendar", "local_drive"]
        );
        // `notion_search` / `stripe_charges` ride on their connector's row.
        assert_eq!(plan.llm_tools, vec!["summarize_text"]);
    }

    fn reported(v: ProbeVerdict) -> tool_runner::ToolTestResult {
        match v {
            ProbeVerdict::Reported(r) => r,
            ProbeVerdict::Unscriptable(why) => panic!("expected a row, got fallback: {why}"),
        }
    }

    #[test]
    fn probe_verdicts_never_turn_an_uncalled_check_into_a_pass() {
        let t = Duration::from_secs(20);

        let ok = reported(verdict_from_probe(
            "notion",
            ProbeOutcome::Checked(HealthcheckResult::probed(
                true,
                "Connection successful (HTTP 200)",
            )),
            42,
            t,
        ));
        assert_eq!(
            (ok.status.as_str(), ok.http_status, ok.latency_ms),
            ("passed", Some(200), 42)
        );
        assert_eq!(ok.connector.as_deref(), Some("notion"));

        let denied = reported(verdict_from_probe(
            "notion",
            ProbeOutcome::Checked(HealthcheckResult::probed(
                false,
                "Service returned HTTP 401",
            )),
            5,
            t,
        ));
        assert_eq!(
            (denied.status.as_str(), denied.http_status),
            ("failed", Some(401))
        );

        let offline = reported(verdict_from_probe(
            "notion",
            ProbeOutcome::Checked(HealthcheckResult::unreachable("Connection failed: refused")),
            5,
            t,
        ));
        assert_eq!(
            (offline.status.as_str(), offline.http_status),
            ("failed", None)
        );

        let slow = reported(verdict_from_probe(
            "notion",
            ProbeOutcome::TimedOut,
            20_000,
            t,
        ));
        assert_eq!(slow.status, "failed");
        assert!(slow
            .error
            .as_deref()
            .unwrap_or("")
            .contains("did not answer within 20s"));

        // `unverifiable` carries `success: true` — the gated scripted path used
        // to count it as a pass. It is a fallback, not a verdict.
        for outcome in [
            ProbeOutcome::Checked(HealthcheckResult::unverifiable("credentials stored")),
            ProbeOutcome::Errored("No connector definition found".into()),
            ProbeOutcome::Panicked("boom".into()),
        ] {
            assert!(
                matches!(
                    verdict_from_probe("notion", outcome, 0, t),
                    ProbeVerdict::Unscriptable(_)
                ),
                "a check that could not run must fall back to the LLM plan"
            );
        }
    }

    #[test]
    fn http_status_is_read_from_the_healthcheck_message_formats() {
        assert_eq!(
            http_status_from_message("Connection successful (HTTP 204)"),
            Some(204)
        );
        assert_eq!(
            http_status_from_message("Service returned HTTP 429"),
            Some(429)
        );
        assert_eq!(
            http_status_from_message("Connection failed: dns error"),
            None
        );
        assert_eq!(http_status_from_message("HTTP 20"), None);
    }

    #[test]
    fn a_plan_entry_about_a_connector_is_keyed_on_the_connector_not_the_conduit() {
        let conns: HashSet<String> = ["gmail".to_string()].into_iter().collect();
        let tools: HashSet<String> = ["http_request".to_string(), "web_search".to_string()]
            .into_iter()
            .collect();
        let dropped = |e: serde_json::Value| plan_entry_already_scripted(&e, &conns, &tools);
        assert!(dropped(
            json!({"tool_name": "gmail_search", "connector": "gmail"})
        ));
        assert!(dropped(
            json!({"tool_name": "web_search", "connector": null})
        ));
        assert!(dropped(json!({"tool_name": "gmail"})));
        // Scripting the conduit must not swallow the connector it drives.
        assert!(!dropped(
            json!({"tool_name": "http_request", "connector": "alpha_vantage"})
        ));
        assert!(!dropped(json!({"tool_name": "summarize", "connector": ""})));
    }

    /// Mirror of `parseReportSections` in `TestReportModal.tsx`:
    /// `/^###?\s+overview/i`, `/^###?\s+results/i`, `/^###?\s+next\s*steps/i`,
    /// any other `##`/`###` heading ends the section.
    fn parse_report_sections(md: &str) -> (String, String, String) {
        let (mut overview, mut results, mut next) = (String::new(), String::new(), String::new());
        let mut current: Option<u8> = None;
        for line in md.split('\n') {
            let t = line.trim();
            let lower = t.to_lowercase();
            let hashes = lower.chars().take_while(|c| *c == '#').count();
            let rest = &lower[hashes..];
            if (hashes == 2 || hashes == 3) && rest.starts_with(char::is_whitespace) {
                let h = rest.trim_start();
                current = if h.starts_with("overview") {
                    Some(0)
                } else if h.starts_with("results") {
                    Some(1)
                } else if h.replace(' ', "").starts_with("nextsteps") {
                    Some(2)
                } else {
                    None
                };
                continue;
            }
            let dst = match current {
                Some(0) => &mut overview,
                Some(1) => &mut results,
                Some(2) => &mut next,
                _ => continue,
            };
            dst.push_str(line);
            dst.push('\n');
        }
        (overview, results, next)
    }

    fn assert_summary_is_modal_readable(summary: &str, report: &serde_json::Value) {
        let (overview, results, next) = parse_report_sections(summary);
        assert!(
            !overview.trim().is_empty(),
            "no Overview section: {summary}"
        );
        assert!(!next.trim().is_empty(), "no Next Steps section: {summary}");
        for r in report["results"].as_array().unwrap() {
            // `ToolDetailView`: a result's line is the first Results line that
            // contains its subject (connector, else tool; `_` as spaces).
            let subject = row_subject(r).to_lowercase();
            assert!(
                results.lines().any(|l| l.to_lowercase().contains(&subject)),
                "no Results line for `{subject}`: {summary}"
            );
        }
        assert!(
            !summary.contains("HTTP") && !summary.contains('{'),
            "no codes or JSON for a non-technical reader: {summary}"
        );
    }

    #[test]
    fn the_scripted_summary_parses_into_the_sections_the_modal_reads() {
        let mut tally = ToolTestTally::default();
        for row in [
            DecidedRow::PlatformBuiltin {
                tool_name: "web_search".into(),
                connector: None,
            },
            DecidedRow::CredentialMissing {
                connector: "alpha_vantage".into(),
            },
        ] {
            let r = tally.record_decided(&row);
            tally.push(&r);
        }
        let denied = reported(verdict_from_probe(
            "notion",
            ProbeOutcome::Checked(HealthcheckResult::probed(
                false,
                "Service returned HTTP 401",
            )),
            3,
            Duration::from_secs(20),
        ));
        let r = tally.record_executed("notion", Some("notion".into()), denied);
        tally.push(&r);

        let summary = build_scripted_summary(&tally);
        assert!(summary.contains("**Alpha Vantage** — ❌"), "{summary}");
        assert!(summary.contains("**Web Search** — ✅"), "{summary}");
        assert!(summary.contains("**Notion** — ❌"), "{summary}");
        assert!(summary.contains("**Keys**"), "{summary}");
        assert_summary_is_modal_readable(&summary, &tally.into_report());
    }

    // ── end to end, against a local mock API ───────────────────────────────

    /// A bearer-auth API: `Authorization: Bearer good-token` → 200, anything
    /// else → 401, `GET /hang` is accepted and never answered. Counts
    /// authorised hits (proof the vault secret was decrypted and sent). The
    /// server task is owned by the returned value and aborted when it drops.
    struct MockApi {
        port: u16,
        good_hits: Arc<AtomicUsize>,
        server: tokio::task::JoinHandle<()>,
    }

    impl Drop for MockApi {
        fn drop(&mut self) {
            self.server.abort();
        }
    }

    async fn spawn_mock_api() -> MockApi {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let good_hits = Arc::new(AtomicUsize::new(0));
        let hits = good_hits.clone();
        let server = tokio::spawn(async move {
            // Parked, never-answered sockets for `/hang`: held open until the
            // server is aborted, so the client sees a stalled request.
            let mut parked = Vec::new();
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    return;
                };
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let req = String::from_utf8_lossy(&buf[..n]).to_lowercase();
                if req.starts_with("get /hang") {
                    parked.push(sock);
                    continue;
                }
                let resp = if req.contains("authorization: bearer good-token") {
                    hits.fetch_add(1, Ordering::SeqCst);
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 11\r\nConnection: close\r\n\r\n{\"id\":\"me\"}"
                } else {
                    "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                };
                let _ = sock.write_all(resp.as_bytes()).await;
                let _ = sock.flush().await;
            }
        });
        MockApi {
            port,
            good_hits,
            server,
        }
    }

    /// An HTTP API connector as the catalog declares one: a healthcheck with a
    /// bearer header template, opted into private-network access (the flag
    /// self-hosted connectors use) so it may reach 127.0.0.1.
    fn seed_api_connector(pool: &DbPool, name: &str, endpoint: Option<String>) {
        crate::db::repos::resources::connectors::create(
            pool,
            CreateConnectorDefinitionInput {
                name: name.to_string(),
                label: format!("{name} Label"),
                icon_url: None,
                color: None,
                category: None,
                fields: "[]".to_string(),
                healthcheck_config: endpoint.map(|e| {
                    json!({
                        "endpoint": e,
                        "method": "GET",
                        "headers": { "Authorization": "Bearer {{api_key}}" }
                    })
                    .to_string()
                }),
                services: None,
                events: None,
                metadata: Some(json!({ "allow_private_network": true }).to_string()),
                is_builtin: Some(false),
            },
        )
        .unwrap();
    }

    /// A vault credential written through the production path (fields
    /// encrypted by `create_with_fields`).
    fn seed_api_key(pool: &DbPool, service_type: &str, api_key: &str) {
        let fields: HashMap<String, String> = [("api_key".to_string(), api_key.to_string())]
            .into_iter()
            .collect();
        crate::db::repos::resources::credentials::create_with_fields(
            pool,
            CreateCredentialInput {
                name: format!("{service_type} key"),
                service_type: service_type.to_string(),
                encrypted_data: String::new(),
                iv: String::new(),
                metadata: None,
                session_encrypted_data: None,
                healthcheck_passed: None,
                oauth_session_ref: None,
            },
            &fields,
        )
        .unwrap();
    }

    #[derive(Default)]
    struct Recorder {
        prompts: Mutex<Vec<String>>,
        emitted: Mutex<Vec<(String, String, usize, usize)>>,
        summaries: AtomicUsize,
    }

    /// Drive `run_resolved_tests` with the two CLI legs faked: the plan leg
    /// answers `plan`, the summary leg returns a marker string.
    async fn run_with(
        pool: &DbPool,
        tools: &[&str],
        connectors: &[&str],
        vault_types: &[&str],
        plan: Result<Vec<serde_json::Value>, String>,
        scripted: bool,
        rec: Arc<Recorder>,
    ) -> Result<serde_json::Value, AppError> {
        crate::engine::connector_strategy::init_registry();
        let tools: Vec<AgentIrTool> = tools
            .iter()
            .map(|t| AgentIrTool::Simple(t.to_string()))
            .collect();
        let connectors: Vec<AgentIrConnector> = connectors
            .iter()
            .map(|c| AgentIrConnector::Simple(c.to_string()))
            .collect();
        let matcher = vault_matcher(vault_types);

        let rec_c = rec.clone();
        let compose =
            move |p: String| -> BoxFuture<'static, Result<Vec<serde_json::Value>, AppError>> {
                rec_c.prompts.lock().unwrap().push(p);
                let plan = plan.clone().map_err(AppError::ProcessSpawn);
                Box::pin(async move { plan })
            };
        let rec_s = rec.clone();
        let summary = move |_json: String,
                            _c: SummaryCounts|
              -> BoxFuture<'static, Result<String, AppError>> {
            rec_s.summaries.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok("### Overview\nwritten by the summary model".to_string()) })
        };
        let rec_e = rec.clone();
        let emit = move |r: &tool_runner::ToolTestResult, tested: usize, total: usize| {
            rec_e.emitted.lock().unwrap().push((
                r.tool_name.clone(),
                r.status.clone(),
                tested,
                total,
            ));
        };

        run_resolved_tests(
            pool,
            &ResolvedTestContext {
                session_id: "sess-tt",
                tools: &tools,
                required_connectors: &connectors,
                cred_context: "",
                env_vars: &[],
                matcher: &matcher,
            },
            &TestSeams {
                compose_plan: &compose,
                write_summary: &summary,
                emit: &emit,
            },
            TestStrategy {
                scripted,
                lanes: SCRIPTED_TEST_LANES,
                per_test_timeout: Duration::from_secs(2),
            },
        )
        .await
    }

    fn row<'a>(report: &'a serde_json::Value, subject: &str) -> &'a serde_json::Value {
        report["results"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["tool_name"] == json!(subject))
            .unwrap_or_else(|| panic!("no row for {subject}: {report}"))
    }

    /// The realistic mix: a working bearer API, a rejected key, a connector
    /// with no credential, one that hangs, one with no declared healthcheck,
    /// a platform connector, a built-in, a conduit and a custom tool.
    #[tokio::test]
    async fn a_mixed_build_scripts_what_it_can_and_hands_only_the_rest_to_the_llm() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        let (port, good_hits) = (api.port, api.good_hits.clone());
        let base = format!("http://127.0.0.1:{port}");
        seed_api_connector(&pool, "mockapi_tt", Some(format!("{base}/v1/me")));
        seed_api_key(&pool, "mockapi_tt", "good-token");
        seed_api_connector(&pool, "mockapi_bad_tt", Some(format!("{base}/v1/me")));
        seed_api_key(&pool, "mockapi_bad_tt", "revoked-token");
        seed_api_connector(&pool, "slow_tt", Some(format!("{base}/hang")));
        seed_api_key(&pool, "slow_tt", "good-token");
        seed_api_connector(&pool, "nocheck_tt", None);
        seed_api_key(&pool, "nocheck_tt", "good-token");

        // What the build model answers for the leftover subset — including a
        // stray entry for a connector the scripted phase already covered.
        let plan = vec![
            json!({"tool_name": "nocheck_tt", "connector": "nocheck_tt", "curl": "", "description": "No read-only endpoint"}),
            json!({"tool_name": "summarize_notes_tt", "connector": null, "curl": "", "cli_native": true}),
            json!({"tool_name": "mockapi_tt", "connector": "mockapi_tt", "curl": "curl -s http://127.0.0.1:9/never-run"}),
        ];
        let rec = Arc::new(Recorder::default());
        let started = std::time::Instant::now();
        let report = run_with(
            &pool,
            &[
                "mockapi_tt_list",
                "web_search",
                "http_request",
                "summarize_notes_tt",
            ],
            &[
                "mockapi_tt",
                "mockapi_bad_tt",
                "missing_tt",
                "slow_tt",
                "nocheck_tt",
                "personas_messages",
            ],
            &["mockapi_tt", "mockapi_bad_tt", "slow_tt", "nocheck_tt"],
            Ok(plan),
            true,
            rec.clone(),
        )
        .await
        .unwrap();
        // The hanging connector costs one per-test timeout, not the run.
        assert!(
            started.elapsed() < Duration::from_secs(15),
            "{:?}",
            started.elapsed()
        );

        // Real calls: the decrypted vault key reached the API as a bearer token.
        assert!(
            good_hits.load(Ordering::SeqCst) >= 1,
            "the good key never arrived"
        );
        assert_eq!(row(&report, "mockapi_tt")["status"], json!("passed"));
        assert_eq!(row(&report, "mockapi_tt")["http_status"], json!(200));
        assert_eq!(row(&report, "mockapi_bad_tt")["status"], json!("failed"));
        assert_eq!(row(&report, "mockapi_bad_tt")["http_status"], json!(401));
        assert_eq!(
            row(&report, "missing_tt")["status"],
            json!("credential_missing")
        );
        assert_eq!(row(&report, "slow_tt")["status"], json!("failed"));
        assert!(row(&report, "slow_tt")["error"]
            .as_str()
            .unwrap()
            .contains("did not answer"));
        assert_eq!(row(&report, "personas_messages")["status"], json!("passed"));
        assert_eq!(row(&report, "web_search")["status"], json!("passed"));
        assert_eq!(row(&report, "http_request")["status"], json!("passed"));
        // Unscriptable → decided by the LLM plan.
        assert_eq!(row(&report, "nocheck_tt")["status"], json!("skipped"));
        assert_eq!(
            row(&report, "summarize_notes_tt")["status"],
            json!(STATUS_UNVERIFIED)
        );

        // Never both: one row per subject, the stray plan entry dropped.
        let results = report["results"].as_array().unwrap();
        assert_eq!(results.len(), 9, "{report}");
        let mut subjects: Vec<&str> = results
            .iter()
            .map(|r| r["tool_name"].as_str().unwrap())
            .collect();
        subjects.sort();
        subjects.dedup();
        assert_eq!(subjects.len(), 9, "a subject was reported twice: {report}");

        // The LLM saw ONLY the leftover subset, once.
        let prompts = rec.prompts.lock().unwrap().clone();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("nocheck_tt") && prompts[0].contains("summarize_notes_tt"));
        for scripted in ["mockapi_bad_tt", "slow_tt", "missing_tt", "\"mockapi_tt\""] {
            assert!(
                !prompts[0].contains(scripted),
                "{scripted} leaked into the LLM prompt"
            );
        }

        // Counters the promote gate and the frontend read.
        assert_eq!(report["tools_passed"], json!(4));
        assert_eq!(report["tools_failed"], json!(3));
        assert_eq!(report["tools_tested"], json!(7));
        assert_eq!(report["tools_skipped"], json!(1));
        assert_eq!(report["tools_unverified"], json!(1));
        assert_eq!(
            report["credential_issues"],
            json!([{
                "connector": "missing_tt",
                "issue": "No credential found for connector 'missing_tt'. Add it in Keys section."
            }])
        );
        assert_eq!(report["test_mode"], json!("hybrid"));
        // A plan was parsed, so the summary model wrote the report.
        assert_eq!(rec.summaries.load(Ordering::SeqCst), 1);
        assert_eq!(
            report["summary"],
            json!("### Overview\nwritten by the summary model")
        );

        // One event per row, numbered in order.
        let emitted = rec.emitted.lock().unwrap().clone();
        assert_eq!(emitted.len(), 9);
        assert!(emitted.iter().enumerate().all(|(i, e)| e.2 == i + 1));

        // Shape: every row carries exactly the frontend `ToolTestResult` keys,
        // `connectors_resolved` is `{name, has_credential}` objects.
        let mut want = ROW_KEYS.to_vec();
        want.sort();
        for r in results {
            let mut keys: Vec<&str> = r.as_object().unwrap().keys().map(|k| k.as_str()).collect();
            keys.sort();
            assert_eq!(keys, want, "row shape drifted: {r}");
        }
        let resolved = report["connectors_resolved"].as_array().unwrap();
        assert_eq!(
            resolved.len(),
            5,
            "platform connectors are not credential subjects"
        );
        for c in resolved {
            let obj = c.as_object().unwrap();
            assert_eq!(obj.len(), 2);
            assert!(
                obj["name"].is_string() && obj["has_credential"].is_boolean(),
                "{c}"
            );
        }
        assert!(resolved.contains(&json!({"name": "missing_tt", "has_credential": false})));
        assert!(resolved.contains(&json!({"name": "mockapi_tt", "has_credential": true})));
    }

    #[tokio::test]
    async fn a_fully_scriptable_build_never_calls_either_llm() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        let (port, good_hits) = (api.port, api.good_hits.clone());
        seed_api_connector(
            &pool,
            "mockapi_tt",
            Some(format!("http://127.0.0.1:{port}/v1/me")),
        );
        seed_api_key(&pool, "mockapi_tt", "good-token");

        let rec = Arc::new(Recorder::default());
        let report = run_with(
            &pool,
            &["mockapi_tt_list", "web_search"],
            &["mockapi_tt", "personas_messages"],
            &["mockapi_tt"],
            Err("the plan CLI must not be spawned".into()),
            true,
            rec.clone(),
        )
        .await
        .unwrap();

        assert!(
            rec.prompts.lock().unwrap().is_empty(),
            "the plan LLM was called"
        );
        assert_eq!(
            rec.summaries.load(Ordering::SeqCst),
            0,
            "the summary LLM was called"
        );
        assert_eq!(good_hits.load(Ordering::SeqCst), 1);
        assert_eq!(report["test_mode"], json!("scripted"));
        assert_eq!(report["tools_passed"], json!(3));
        assert_eq!(report["tools_failed"], json!(0));
        assert_eq!(report["tools_unverified"], json!(0));
        assert!(report.get("test_plan_parsed").is_none());
        let summary = report["summary"]
            .as_str()
            .expect("a scripted run still writes a summary");
        assert_summary_is_modal_readable(summary, &report);
        assert_eq!(rec.emitted.lock().unwrap().len(), 3);
    }

    #[tokio::test]
    async fn a_failing_plan_cli_degrades_only_the_leftover_subset() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        let port = api.port;
        seed_api_connector(
            &pool,
            "mockapi_tt",
            Some(format!("http://127.0.0.1:{port}/v1/me")),
        );
        seed_api_key(&pool, "mockapi_tt", "good-token");
        seed_api_connector(&pool, "nocheck_tt", None);
        seed_api_key(&pool, "nocheck_tt", "good-token");

        let rec = Arc::new(Recorder::default());
        let report = run_with(
            &pool,
            &["http_request"],
            &["mockapi_tt", "nocheck_tt"],
            &["mockapi_tt", "nocheck_tt"],
            Err("claude not on PATH".into()),
            true,
            rec,
        )
        .await
        .expect("real verdicts in hand must not be thrown away");

        assert_eq!(row(&report, "mockapi_tt")["status"], json!("passed"));
        // No plan for the unscriptable connector: the no-plan fallback's
        // honest `unverified`, which holds promotion.
        assert_eq!(
            row(&report, "nocheck_tt")["status"],
            json!(STATUS_UNVERIFIED)
        );
        assert_eq!(report["test_plan_parsed"], json!(false));
        assert_eq!(report["tools_unverified"], json!(1));
        assert_summary_is_modal_readable(report["summary"].as_str().unwrap(), &report);
    }

    /// `PERSONAS_SCRIPTED_TOOL_TESTS=0`: nothing is probed, the whole IR goes
    /// to the LLM, and a no-plan answer yields exactly the old report.
    #[tokio::test]
    async fn the_override_restores_the_all_llm_path_and_its_report() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        let (port, good_hits) = (api.port, api.good_hits.clone());
        seed_api_connector(
            &pool,
            "mockapi_tt",
            Some(format!("http://127.0.0.1:{port}/v1/me")),
        );
        seed_api_key(&pool, "mockapi_tt", "good-token");

        let rec = Arc::new(Recorder::default());
        let report = run_with(
            &pool,
            &["http_request"],
            &["mockapi_tt", "missing_tt"],
            &["mockapi_tt"],
            Ok(vec![]),
            false,
            rec.clone(),
        )
        .await
        .unwrap();

        assert_eq!(
            good_hits.load(Ordering::SeqCst),
            0,
            "the legacy path must not probe"
        );
        let prompts = rec.prompts.lock().unwrap().clone();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("mockapi_tt") && prompts[0].contains("missing_tt"));

        let mut expected = build_no_plan_fallback(
            &["http_request".to_string()],
            &[
                ("mockapi_tt".to_string(), true),
                ("missing_tt".to_string(), false),
            ],
        );
        let obj = expected.as_object_mut().unwrap();
        obj.insert(
            "connectors_resolved".into(),
            json!([
                {"name": "mockapi_tt", "has_credential": true},
                {"name": "missing_tt", "has_credential": false}
            ]),
        );
        obj.insert("test_mode".into(), json!("llm"));
        assert_eq!(report, expected);
        assert!(
            rec.emitted.lock().unwrap().is_empty(),
            "the no-plan path never emitted"
        );
    }

    #[tokio::test]
    async fn the_override_still_propagates_a_plan_cli_that_will_not_start() {
        let pool = init_test_db().unwrap();
        let err = run_with(
            &pool,
            &["http_request"],
            &["notion"],
            &[],
            Err("spawn failed".into()),
            false,
            Arc::new(Recorder::default()),
        )
        .await
        .expect_err("with nothing scripted the old error contract holds");
        assert!(matches!(err, AppError::ProcessSpawn(_)));
    }

    // =====================================================================
    // Real draft shapes (2026-09-26 live check)
    // =====================================================================
    //
    // A build draft's `agent_ir` is v3-shaped: tools in `persona.tools[]`,
    // connectors in `persona.connectors[]`, per-capability `tool_hints[]`, and
    // NO top-level `tools` / `required_connectors`. The drafts below are the
    // live-check drafts trimmed to the fields this module reads.

    // ── the tool -> connector mapping ────────────────────────────────────

    #[test]
    fn real_tool_names_map_to_the_connector_the_draft_binds() {
        let bound = vec![
            ConnectorKeys {
                name: "linear".into(),
                service_type: Some("linear".into()),
                catalog_tools: vec![],
            },
            ConnectorKeys {
                name: "leonardo_ai".into(),
                ..Default::default()
            },
            ConnectorKeys {
                name: "google_calendar".into(),
                ..Default::default()
            },
            ConnectorKeys {
                name: "personas_messages".into(),
                service_type: None,
                catalog_tools: vec!["send_notification".into(), "send_message".into()],
            },
            ConnectorKeys {
                name: "email".into(),
                service_type: Some("gmail".into()),
                catalog_tools: vec![],
            },
        ]
        .into_iter()
        .chain(keys(&[
            "sentry",
            "notion",
            "github",
            "github_actions",
            "airtable",
            "alpha_vantage",
            "cal_com",
        ]))
        .collect::<Vec<_>>();
        let map = |t: &str| backing_connector(t, None, &bound);

        // Every connector-backed tool name the seven live drafts carried.
        for (tool, want) in [
            ("linear_issues_list", "linear"),
            ("linear_issues_search", "linear"),
            ("linear_create_issue", "linear"),
            ("sentry_list_issues", "sentry"),
            ("sentry_get_issue_stats", "sentry"),
            ("notion_create_page", "notion"),
            ("notion_append_block", "notion"),
            ("github_read_pr", "github"),
            ("airtable_create_record", "airtable"),
            ("airtable_query_records", "airtable"),
            // The prefix is the catalog name minus its vendor suffix.
            ("leonardo_generate_image", "leonardo_ai"),
            ("alpha_vantage_quote", "alpha_vantage"),
            ("alpha_vantage_time_series", "alpha_vantage"),
            ("google_calendar_list_events", "google_calendar"),
            ("google_calendar_create_event", "google_calendar"),
            // Adopted drafts: a role name bound to a concrete service_type.
            ("gmail_send", "email"),
            ("gmail_send_email", "email"),
            ("gmail_get_attachment", "email"),
            // The catalog's declared services.
            ("send_message", "personas_messages"),
            // The longest key wins over its own prefix.
            ("github_actions_list_runs", "github_actions"),
            ("cal_list_bookings", "cal_com"),
        ] {
            assert_eq!(map(tool), Some(want), "{tool}");
        }

        // Conduits, built-ins and unrelated names are nobody's.
        for tool in [
            "http_request",
            "web_fetch",
            "data_processing",
            "ai_generation",
            "file_read",
            "vector_store_upsert",
            "calendar_sync",
            "linearize_text",
        ] {
            assert_eq!(map(tool), None, "{tool}");
        }

        // A declared connector decides, even against the name.
        assert_eq!(
            backing_connector("create_ticket", Some("Linear"), &bound),
            Some("linear")
        );
        // …and a tool the draft ties to an UNBOUND service is not
        // re-assigned to a bound one because of its name.
        assert_eq!(
            backing_connector("notion_create_page", Some("confluence"), &bound),
            None
        );
        // Two connectors claiming one catalog tool decide nothing.
        let both = vec![
            ConnectorKeys {
                name: "codebase".into(),
                service_type: None,
                catalog_tools: vec!["read_file".into()],
            },
            ConnectorKeys {
                name: "codebases".into(),
                service_type: None,
                catalog_tools: vec!["read_file".into()],
            },
        ];
        assert_eq!(backing_connector("read_file", None, &both), None);
    }

    /// The whole seeded catalog bound at once (the worst case for
    /// collisions): every tool a catalog connector declares maps to that
    /// connector or, when two connectors declare it, to nobody; and
    /// `<name>_x` maps to `<name>` for every connector — no stem or shorter
    /// name steals another connector's tools.
    #[test]
    fn the_mapping_is_sound_across_the_real_connector_catalog() {
        let pool = init_test_db().unwrap();
        let catalog = crate::db::repos::resources::connectors::get_all(&pool).unwrap();
        assert!(catalog.len() > 100, "the builtin catalog was not seeded");
        let bound: Vec<ConnectorKeys> = catalog
            .iter()
            .map(|c| ConnectorKeys {
                name: c.name.clone(),
                service_type: None,
                catalog_tools: catalog_service_tools(&c.services),
            })
            .collect();
        let mut declared = 0usize;
        for c in &bound {
            for tool in &c.catalog_tools {
                declared += 1;
                let claimants = bound
                    .iter()
                    .filter(|o| o.catalog_tools.contains(tool))
                    .count();
                let got = backing_connector(tool, None, &bound);
                if claimants == 1 {
                    assert_eq!(got, Some(c.name.as_str()), "{tool}");
                } else {
                    assert_ne!(got, Some(c.name.as_str()), "{tool} is claimed twice");
                }
            }
            let probe = format!("{}_list_items", c.name.to_lowercase());
            assert_eq!(
                backing_connector(&probe, None, &bound),
                Some(c.name.as_str()),
                "{probe}"
            );
        }
        assert!(declared > 50, "the catalog declares its services");
    }

    #[test]
    fn a_v3_draft_is_read_from_its_persona_block_and_tool_hints() {
        let ir: crate::db::models::AgentIr = serde_json::from_value(json!({
            "name": "Morning Motivator",
            "persona": {
                "tools": [
                    {"category": "connector", "name": "gmail_send"},
                    {"category": "connector", "name": "crm_lookup", "connector": "hubspot"},
                    "ai_generation"
                ],
                "connectors": [
                    {"name": "gmail", "service_type": "gmail", "has_credential": true, "purpose": "send"},
                    "hubspot",
                    {"name": "Gmail"}
                ]
            },
            "use_cases": [
                {"id": "uc_note", "tool_hints": ["gmail_send", "web_fetch"], "connectors": ["gmail"]}
            ]
        }))
        .unwrap();
        let s = draft_test_subjects(&ir);
        let names: Vec<&str> = s.tools.iter().map(|t| t.name()).collect();
        assert_eq!(
            names,
            vec!["gmail_send", "crm_lookup", "ai_generation", "web_fetch"]
        );
        assert_eq!(
            s.tools[1]
                .data()
                .and_then(|d| d.requires_credential_type.as_deref()),
            Some("hubspot"),
            "a tool's declared connector is kept"
        );
        let conns: Vec<&str> = s.connectors.iter().filter_map(|c| c.name()).collect();
        assert_eq!(conns, vec!["gmail", "hubspot"]);

        // The flat list, when present, wins outright (post-binding names).
        let flat: crate::db::models::AgentIr = serde_json::from_value(json!({
            "required_connectors": [{"name": "gmail", "service_type": "gmail"}],
            "persona": {"connectors": [{"name": "email"}]}
        }))
        .unwrap();
        let conns: Vec<String> = draft_test_subjects(&flat)
            .connectors
            .iter()
            .filter_map(|c| c.name().map(str::to_string))
            .collect();
        assert_eq!(conns, vec!["gmail"]);
    }

    // ── end to end on real drafts ─────────────────────────────────────────

    /// Point a REAL catalog connector's declared healthcheck at the mock API
    /// (bearer header, private network allowed); its catalog `services` stay.
    fn point_catalog_connector_at(pool: &DbPool, name: &str, endpoint: &str) {
        let def = crate::db::repos::resources::connectors::get_all(pool)
            .unwrap()
            .into_iter()
            .find(|c| c.name == name)
            .unwrap_or_else(|| panic!("{name} is not in the seeded catalog"));
        crate::db::repos::resources::connectors::update(
            pool,
            &def.id,
            crate::db::models::UpdateConnectorDefinitionInput {
                name: None,
                label: None,
                icon_url: None,
                color: None,
                category: None,
                fields: None,
                healthcheck_config: Some(Some(
                    json!({
                        "endpoint": endpoint,
                        "method": "GET",
                        "headers": { "Authorization": "Bearer {{api_key}}" }
                    })
                    .to_string(),
                )),
                services: None,
                events: None,
                metadata: Some(Some(json!({ "allow_private_network": true }).to_string())),
            },
        )
        .unwrap();
    }

    /// Drive a real draft through the production subject reader and the
    /// scripted orchestrator.
    async fn run_draft(
        pool: &DbPool,
        draft: serde_json::Value,
        vault_types: &[&str],
        rec: Arc<Recorder>,
    ) -> serde_json::Value {
        crate::engine::connector_strategy::init_registry();
        let ir: crate::db::models::AgentIr = serde_json::from_value(draft).unwrap();
        let DraftSubjects { tools, connectors } = draft_test_subjects(&ir);
        let matcher = vault_matcher(vault_types);
        let rec_c = rec.clone();
        let compose =
            move |p: String| -> BoxFuture<'static, Result<Vec<serde_json::Value>, AppError>> {
                rec_c.prompts.lock().unwrap().push(p);
                Box::pin(async { Ok(Vec::new()) })
            };
        let rec_s = rec.clone();
        let summary = move |_json: String,
                            _c: SummaryCounts|
              -> BoxFuture<'static, Result<String, AppError>> {
            rec_s.summaries.fetch_add(1, Ordering::SeqCst);
            Box::pin(async { Ok("### Overview\nmodel".to_string()) })
        };
        let rec_e = rec.clone();
        let emit = move |r: &tool_runner::ToolTestResult, tested: usize, total: usize| {
            rec_e.emitted.lock().unwrap().push((
                r.tool_name.clone(),
                r.status.clone(),
                tested,
                total,
            ));
        };
        run_resolved_tests(
            pool,
            &ResolvedTestContext {
                session_id: "sess-draft",
                tools: &tools,
                required_connectors: &connectors,
                cred_context: "",
                env_vars: &[],
                matcher: &matcher,
            },
            &TestSeams {
                compose_plan: &compose,
                write_summary: &summary,
                emit: &emit,
            },
            TestStrategy {
                scripted: true,
                lanes: SCRIPTED_TEST_LANES,
                per_test_timeout: Duration::from_secs(5),
            },
        )
        .await
        .unwrap()
    }

    /// `(tool_name, connector, status, http_status)` per row, in report order.
    fn rows(report: &serde_json::Value) -> Vec<(String, Option<String>, String, Option<u64>)> {
        report["results"]
            .as_array()
            .unwrap()
            .iter()
            .map(|r| {
                (
                    r["tool_name"].as_str().unwrap().to_string(),
                    r["connector"].as_str().map(str::to_string),
                    r["status"].as_str().unwrap().to_string(),
                    r["http_status"].as_u64(),
                )
            })
            .collect()
    }

    fn r(
        tool: &str,
        connector: Option<&str>,
        status: &str,
        http: Option<u64>,
    ) -> (String, Option<String>, String, Option<u64>) {
        (
            tool.to_string(),
            connector.map(str::to_string),
            status.to_string(),
            http,
        )
    }

    /// Everything a fully scripted run must NOT do, and the shape it must keep.
    fn assert_fully_scripted(report: &serde_json::Value, rec: &Recorder) {
        assert_eq!(report["test_mode"], json!("scripted"), "{report}");
        assert!(
            rec.prompts.lock().unwrap().is_empty(),
            "the Sonnet plan was called: {report}"
        );
        assert_eq!(rec.summaries.load(Ordering::SeqCst), 0);
        let n = report["results"].as_array().unwrap().len();
        let emitted = rec.emitted.lock().unwrap().clone();
        assert_eq!(emitted.len(), n, "one event per row");
        assert!(emitted
            .iter()
            .enumerate()
            .all(|(i, e)| e.2 == i + 1 && e.3 == n));
        assert_summary_is_modal_readable(report["summary"].as_str().unwrap(), report);
    }

    #[tokio::test]
    async fn a_linear_digest_draft_is_fully_scripted() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        point_catalog_connector_at(
            &pool,
            "linear",
            &format!("http://127.0.0.1:{}/v1/me", api.port),
        );
        seed_api_key(&pool, "linear", "good-token");

        let rec = Arc::new(Recorder::default());
        let report = run_draft(
            &pool,
            json!({
                "name": "Linear Morning Digest",
                "persona": {
                    "tools": [
                        {"category": "connector", "name": "linear_issues_list"},
                        {"category": "connector", "name": "linear_issues_search"},
                        {"category": "built_in", "name": "data_processing"},
                        {"category": "connector", "name": "send_message"}
                    ],
                    "connectors": [
                        {"has_credential": true, "name": "linear", "service_type": "linear"},
                        {"has_credential": true, "name": "personas_messages", "service_type": "personas_messages"}
                    ]
                },
                "use_cases": [{
                    "id": "uc_morning_linear_digest",
                    "tool_hints": ["linear_issues_list", "linear_issues_search", "data_processing"],
                    "connectors": ["linear", "personas_messages"]
                }]
            }),
            &["linear"],
            rec.clone(),
        )
        .await;

        assert_eq!(
            rows(&report),
            vec![
                r(
                    "personas_messages",
                    Some("personas_messages"),
                    "passed",
                    None
                ),
                r("data_processing", None, "passed", None),
                r("linear", Some("linear"), "passed", Some(200)),
            ]
        );
        assert_eq!(api.good_hits.load(Ordering::SeqCst), 1);
        assert_fully_scripted(&report, &rec);
        assert_eq!(
            report["connectors_resolved"],
            json!([{"name": "linear", "has_credential": true}])
        );
        assert_eq!(report["tools_passed"], json!(3));
        assert_eq!(report["tools_failed"], json!(0));
    }

    #[tokio::test]
    async fn a_sentry_linear_notion_incident_draft_scripts_every_connector() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        let me = format!("http://127.0.0.1:{}/v1/me", api.port);
        for name in ["sentry", "linear", "notion"] {
            point_catalog_connector_at(&pool, name, &me);
        }
        seed_api_key(&pool, "sentry", "good-token");
        seed_api_key(&pool, "linear", "good-token");
        // A revoked key: a real verdict, reported — never re-tried via the LLM.
        seed_api_key(&pool, "notion", "revoked-token");

        let rec = Arc::new(Recorder::default());
        let report = run_draft(
            &pool,
            json!({
                "name": "Sentry Incident Sentinel",
                "persona": {
                    "tools": [
                        {"category": "connector", "name": "sentry_list_issues"},
                        {"category": "connector", "name": "sentry_get_issue_stats"},
                        {"category": "connector", "name": "linear_create_issue"},
                        {"category": "connector", "name": "notion_create_page"},
                        {"category": "connector", "name": "notion_append_block"}
                    ],
                    "connectors": [
                        {"has_credential": true, "name": "sentry", "service_type": "sentry"},
                        {"has_credential": true, "name": "linear", "service_type": "linear"},
                        {"has_credential": true, "name": "notion", "service_type": "notion"}
                    ]
                },
                "use_cases": [
                    {"id": "uc_spike_detection", "tool_hints": ["sentry_list_issues", "sentry_get_issue_stats"], "connectors": ["sentry"]},
                    {"id": "uc_linear_ticket", "tool_hints": ["linear_create_issue"], "connectors": ["linear"]},
                    {"id": "uc_notion_incident_log", "tool_hints": ["notion_create_page", "notion_append_block"], "connectors": ["notion"]}
                ]
            }),
            &["sentry", "linear", "notion"],
            rec.clone(),
        )
        .await;

        assert_eq!(
            rows(&report),
            vec![
                r("sentry", Some("sentry"), "passed", Some(200)),
                r("linear", Some("linear"), "passed", Some(200)),
                r("notion", Some("notion"), "failed", Some(401)),
            ]
        );
        assert_eq!(api.good_hits.load(Ordering::SeqCst), 2);
        assert_fully_scripted(&report, &rec);
        assert_eq!(report["tools_passed"], json!(2));
        assert_eq!(report["tools_failed"], json!(1));
        assert_eq!(report["connectors_resolved"].as_array().unwrap().len(), 3);
    }

    /// Live-check S5: `test_mode: scripted` with three conduit rows and its
    /// GitHub / Airtable connectors never tested, because the capability
    /// hints named only conduits and `persona.tools` / `persona.connectors`
    /// were never read.
    #[tokio::test]
    async fn a_github_airtable_leonardo_pr_reviewer_tests_every_connector() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        let me = format!("http://127.0.0.1:{}/v1/me", api.port);
        for name in ["github", "airtable", "leonardo_ai"] {
            point_catalog_connector_at(&pool, name, &me);
            seed_api_key(&pool, name, "good-token");
        }

        let rec = Arc::new(Recorder::default());
        let report = run_draft(
            &pool,
            json!({
                "name": "PR Risk Radar",
                "persona": {
                    "tools": [
                        {"category": "connector", "name": "github_read_pr"},
                        {"category": "connector", "name": "airtable_create_record"},
                        {"category": "connector", "name": "airtable_query_records"},
                        {"category": "connector", "name": "leonardo_generate_image"},
                        {"category": "connector", "name": "gmail_send_email"},
                        {"category": "built-in", "name": "web_fetch"},
                        {"category": "built-in", "name": "data_processing"},
                        {"category": "built-in", "name": "ai_generation"}
                    ],
                    "connectors": [
                        {"has_credential": true, "name": "github", "service_type": "github"},
                        {"has_credential": true, "name": "airtable", "service_type": "airtable"},
                        {"has_credential": true, "name": "leonardo_ai", "service_type": "leonardo_ai"},
                        {"has_credential": true, "name": "gmail", "service_type": "gmail"}
                    ]
                },
                "use_cases": [
                    {"id": "uc_pr_risk_review", "tool_hints": ["web_fetch", "data_processing", "ai_generation"], "connectors": ["github", "airtable"]},
                    {"id": "uc_weekly_engineering_report", "tool_hints": ["ai_generation", "data_processing"], "connectors": ["airtable", "leonardo_ai", "gmail"]}
                ]
            }),
            &["github", "airtable", "leonardo_ai"],
            rec.clone(),
        )
        .await;

        assert_eq!(
            rows(&report),
            vec![
                // No vault credential for Gmail at all: its row, not a skip.
                r("gmail", Some("gmail"), "credential_missing", None),
                r("web_fetch", None, "passed", None),
                r("data_processing", None, "passed", None),
                r("ai_generation", None, "passed", None),
                r("github", Some("github"), "passed", Some(200)),
                r("airtable", Some("airtable"), "passed", Some(200)),
                r("leonardo_ai", Some("leonardo_ai"), "passed", Some(200)),
            ]
        );
        assert_eq!(api.good_hits.load(Ordering::SeqCst), 3);
        assert_fully_scripted(&report, &rec);
        assert_eq!(report["tools_failed"], json!(1));
        assert_eq!(
            report["credential_issues"],
            json!([{
                "connector": "gmail",
                "issue": "No credential found for connector 'gmail'. Add it in Keys section."
            }])
        );
    }

    /// A connector no tool names still gets its own health-check row, from
    /// the flat `required_connectors` shape and from a draft with no tools.
    #[tokio::test]
    async fn a_connector_with_no_tool_rows_still_gets_its_health_check() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        point_catalog_connector_at(
            &pool,
            "alpha_vantage",
            &format!("http://127.0.0.1:{}/v1/me", api.port),
        );
        seed_api_key(&pool, "alpha_vantage", "good-token");

        let rec = Arc::new(Recorder::default());
        let report = run_draft(
            &pool,
            json!({
                "name": "Finance Digest",
                "required_connectors": [{"name": "alpha_vantage", "service_type": "alpha_vantage"}],
                "use_cases": [{"id": "uc_morning_digest", "tool_hints": ["data_processing"]}]
            }),
            &["alpha_vantage"],
            rec.clone(),
        )
        .await;
        assert_eq!(
            rows(&report),
            vec![
                r("data_processing", None, "passed", None),
                r("alpha_vantage", Some("alpha_vantage"), "passed", Some(200)),
            ]
        );
        assert_fully_scripted(&report, &rec);

        let rec = Arc::new(Recorder::default());
        let report = run_draft(
            &pool,
            json!({
                "name": "Connector only",
                "persona": {"connectors": [{"name": "alpha_vantage", "service_type": "alpha_vantage"}]}
            }),
            &["alpha_vantage"],
            rec.clone(),
        )
        .await;
        assert_eq!(
            rows(&report),
            vec![r(
                "alpha_vantage",
                Some("alpha_vantage"),
                "passed",
                Some(200)
            )]
        );
        assert_fully_scripted(&report, &rec);
        assert_eq!(api.good_hits.load(Ordering::SeqCst), 2);
    }

    /// Only a genuinely unscriptable leftover reaches the plan: here a
    /// custom tool no connector backs. The bound connector's tools do not.
    #[tokio::test]
    async fn only_unbacked_tools_reach_the_plan() {
        let pool = init_test_db().unwrap();
        let api = spawn_mock_api().await;
        point_catalog_connector_at(
            &pool,
            "linear",
            &format!("http://127.0.0.1:{}/v1/me", api.port),
        );
        seed_api_key(&pool, "linear", "good-token");

        let rec = Arc::new(Recorder::default());
        let report = run_draft(
            &pool,
            json!({
                "persona": {
                    "tools": [
                        {"name": "linear_issues_list"},
                        {"name": "vector_store_upsert"}
                    ],
                    "connectors": [{"name": "linear", "service_type": "linear"}]
                }
            }),
            &["linear"],
            rec.clone(),
        )
        .await;
        assert_eq!(report["test_mode"], json!("hybrid"));
        let prompts = rec.prompts.lock().unwrap().clone();
        assert_eq!(prompts.len(), 1);
        assert!(prompts[0].contains("vector_store_upsert"));
        assert!(
            !prompts[0].contains("linear_issues_list") && !prompts[0].contains("\"linear\""),
            "a connector-backed tool leaked into the plan: {}",
            prompts[0]
        );
        assert_eq!(row(&report, "linear")["status"], json!("passed"));
    }
}
