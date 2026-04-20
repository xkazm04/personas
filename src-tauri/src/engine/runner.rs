use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, LazyLock};
use super::events::emit_to;
use tokio::sync::Mutex;

use super::cli_process::{read_line_limited, CliProcessDriver};
use super::event_registry::event_name;
use crate::keyed_pool::{KeyedResourcePool, PoolHandle};

/// Per-credential mutex pool to prevent concurrent OAuth token refreshes from
/// racing. Uses [`KeyedResourcePool`] with RAII handles and automatic pruning
/// (every 32 acquisitions, threshold 8 entries).
static CREDENTIAL_REFRESH_LOCKS: LazyLock<KeyedResourcePool<String, Arc<Mutex<()>>>> =
    LazyLock::new(|| KeyedResourcePool::new(32, 8));

/// Acquire a per-credential refresh lock. The returned [`PoolHandle`] holds a
/// clone of the `Arc<Mutex<()>>` and decrements the active-user count when
/// dropped, making the entry eligible for future pruning.
fn credential_refresh_lock(credential_id: &str) -> PoolHandle<String, Arc<Mutex<()>>> {
    CREDENTIAL_REFRESH_LOCKS.acquire(credential_id.to_string(), || Arc::new(Mutex::new(())))
}

use crate::db::models::{Persona, PersonaToolDefinition, UpdateExecutionStatus};
use crate::db::repos::core::groups as group_repo;
use crate::db::repos::core::memories as mem_repo;
use crate::db::repos::execution::executions as exec_repo;
use crate::db::repos::execution::tool_usage as usage_repo;
use crate::db::repos::resources::{
    audit_log, connectors as connector_repo, credentials as cred_repo,
};
use crate::db::settings_keys;
use crate::db::DbPool;

use super::failover;
use super::logger::ExecutionLogger;
use super::parser;
use super::prompt;
use super::provider::{self, PromptDelivery};

/// Default per-execution stream timeout when `persona.timeout_ms <= 0`.
///
/// 11 minutes — deliberately above the Claude Code CLI 2.1.113 subagent-stall
/// cutoff (10 minutes) so the CLI's clearer mid-stream error surfaces before
/// personas' generic "timed out after 600s" fires. See
/// `.planning/handoffs/2026-04-17-claude-cli-2-1-111-adapter-drift.md` T6.
pub(crate) const DEFAULT_EXECUTION_TIMEOUT_MS: u64 = 660_000;
use super::trace::{SpanType, TraceCollector, TraceSpanEvent};
use super::types::*;

// =============================================================================
// Env var sanitization
// =============================================================================

/// Env var names that must never be overridden by credential/MCP field injection.
const BLOCKED_ENV_NAMES: &[&str] = &[
    // OS-level / linker injection
    "PATH", "LD_PRELOAD", "LD_LIBRARY_PATH",
    "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    // System identity & shell
    "HOME", "SHELL", "USER", "LOGNAME",
    "SYSTEMROOT", "COMSPEC", "WINDIR",
    "TEMP", "TMP",
    // Language runtime code-execution vectors
    "NODE_OPTIONS",       // --require= arbitrary module loading
    "NODE_PATH",          // hijack Node module resolution
    "PYTHONPATH",         // hijack Python imports
    "PYTHONSTARTUP",      // execute Python script at interpreter start
    "PERL5OPT",           // inject Perl command-line flags
    "PERL5LIB",           // hijack Perl module search path
    "RUBYOPT",            // inject Ruby flags (e.g. -r for require)
    "RUBYLIB",            // hijack Ruby load path
    "JAVA_TOOL_OPTIONS",  // JVM agent/flag injection
    "JAVA_OPTIONS",       // alternative JVM flag injection
    "_JAVA_OPTIONS",      // alternative JVM flag injection
    "CLASSPATH",          // hijack Java class loading
    "DOTNET_STARTUP_HOOKS", // .NET assembly injection at startup
    "BASH_ENV",           // execute script when bash starts non-interactively
    "ENV",                // execute script when sh starts
    "ZDOTDIR",            // redirect zsh config to attacker-controlled dir
];

/// Sanitize an env var name: strip non-alphanumeric/underscore chars, uppercase,
/// and check against the denylist. Returns `None` if the name is blocked or empty.
pub(crate) fn sanitize_env_name(name: &str) -> Option<String> {
    let sanitized: String = name
        .to_uppercase()
        .replace('-', "_")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_')
        .collect();

    if sanitized.is_empty() {
        return None;
    }

    if BLOCKED_ENV_NAMES.contains(&sanitized.as_str()) {
        tracing::warn!(env_var = %sanitized, "Blocked dangerous env var name from credential injection");
        return None;
    }

    Some(sanitized)
}

