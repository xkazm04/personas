//! Dry-run execution path for personas.
//!
//! Mirrors the runner's `Validate` stage — resolves credentials, validates the
//! capability contract, parses the model profile, assembles the full prompt —
//! but stops short of the `SpawnEngine` stage. Returns the assembled prompt
//! plus the planned tool surface so the UI can preview what an execution would
//! look like before any real CLI subprocess runs.
//!
//! By design we do **not** create a `persona_executions` row. The result is
//! returned synchronously and the dry-run trace is written to a log file under
//! the engine's `log_dir` so power users can reuse the existing log surface to
//! inspect it. Skipping DB persistence keeps dry runs out of every existing
//! metric query, dashboard, and activity feed — the simplest possible isolation
//! from real execution metrics.

use std::sync::Arc;
use ts_rs::TS;
use uuid::Uuid;

use crate::db::repos::core::personas as persona_repo;
use crate::db::repos::resources::{automations as automation_repo, tools as tool_repo};
use crate::engine::automation_runner::automation_to_virtual_tool;
use crate::engine::capability_contract::{self, ContractReport};
use crate::engine::logger::ExecutionLogger;
use crate::engine::prompt;
use crate::engine::runner::resolve_credential_env_vars;
use crate::error::AppError;
use crate::AppState;

/// Tool entry presented in the dry-run report. `requires_credential_type` is
/// surfaced so the UI can correlate the planned tool surface with the
/// credential-resolution outcome.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub struct DryRunTool {
    pub name: String,
    pub category: String,
    pub requires_credential_type: Option<String>,
}

/// Result of running the validate-stage checks for a persona without spawning
/// an engine subprocess. All sensitive material (credential values, auth
/// tokens) is intentionally excluded — only the resolved *shape* of the run
/// surfaces here.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, TS)]
#[ts(export)]
pub struct DryRunReport {
    /// Synthetic id used for the log file name and trace correlation.
    pub dry_run_id: String,
    /// `true` when every validate check passed and the engine would have
    /// proceeded to `SpawnEngine`. Soft warnings do not flip this to `false`.
    pub success: bool,
    /// Persona that was validated.
    pub persona_id: String,
    pub persona_name: String,
    /// Resolved model name (post-cascade). `None` when the persona has no
    /// `model_profile.model` configured.
    pub model: Option<String>,
    /// Provider that would handle the call (e.g. "anthropic", "ollama").
    pub provider: Option<String>,
    /// Full assembled prompt that would be sent to the engine.
    pub prompt: String,
    #[ts(type = "number")]
    pub prompt_chars: i64,
    /// Tool surface that would have been exposed to the engine.
    pub tools: Vec<DryRunTool>,
    /// Names of connectors whose credentials resolved cleanly.
    pub resolved_credentials: Vec<String>,
    /// Connector names whose credentials failed to decrypt. Non-empty here
    /// flips `success` to false.
    pub credential_failures: Vec<String>,
    /// Capability-contract diagnostics (missing connectors / personas /
    /// automations).
    pub contract_report: Option<ContractReport>,
    /// Soft warnings (e.g. unmet contracts, missing credentials) — surfaced
    /// to the UI without aborting the dry run.
    pub warnings: Vec<String>,
    /// Hard error message if `success == false`.
    pub error: Option<String>,
    /// Path to the on-disk log file written for this dry run.
    pub log_file_path: Option<String>,
}