/// Run a persona execution: spawn Claude CLI, stream output, capture results.
///
/// Supports automatic provider failover: if the primary provider fails with a
/// retryable error (binary not found, rate limited, session limit), the next
/// available provider/model in the failover chain is tried automatically.
#[allow(clippy::too_many_arguments)]
pub async fn run_execution(
    emitter: Arc<dyn super::events::ExecutionEventEmitter>,
    pool: DbPool,
    execution_id: String,
    persona: Persona,
    tools: Vec<PersonaToolDefinition>,
    input_data: Option<serde_json::Value>,
    log_dir: PathBuf,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled: Arc<AtomicBool>,
    continuation: Option<Continuation>,
    chain_trace_id: Option<String>,
    circuit_breaker: Arc<super::failover::ProviderCircuitBreaker>,
) -> ExecutionResult {
    let start_time = std::time::Instant::now();

    // Initialize trace collector for structured execution tracing
    let trace = TraceCollector::new(&execution_id, &persona.id, chain_trace_id);

    // -- Pipeline Stage: Validate -----------------------------------------
    // Covers setup, workspace resolution, model parsing, and credential resolution.
    let validate_stage = trace.start_span(
        SpanType::PipelineStage,
        "Pipeline: Validate",
        None,
        Some(serde_json::json!({
            "pipeline_stage": "validate",
            "boundary": "Command -> DB reads",
        })),
    );

    // Set up logger
    let mut logger = match ExecutionLogger::new(&log_dir, &execution_id) {
        Ok(l) => l,
        Err(e) => {
            return ExecutionResult {
                success: false,
                error: Some(format!("Failed to create log file: {e}")),
                duration_ms: 0,
                ..default_result()
            };
        }
    };

    let log_file_path = logger.path().to_string_lossy().to_string();

    // Resolve workspace (group) defaults via the centralised cascade:
    // persona-level > workspace-level > global-level.
    // `config_merge::resolve_effective_config` logs which tier supplied each
    // value so the priority order is visible in traces.
    let workspace = persona
        .group_id
        .as_deref()
        .and_then(|gid| group_repo::get_by_id(&pool, gid).ok());

    let effective = super::config_merge::resolve_effective_config(
        &pool,
        &persona,
        workspace.as_ref(),
    );

    // Apply the resolved effective values back onto the persona so that
    // downstream code (prompt building, budget enforcement, etc.) sees the
    // cascaded result without duplicating the fallback logic.
    let mut persona = persona;
    if let Some(ref model_json) = effective.model.value {
        // Reconstruct a ModelProfile JSON that reflects all resolved fields,
        // preserving any agent-level fields not part of the cascade.
        let mut base = persona.model_profile.as_deref()
            .and_then(|s| serde_json::from_str::<serde_json::Value>(s).ok())
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();

        base.insert("model".into(), serde_json::Value::String(model_json.clone()));
        if let Some(ref p) = effective.provider.value {
            base.insert("provider".into(), serde_json::Value::String(p.clone()));
        }
        if let Some(ref u) = effective.base_url.value {
            base.insert("base_url".into(), serde_json::Value::String(u.clone()));
        }
        if let Some(ref t) = effective.auth_token.value {
            base.insert("auth_token".into(), serde_json::Value::String(t.clone()));
        }
        if let Some(ref c) = effective.prompt_cache_policy.value {
            base.insert("prompt_cache_policy".into(), serde_json::Value::String(c.clone()));
        }
        persona.model_profile = Some(serde_json::to_string(&base).unwrap_or_default());
    } else if effective.provider.value.is_some() || effective.base_url.value.is_some() {
        // No model but other profile fields resolved — still build the JSON
        let mut base = serde_json::Map::new();
        if let Some(ref p) = effective.provider.value {
            base.insert("provider".into(), serde_json::Value::String(p.clone()));
        }
        if let Some(ref u) = effective.base_url.value {
            base.insert("base_url".into(), serde_json::Value::String(u.clone()));
        }
        if let Some(ref t) = effective.auth_token.value {
            base.insert("auth_token".into(), serde_json::Value::String(t.clone()));
        }
        persona.model_profile = Some(serde_json::to_string(&base).unwrap_or_default());
    }
    persona.max_budget_usd = effective.max_budget_usd.value;
    persona.max_turns = effective.max_turns.value;

    // Parse model profile
    let mut model_profile = prompt::parse_model_profile(persona.model_profile.as_deref());

    // Resolve global provider settings (Ollama, LiteLLM) from app settings DB
    if let Some(ref mut profile) = model_profile {
        resolve_global_provider_settings(&pool, profile);
    }

    // Workspace shared instructions -- appended to the prompt later
    let workspace_instructions = workspace
        .as_ref()
        .and_then(|ws| ws.shared_instructions.clone())
        .filter(|s| !s.trim().is_empty());

    // Apply Continuation: SessionResume uses --resume CLI args,
    // PromptHint injects a hint into the input data for the prompt.
    let mut input_data = input_data;
    let is_session_resume = matches!(continuation, Some(Continuation::SessionResume(_)));

    // Detect ops chat mode — suppresses protocol dispatch (no messages, memories, events)
    let is_ops_mode = input_data
        .as_ref()
        .and_then(|d| d.get("_ops"))
        .and_then(|f| f.as_bool())
        .unwrap_or(false);

    // Phase C3 — simulation runs preserve protocol storage but skip outbound
    // notification delivery (real Slack/email pushes). Set by `simulate_use_case`.
    let is_simulation_mode = input_data
        .as_ref()
        .and_then(|d| d.get("_simulation"))
        .and_then(|f| f.as_bool())
        .unwrap_or(false);

    // Phase C5 — capability attribution. The execution's use_case_id is
    // expanded into `input_data._use_case` by `execute_persona` (see
    // commands/execution/executions.rs §1b). Recover the bare id here so
    // every dispatch context (and the memory injection below) can scope
    // by capability.
    let execution_use_case_id: Option<String> = input_data
        .as_ref()
        .and_then(|d| d.get("_use_case"))
        .and_then(|uc| uc.get("id"))
        .and_then(|id| id.as_str())
        .map(|s| s.to_string());

    // Phase 9 of EXEC-VERIF-PLAN — per-UC model override. When the triggering
    // capability declares `model_override`, seed the primary model before the
    // failover chain builds. Accepted shapes:
    //   "haiku"                                    — bare model name string
    //   { "model": "claude-haiku-4-5-20251001" }   — full ModelProfile-shaped object
    // Fields other than `model` on the object merge into the persona's base
    // profile (provider, temperature, etc.). If no override: untouched.
    if let (Some(uc_id), Some(ref dc_json)) = (&execution_use_case_id, &persona.design_context) {
        if let Ok(dc) = serde_json::from_str::<serde_json::Value>(dc_json) {
            let uc_override = dc
                .get("useCases")
                .and_then(|v| v.as_array())
                .and_then(|arr| {
                    arr.iter().find(|uc| uc.get("id").and_then(|i| i.as_str()) == Some(uc_id.as_str()))
                })
                .and_then(|uc| uc.get("model_override"))
                .filter(|v| !v.is_null())
                .cloned();

            if let Some(override_val) = uc_override {
                let base_profile = model_profile.clone().unwrap_or_default();
                let merged = match override_val {
                    serde_json::Value::String(model_name) => ModelProfile {
                        model: Some(model_name),
                        ..base_profile
                    },
                    serde_json::Value::Object(_) => {
                        // Parse the override as a partial ModelProfile. Fields set on
                        // the override win; missing fields fall back to the persona default.
                        match serde_json::from_value::<ModelProfile>(override_val.clone()) {
                            Ok(override_profile) => ModelProfile {
                                model: override_profile.model.or(base_profile.model),
                                provider: override_profile.provider.or(base_profile.provider),
                                ..base_profile
                            },
                            Err(e) => {
                                tracing::warn!(
                                    use_case_id = %uc_id,
                                    error = %e,
                                    "Per-UC model_override unparseable as ModelProfile; using persona default",
                                );
                                base_profile
                            }
                        }
                    }
                    _ => base_profile,
                };
                tracing::info!(
                    use_case_id = %uc_id,
                    model = ?merged.model,
                    "Applied per-UC model override",
                );
                model_profile = Some(merged);
            }
        }
    }

    if let Some(Continuation::PromptHint(ref hint)) = continuation {
        let mut obj = input_data
            .as_ref()
            .and_then(|v| v.as_object().cloned())
            .unwrap_or_default();
        obj.insert("_resume_hint".to_string(), serde_json::Value::String(hint.clone()));
        input_data = Some(serde_json::Value::Object(obj));
    }

    // -- Capability contract pre-check ------------------------------------
    // Surface unmet dependency contracts (missing credentials, personas, etc.)
    // as a trace warning *before* the hard credential resolution gate.
    // This gives the UI and healing system richer diagnostics.
    {
        let contract_report = super::capability_contract::validate_persona_contracts(&pool, &persona.id);
        if let Ok(ref report) = contract_report {
            if !report.all_satisfied {
                let issues: Vec<String> = report.unmet.iter().map(|u| u.reason.clone()).collect();
                let msg = format!(
                    "Capability contract pre-check: {} unmet requirement(s): {}",
                    issues.len(),
                    issues.join("; ")
                );
                tracing::warn!(persona_id = %persona.id, "{}", msg);
                logger.log(&format!("[WARN] {msg}"));
            }
        }
    }

    // Inject decrypted service credentials as env vars (with OAuth token refresh)
    let cred_span = trace.start_span(
        SpanType::CredentialResolution,
        "Credential Resolution",
        None,
        Some(serde_json::json!({ "tool_count": tools.len() })),
    );
    let (mut cred_env, mut cred_hints, cred_failures, mut injected_connectors) = resolve_credential_env_vars(&pool, &tools, &persona.id, &persona.name).await;

    // Second pass: inject credentials for ALL connectors referenced in the persona's
    // design_context, not just those matched by tool name. This ensures that generic
    // tools like http_request can access connector credentials (e.g. alpha_vantage API key)
    // even if the tool name doesn't match the connector name.
    inject_design_context_credentials(&pool, &persona, &mut cred_env, &mut cred_hints, &mut injected_connectors, &persona.id, &persona.name).await;

    // Resolve connector usage hints (metadata.llm_usage_hint) for every
    // connector whose credentials were actually injected. Passed into
    // assemble_prompt below so the system prompt includes a Connector Usage
    // Reference section -- saves the agent from exploratory API calls.
    let connector_usage_hints: Vec<prompt::ResolvedConnectorHint> = {
        let mut resolved: Vec<prompt::ResolvedConnectorHint> = Vec::new();
        if !injected_connectors.is_empty() {
            if let Ok(all_conns) = connector_repo::get_all(&pool) {
                let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
                for name in &injected_connectors {
                    if !seen.insert(name.clone()) { continue; }
                    let Some(conn) = all_conns.iter().find(|c| &c.name == name) else { continue };
                    let Some(meta_str) = conn.metadata.as_deref() else { continue };
                    let parsed: Option<crate::db::models::ConnectorMetadataPartial> =
                        serde_json::from_str(meta_str).ok();
                    if let Some(partial) = parsed {
                        if let Some(hint) = partial.llm_usage_hint {
                            resolved.push(prompt::ResolvedConnectorHint {
                                label: conn.label.clone(),
                                hint,
                            });
                        }
                    }
                }
            }
        }
        resolved
    };

    trace.end_span(&cred_span, None, None, None, None);

    if !cred_failures.is_empty() {
        let msg = format!(
            "Credential decryption failed for: {}. Re-enter or rotate these credentials before retrying.",
            cred_failures.join(", ")
        );
        trace.end_span_error(&validate_stage, &msg);
        logger.log(&format!("[ABORT] {}", msg));
        logger.close();
        let duration_ms = start_time.elapsed().as_millis() as u64;
        let final_trace = trace.finalize(None, None, None, Some(msg.clone()));
        let _ = crate::db::repos::execution::traces::save(&pool, &final_trace);

        emit_to(
            &*emitter,
            event_name::EXECUTION_OUTPUT,
            &ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: format!("[ERROR] {msg}"),
            },
        );
        emit_to(
            &*emitter,
            event_name::EXECUTION_STATUS,
            &ExecutionStatusEvent {
                execution_id: execution_id.clone(),
                status: ExecutionState::Failed,
                error: Some(msg.clone()),
                duration_ms: Some(duration_ms),
                cost_usd: None,
            },
        );

        let _ = exec_repo::update_status(
            &pool,
            &execution_id,
            crate::db::models::UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some(msg.clone()),
                duration_ms: Some(duration_ms as i64),
                ..Default::default()
            },
        );

        return ExecutionResult {
            success: false,
            error: Some(msg),
            log_file_path: Some(log_file_path),
            duration_ms,
            trace_id: Some(final_trace.trace_id.clone()),
            ..default_result()
        };
    }

    let cred_env_clone = cred_env.clone();

    // Load engine kind once and reuse for both config snapshot and provider selection
    let engine_kind = {
        let raw = crate::db::repos::core::settings::get(&pool, crate::db::settings_keys::CLI_ENGINE)
            .ok()
            .flatten();
        match raw {
            Some(ref s) if s.parse::<provider::EngineKind>().is_err() => {
                let kind = provider::EngineKind::from_setting(s);
                emit_to(&*emitter, event_name::ENGINE_FALLBACK, &serde_json::json!({
                    "requested": s,
                    "actual": kind.as_setting(),
                }));
                kind
            }
            Some(ref s) => provider::EngineKind::from_setting(s),
            None => provider::EngineKind::ClaudeCode,
        }
    };

    // Assemble immutable ExecutionConfig snapshot from all resolved sources.
    // This is the single source of truth for what config this execution used.
    let execution_config = ExecutionConfig {
        model_profile: model_profile.as_ref().map(RedactedModelProfile::from_profile),
        engine: engine_kind.as_setting().to_string(),
        max_budget_usd: persona.max_budget_usd,
        max_turns: persona.max_turns,
        timeout_ms: {
            let ceiling = super::ENGINE_MAX_EXECUTION_MS;
            if persona.timeout_ms > ceiling {
                tracing::warn!(
                    persona_id = %persona.id,
                    configured_ms = persona.timeout_ms,
                    ceiling_ms = ceiling,
                    "Persona timeout_ms exceeds engine ceiling — clamped to {}ms ({}min)",
                    ceiling,
                    ceiling / 60_000,
                );
                ceiling
            } else {
                persona.timeout_ms
            }
        },
        has_workspace_instructions: workspace_instructions.is_some(),
        workspace_id: persona.group_id.clone(),
        tool_names: tools.iter().map(|t| t.name.clone()).collect(),
        credential_connectors: cred_hints.to_vec(),
        routing_rule: None, // Set after BYOM policy evaluation in spawn stage
        compliance_rule: None,
        continuation_mode: match &continuation {
            None => "none".to_string(),
            Some(Continuation::PromptHint(_)) => "prompt_hint".to_string(),
            Some(Continuation::SessionResume(_)) => "session_resume".to_string(),
        },
        assembled_at: chrono::Utc::now().to_rfc3339(),
    };

    trace.end_span_ok(&validate_stage);

    // -- Pipeline Stage: SpawnEngine --------------------------------------
    // Covers prompt assembly, provider failover, and CLI process spawn.
    let spawn_engine_stage = trace.start_span(
        SpanType::PipelineStage,
        "Pipeline: Spawn Engine",
        None,
        Some(serde_json::json!({
            "pipeline_stage": "spawn_engine",
            "boundary": "Engine -> Tokio task",
        })),
    );

    // Assemble prompt (with credential env var hints)
    let prompt_span = trace.start_span(
        SpanType::PromptAssembly,
        "Prompt Assembly",
        None,
        Some(serde_json::json!({ "is_resume": is_session_resume })),
    );
    let hint_refs: Vec<&str> = cred_hints.iter().map(|s| s.as_str()).collect();
    let connector_hints_opt: Option<&[prompt::ResolvedConnectorHint]> = if connector_usage_hints.is_empty() {
        None
    } else {
        Some(&connector_usage_hints)
    };
    let prompt_text = if is_session_resume {
        // For session resume, send a lighter prompt -- the session already has context
        prompt::assemble_resume_prompt(
            input_data.as_ref(),
            if hint_refs.is_empty() { None } else { Some(&hint_refs) },
            connector_hints_opt,
        )
    } else {
        prompt::assemble_prompt(
            &persona,
            &tools,
            input_data.as_ref(),
            if hint_refs.is_empty() {
                None
            } else {
                Some(&hint_refs)
            },
            workspace_instructions.as_deref(),
            connector_hints_opt,
            #[cfg(feature = "desktop")]
            None, // Ambient context is injected by the engine layer (see mod.rs)
        )
    };

    // Inject tiered agent memories from prior runs so the agent can recall
    // what the user found valuable, recurring patterns, and learned context.
    // Core memories (stable beliefs/preferences) are always injected.
    // Active/working memories are scored by importance + recency + access
    // frequency, and (Phase C5) scoped to the execution's capability when one
    // is set — so capability-attributed learnings only surface under their
    // own capability, while persona-wide memories surface everywhere.
    let prompt_text = if !is_session_resume {
        match mem_repo::get_for_injection_v2(
            &pool,
            &persona.id,
            execution_use_case_id.as_deref(),
            10,
            40,
        ) {
            Ok(tiered) if !tiered.core.is_empty() || !tiered.active.is_empty() => {
                let mut mem_section = String::new();

                // Core beliefs — always present, define agent identity
                if !tiered.core.is_empty() {
                    mem_section.push_str("\n\n## Agent Memory — Core Beliefs\n\n");
                    mem_section.push_str("These are your established principles and preferences learned over many interactions. Treat them as strong defaults.\n\n");
                    for m in &tiered.core {
                        mem_section.push_str(&format!(
                            "- **{}** [{}]: {}\n",
                            m.title, m.category, m.content
                        ));
                    }
                }

                // Active knowledge — recent learnings, contextual facts
                if !tiered.active.is_empty() {
                    mem_section.push_str("\n\n## Agent Memory — Recent Learnings\n\n");
                    mem_section.push_str("Context from recent work. Use to inform your analysis and avoid repeating past mistakes.\n\n");
                    for m in &tiered.active {
                        mem_section.push_str(&format!(
                            "- **{}** [{}] (importance: {}): {}\n",
                            m.title, m.category, m.importance, m.content
                        ));
                    }
                }

                mem_section.push('\n');
                let total = tiered.core.len() + tiered.active.len();
                logger.log(&format!(
                    "[MEMORY] Injected {} memories ({} core, {} active)",
                    total, tiered.core.len(), tiered.active.len()
                ));

                // Track access: increment counters for all injected memories
                let all_ids: Vec<String> = tiered.core.iter()
                    .chain(tiered.active.iter())
                    .map(|m| m.id.clone())
                    .collect();
                if let Err(e) = mem_repo::increment_access_batch(&pool, &all_ids) {
                    logger.log(&format!("[MEMORY] Failed to update access counts: {e}"));
                }

                // Run lifecycle transitions (promote/archive) after access update
                if let Err(e) = mem_repo::run_lifecycle(&pool, &persona.id) {
                    logger.log(&format!("[MEMORY] Lifecycle transition failed: {e}"));
                }

                format!("{prompt_text}{mem_section}")
            }
            Ok(_) => prompt_text, // no memories yet
            Err(e) => {
                logger.log(&format!("[MEMORY] Failed to load memories: {e}"));
                prompt_text
            }
        }
    } else {
        prompt_text // skip for session resumes -- context already loaded
    };

    trace.end_span(&prompt_span, None, None, None, None);

    logger.log("=== Persona Execution Started ===");
    logger.log(&format!("Persona: {}", persona.name));
    logger.log(&format!("Execution ID: {execution_id}"));
    logger.log(&format!(
        "Tools: {}",
        tools
            .iter()
            .map(|t| t.name.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    ));
    logger.log(&format!("Prompt length: {} characters", prompt_text.len()));

    // Create a stable per-persona working directory (persists across executions).
    let exec_dir = {
        let stable_dir = std::env::temp_dir()
            .join("personas-workspace")
            .join(&persona.id);
        if std::fs::create_dir_all(&stable_dir).is_ok() {
            stable_dir
        } else {
            std::env::temp_dir().join(format!("personas-exec-{}", &execution_id))
        }
    };
    if let Err(e) = std::fs::create_dir_all(&exec_dir) {
        let err_msg = format!("Failed to create execution directory: {e}");
        logger.log(&format!("Failed to create exec dir: {e}"));
        let _ = exec_repo::update_status(
            &pool,
            &execution_id,
            crate::db::models::UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some(err_msg.clone()),
                duration_ms: Some(start_time.elapsed().as_millis() as i64),
                ..Default::default()
            },
        );
        return ExecutionResult {
            success: false,
            error: Some(err_msg),
            log_file_path: Some(log_file_path),
            duration_ms: start_time.elapsed().as_millis() as u64,
            ..default_result()
        };
    }

    // Install Claude Code hooks sidecar (Karpathy-style auto-capture).
    // No-op unless PERSONAS_HOOKS_SIDECAR=1 — see hooks_sidecar.rs for details.
    // Best-effort: never fails the execution if the sidecar can't be written.
    match super::hooks_sidecar::install_sidecar(&exec_dir) {
        Ok(true) => logger.log("[hooks] installed Claude Code hooks sidecar in exec_dir"),
        Ok(false) => {} // disabled or skipped
        Err(e) => logger.log(&format!("[hooks] sidecar install failed (non-fatal): {e}")),
    }

    // =========================================================================
    // Provider failover: build candidate chain and try each until one succeeds
    // =========================================================================
    let primary_engine = engine_kind;

    // Evaluate BYOM policy if configured.
    // IMPORTANT: If the stored policy JSON is corrupt we must NOT silently
    // fall back to open-access — that would disable compliance restrictions.
    // Instead, abort the execution so the user is forced to fix the policy.
    let byom_policy = match super::byom::ByomPolicy::load(&pool) {
        Ok(p) => p,
        Err(e) => {
            tracing::error!(error = %e, "BYOM policy is corrupt — blocking execution");
            logger.log(&format!("BYOM policy is corrupt — execution blocked: {e}"));
            let err_msg = "BYOM policy is corrupt and cannot be loaded. \
                     Please reset or fix the policy in Settings → BYOM before running executions.".to_string();
            let _ = exec_repo::update_status(
                &pool,
                &execution_id,
                crate::db::models::UpdateExecutionStatus {
                    status: ExecutionState::Failed,
                    error_message: Some(err_msg.clone()),
                    duration_ms: Some(start_time.elapsed().as_millis() as i64),
                    ..Default::default()
                },
            );
            return ExecutionResult {
                success: false,
                error: Some(err_msg),
                log_file_path: Some(log_file_path),
                duration_ms: start_time.elapsed().as_millis() as u64,
                ..default_result()
            };
        }
    };
    let policy_decision = byom_policy
        .as_ref()
        .map(|p| p.evaluate(&[], None))
        .unwrap_or_else(|| super::byom::PolicyDecision {
            preferred_provider: None,
            preferred_model: None,
            blocked_providers: Vec::new(),
            routing_rule_name: None,
            compliance_rule_name: None,
        });

    // Enrich execution config with BYOM policy results
    let mut execution_config = execution_config;
    execution_config.routing_rule = policy_decision.routing_rule_name.clone();
    execution_config.compliance_rule = policy_decision.compliance_rule_name.clone();
    // Freeze: no further mutations after this point
    let execution_config = execution_config;
    let execution_config_json = serde_json::to_string(&execution_config).ok();

    let failover_chain = failover::build_failover_chain_with_policy(
        primary_engine,
        model_profile.as_ref(),
        &policy_decision,
    );

    // Generate a W3C traceparent for this execution. Injected into each
    // failover candidate's env so the spawned Claude CLI ≥ 2.1.110 participates
    // in the same distributed trace as personas' own span tree. Persisted once
    // up-front; failover re-attempts within the same execution share the ID.
    let w3c_trace = super::trace::W3cTraceContext::new_root();
    let traceparent_header = w3c_trace.traceparent_header();
    if let Err(e) = exec_repo::set_traceparent(&pool, &execution_id, &traceparent_header) {
        tracing::warn!(
            execution_id = %execution_id,
            error = ?e,
            "Failed to persist traceparent — continuing without DB-side correlation"
        );
    }

    // Resolve provider + build CLI args + spawn, trying each failover candidate
    let mut last_spawn_error: Option<String> = None;
    #[allow(unused_assignments)]
    let mut active_engine_kind = primary_engine; // overwritten per-candidate in failover loop
    #[allow(unused_assignments)]
    let mut cli_provider: Box<dyn provider::CliProvider> = provider::resolve_provider(primary_engine); // overwritten per-candidate
    let mut cli_args;

    let mut driver = 'failover: {
        for (candidate_idx, candidate) in failover_chain.iter().enumerate() {
            // Atomically check circuit breaker and reserve a slot.
            // try_acquire prevents the TOCTOU race where another thread could
            // open the circuit between check and use.
            if !circuit_breaker.try_acquire_and_probe(candidate.engine_kind) {
                let reason = if circuit_breaker.is_globally_paused() {
                    "global circuit breaker paused"
                } else {
                    "circuit breaker open"
                };
                logger.log(&format!(
                    "[FAILOVER] Skipping {} ({})",
                    candidate.label, reason,
                ));
                continue;
            }

            active_engine_kind = candidate.engine_kind;
            cli_provider = provider::resolve_provider(candidate.engine_kind);

            // Build model profile override for this candidate
            let candidate_profile = if let Some(ref model_override) = candidate.model {
                Some(ModelProfile {
                    model: Some(model_override.clone()),
                    ..model_profile.clone().unwrap_or_default()
                })
            } else {
                model_profile.clone()
            };

            // Build CLI args
            cli_args = if let Some(Continuation::SessionResume(ref session_id)) = continuation {
                let mut args = cli_provider.build_resume_args(session_id);
                if let Some(profile) = candidate_profile.as_ref() {
                    cli_provider.apply_provider_env(&mut args, profile);
                }
                args
            } else {
                cli_provider.build_execution_args(Some(&persona), candidate_profile.as_ref())
            };

            // Inject credential env vars
            for (key, val) in &cred_env_clone {
                cli_args.env_overrides.push((key.clone(), val.clone()));
            }

            // For non-Stdin providers, rebuild args with the prompt embedded
            match cli_provider.prompt_delivery() {
                PromptDelivery::PositionalArg | PromptDelivery::Flag(_) => {
                    cli_args = if let Some(Continuation::SessionResume(ref session_id)) = continuation {
                        let mut args = cli_provider.build_resume_args_with_prompt(session_id, &prompt_text);
                        if let Some(profile) = candidate_profile.as_ref() {
                            cli_provider.apply_provider_env(&mut args, profile);
                        }
                        for (key, val) in &cred_env_clone {
                            args.env_overrides.push((key.clone(), val.clone()));
                        }
                        args
                    } else {
                        let mut args = cli_provider.build_execution_args_with_prompt(
                            Some(&persona),
                            candidate_profile.as_ref(),
                            &prompt_text,
                        );
                        for (key, val) in &cred_env_clone {
                            args.env_overrides.push((key.clone(), val.clone()));
                        }
                        args
                    };
                }
                PromptDelivery::Stdin => {}
            }

            // Inject the W3C traceparent generated above into the child CLI's
            // env. Claude CLI ≥ 2.1.110 picks this up and includes it on the
            // spans it emits for its internal API / tool calls. Harmless no-op
            // for providers that don't read it (e.g. Codex) — OTEL collectors
            // simply ignore unrelated env vars.
            cli_args.env_overrides.push((
                "TRACEPARENT".to_string(),
                traceparent_header.clone(),
            ));
            if let Some(state) = w3c_trace.tracestate_header() {
                cli_args.env_overrides.push(("TRACESTATE".to_string(), state));
            }

            if candidate_idx > 0 {
                logger.log(&format!(
                    "[FAILOVER] Trying {} after previous provider failed",
                    candidate.label,
                ));
                emit_to(
                    &*emitter,
                    event_name::EXECUTION_OUTPUT,
                    &ExecutionOutputEvent {
                        execution_id: execution_id.clone(),
                        line: format!("[FAILOVER] Trying {}...", candidate.label),
                    },
                );
            }

            // Early cancellation check: if the user cancelled during arg
            // building or failover iteration, skip spawning entirely to avoid
            // starting a process that will be immediately killed.
            if CliProcessDriver::is_cancelled(&cancelled) {
                logger.log("[CANCELLED] Execution cancelled before CLI spawn");
                trace.end_span_error(&spawn_engine_stage, "Cancelled before spawn");
                logger.close();

                emit_to(&*emitter, event_name::PROCESS_ACTIVITY, &super::process_activity::ProcessActivityEvent::new("execution", "cancelled", Some(&execution_id), Some(&persona.name)));

                let duration_ms = start_time.elapsed().as_millis() as u64;
                emit_to(
                    &*emitter,
                    event_name::EXECUTION_OUTPUT,
                    &ExecutionOutputEvent {
                        execution_id: execution_id.clone(),
                        line: "[CANCELLED] Execution cancelled before CLI spawn".into(),
                    },
                );

                return ExecutionResult {
                    success: false,
                    error: Some("Cancelled before spawn".into()),
                    log_file_path: Some(log_file_path),
                    duration_ms,
                    ..default_result()
                };
            }

            // Spawn CLI process via CliProcessDriver
            match CliProcessDriver::spawn(&cli_args, exec_dir.clone()) {
                Ok(driver) => {
                    // Spawn succeeded -- use this provider
                    break 'failover driver;
                }
                Err(e) => {
                    let error_msg = if e.kind() == std::io::ErrorKind::NotFound {
                        format!(
                            "{} not found. Please install it or select a different engine in Settings.",
                            cli_provider.engine_name()
                        )
                    } else {
                        format!("Failed to spawn {}: {}", cli_provider.engine_name(), e)
                    };

                    // Record failure in circuit breaker and emit transition events
                    let transitions = circuit_breaker.record_failure(candidate.engine_kind);
                    for transition in &transitions {
                        emit_to(&*emitter, event_name::CIRCUIT_BREAKER_TRANSITION, transition);
                    }
                    if transitions.iter().any(|t| t.provider == "global") {
                        emit_to(&*emitter, event_name::CIRCUIT_BREAKER_GLOBAL_TRIPPED, &circuit_breaker.get_status());
                    }
                    logger.log(&format!("[FAILOVER] {} failed: {}", candidate.label, error_msg));
                    last_spawn_error = Some(error_msg);
                    // Continue to next candidate
                }
            }
        }

        // All candidates exhausted
        let error_msg = last_spawn_error.unwrap_or_else(|| {
            "All providers failed or have open circuit breakers".to_string()
        });
        trace.end_span_error(&spawn_engine_stage, &error_msg);
        let final_trace = trace.finalize(None, None, None, Some(error_msg.clone()));
        let _ = crate::db::repos::execution::traces::save(&pool, &final_trace);

        logger.log(&format!("[ERROR] {error_msg}"));
        logger.close();

        emit_to(&*emitter, event_name::PROCESS_ACTIVITY, &super::process_activity::ProcessActivityEvent::new("execution", "failed", Some(&execution_id), Some(&persona.name)));

        emit_to(
            &*emitter,
            event_name::EXECUTION_OUTPUT,
            &ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: format!("[ERROR] {error_msg}"),
            },
        );
        emit_to(
            &*emitter,
            event_name::EXECUTION_STATUS,
            &ExecutionStatusEvent {
                execution_id: execution_id.clone(),
                status: ExecutionState::Failed,
                error: Some(error_msg.clone()),
                duration_ms: Some(start_time.elapsed().as_millis() as u64),
                cost_usd: None,
            },
        );

        let _ = exec_repo::update_status(
            &pool,
            &execution_id,
            crate::db::models::UpdateExecutionStatus {
                status: ExecutionState::Failed,
                error_message: Some(error_msg.clone()),
                duration_ms: Some(start_time.elapsed().as_millis() as i64),
                ..Default::default()
            },
        );

        return ExecutionResult {
            success: false,
            error: Some(error_msg),
            log_file_path: Some(log_file_path),
            duration_ms: start_time.elapsed().as_millis() as u64,
            trace_id: Some(final_trace.trace_id.clone()),
            ..default_result()
        };
    };

    // Register child PID immediately after spawn to minimise the window where
    // cancel_execution cannot kill the process (no PID in the map yet).
    driver.register_pid(&child_pids, &execution_id).await;

    // Check cancellation right after PID registration. This closes the race
    // window between task start and PID registration: if the user cancelled
    // during spawn, the flag is set but the process couldn't be killed (PID
    // wasn't registered). Now that the PID is registered, catch it early —
    // before trace recording and prompt delivery — to prevent wasting API
    // credits on an execution the user already cancelled.
    if CliProcessDriver::is_cancelled(&cancelled) {
        trace.end_span_error(&spawn_engine_stage, "Cancelled during spawn");
        logger.log("[CANCELLED] Execution cancelled during spawn, killing process");
        driver.kill().await;
        driver.unregister_pid(&child_pids, &execution_id).await;
        logger.close();

        emit_to(&*emitter, event_name::PROCESS_ACTIVITY, &super::process_activity::ProcessActivityEvent::new("execution", "cancelled", Some(&execution_id), Some(&persona.name)));

        let duration_ms = start_time.elapsed().as_millis() as u64;
        emit_to(
            &*emitter,
            event_name::EXECUTION_OUTPUT,
            &ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: "[CANCELLED] Execution cancelled during spawn".into(),
            },
        );

        let _ = exec_repo::update_status(
            &pool,
            &execution_id,
            crate::db::models::UpdateExecutionStatus {
                status: ExecutionState::Cancelled,
                error_message: Some("Cancelled during spawn".into()),
                duration_ms: Some(duration_ms as i64),
                ..Default::default()
            },
        );

        return ExecutionResult {
            success: false,
            error: Some("Cancelled during spawn".into()),
            log_file_path: Some(log_file_path),
            duration_ms,
            ..default_result()
        };
    }

    // Emit process activity: execution started
    emit_to(&*emitter, event_name::PROCESS_ACTIVITY, &super::process_activity::ProcessActivityEvent::new("execution", "started", Some(&execution_id), Some(&persona.name)));

    // Provider spawn succeeded -- record in trace
    let spawn_span = trace.start_span(
        SpanType::CliSpawn,
        &format!("CLI Spawn: {}", cli_provider.engine_name()),
        None,
        Some(serde_json::json!({
            "engine": cli_provider.engine_name(),
            "prompt_length": prompt_text.len(),
        })),
    );

    trace.end_span_ok(&spawn_span);
    trace.end_span_ok(&spawn_engine_stage);

    // -- Pipeline Stage: StreamOutput -------------------------------------
    // Covers stdin delivery and the main stream processing loop.
    // (PID registration was done immediately after spawn above.)
    let stream_output_stage = trace.start_span(
        SpanType::PipelineStage,
        "Pipeline: Stream Output",
        None,
        Some(serde_json::json!({
            "pipeline_stage": "stream_output",
            "boundary": "Runner -> Tauri events",
        })),
    );

    // Final cancellation gate before prompt delivery. The earlier check (right
    // after spawn) catches the fast path; this one catches cancellations that
    // arrived during trace recording. Critically, this runs BEFORE stdin/prompt
    // delivery to prevent wasting API credits.
    if CliProcessDriver::is_cancelled(&cancelled) {
        trace.end_span_error(&stream_output_stage, "Cancelled before prompt delivery");
        logger.log("[CANCELLED] Execution cancelled before prompt delivery, killing process");
        driver.kill().await;
        driver.unregister_pid(&child_pids, &execution_id).await;
        logger.close();

        emit_to(&*emitter, event_name::PROCESS_ACTIVITY, &super::process_activity::ProcessActivityEvent::new("execution", "cancelled", Some(&execution_id), Some(&persona.name)));

        let duration_ms = start_time.elapsed().as_millis() as u64;
        emit_to(
            &*emitter,
            event_name::EXECUTION_OUTPUT,
            &ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: "[CANCELLED] Execution cancelled before prompt delivery".into(),
            },
        );

        return ExecutionResult {
            success: false,
            error: Some("Cancelled before prompt delivery".into()),
            log_file_path: Some(log_file_path),
            duration_ms,
            ..default_result()
        };
    }

    // Deliver prompt based on provider strategy
    match cli_provider.prompt_delivery() {
        PromptDelivery::Stdin => {
            // Claude: write prompt to stdin, then close
            driver.write_stdin(prompt_text.as_bytes()).await;
        }
        PromptDelivery::PositionalArg | PromptDelivery::Flag(_) => {
            // Codex/Gemini: prompt already embedded in args, just close stdin
            driver.close_stdin().await;
        }
    }

    // Read stdout line by line (with per-line 64KB cap and 30s watchdog)
    let Some(mut stdout_reader) = driver.take_stdout_reader() else {
        let error_msg = "Failed to capture stdout pipe from child process".to_string();
        trace.end_span_error(&stream_output_stage, &error_msg);
        logger.log(&format!("[ERROR] {error_msg}"));
        logger.close();
        driver.kill().await;
        driver.unregister_pid(&child_pids, &execution_id).await;
        let duration_ms = start_time.elapsed().as_millis() as u64;
        let final_trace = trace.finalize(None, None, None, Some(error_msg.clone()));
        let _ = crate::db::repos::execution::traces::save(&pool, &final_trace);
        emit_to(
            &*emitter,
            event_name::EXECUTION_STATUS,
            &ExecutionStatusEvent {
                execution_id: execution_id.clone(),
                status: ExecutionState::Failed,
                error: Some(error_msg.clone()),
                duration_ms: Some(duration_ms),
                cost_usd: None,
            },
        );
        return ExecutionResult {
            success: false,
            error: Some(error_msg),
            log_file_path: Some(log_file_path),
            duration_ms,
            trace_id: Some(final_trace.trace_id.clone()),
            ..default_result()
        };
    };
    // Stderr may be null if piped to /dev/null (Windows deadlock prevention).
    // Gracefully handle by spawning an empty background collector.
    let stderr_opt = driver.take_stderr();

    let mut metrics = ExecutionMetrics::default();
    let mut assistant_text = String::new();
    let mut tool_use_lines: Vec<StreamLineType> = Vec::new();
    let mut tool_steps: Vec<ToolCallStep> = Vec::new();
    let mut step_counter: u32 = 0;

    /// Maximum total stdout bytes captured before truncation (10 MB).
    const MAX_OUTPUT_BYTES: usize = 10 * 1024 * 1024;
    let mut total_stdout_bytes: usize = 0;
    let mut output_truncated = false;

    // Read stderr in background (capped at 100KB to prevent OOM)
    let stderr_handle = if let Some(mut stderr_reader) = stderr_opt {
        tokio::spawn(async move {
        const MAX_STDERR_BYTES: usize = 100 * 1024;
        let mut buf = vec![0u8; MAX_STDERR_BYTES];
        let mut total = 0;
        loop {
            match tokio::io::AsyncReadExt::read(&mut stderr_reader, &mut buf[total..]).await {
                Ok(0) => break,
                Ok(n) => {
                    total += n;
                    if total >= MAX_STDERR_BYTES {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let mut s = String::from_utf8_lossy(&buf[..total]).into_owned();
        if total >= MAX_STDERR_BYTES {
            s.push_str("\n... [stderr truncated at 100KB]");
        }
        s
    })
    } else {
        // stderr was piped to null (Windows deadlock prevention) — return empty string
        tokio::spawn(async { String::new() })
    };

    // Set up timeout. Buffer above the CLI's 10-min subagent-stall cutoff so the
    // upstream error can surface before personas' generic timeout fires.
    let timeout_ms = if persona.timeout_ms > 0 {
        persona.timeout_ms as u64
    } else {
        DEFAULT_EXECUTION_TIMEOUT_MS
    };
    let timeout_duration = std::time::Duration::from_millis(timeout_ms);

    // Clone values needed in the closure
    let exec_id_for_stream = execution_id.clone();
    let persona_id_for_stream = persona.id.clone();
    let use_case_id_for_stream: Option<String> = execution_use_case_id.clone();
    let project_id_for_stream = persona.project_id.clone();
    let pool_for_stream = pool.clone();
    let persona_name_for_stream = persona.name.clone();
    let notif_channels_for_stream = persona.notification_channels.clone();
    let is_ops_for_stream = is_ops_mode;
    let is_simulation_for_stream = is_simulation_mode;

    // Track mid-stream protocol dispatches for execution-scoped dedup in post-mortem
    let stream_events_dispatched = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let stream_memories_dispatched = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let stream_messages_dispatched = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let events_counter = stream_events_dispatched.clone();
    let memories_counter = stream_memories_dispatched.clone();
    let messages_counter = stream_messages_dispatched.clone();

    // Pre-load quality gate config once per execution (avoids O(messages) DB reads).
    let gate_config = super::quality_gate::load(&pool_for_stream);

    // Start stream processing span
    let stream_span = trace.start_span(
        SpanType::StreamProcessing,
        "Stream Processing",
        None,
        None,
    );

    // Process stdout lines with timeout
    let mut last_activity = std::time::Instant::now();
    let stream_result = tokio::time::timeout(timeout_duration, async {
        let mut heartbeat_interval = tokio::time::interval(std::time::Duration::from_secs(30));
        heartbeat_interval.tick().await; // consume immediate first tick

        loop {
            tokio::select! {
                biased;  // prefer line reads over heartbeat

                line_result = read_line_limited(&mut stdout_reader) => {
                    match line_result {
                        Ok(Some(raw_line)) => {
                            last_activity = std::time::Instant::now();

                            if raw_line.trim().is_empty() {
                                continue;
                            }

                            // Enforce total output byte cap
                            total_stdout_bytes += raw_line.len();
                            if total_stdout_bytes > MAX_OUTPUT_BYTES {
                                if !output_truncated {
                                    output_truncated = true;
                                    logger.log("[RUNNER] stdout truncated -- MAX_OUTPUT_BYTES (10MB) exceeded");
                                    emit_to(
                                        &*emitter,
                                        event_name::EXECUTION_OUTPUT,
                                        &ExecutionOutputEvent {
                                            execution_id: exec_id_for_stream.clone(),
                                            line: "[output truncated -- 10MB limit exceeded]".to_string(),
                                        },
                                    );
                                }
                                continue;
                            }

                            // Per-line truncation is now handled by read_line_limited (64KB cap).
                            let line = raw_line;

                            logger.log(&format!("[STDOUT] {}", line.trim()));

                            // Parse stream line using the active provider
                            let (line_type, display) = cli_provider.parse_stream_line(&line);

                            // Emit user-facing output to frontend
                            if let Some(ref display_text) = display {
                                emit_to(
                                    &*emitter,
                                    event_name::EXECUTION_OUTPUT,
                                    &ExecutionOutputEvent {
                                        execution_id: exec_id_for_stream.clone(),
                                        line: display_text.clone(),
                                    },
                                );
                            }

                            // Update metrics from result lines
                            parser::update_metrics_from_result(&mut metrics, &line_type);

                            // Persist session_id to DB immediately when first captured
                            if let StreamLineType::SystemInit { session_id: Some(ref sid), .. } = line_type {
                                if metrics.session_id.is_none() {
                                    metrics.session_id = Some(sid.clone());
                                    let pool_ref = pool_for_stream.clone();
                                    let exec_id_ref = exec_id_for_stream.clone();
                                    let sid_clone = sid.clone();
                                    // Persist session_id with retry — losing this silently
                                    // breaks warm session reuse (cost optimization).
                                    tokio::spawn(async move {
                                        let update = || exec_repo::update_status(
                                            &pool_ref,
                                            &exec_id_ref,
                                            UpdateExecutionStatus {
                                                status: ExecutionState::Running,
                                                claude_session_id: Some(sid_clone.clone()),
                                                ..Default::default()
                                            },
                                        );
                                        if let Err(e) = update() {
                                            tracing::warn!(
                                                execution_id = %exec_id_ref,
                                                "session_id DB persist failed, retrying once: {e}"
                                            );
                                            if let Err(e2) = update() {
                                                tracing::error!(
                                                    execution_id = %exec_id_ref,
                                                    "session_id DB persist failed after retry — \
                                                     warm session reuse will be unavailable: {e2}"
                                                );
                                            }
                                        }
                                    });
                                }
                            }

                            // Emit structured event on the typed channel
                            let structured_event = match &line_type {
                                StreamLineType::AssistantText { text } => Some(StructuredExecutionEvent::Text {
                                    execution_id: exec_id_for_stream.clone(),
                                    content: text.clone(),
                                }),
                                StreamLineType::AssistantToolUse { tool_name, input_preview } => Some(StructuredExecutionEvent::ToolUse {
                                    execution_id: exec_id_for_stream.clone(),
                                    tool_name: tool_name.clone(),
                                    input_preview: input_preview.clone(),
                                }),
                                StreamLineType::ToolResult { content_preview } => Some(StructuredExecutionEvent::ToolResult {
                                    execution_id: exec_id_for_stream.clone(),
                                    content_preview: content_preview.clone(),
                                }),
                                StreamLineType::SystemInit { model, session_id, plugin_errors } => {
                                    // CLI ≥ 2.1.111 reports demoted plugins in .claude/plugins/.
                                    // Surface them to tracing so headless runs get observability;
                                    // StructuredExecutionEvent::SystemInit does not currently carry
                                    // the vec (frontend has no surface for it), so the log is the
                                    // canonical signal.
                                    if !plugin_errors.is_empty() {
                                        tracing::warn!(
                                            execution_id = %exec_id_for_stream,
                                            count = plugin_errors.len(),
                                            errors = ?plugin_errors,
                                            "Claude CLI reported demoted plugins on session init"
                                        );
                                    }
                                    Some(StructuredExecutionEvent::SystemInit {
                                        execution_id: exec_id_for_stream.clone(),
                                        model: model.clone(),
                                        session_id: session_id.clone(),
                                    })
                                }
                                StreamLineType::Result { duration_ms, total_cost_usd, total_input_tokens, total_output_tokens, model, session_id } => Some(StructuredExecutionEvent::ExecutionResult {
                                    execution_id: exec_id_for_stream.clone(),
                                    duration_ms: *duration_ms,
                                    cost_usd: *total_cost_usd,
                                    input_tokens: *total_input_tokens,
                                    output_tokens: *total_output_tokens,
                                    model: model.clone(),
                                    session_id: session_id.clone(),
                                }),
                                StreamLineType::Unknown => None,
                            };
                            if let Some(event) = structured_event {
                                emit_to(&*emitter, event_name::EXECUTION_EVENT, &event);
                            }

                            // Track tool usage and build tool steps for inspector
                            if let StreamLineType::AssistantToolUse {
                                ref tool_name,
                                ref input_preview,
                            } = line_type
                            {
                                // Protocol tool interception: if the LLM called one of our
                                // virtual protocol tools, parse the input and dispatch as a
                                // structured protocol message (more reliable than JSON lines).
                                static PROTOCOL_TOOLS: &[&str] = &["emit_memory", "emit_message", "emit_event", "request_review"];
                                if PROTOCOL_TOOLS.contains(&tool_name.as_str()) {
                                    if let Ok(input_val) = serde_json::from_str::<serde_json::Value>(input_preview) {
                                        let protocol_msg = match tool_name.as_str() {
                                            "emit_memory" => Some(ProtocolMessage::AgentMemory {
                                                title: input_val.get("title").and_then(|v| v.as_str()).unwrap_or("Untitled").to_string(),
                                                content: input_val.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                                category: input_val.get("category").and_then(|v| v.as_str()).map(String::from),
                                                importance: input_val.get("importance").and_then(|v| v.as_i64()).map(|v| v as i32),
                                                tags: input_val.get("tags").and_then(|v| serde_json::from_value(v.clone()).ok()),
                                            }),
                                            "emit_message" => Some(ProtocolMessage::UserMessage {
                                                title: input_val.get("title").and_then(|v| v.as_str()).map(String::from),
                                                content: input_val.get("content").and_then(|v| v.as_str()).unwrap_or("").to_string(),
                                                content_type: input_val.get("content_type").and_then(|v| v.as_str()).map(String::from),
                                                priority: input_val.get("priority").and_then(|v| v.as_str()).map(String::from),
                                            }),
                                            "emit_event" => Some(ProtocolMessage::EmitEvent {
                                                event_type: input_val.get("event_type").and_then(|v| v.as_str()).unwrap_or("custom").to_string(),
                                                data: input_val.get("data").cloned(),
                                            }),
                                            "request_review" => Some(ProtocolMessage::ManualReview {
                                                title: input_val.get("title").and_then(|v| v.as_str()).unwrap_or("Review Required").to_string(),
                                                description: input_val.get("description").and_then(|v| v.as_str()).map(String::from),
                                                severity: input_val.get("severity").and_then(|v| v.as_str()).map(String::from),
                                                context_data: input_val.get("context_data").and_then(|v| v.as_str()).map(String::from),
                                                suggested_actions: input_val.get("suggested_actions").and_then(|v| serde_json::from_value(v.clone()).ok()),
                                                decisions: input_val.get("decisions").and_then(|v| serde_json::from_value(v.clone()).ok()),
                                            }),
                                            _ => None,
                                        };
                                        if let Some(ref msg) = protocol_msg {
                                            if matches!(msg, ProtocolMessage::UserMessage { .. }) {
                                                messages_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                            }
                                            let notif_ref = notif_channels_for_stream.as_deref();
                                            let mut dispatch_ctx = super::dispatch::DispatchContext::new(
                                                &*emitter,
                                                &pool_for_stream,
                                                &exec_id_for_stream,
                                                &persona_id_for_stream,
                                                &project_id_for_stream,
                                                &persona_name_for_stream,
                                                notif_ref,
                                                &mut logger,
                                                Some(gate_config.clone()),
                                            );
                                            dispatch_ctx.ops_mode = is_ops_for_stream;
                                            dispatch_ctx.is_simulation = is_simulation_for_stream;
                                            dispatch_ctx.use_case_id = use_case_id_for_stream.as_deref();
                                            super::dispatch::dispatch(&mut dispatch_ctx, msg);
                                        }
                                    }
                                }

                                tool_use_lines.push(line_type.clone());
                                step_counter += 1;

                                // Create trace span for this tool call
                                let tool_span_id = trace.start_span(
                                    SpanType::ToolCall,
                                    &format!("ToolCall: {tool_name}"),
                                    Some(&stream_span),
                                    Some(serde_json::json!({
                                        "tool_name": tool_name,
                                        "step_index": step_counter,
                                    })),
                                );
                                // Emit live trace span event to frontend
                                if let Some(span_data) = trace.get_span(&tool_span_id) {
                                    emit_to(&*emitter, event_name::EXECUTION_TRACE_SPAN, &TraceSpanEvent {
                                        execution_id: exec_id_for_stream.clone(),
                                        span: span_data,
                                        event_type: "start".to_string(),
                                    });
                                }

                                tool_steps.push(ToolCallStep {
                                    step_index: step_counter,
                                    tool_name: tool_name.clone(),
                                    input_preview: input_preview.clone(),
                                    output_preview: String::new(),
                                    started_at_ms: start_time.elapsed().as_millis() as u64,
                                    ended_at_ms: None,
                                    duration_ms: None,
                                });

                                // Emit file change event if this is a file operation
                                if let Some(file_change) = parser::extract_file_change(tool_name, input_preview) {
                                    emit_to(
                                        &*emitter,
                                        event_name::EXECUTION_FILE_CHANGE,
                                        &serde_json::json!({
                                            "execution_id": exec_id_for_stream,
                                            "path": file_change.path,
                                            "change_type": file_change.change_type,
                                        }),
                                    );
                                    emit_to(
                                        &*emitter,
                                        event_name::EXECUTION_EVENT,
                                        &StructuredExecutionEvent::FileChange {
                                            execution_id: exec_id_for_stream.clone(),
                                            path: file_change.path.clone(),
                                            change_type: format!("{:?}", file_change.change_type).to_lowercase(),
                                        },
                                    );
                                }
                            }

                            // Fill last tool step with result output
                            if let StreamLineType::ToolResult {
                                ref content_preview,
                            } = line_type
                            {
                                if let Some(last) = tool_steps.last_mut() {
                                    if last.ended_at_ms.is_none() {
                                        let now = start_time.elapsed().as_millis() as u64;
                                        last.output_preview = if content_preview.len() > 500 {
                                            format!("{}...", &content_preview[..500])
                                        } else {
                                            content_preview.clone()
                                        };
                                        last.ended_at_ms = Some(now);
                                        last.duration_ms = Some(now.saturating_sub(last.started_at_ms));
                                    }
                                }

                                // End the most recent open ToolCall trace span
                                let tool_span_to_close = {
                                    let store = trace.spans.lock().unwrap_or_else(|e| e.into_inner());
                                    store.vec.iter().rev()
                                        .find(|s| s.span_type == SpanType::ToolCall && s.end_ms.is_none())
                                        .map(|s| s.span_id.clone())
                                };
                                if let Some(span_id) = tool_span_to_close {
                                    trace.end_span_ok(&span_id);
                                    // Emit live trace span end event
                                    if let Some(span_data) = trace.get_span(&span_id) {
                                        emit_to(&*emitter, event_name::EXECUTION_TRACE_SPAN, &TraceSpanEvent {
                                            execution_id: exec_id_for_stream.clone(),
                                            span: span_data,
                                            event_type: "end".to_string(),
                                        });
                                    }
                                }
                            }

                            // For assistant text, check for protocol messages
                            if let StreamLineType::AssistantText { ref text } = line_type {
                                for text_line in text.split('\n') {
                                    if assistant_text.len() < MAX_OUTPUT_BYTES {
                                        assistant_text.push_str(text_line);
                                        assistant_text.push('\n');
                                    }

                                    // Mid-stream protocol message detection.
                                    // Fast prefix check then parse once; use from_value to avoid
                                    // re-deserializing what parse_stream_line already parsed.
                                    let protocol_msg = {
                                        let trimmed = text_line.trim();
                                        if trimmed.starts_with('{') {
                                            serde_json::from_str::<serde_json::Value>(trimmed)
                                                .ok()
                                                .and_then(|v| parser::extract_protocol_message_from_value(&v))
                                        } else {
                                            None
                                        }
                                    };
                                    if let Some(protocol_msg) = protocol_msg {
                                        let dispatch_span = trace.start_span(
                                            SpanType::ProtocolDispatch,
                                            &format!("Protocol: {:?}", std::mem::discriminant(&protocol_msg)),
                                            Some(&stream_span),
                                            None,
                                        );
                                        let mut dispatch_ctx = super::dispatch::DispatchContext::new(
                                            &*emitter,
                                            &pool_for_stream,
                                            &exec_id_for_stream,
                                            &persona_id_for_stream,
                                            &project_id_for_stream,
                                            &persona_name_for_stream,
                                            notif_channels_for_stream.as_deref(),
                                            &mut logger,
                                            Some(gate_config.clone()),
                                        );
                                        dispatch_ctx.ops_mode = is_ops_for_stream;
                                        dispatch_ctx.is_simulation = is_simulation_for_stream;
                                        dispatch_ctx.use_case_id = use_case_id_for_stream.as_deref();
                                        use super::protocol::ExecutionProtocol;
                                        match &protocol_msg {
                                            ProtocolMessage::EmitEvent { .. } => {
                                                events_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                            }
                                            ProtocolMessage::AgentMemory { .. } => {
                                                memories_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                            }
                                            ProtocolMessage::UserMessage { .. } => {
                                                messages_counter.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                                            }
                                            _ => {}
                                        }
                                        dispatch_ctx.dispatch_message(&protocol_msg);
                                        trace.end_span_ok(&dispatch_span);
                                    }
                                }
                            }
                        }
                        Ok(None) => break,  // EOF
                        Err(e) => {
                            logger.log(&format!("[RUNNER] stdout read error: {e}"));
                            break;
                        }
                    }
                }

                _ = heartbeat_interval.tick() => {
                    let elapsed_ms = start_time.elapsed().as_millis() as u64;
                    let silence_ms = last_activity.elapsed().as_millis() as u64;
                    emit_to(
                        &*emitter,
                        event_name::EXECUTION_HEARTBEAT,
                        &HeartbeatEvent {
                            execution_id: exec_id_for_stream.clone(),
                            elapsed_ms,
                            silence_ms,
                        },
                    );
                    // Also emit on structured channel
                    emit_to(
                        &*emitter,
                        event_name::EXECUTION_EVENT,
                        &StructuredExecutionEvent::Heartbeat {
                            execution_id: exec_id_for_stream.clone(),
                            elapsed_ms,
                            silence_ms,
                        },
                    );
                }
            }
        }
    })
    .await;

    // End stream processing span
    if stream_result.is_err() {
        trace.end_span_error(&stream_span, "Stream timed out");
        trace.end_span_error(&stream_output_stage, "Stream timed out");
    } else {
        trace.end_span_ok(&stream_span);
        trace.end_span_ok(&stream_output_stage);
    }

    // -- Pipeline Stage: FinalizeStatus -----------------------------------
    // Covers stderr collection, exit code handling, outcome assessment,
    // circuit breaker recording, audit logging, trace finalization, and status emit.
    let finalize_stage = trace.start_span(
        SpanType::PipelineStage,
        "Pipeline: Finalize Status",
        None,
        Some(serde_json::json!({
            "pipeline_stage": "finalize_status",
            "boundary": "Runner -> DB + events",
        })),
    );

    // Get stderr
    let stderr_text = stderr_handle.await.unwrap_or_default();
    if !stderr_text.is_empty() {
        logger.log(&format!("[STDERR] {}", stderr_text.trim()));
        emit_to(
            &*emitter,
            event_name::EXECUTION_OUTPUT,
            &ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: format!("[ERROR] {}", stderr_text.trim()),
            },
        );
    }

    // Check timeout
    let timed_out = stream_result.is_err();
    if timed_out {
        logger.log("[TIMEOUT] Execution timed out, killing process");
        driver.kill().await;
        emit_to(
            &*emitter,
            event_name::EXECUTION_OUTPUT,
            &ExecutionOutputEvent {
                execution_id: execution_id.clone(),
                line: format!("[TIMEOUT] Execution timed out after {}s", timeout_ms / 1000),
            },
        );
    }

    // Wait for process to exit (after timeout kill, if applicable)
    let exit_status = driver.wait().await;
    let duration_ms = start_time.elapsed().as_millis() as u64;

    // Unregister child PID (process has exited)
    driver.unregister_pid(&child_pids, &execution_id).await;

    let exit_code = exit_status.map(|s| s.code().unwrap_or(-1)).unwrap_or(-1);

    logger.log(&format!("Process exited with code: {exit_code}"));
    logger.log(&format!("Duration: {duration_ms}ms"));
    logger.log("=== Persona Execution Finished ===");

    // Post-mortem: extract execution flows and any protocol messages that were
    // missed during streaming (e.g. because they spanned multiple streaming deltas).
    let execution_flows = parser::extract_execution_flows(&assistant_text)
        .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
        .map(crate::db::models::Json);

    // Post-mortem protocol extraction: catch emit_event and agent_memory messages
    // that were missed during streaming (e.g. because they spanned multiple deltas).
    // Use execution-scoped counters from mid-stream dispatch to avoid persona-wide
    // dedup that would either skip recovery or duplicate across executions.
    {
        let mid_stream_events = stream_events_dispatched.load(std::sync::atomic::Ordering::Relaxed);
        let mid_stream_memories = stream_memories_dispatched.load(std::sync::atomic::Ordering::Relaxed);

        let need_events = mid_stream_events == 0;
        let need_memories = mid_stream_memories == 0;

        if need_events || need_memories {
            let notif_ref = persona.notification_channels.as_deref();
            let mut dispatch_ctx = super::dispatch::DispatchContext::new(
                &*emitter,
                &pool,
                &execution_id,
                &persona.id,
                &persona.project_id,
                &persona.name,
                notif_ref,
                &mut logger,
                None, // lazy-loaded on first use (context persists across loop)
            );
            dispatch_ctx.ops_mode = is_ops_mode;
            dispatch_ctx.is_simulation = is_simulation_mode;
            dispatch_ctx.use_case_id = execution_use_case_id.as_deref();
            use super::protocol::ExecutionProtocol;
            for line in assistant_text.split('\n') {
                let trimmed = line.trim();
                if trimmed.starts_with('{') {
                    if let Some(protocol_msg) = parser::extract_protocol_message(trimmed) {
                        match &protocol_msg {
                            ProtocolMessage::EmitEvent { .. } if need_events => {
                                dispatch_ctx.dispatch_message(&protocol_msg);
                            }
                            ProtocolMessage::AgentMemory { .. } if need_memories => {
                                dispatch_ctx.dispatch_message(&protocol_msg);
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    // Record tool usage (skip if persona deletion is in progress — rows will be CASCADE-deleted)
    let persona_being_deleted = cancelled.load(std::sync::atomic::Ordering::Acquire);
    if !persona_being_deleted {
        let tool_counts = parser::count_tool_usage(&tool_use_lines);
        for (tool_name, count) in &tool_counts {
            let _ = usage_repo::record(&pool, &execution_id, &persona.id, tool_name, *count as i32);
        }
    }

    // Wrap tool steps for typed DB storage
    let tool_steps_json = if tool_steps.is_empty() {
        None
    } else {
        Some(crate::db::models::Json(tool_steps))
    };

    logger.close();
    let log_truncated = logger.had_write_errors();

    // Stable per-persona workspace dirs are NOT cleaned up (they persist
    // across executions for Claude Code memory and workspace files).
    // Only per-execution fallback dirs are cleaned up.

    // Build result
    let success = !timed_out && exit_code == 0;
    let error = if timed_out {
        Some(format!("Execution timed out after {}s", timeout_ms / 1000))
    } else if exit_code != 0 {
        if parser::is_session_limit_error(&stderr_text) {
            Some("Session limit reached".into())
        } else {
            Some(format!(
                "Execution failed (exit code {}): {}",
                exit_code,
                stderr_text.trim()
            ))
        }
    } else {
        None
    };

    // Check outcome assessment: CLI exited 0 but task may not have been accomplished
    let mut final_status = if success { ExecutionState::Completed } else { ExecutionState::Failed };
    if success {
        if let Some((accomplished, ref _summary)) =
            parser::parse_outcome_assessment(&assistant_text)
        {
            if !accomplished {
                final_status = ExecutionState::Incomplete;
                logger.log("[OUTCOME] Task not accomplished -- marking as incomplete");
            }
        } else {
            // No outcome_assessment found -- use heuristic, but conservatively
            // defer to exit code 0. Agents often discuss errors they encountered
            // and fixed (e.g., "I found an error and resolved it"), so error
            // substrings alone are not reliable without checking for resolution
            // language. Only mark as incomplete when error indicators appear
            // WITHOUT any success or resolution indicators.
            let lower_text = assistant_text.to_lowercase();
            let has_error_indicators = lower_text.contains("error:")
                || lower_text.contains("failed to")
                || lower_text.contains("unable to")
                || lower_text.contains("could not");
            let has_success_indicators = lower_text.contains("successfully")
                || lower_text.contains("completed")
                || lower_text.contains("done");
            let has_resolution_indicators = lower_text.contains("fixed")
                || lower_text.contains("resolved")
                || lower_text.contains("corrected")
                || lower_text.contains("handled")
                || lower_text.contains("recovered")
                || lower_text.contains("worked around");
            if has_error_indicators && !has_success_indicators && !has_resolution_indicators {
                final_status = ExecutionState::Incomplete;
                logger.log("[OUTCOME] No assessment found, error indicators detected -- marking as incomplete");
            }
        }
    }

    let session_limit_reached = error
        .as_ref()
        .map(|e| e.contains("Session limit"))
        .unwrap_or(false);

    // Record circuit breaker outcome for the active provider
    if let Some(ref err) = error {
        if failover::classify_error(err).is_some() {
            let transitions = circuit_breaker.record_failure(active_engine_kind);
            for transition in &transitions {
                emit_to(&*emitter, event_name::CIRCUIT_BREAKER_TRANSITION, transition);
            }
            if transitions.iter().any(|t| t.provider == "global") {
                emit_to(&*emitter, event_name::CIRCUIT_BREAKER_GLOBAL_TRIPPED, &circuit_breaker.get_status());
            }
        }
    } else {
        circuit_breaker.record_success(active_engine_kind);
    }

    // Record provider audit log entry (BYOM compliance trail)
    let audit_entry = super::byom::ProviderAuditEntry {
        id: uuid::Uuid::new_v4().to_string(),
        execution_id: execution_id.clone(),
        persona_id: persona.id.clone(),
        persona_name: persona.name.clone(),
        engine_kind: active_engine_kind.as_setting().to_string(),
        model_used: metrics.model_used.clone(),
        was_failover: active_engine_kind != primary_engine,
        routing_rule_name: policy_decision.routing_rule_name.clone(),
        compliance_rule_name: policy_decision.compliance_rule_name.clone(),
        cost_usd: Some(metrics.cost_usd),
        duration_ms: Some(duration_ms as i64),
        status: final_status.as_str().to_string(),
        created_at: chrono::Utc::now().to_rfc3339(),
    };
    if let Err(e) = crate::db::repos::execution::provider_audit::insert(&pool, &audit_entry) {
        tracing::warn!(execution_id = %execution_id, "Failed to record provider audit log: {}", e);
    }

    // End finalize stage before trace finalization (finalize drains all spans)
    if error.is_some() {
        trace.end_span_error(&finalize_stage, error.as_deref().unwrap_or("unknown"));
    } else {
        trace.end_span_ok(&finalize_stage);
    }

    // Finalize and save execution trace
    let final_trace = trace.finalize(
        Some(metrics.cost_usd),
        Some(metrics.input_tokens),
        Some(metrics.output_tokens),
        error.clone(),
    );
    if let Err(e) = crate::db::repos::execution::traces::save(&pool, &final_trace) {
        tracing::warn!(execution_id = %execution_id, "Failed to save execution trace: {}", e);
    }
    // Emit the complete trace to frontend
    emit_to(&*emitter, event_name::EXECUTION_TRACE, &final_trace);

    // Emit process activity: final outcome
    {
        let action = if success { "completed" } else { "failed" };
        emit_to(&*emitter, event_name::PROCESS_ACTIVITY, &super::process_activity::ProcessActivityEvent::new("execution", action, Some(&execution_id), Some(&persona.name)));
    }

    // Emit final status
    emit_to(
        &*emitter,
        event_name::EXECUTION_STATUS,
        &ExecutionStatusEvent {
            execution_id: execution_id.clone(),
            status: final_status,
            error: error.clone(),
            duration_ms: Some(duration_ms),
            cost_usd: Some(metrics.cost_usd),
        },
    );

    // Deliver message to persona_messages if execution produced output but the AI
    // did NOT already send a structured report via the emit_message protocol tool.
    // When a protocol UserMessage exists, it IS the report — the raw dump is redundant.
    // The INSERT is conditional on the execution NOT already being terminal in the DB,
    // checked atomically to avoid a race with cancel/timeout handlers.
    let protocol_messages_sent = stream_messages_dispatched.load(std::sync::atomic::Ordering::Relaxed);
    if success && !assistant_text.is_empty() && protocol_messages_sent == 0 && !cancelled.load(std::sync::atomic::Ordering::Acquire) {
        // Generate a descriptive title: use the first heading, first sentence,
        // or persona name + date range as fallback instead of generic "Execution output"
        let title = {
            let first_line = assistant_text.lines().next().unwrap_or("").trim();
            // Strip markdown heading prefix
            let clean = first_line.trim_start_matches('#').trim();
            if clean.len() >= 8 && clean.len() <= 120 {
                clean.to_string()
            } else {
                // Use persona name + date for a more descriptive fallback
                format!("{} — {}", persona.name, chrono::Local::now().format("%b %d, %H:%M"))
            }
        };
        let content = if assistant_text.len() > 50_000 {
            format!("{}...\n[truncated at 50KB]", &assistant_text[..50_000])
        } else {
            assistant_text.clone()
        };
        let msg_id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let _ = pool.get().map(|conn| {
            conn.execute(
                "INSERT INTO persona_messages (id, persona_id, execution_id, title, content, content_type, priority, created_at)
                 SELECT ?1, ?2, ?3, ?4, ?5, 'text', 'normal', ?6
                 WHERE NOT EXISTS (
                     SELECT 1 FROM persona_executions WHERE id = ?3
                     AND status IN ('completed', 'failed', 'cancelled')
                 )",
                rusqlite::params![msg_id, persona.id, execution_id, title, content, now],
            ).ok();
        });
    }

    ExecutionResult {
        success,
        output: if assistant_text.is_empty() { None } else { Some(assistant_text.clone()) },
        error,
        session_limit_reached,
        log_file_path: Some(log_file_path),
        claude_session_id: metrics.session_id.clone(),
        duration_ms,
        execution_flows,
        model_used: metrics.model_used.clone(),
        input_tokens: metrics.input_tokens,
        output_tokens: metrics.output_tokens,
        cost_usd: metrics.cost_usd,
        tool_steps: tool_steps_json,
        trace_id: Some(final_trace.trace_id.clone()),
        execution_config: execution_config_json,
        log_truncated,
    }
}

/// Apply a global settings value to a profile field when the field is empty.
fn apply_global_setting(pool: &DbPool, field: &mut Option<String>, settings_key: &str) {
    let needs_global = field.as_ref().map_or(true, |v| v.is_empty());
    if needs_global {
        if let Ok(Some(value)) = crate::db::repos::core::settings::get(pool, settings_key) {
            if !value.is_empty() {
                *field = Some(value);
            }
        }
    }
}

/// Resolve global provider settings (API keys, base URLs) from the app settings DB
/// when the per-persona model profile doesn't specify them.
fn resolve_global_provider_settings(pool: &DbPool, profile: &mut ModelProfile) {
    match profile.provider.as_deref() {
        Some(providers::OLLAMA) => {
            apply_global_setting(pool, &mut profile.auth_token, settings_keys::OLLAMA_API_KEY);
        }
        Some(providers::LITELLM) => {
            apply_global_setting(pool, &mut profile.base_url, settings_keys::LITELLM_BASE_URL);
            apply_global_setting(pool, &mut profile.auth_token, settings_keys::LITELLM_MASTER_KEY);
        }
        _ => {}
    }
}

fn default_result() -> ExecutionResult {
    ExecutionResult {
        success: false,
        output: None,
        error: None,
        session_limit_reached: false,
        log_file_path: None,
        claude_session_id: None,
        duration_ms: 0,
        execution_flows: None,
        model_used: None,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0.0,
        tool_steps: None,
        trace_id: None,
        execution_config: None,
        log_truncated: false,
    }
}

/// Resolve credentials for a persona's tools and return env var mappings + prompt hints.
///
/// Resolution strategy (per tool):
/// 1. **Primary**: Find connectors whose `services` JSON array lists this tool by name.
/// 2. **Fallback**: If no connector services match, use `tool.requires_credential_type`
///    to match against connector names or credential `service_type` values.
///
/// Each credential field is mapped to an env var: `{CONNECTOR_NAME_UPPER}_{FIELD_KEY_UPPER}`.
/// For OAuth credentials with a refresh_token, automatically refreshes the access_token.
/// Returns `(env_vars, hints, decryption_failures)`. If `decryption_failures`
/// is non-empty, the caller should abort execution and surface the names.
pub(crate) async fn resolve_credential_env_vars(
    pool: &DbPool,
    tools: &[PersonaToolDefinition],
    persona_id: &str,
    persona_name: &str,
) -> (Vec<(String, String)>, Vec<String>, Vec<String>, Vec<String>) {
    let mut env_vars: Vec<(String, String)> = Vec::new();
    let mut hints: Vec<String> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    // Names of connectors that had credentials successfully injected for this
    // execution. Deduped by connector.name. Used downstream to load
    // `metadata.llm_usage_hint` for the prompt's Connector Usage Reference
    // section.
    let mut injected_connector_names: Vec<String> = Vec::new();
    let mut seen_connectors: std::collections::HashSet<String> = std::collections::HashSet::new();

    let connectors = match connector_repo::get_all(pool) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to load connectors for credential injection: {}", e);
            return (env_vars, hints, failures, injected_connector_names);
        }
    };

    for tool in tools {
        // -- Primary: match tool name in connector services --
        let mut matched_connector = false;
        for connector in &connectors {
            let services: Vec<serde_json::Value> =
                serde_json::from_str(&connector.services).unwrap_or_default();
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });

            if !tool_listed || !seen_connectors.insert(connector.name.clone()) {
                continue;
            }

            match inject_connector_credentials(
                pool,
                connector,
                &mut env_vars,
                &mut hints,
                persona_id,
                persona_name,
            ).await {
                Ok(true) => {
                    matched_connector = true;
                    injected_connector_names.push(connector.name.clone());
                }
                Ok(false) => {}
                Err(name) => { failures.push(name); }
            }
        }

        // -- Fallback: match via requires_credential_type --
        if !matched_connector {
            if let Some(ref cred_type) = tool.requires_credential_type {
                // Try matching connector by name (e.g. "google" -> connector named "google")
                // or by name prefix/substring for common patterns
                for connector in &connectors {
                    if !seen_connectors.insert(connector.name.clone()) {
                        continue;
                    }

                    let connector_matches = connector.name == *cred_type
                        || connector.name.starts_with(cred_type)
                        || cred_type.starts_with(&connector.name);

                    if !connector_matches {
                        continue;
                    }

                    match inject_connector_credentials(
                        pool,
                        connector,
                        &mut env_vars,
                        &mut hints,
                        persona_id,
                        persona_name,
                    ).await {
                        Ok(true) => {
                            matched_connector = true;
                            injected_connector_names.push(connector.name.clone());
                            break;
                        }
                        Ok(false) => {}
                        Err(name) => { failures.push(name); }
                    }
                }

                // Last resort: query credentials directly by service_type
                if !matched_connector {
                    if let Ok(creds) = cred_repo::get_by_service_type(pool, cred_type) {
                        if let Some(cred) = creds.first() {
                            if let Err(name) = inject_credential(
                                pool,
                                cred,
                                cred_type,
                                cred_type,
                                &mut env_vars,
                                &mut hints,
                                persona_id,
                                persona_name,
                            ).await {
                                failures.push(name);
                            }
                        }
                    }
                }
            }
        }
    }

    (env_vars, hints, failures, injected_connector_names)
}

/// Inject credentials for connectors referenced in the persona's design_context.
/// This ensures that generic tools (http_request, etc.) have access to all
/// connector credentials even when tool-name-based matching fails.
async fn inject_design_context_credentials(
    pool: &DbPool,
    persona: &crate::db::models::Persona,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    injected_connector_names: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) {
    // Extract connector names from design_context JSON
    let dc = match &persona.design_context {
        Some(dc) => dc,
        None => return,
    };
    let parsed: serde_json::Value = match serde_json::from_str(dc) {
        Ok(v) => v,
        Err(_) => return,
    };

    // Connector names may be in useCases[].connectors or a top-level connectors/summary field
    let mut connector_names: Vec<String> = Vec::new();

    // Check useCases[].connectors (common pattern from promote)
    if let Some(use_cases) = parsed.get("useCases").and_then(|v| v.as_array()) {
        for uc in use_cases {
            if let Some(conns) = uc.get("connectors").and_then(|v| v.as_array()) {
                for c in conns {
                    if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                        connector_names.push(name.to_string());
                    }
                }
            }
        }
    }

    // Check summary.connectors (alternate pattern)
    if let Some(summary) = parsed.get("summary") {
        if let Some(conns) = summary.get("connectors").and_then(|v| v.as_array()) {
            for c in conns {
                if let Some(name) = c.as_str() {
                    connector_names.push(name.to_string());
                } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                    connector_names.push(name.to_string());
                }
            }
        }
    }

    // Also check last_design_result for required_connectors/suggested_connectors
    if let Some(ref ldr) = persona.last_design_result {
        if let Ok(dr) = serde_json::from_str::<serde_json::Value>(ldr) {
            for key in &["required_connectors", "suggested_connectors"] {
                if let Some(conns) = dr.get(key).and_then(|v| v.as_array()) {
                    for c in conns {
                        // Handle both string ("gmail") and object ({"name": "gmail"}) formats
                        if let Some(name) = c.as_str() {
                            connector_names.push(name.to_string());
                        } else if let Some(name) = c.get("name").and_then(|v| v.as_str()) {
                            connector_names.push(name.to_string());
                        }
                    }
                }
            }
        }
    }

    if connector_names.is_empty() { return; }

    // Deduplicate and skip connectors already injected
    let existing_prefixes: std::collections::HashSet<String> = env_vars.iter()
        .filter_map(|(k, _)| k.split('_').next().map(|p| p.to_lowercase()))
        .collect();

    let connectors = match connector_repo::get_all(pool) {
        Ok(c) => c,
        Err(_) => return,
    };

    for name in &connector_names {
        let name_lower = name.to_lowercase();
        // Skip if we already injected env vars for this connector
        if existing_prefixes.contains(&name_lower) { continue; }

        // Try to find a matching connector definition
        if let Some(conn) = connectors.iter().find(|c| c.name.to_lowercase() == name_lower) {
            if let Ok(true) = inject_connector_credentials(pool, conn, env_vars, hints, persona_id, persona_name).await {
                injected_connector_names.push(conn.name.clone());
            }
        } else {
            // Direct service_type lookup as fallback
            if let Ok(creds) = cred_repo::get_by_service_type(pool, name) {
                if let Some(cred) = creds.first() {
                    if inject_credential(pool, cred, name, name, env_vars, hints, persona_id, persona_name).await.is_ok() {
                        injected_connector_names.push(name.clone());
                    }
                }
            }
        }
    }
}

/// Decrypt and inject all fields from a connector's first credential as env vars.
/// Returns `Ok(true)` if credentials were found and injected, `Ok(false)` if none
/// found, or `Err(name)` if decryption failed.
pub(crate) async fn inject_connector_credentials(
    pool: &DbPool,
    connector: &crate::db::models::ConnectorDefinition,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) -> Result<bool, String> {
    let creds = match cred_repo::get_by_service_type(pool, &connector.name) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    if let Some(cred) = creds.first() {
        inject_credential(
            pool,
            cred,
            &connector.name,
            &connector.label,
            env_vars,
            hints,
            persona_id,
            persona_name,
        ).await?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Attempt to refresh an OAuth access_token using a stored refresh_token.
/// `override_client` can supply (client_id, client_secret) when the credential
/// itself doesn't store them (e.g. `app_managed` mode).
/// Returns the new access_token on success, or None on failure.
async fn try_refresh_oauth_token(
    fields: &HashMap<String, String>,
    connector_name: &str,
    override_client: Option<(&str, &str)>,
) -> Option<String> {
    let refresh_token = fields.get("refresh_token").filter(|v| !v.is_empty())?;

    // Resolve client credentials: prefer fields, then override, then fail
    let (cid, csec) = if let (Some(id), Some(secret)) = (
        fields.get("client_id").filter(|v| !v.is_empty()),
        fields.get("client_secret").filter(|v| !v.is_empty()),
    ) {
        (id.clone(), secret.clone())
    } else if let Some((id, secret)) = override_client {
        (id.to_string(), secret.to_string())
    } else {
        tracing::debug!("No client credentials available for OAuth refresh of '{}'", connector_name);
        return None;
    };
    let client_id = &cid;
    let client_secret = &csec;

    // Determine the token endpoint based on connector type
    let token_url = match connector_name {
        n if n.starts_with("google") || n == "gmail" || n == "google_calendar" || n == "google_drive" => {
            "https://oauth2.googleapis.com/token"
        }
        "microsoft" => "https://login.microsoftonline.com/common/oauth2/v2.0/token",
        "slack" => "https://slack.com/api/oauth.v2.access",
        "github" => "https://github.com/login/oauth/access_token",
        _ => return None, // Unknown provider -- skip refresh
    };

    tracing::info!("Refreshing OAuth access token for connector '{}'", connector_name);

    let response = crate::SHARED_HTTP
        .post(token_url)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", client_id.as_str()),
            ("client_secret", client_secret.as_str()),
            ("refresh_token", refresh_token.as_str()),
            ("grant_type", "refresh_token"),
        ])
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .ok()?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        tracing::warn!("OAuth token refresh failed for '{}' ({}): {}", connector_name, status, body);
        return None;
    }

    let value: serde_json::Value = response.json().await.ok()?;
    let new_token = value.get("access_token")?.as_str()?.to_string();

    tracing::info!("Successfully refreshed OAuth access token for '{}'", connector_name);
    Some(new_token)
}

/// Decrypt a single credential and inject its fields as env vars.
/// For OAuth credentials, automatically refreshes expired access tokens.
/// Returns `Err` with the credential name if decryption fails.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn inject_credential(
    pool: &DbPool,
    cred: &crate::db::models::PersonaCredential,
    connector_name: &str,
    connector_label: &str,
    env_vars: &mut Vec<(String, String)>,
    hints: &mut Vec<String>,
    persona_id: &str,
    persona_name: &str,
) -> Result<(), String> {
    let mut fields: HashMap<String, String> = match cred_repo::get_decrypted_fields(pool, cred) {
        Ok(f) => f,
        Err(e) => {
            tracing::error!("Failed to decrypt credential '{}': {}", cred.name, e);
            return Err(cred.name.clone());
        }
    };
    let prefix = connector_name.to_uppercase().replace('-', "_");

    // Auto-refresh OAuth token if refresh_token is present.
    // For app_managed credentials (no client_id in fields), resolve from platform env.
    // Locked per credential ID to prevent concurrent refreshes from racing.
    if fields.get("refresh_token").is_some_and(|v| !v.is_empty()) {
        let refresh_handle = credential_refresh_lock(&cred.id);
        let _guard = refresh_handle.value.lock().await;

        // Re-read the credential inside the lock to pick up any token refreshed
        // by a concurrent execution that held the lock before us.
        if let Ok(re_read_cred) = cred_repo::get_by_id(pool, &cred.id) {
            if let Ok(fresh_fields) = cred_repo::get_decrypted_fields(pool, &re_read_cred) {
                fields = fresh_fields;
            }
        }

        let override_client = if fields.get("client_id").map_or(true, |v| v.is_empty()) {
            // Resolve platform-managed client credentials for OAuth connectors
            let is_google = connector_name.starts_with("google")
                || connector_name == "gmail"
                || connector_name == "google_calendar"
                || connector_name == "google_drive";
            let is_microsoft = connector_name.starts_with("microsoft")
                || connector_name == "onedrive"
                || connector_name == "sharepoint";
            if is_google {
                super::google_oauth::resolve_google_desktop_oauth_credentials()
                    .ok()
            } else if is_microsoft {
                super::google_oauth::resolve_microsoft_oauth_credentials()
                    .ok()
            } else {
                None
            }
        } else {
            None
        };
        let override_ref = override_client.as_ref().map(|(id, sec)| (id.as_str(), sec.as_str()));
        if let Some(fresh_token) = try_refresh_oauth_token(&fields, connector_name, override_ref).await {
            fields.insert("access_token".to_string(), fresh_token.clone());
            // Persist the refreshed token back to field-level storage
            if let Err(e) = cred_repo::save_fields(pool, &cred.id, &fields) {
                tracing::error!(credential_id = %cred.id, credential_name = %cred.name, "Failed to persist refreshed OAuth token: {e}");
            }
        }
    }

    // Internal metadata fields that shouldn't be exposed as env vars
    const SKIP_FIELDS: &[&str] = &[
        "oauth_client_mode", "client_id", "client_secret",
        "token_type", "expiry_date", "expires_in",
    ];

    for (field_key, field_val) in &fields {
        if SKIP_FIELDS.contains(&field_key.as_str()) || field_val.is_empty() {
            continue;
        }
        let raw_key = format!("{}_{}", prefix, field_key);
        let env_key = match sanitize_env_name(&raw_key) {
            Some(k) => k,
            None => continue,
        };
        env_vars.push((env_key.clone(), field_val.clone()));
        hints.push(format!(
            "`{}` (from {} credential '{}')",
            env_key, connector_label, cred.name
        ));
    }

    // Add well-known aliases for Google connectors so the CLI finds credentials
    // regardless of whether it looks for GMAIL_ACCESS_TOKEN or GOOGLE_ACCESS_TOKEN.
    let is_google_family = connector_name.starts_with("google")
        || connector_name == "gmail"
        || connector_name == "google_calendar"
        || connector_name == "google_drive"
        || connector_name == "google_sheets";
    if is_google_family && prefix != "GOOGLE" {
        if let Some(access_token) = fields.get("access_token").filter(|v| !v.is_empty()) {
            env_vars.push(("GOOGLE_ACCESS_TOKEN".to_string(), access_token.clone()));
        }
        if let Some(refresh_token) = fields.get("refresh_token").filter(|v| !v.is_empty()) {
            env_vars.push(("GOOGLE_REFRESH_TOKEN".to_string(), refresh_token.clone()));
        }
    }

    let _ = cred_repo::record_usage(pool, &cred.id);
    let _ = audit_log::insert(
        pool,
        &cred.id,
        &cred.name,
        "decrypt",
        Some(persona_id),
        Some(persona_name),
        Some(&format!("injected via connector '{connector_label}'")),
    );

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::DEFAULT_EXECUTION_TIMEOUT_MS;

    /// Defensive guard: the fallback must stay above the Claude Code CLI
    /// 2.1.113 subagent-stall cutoff (10 minutes). See handoff T6 in
    /// `.planning/handoffs/2026-04-17-claude-cli-2-1-111-adapter-drift.md`.
    #[test]
    fn default_execution_timeout_exceeds_cli_subagent_stall_cutoff() {
        const CLI_SUBAGENT_STALL_CUTOFF_MS: u64 = 600_000;
        assert!(
            DEFAULT_EXECUTION_TIMEOUT_MS > CLI_SUBAGENT_STALL_CUTOFF_MS,
            "DEFAULT_EXECUTION_TIMEOUT_MS ({DEFAULT_EXECUTION_TIMEOUT_MS} ms) must be > \
             CLI_SUBAGENT_STALL_CUTOFF_MS ({CLI_SUBAGENT_STALL_CUTOFF_MS} ms) so the CLI's \
             clearer error can surface before personas' generic timeout fires"
        );
    }

    #[test]
    fn default_execution_timeout_is_660_000_ms() {
        assert_eq!(DEFAULT_EXECUTION_TIMEOUT_MS, 660_000);
    }
}