/// Run the validate-stage checks for `persona_id` and return a `DryRunReport`.
///
/// The function intentionally does not consume connector OAuth grants — it
/// uses [`resolve_credential_env_vars`] for the credential pass which is the
/// same path the real runner uses, so any OAuth refresh that the runner would
/// have performed will also happen here. This is intentional: refreshing
/// stale tokens before a real run is a feature, not a side effect to avoid.
pub async fn dry_run_persona(
    state: &Arc<AppState>,
    persona_id: &str,
    input_data: Option<String>,
    use_case_id: Option<String>,
) -> Result<DryRunReport, AppError> {
    let dry_run_id = format!("dryrun-{}", Uuid::new_v4());

    // Open a logger early so we capture diagnostics even on hard validation
    // failures. Best-effort: if log dir creation fails, we proceed without it.
    let log_dir = state.engine.log_dir().to_path_buf();
    let mut logger = ExecutionLogger::new(&log_dir, &dry_run_id).ok();
    let log_file_path = logger
        .as_ref()
        .map(|l| l.path().to_string_lossy().to_string());
    let log = |logger: &mut Option<ExecutionLogger>, msg: &str| {
        if let Some(ref mut l) = logger {
            l.log(msg);
        }
    };

    log(&mut logger, "=== Persona Dry Run Started ===");
    log(&mut logger, &format!("Dry run ID: {dry_run_id}"));
    log(&mut logger, &format!("Persona: {persona_id}"));
    if let Some(ref uc) = use_case_id {
        log(&mut logger, &format!("Use case: {uc}"));
    }

    // -- Load persona ------------------------------------------------------
    let mut persona = match persona_repo::get_by_id(&state.db, persona_id) {
        Ok(p) => p,
        Err(e) => {
            let msg = format!("Failed to load persona: {e}");
            log(&mut logger, &format!("[ABORT] {msg}"));
            if let Some(ref mut l) = logger {
                l.close();
            }
            return Ok(DryRunReport {
                dry_run_id,
                success: false,
                persona_id: persona_id.to_string(),
                persona_name: String::new(),
                model: None,
                provider: None,
                prompt: String::new(),
                prompt_chars: 0,
                tools: Vec::new(),
                resolved_credentials: Vec::new(),
                credential_failures: Vec::new(),
                contract_report: None,
                warnings: Vec::new(),
                error: Some(msg),
                log_file_path,
            });
        }
    };

    // 1b. Auto-expand use_case_id into input_data._use_case (mirror runner).
    let mut input_data = input_data;
    if let Some(uc_id) = use_case_id.as_ref() {
        let Some(dc_str) = persona.design_context.as_deref() else {
            let msg = format!(
                "Persona '{}' has no design_context but use_case_id='{}' was requested",
                persona.name, uc_id
            );
            log(&mut logger, &format!("[ABORT] {msg}"));
            if let Some(ref mut l) = logger {
                l.close();
            }
            return Ok(DryRunReport {
                dry_run_id,
                success: false,
                persona_id: persona.id.clone(),
                persona_name: persona.name.clone(),
                model: None,
                provider: None,
                prompt: String::new(),
                prompt_chars: 0,
                tools: Vec::new(),
                resolved_credentials: Vec::new(),
                credential_failures: Vec::new(),
                contract_report: None,
                warnings: Vec::new(),
                error: Some(msg),
                log_file_path,
            });
        };
        if let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_str) {
            if let Some(use_case) = crate::engine::design_context::pick_use_cases_array(&dc)
                .and_then(|arr| {
                    arr.iter()
                        .find(|uc| uc.get("id").and_then(|v| v.as_str()) == Some(uc_id))
                })
                .cloned()
            {
                let mut merged: serde_json::Map<String, serde_json::Value> = input_data
                    .as_deref()
                    .filter(|s| !s.trim().is_empty())
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
                    .and_then(|v| v.as_object().cloned())
                    .unwrap_or_default();
                merged
                    .entry("_use_case".to_string())
                    .or_insert_with(|| use_case.clone());
                if let Some(tf) = use_case.get("time_filter").cloned() {
                    merged.entry("_time_filter".to_string()).or_insert(tf);
                }
                input_data = Some(serde_json::to_string(&merged).unwrap_or_default());
                if let Some(mo) = use_case.get("model_override") {
                    if !mo.is_null() {
                        persona.model_profile = Some(mo.to_string());
                    }
                }
            }
        }
    }

    // -- Load tools (mirror execute_persona_inner step 5) ------------------
    let mut tools = tool_repo::get_tools_for_persona(&state.db, persona_id)?;
    if let Ok(automations) = automation_repo::get_by_persona(&state.db, persona_id) {
        for auto in &automations {
            if auto.deployment_status.is_runnable() {
                tools.push(automation_to_virtual_tool(auto));
            }
        }
    }
    log(&mut logger, &format!("Tools resolved: {}", tools.len()));

    // -- Capability contract pre-check ------------------------------------
    let mut warnings: Vec<String> = Vec::new();
    let contract_report = capability_contract::validate_persona_contracts(&state.db, persona_id)
        .ok();
    if let Some(ref report) = contract_report {
        if !report.all_satisfied {
            for u in &report.unmet {
                warnings.push(format!("Unmet capability: {}", u.reason));
            }
            log(
                &mut logger,
                &format!(
                    "[WARN] Capability contract: {} unmet requirement(s)",
                    report.unmet.len()
                ),
            );
        }
    }

    // -- Credential resolution --------------------------------------------
    let (_cred_env, _cred_hints, cred_failures, injected_connectors) =
        resolve_credential_env_vars(&state.db, &tools, &persona.id, &persona.name).await;

    let mut resolved_credentials = injected_connectors.clone();
    resolved_credentials.sort();
    resolved_credentials.dedup();

    log(
        &mut logger,
        &format!(
            "Credential resolution: {} connector(s) resolved, {} failure(s)",
            resolved_credentials.len(),
            cred_failures.len()
        ),
    );

    let mut hard_error: Option<String> = None;
    if !cred_failures.is_empty() {
        let msg = format!(
            "Credential decryption failed for: {}. Re-enter or rotate these credentials before running.",
            cred_failures.join(", ")
        );
        log(&mut logger, &format!("[FAIL] {msg}"));
        hard_error = Some(msg);
    }

    // -- Model resolution --------------------------------------------------
    let model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());
    let model = model_profile.as_ref().and_then(|m| m.model.clone());
    let provider = model_profile.as_ref().and_then(|m| m.provider.clone());
    log(
        &mut logger,
        &format!(
            "Model resolved: model={:?} provider={:?}",
            model.as_deref().unwrap_or("<default>"),
            provider.as_deref().unwrap_or("<default>"),
        ),
    );

    // -- Parse input data --------------------------------------------------
    let input_json: Option<serde_json::Value> = input_data
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .map(|s| {
            serde_json::from_str(s).unwrap_or_else(|_| {
                serde_json::json!({ "user_input": s })
            })
        });

    // -- Assemble prompt (same path as the real runner) -------------------
    let prompt_text = prompt::assemble_prompt(
        &persona,
        &tools,
        input_json.as_ref(),
        None, // credential hints intentionally excluded from preview surface
        None, // workspace instructions not resolved in dry-run for now
        None, // connector usage hints
        #[cfg(feature = "desktop")]
        None,
    );
    let prompt_chars = prompt_text.chars().count() as i64;
    log(
        &mut logger,
        &format!("Prompt assembled: {prompt_chars} characters"),
    );

    let dry_run_tools: Vec<DryRunTool> = tools
        .iter()
        .map(|t| DryRunTool {
            name: t.name.clone(),
            category: t.category.clone(),
            requires_credential_type: t.requires_credential_type.clone(),
        })
        .collect();

    let success = hard_error.is_none();
    log(
        &mut logger,
        &format!("=== Persona Dry Run Finished (success={success}) ==="),
    );
    if let Some(ref mut l) = logger {
        l.close();
    }

    Ok(DryRunReport {
        dry_run_id,
        success,
        persona_id: persona.id.clone(),
        persona_name: persona.name.clone(),
        model,
        provider,
        prompt: prompt_text,
        prompt_chars,
        tools: dry_run_tools,
        resolved_credentials,
        credential_failures: cred_failures,
        contract_report,
        warnings,
        error: hard_error,
        log_file_path,
    })
}
