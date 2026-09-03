//! Failure aftermath: healing evaluation, retry spawning, and the persona
//! failure-count circuit breaker.
//!
//! Split out of `engine/mod.rs` verbatim (Rust refactor wave 1). Everything
//! here hangs off the single edge `handle_execution_result` →
//! [`evaluate_healing_and_retry`]: a run has already finished and failed, and
//! this half decides whether to diagnose it, retry it (delayed, chained, or
//! resumed), record it to the knowledge base, or trip the breaker and stop.
//!
//! `use super::*` re-imports the parent's module set and import block, so the
//! bodies below are byte-identical to the ones that used to live in `mod.rs`.

use super::execution::run_execution_with_ceiling;
use super::*;
use crate::utils::extract_panic_message;

/// Per-capability "Errors" sigil routing, resolved from the persona's
/// `design_context.use_cases[i].error_policy` (set during adoption). Returns
/// `(incident, lab, escalate_after)`. Absent policy falls back to the same
/// default the adoption card shows: incident on, lab off, escalate after 3 —
/// so every persona's recurring terminal failures surface in the inbox
/// without requiring per-template metadata.
fn resolve_error_policy(
    pool: &DbPool,
    persona_id: &str,
    use_case_id: Option<&str>,
) -> (bool, bool, u32) {
    const DEFAULT: (bool, bool, u32) = (true, false, 3);
    let Ok(persona) = persona_repo::get_by_id(pool, persona_id) else {
        return DEFAULT;
    };
    let Some(dc) = persona.design_context.as_deref() else {
        return DEFAULT;
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(dc) else {
        return DEFAULT;
    };
    let Some(use_cases) = design_context::pick_use_cases_array(&val) else {
        return DEFAULT;
    };
    // Prefer the capability that actually failed; fall back to the first one
    // (single-capability personas, or executions without a use_case tag).
    let uc = use_case_id
        .and_then(|id| {
            use_cases
                .iter()
                .find(|u| u.get("id").and_then(|v| v.as_str()) == Some(id))
        })
        .or_else(|| use_cases.first());
    let Some(ep) = uc.and_then(|u| u.get("error_policy")) else {
        return DEFAULT;
    };
    let incident = ep.get("incident").and_then(|v| v.as_bool()).unwrap_or(true);
    let lab = ep.get("lab").and_then(|v| v.as_bool()).unwrap_or(false);
    let escalate_after = ep
        .get("escalate_after")
        .and_then(|v| v.as_u64())
        .unwrap_or(3)
        .max(1) as u32;
    (incident, lab, escalate_after)
}

/// Evaluate a failed execution for healing opportunities and spawn retries.
#[allow(clippy::too_many_arguments)]
pub(super) fn evaluate_healing_and_retry(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    persona_timeout_ms: i32,
    result: &ExecutionResult,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
    healing_personas: Arc<Mutex<HashSet<String>>>,
) {
    // True streak since the last success, excluding environmental failures
    // (quota/limit/app-restart) — get_recent_failures(...).len() counted the
    // last 5 failed rows regardless of interleaved successes, so any persona
    // with >= 5 lifetime failures permanently read as "5 consecutive" and
    // tripped the breaker on every subsequent failure (incident spam during
    // the 2026-06-10 quota storm).
    let consecutive = exec_repo::count_consecutive_real_failures(pool, persona_id).unwrap_or(0);

    // Storm guard signal: environmental provider failures (usage-limit /
    // API-server-error) for this persona within the storm window. These bypass
    // the `consecutive < 3` gate AND are excluded from the breaker above, so
    // this is the ONLY count that bounds a sustained-incident retry storm across
    // chains. The orchestrator caps the usage-limit / ApiError arms on it.
    let environmental_failures_in_window = exec_repo::count_environmental_failures_in_window(
        pool,
        persona_id,
        healing_orchestrator::STORM_WINDOW_MINUTES as i64,
    )
    .unwrap_or(0);

    let timeout_ms = if persona_timeout_ms > 0 {
        persona_timeout_ms as u64
    } else {
        600_000
    };

    let error_str = result.error.as_deref().unwrap_or("");
    let timed_out = error_str.contains("timed out");

    let is_dev_mode =
        cfg!(debug_assertions) || std::env::var("VITE_DEVELOPMENT").as_deref() == Ok("true");

    let exec_state_str = if result.success {
        "incomplete"
    } else {
        "failed"
    };

    // Reader one. Prefer the class the RAISE SITE minted; fall back to the
    // string ladder only when nothing knew it. `diagnose` and the whole
    // recovery policy below are untouched -- same policy, better input. The
    // engine's own safety ceiling is the case this changes: it used to arrive
    // here as prose that matched no timeout pattern and landed in `Unknown`,
    // whose recovery is `CreateIssue` with no retry, ever.
    let category = result.error_category.unwrap_or_else(|| {
        healing::classify_error(error_str, timed_out, result.session_limit_reached)
    });

    // Phase C5b — when the run fails for a technical reason (auth, network,
    // rate-limit, timeout, provider-not-found, API error), wipe any manual
    // reviews the LLM emitted *before* the technical error propagated. Those
    // reviews describe a run that never produced real output, so queueing
    // them for a human to resolve is noise. See
    // `engine::error_taxonomy::is_technical_failure` for the category set.
    if !result.success && error_taxonomy::is_technical_failure(&category) {
        match crate::db::repos::communication::manual_reviews::delete_for_execution(pool, exec_id) {
            Ok(0) => { /* nothing to clean up */ }
            Ok(n) => tracing::info!(
                execution_id = %exec_id,
                category = ?category,
                deleted = n,
                "Suppressed {n} manual review(s) — execution failed for a technical reason"
            ),
            Err(e) => tracing::warn!(
                execution_id = %exec_id,
                error = %e,
                "Failed to clean up manual reviews after technical failure"
            ),
        }
    }

    let kb_hint = resolve_service_knowledge_hint(pool, persona_id, &category);

    let current_retry_count = exec_repo::get_by_id(pool, exec_id)
        .map(|e| e.retry_count)
        .unwrap_or(0);

    // --- Decision tree (see healing_orchestrator module docs for precedence) ---
    // `category` was classified once above (the single classification on the
    // failure path) — thread it in so the orchestrator does NOT re-run the
    // string ladder. `timed_out` / `session_limit_reached` already folded into
    // `category` via `classify_error`, so they are not passed again.
    let ctx = healing_orchestrator::HealingContext {
        error: error_str,
        category,
        usage_limit: result.usage_limit.as_ref(),
        execution_state: exec_state_str,
        timeout_ms,
        consecutive_failures: consecutive,
        retry_count: current_retry_count,
        environmental_failures_in_window,
        kb_hint: kb_hint.as_ref(),
        has_session_id: result.claude_session_id.is_some(),
        is_dev_mode,
    };
    let strategy = healing_orchestrator::evaluate(&ctx);
    let diagnosis = strategy.diagnosis().clone();

    record_failure_to_knowledge_base(pool, persona_id, &category, &diagnosis);

    let issue = match healing_repo::create(
        pool,
        persona_id,
        &diagnosis.title,
        &diagnosis.description,
        diagnosis
            .title
            .to_ascii_lowercase()
            .contains("circuit breaker"),
        Some(&diagnosis.severity),
        Some(&diagnosis.db_category),
        Some(exec_id),
        diagnosis.suggested_fix.as_deref(),
    ) {
        Ok(Some(issue)) => issue,
        Ok(None) => return, // duplicate -- already handled
        Err(_) => return,
    };

    // auto_fixed is true only when the strategy wants auto-fix AND the DB
    // status transition succeeded — prevents orphaned retries on DB failure.
    let mut auto_fixed = strategy.is_auto_action();

    // Fetch persona info for notifications
    let persona_for_heal = persona_repo::get_by_id(pool, persona_id).ok();
    let heal_channels = persona_for_heal
        .as_ref()
        .and_then(|p| p.notification_channels.as_deref());
    let heal_name = persona_for_heal
        .as_ref()
        .map(|p| p.name.clone())
        .unwrap_or_else(|| "Agent".into());

    // --- "Errors" sigil routing: escalate recurring terminal failures per the
    // failed capability's error_policy (configured at adoption). Best-effort;
    // never affects the run. Real executions only (skip simulations). Gated by
    // escalate_after consecutive failures so a single blip doesn't escalate.
    {
        let failed_exec = exec_repo::get_by_id(pool, exec_id).ok();
        let is_simulation = failed_exec
            .as_ref()
            .map(|e| e.is_simulation)
            .unwrap_or(false);
        let use_case_id = failed_exec.as_ref().and_then(|e| e.use_case_id.clone());
        if !is_simulation {
            let (route_incident, route_lab, escalate_after) =
                resolve_error_policy(pool, persona_id, use_case_id.as_deref());
            // The `consecutive` count above is capped at 5 (it drives the
            // circuit breaker); re-count sized to escalate_after so the full
            // card range (up to 20) actually fires.
            let escalation_failures =
                exec_repo::get_recent_failures(pool, persona_id, escalate_after as i64)
                    .map(|v| v.len() as u32)
                    .unwrap_or(consecutive);
            if escalation_failures >= escalate_after {
                if route_incident {
                    let detail = serde_json::json!({
                        "use_case_id": use_case_id,
                        "category": diagnosis.db_category,
                        "consecutive_failures": consecutive,
                        "description": diagnosis.description,
                        // Surfaced for an inbox "Send to Lab" action when the
                        // capability opted into lab routing.
                        "lab_requested": route_lab,
                    })
                    .to_string();
                    // dedup_key is `execution_error:{exec_id}` → one incident per
                    // failed execution (idempotent under retries).
                    if let Err(e) = incidents_repo::promote(
                        pool,
                        crate::db::models::CreateAuditIncidentInput {
                            source_table: "execution_error".into(),
                            source_id: exec_id.into(),
                            persona_id: Some(persona_id.into()),
                            persona_name: persona_for_heal.as_ref().map(|p| p.name.clone()),
                            execution_id: Some(exec_id.into()),
                            severity: diagnosis.severity.clone(),
                            kind: diagnosis.db_category.clone(),
                            title: diagnosis.title.clone(),
                            detail: Some(detail),
                        },
                    ) {
                        tracing::warn!(execution_id = %exec_id, error = %e, "error_policy: failed to open incident");
                    }
                }
                if route_lab {
                    // The capability opted into Lab auto-improvement — enable the
                    // persona's evolution policy so the Lab improves it over time.
                    if let Err(e) = evolution_repo::upsert_policy(
                        pool,
                        &crate::db::models::UpsertEvolutionPolicyInput {
                            persona_id: persona_id.into(),
                            enabled: Some(true),
                            fitness_objective: None,
                            mutation_rate: None,
                            variants_per_cycle: None,
                            improvement_threshold: None,
                            min_executions_between: None,
                            mutation_strategy: None,
                        },
                    ) {
                        tracing::warn!(persona_id = %persona_id, error = %e, "error_policy: failed to enable lab auto-improve");
                    }
                }
            }
        }
    }

    // Circuit breaker: disable persona after too many consecutive failures.
    if matches!(
        strategy,
        healing_orchestrator::HealingStrategy::CircuitBreakerTripped { .. }
    ) {
        check_circuit_breaker(
            pool,
            app,
            exec_id,
            persona_id,
            consecutive,
            &issue.id,
            &heal_name,
        );
    }

    let auto_fix_persisted = if matches!(
        strategy,
        healing_orchestrator::HealingStrategy::RuleBasedRetry { .. }
    ) {
        match healing_repo::mark_auto_fix_pending(pool, &issue.id) {
            Ok(()) => true,
            Err(e) => {
                tracing::error!(
                    issue_id = %issue.id,
                    error = %e,
                    "mark_auto_fix_pending failed — skipping auto-retry to avoid orphaned retry"
                );
                false
            }
        }
    } else {
        false
    };

    // If the DB transition failed, demote to non-auto-fixed so downstream
    // event payloads and strategy execution stay consistent.
    if !auto_fix_persisted && auto_fixed {
        auto_fixed = false;
    }

    // Notify healing issue
    (hooks().notify_healing_issue)(
        app,
        &heal_name,
        &diagnosis.title,
        &diagnosis.severity,
        diagnosis.suggested_fix.as_deref(),
        heal_channels,
    );

    // Derive retry-specific storytelling fields
    let (strategy_label, backoff_seconds) = if auto_fixed {
        match &diagnosis.action {
            healing::HealingAction::RetryWithBackoff { delay_secs } => {
                (Some("Exponential backoff".to_string()), Some(*delay_secs))
            }
            healing::HealingAction::RetryWithTimeout { new_timeout_ms } => (
                Some(format!("Increased timeout to {new_timeout_ms}ms")),
                Some(5u64),
            ),
            healing::HealingAction::RetryAt { retry_at } => (
                Some("Scheduled retry at usage-limit reset".to_string()),
                Some((*retry_at - chrono::Utc::now()).num_seconds().max(0) as u64),
            ),
            _ => (None, None),
        }
    } else {
        (Some("Manual investigation required".to_string()), None)
    };

    let _ = app.emit(
        event_name::HEALING_EVENT,
        HealingEventPayload {
            issue_id: issue.id,
            persona_id: persona_id.into(),
            execution_id: exec_id.into(),
            title: diagnosis.title.clone(),
            action: if auto_fixed {
                "auto_retry".into()
            } else {
                "issue_created".into()
            },
            auto_fixed,
            severity: diagnosis.severity.clone(),
            suggested_fix: diagnosis.suggested_fix.clone(),
            persona_name: heal_name,
            description: Some(diagnosis.description.clone()),
            strategy: strategy_label,
            backoff_seconds,
            retry_number: if auto_fixed {
                Some(current_retry_count + 1)
            } else {
                None
            },
            max_retries: Some(healing::MAX_RETRY_COUNT),
        },
    );

    // Execute the chosen strategy.
    match strategy {
        healing_orchestrator::HealingStrategy::RuleBasedRetry { .. } if auto_fix_persisted => {
            spawn_healing_retry(
                pool,
                app,
                exec_id,
                persona_id,
                current_retry_count,
                &diagnosis,
                tracker.clone(),
                child_pids.clone(),
                cancelled_flags.clone(),
                log_dir.clone(),
                circuit_breaker.clone(),
            );
        }
        healing_orchestrator::HealingStrategy::AiHealing { .. } => {
            // AI healing: resume the original Claude session as a chained execution.
            if let Some(ref session_id) = result.claude_session_id {
                spawn_healing_chain(
                    pool.clone(),
                    app.clone(),
                    exec_id.to_string(),
                    persona_id.to_string(),
                    session_id.clone(),
                    result.error.clone().unwrap_or_default(),
                    format!("{category:?}"),
                    tracker,
                    child_pids,
                    cancelled_flags,
                    log_dir,
                    circuit_breaker,
                    healing_personas,
                    false, // auto path: this task acquires the slot itself
                );
            }
        }
        // CircuitBreakerTripped and CreateIssue — no further action needed.
        _ => {}
    }
}

/// Disable persona after too many consecutive failures (circuit breaker).
fn check_circuit_breaker(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    consecutive: u32,
    issue_id: &str,
    persona_name: &str,
) {
    // NEVER silently disable a TEAM MEMBER. Disabled members swallow the bus
    // handoff (skip, no DLQ) and stall the whole team's cascade — the 06-09
    // fleet deadlock traced partly to this: quota-storm + restart-kill
    // failures tripped this breaker on Dev Clone / QA Guardian / Release /
    // Docs across two teams (the E1 no-op breaker already skips team members
    // for the same reason; this failure-path breaker predated that lesson).
    // For a team member, raise a visible INCIDENT instead and leave it
    // enabled — a member that keeps failing is the team's problem to surface,
    // not a unit to silently amputate.
    let home_team: Option<String> = pool
        .get()
        .ok()
        .and_then(|conn| {
            conn.query_row(
                "SELECT home_team_id FROM personas WHERE id = ?1",
                rusqlite::params![persona_id],
                |r| r.get::<_, Option<String>>(0),
            )
            .ok()
        })
        .flatten();
    if let Some(home_team_id) = home_team {
        tracing::warn!(
            persona_id = %persona_id,
            persona_name = %persona_name,
            home_team_id = %home_team_id,
            consecutive,
            "circuit breaker: team member NOT disabled — raising incident instead (disable would stall the team cascade)"
        );
        let _ = crate::db::repos::execution::audit_incidents::promote(
            pool,
            crate::db::models::CreateAuditIncidentInput {
                source_table: "circuit_breaker".to_string(),
                source_id: persona_id.to_string(),
                persona_id: Some(persona_id.to_string()),
                persona_name: Some(persona_name.to_string()),
                execution_id: Some(exec_id.to_string()),
                severity: "high".to_string(),
                kind: "team_member_failing".to_string(),
                title: format!("{persona_name}: {consecutive} consecutive failures"),
                detail: Some(format!(
                    "Team member hit the circuit-breaker threshold ({consecutive} consecutive \
                     failures) but was NOT auto-disabled — disabling a team member silently \
                     breaks the team's handoff chain. Investigate the failure cause (quota \
                     storm? credential? prompt regression?); the member stays enabled."
                )),
            },
        );
        return;
    }

    tracing::warn!(
        persona_id = %persona_id,
        consecutive = consecutive,
        "Circuit breaker tripped: disabling persona after {} consecutive failures",
        consecutive,
    );
    let _ = crate::db::repos::core::personas::update(
        pool,
        persona_id,
        crate::db::models::UpdatePersonaInput {
            enabled: Some(false),
            ..Default::default()
        },
    );
    let cb_fix = "Review recent failures and fix the underlying issue, then re-enable the persona.";
    let _ = healing_repo::create(
        pool,
        persona_id,
        "Circuit breaker tripped",
        &format!(
            "Persona disabled after {consecutive} consecutive failures. Re-enable manually after investigating the root cause.",
        ),
        true,
        Some("critical"),
        Some("config"),
        Some(exec_id),
        Some(cb_fix),
    );
    let _ = app.emit(
        event_name::HEALING_EVENT,
        HealingEventPayload {
            issue_id: issue_id.into(),
            persona_id: persona_id.into(),
            execution_id: exec_id.into(),
            title: "Circuit breaker tripped".into(),
            action: "circuit_breaker".into(),
            auto_fixed: false,
            severity: "critical".into(),
            suggested_fix: Some(cb_fix.into()),
            persona_name: persona_name.into(),
            description: Some(format!(
                "Agent disabled after {consecutive} consecutive failures. Investigation required.",
            )),
            strategy: Some("Persona disabled -- manual intervention required".into()),
            backoff_seconds: None,
            retry_number: None,
            max_retries: Some(healing::MAX_RETRY_COUNT),
        },
    );
}

/// Spawn a retry execution based on the healing diagnosis action.
#[allow(clippy::too_many_arguments)]
fn spawn_healing_retry(
    pool: &DbPool,
    app: &AppHandle,
    exec_id: &str,
    persona_id: &str,
    current_retry_count: i64,
    diagnosis: &healing::HealingDiagnosis,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
) {
    let next_retry_count = current_retry_count + 1;
    let original_exec_id = exec_repo::get_by_id(pool, exec_id)
        .ok()
        .and_then(|e| e.retry_of_execution_id)
        .unwrap_or_else(|| exec_id.into());

    match &diagnosis.action {
        healing::HealingAction::RetryWithBackoff { delay_secs } => {
            tracing::info!(
                persona_id = %persona_id,
                delay_secs = *delay_secs,
                retry_count = next_retry_count,
                "Healing: spawning delayed retry after {}s backoff",
                delay_secs,
            );
            spawn_delayed_retry(
                *delay_secs,
                None,
                None, // backoff retries restart fresh
                pool.clone(),
                app.clone(),
                persona_id.into(),
                original_exec_id,
                next_retry_count,
                tracker,
                child_pids,
                cancelled_flags,
                log_dir,
                circuit_breaker,
            );
        }
        healing::HealingAction::RetryWithTimeout { new_timeout_ms } => {
            tracing::info!(
                persona_id = %persona_id,
                new_timeout_ms = new_timeout_ms,
                retry_count = next_retry_count,
                "Healing: spawning retry with increased timeout {}ms",
                new_timeout_ms,
            );
            spawn_delayed_retry(
                5,
                Some(*new_timeout_ms),
                None, // timeout retries restart fresh
                pool.clone(),
                app.clone(),
                persona_id.into(),
                original_exec_id,
                next_retry_count,
                tracker,
                child_pids,
                cancelled_flags,
                log_dir,
                circuit_breaker,
            );
        }
        healing::HealingAction::RetryAt { retry_at } => {
            // Durable: persisted to scheduled_retries and drained by the
            // event-bus tick, so the retry survives app restarts across the
            // multi-hour usage-limit wait.
            tracing::info!(
                persona_id = %persona_id,
                execution_id = %exec_id,
                retry_at = %retry_at,
                "Healing: persisting scheduled retry",
            );
            if let Err(e) = scheduled_retries_repo::upsert(
                pool,
                exec_id,
                persona_id,
                &retry_at.to_rfc3339(),
                retry_reason_for(diagnosis),
            ) {
                tracing::error!(
                    execution_id = %exec_id,
                    error = %e,
                    "Failed to persist scheduled usage-limit retry",
                );
            }
        }
        _ => {}
    }
}

// =============================================================================
// Healing Executor: autonomous retry spawning
// =============================================================================

/// Spawn a chained healing execution that resumes the original Claude session.
///
/// Instead of building a new prompt from scratch, this resumes the failed
/// session via `--resume <session_id>` so the healer has full context of what
/// the original CLI attempted. The healing execution is tracked as a linked
/// execution record, visible in the execution list.
#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_healing_chain(
    pool: DbPool,
    app: AppHandle,
    original_exec_id: String,
    persona_id: String,
    session_id: String,
    error_message: String,
    category_str: String,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
    healing_personas: Arc<Mutex<HashSet<String>>>,
    // True when the caller already acquired the healing_personas slot (the command
    // path pre-acquires via try_start_healing). In that case this task must NOT
    // re-acquire — re-inserting self-collides, hits the already-in-progress guard,
    // and early-returns BEFORE the cleanup paths, leaking the slot forever (healing
    // then silently bricked for that persona until restart). It still releases the
    // slot on every exit path either way.
    slot_already_held: bool,
) {
    tokio::spawn(async move {
        // Per-persona concurrency guard: prevent overlapping healing sessions. If
        // another session is already in progress, skip silently. Skip the acquire
        // when the caller already holds the slot (see slot_already_held doc above).
        if !slot_already_held && !healing_personas.lock().await.insert(persona_id.clone()) {
            tracing::info!(
                persona_id = %persona_id,
                "AI healing: session already in progress, skipping",
            );
            return;
        }

        // Brief delay to let the original execution finalize
        tokio::time::sleep(std::time::Duration::from_secs(2)).await;

        tracing::info!(
            persona_id = %persona_id,
            original_exec_id = %original_exec_id,
            "AI healing: starting chained healing execution (session resume)",
        );

        // 1. Load persona fresh from DB
        let mut persona = match persona_repo::get_by_id(&pool, &persona_id) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!("AI healing: failed to load persona: {}", e);
                healing_personas.lock().await.remove(&persona_id);
                return;
            }
        };

        if !persona.enabled {
            tracing::warn!("AI healing: persona disabled, skipping");
            healing_personas.lock().await.remove(&persona_id);
            return;
        }

        // 2. Force Claude Opus model for healing
        persona.model_profile = Some(r#"{"model":"claude-opus-4-6"}"#.to_string());

        // 3. Build healing input data
        let healing_input = ai_healing::build_healing_input(&error_message, &category_str);

        // 4. Create healing execution record (linked to original)
        let retry_count = exec_repo::get_by_id(&pool, &original_exec_id)
            .map(|e| e.retry_count)
            .unwrap_or(0);
        let exec =
            match exec_repo::create_retry(&pool, &persona_id, &original_exec_id, retry_count + 1) {
                Ok(e) => e,
                Err(e) => {
                    tracing::error!("AI healing: failed to create execution record: {}", e);
                    healing_personas.lock().await.remove(&persona_id);
                    return;
                }
            };

        let exec_id = exec.id.clone();

        // Emit started status
        let _ = app.emit(
            event_name::AI_HEALING_STATUS,
            serde_json::json!({
                "execution_id": original_exec_id,
                "persona_id": persona_id,
                "phase": "started",
                "healing_execution_id": exec_id,
            }),
        );

        // 5. Check capacity and register in tracker
        {
            let mut t = tracker.lock().await;
            if !t.try_add_running(&persona_id, &exec_id, persona.max_concurrent) {
                tracing::warn!("AI healing: no capacity, skipping");
                let _ = app.emit(
                    event_name::AI_HEALING_STATUS,
                    serde_json::json!({
                        "execution_id": original_exec_id,
                        "persona_id": persona_id,
                        "phase": "failed",
                    }),
                );
                healing_personas.lock().await.remove(&persona_id);
                return;
            }
        }

        // 6. Update to running
        persist_status_update(
            &pool,
            Some(&app),
            &exec_id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .await;

        // 7. Get tools for persona
        let tools = tool_repo::get_tools_for_persona(&pool, &persona_id).unwrap_or_default();

        // 8. Create cancellation flag
        let cancelled = Arc::new(AtomicBool::new(false));
        cancelled_flags
            .lock()
            .await
            .insert(exec_id.clone(), cancelled.clone());

        // Emit diagnosing phase
        let _ = app.emit(
            event_name::AI_HEALING_STATUS,
            serde_json::json!({
                "execution_id": original_exec_id,
                "persona_id": persona_id,
                "phase": "diagnosing",
                "healing_execution_id": exec_id,
            }),
        );

        // Clones for cleanup (catch_unwind guard)
        let pool_for_cleanup = pool.clone();
        let app_for_cleanup = app.clone();
        let exec_id_cleanup = exec_id.clone();
        let persona_id_cleanup = persona_id.clone();

        let work = AssertUnwindSafe(async {
            // 9. Run the execution, resuming the original session
            let result = run_execution_with_ceiling(
                app.clone(),
                pool.clone(),
                exec_id.clone(),
                persona,
                tools,
                Some(healing_input), // healing instructions as input_data
                log_dir,
                child_pids.clone(),
                cancelled.clone(),
                Some(types::Continuation::SessionResume(session_id)),
                None, // no chain_trace_id
                circuit_breaker,
            )
            .await;

            // 10. Write final status (conditional to avoid cancel race)
            let status = if cancelled.load(Ordering::Acquire) {
                ExecutionState::Cancelled
            } else if result.success {
                ExecutionState::Completed
            } else {
                ExecutionState::Failed
            };

            persist_status_if_not_final(
                &pool,
                Some(&app),
                &exec_id,
                UpdateExecutionStatus {
                    status,
                    output_data: result.output.clone(),
                    error_message: result.error.clone(),
                    duration_ms: Some(result.duration_ms as i64),
                    log_file_path: result.log_file_path.clone(),
                    execution_flows: result.execution_flows.clone(),
                    input_tokens: Some(result.input_tokens as i64),
                    output_tokens: Some(result.output_tokens as i64),
                    cost_usd: Some(result.cost_usd),
                    tool_steps: result.tool_steps.clone(),
                    claude_session_id: result.claude_session_id.clone(),
                    execution_config: None,
                    log_truncated: result.log_truncated,
                    business_outcome: result.business_outcome.clone(),
                    error_category: result.error_category.map(error_taxonomy::category_token),
                },
            )
            .await;

            let _ = app.emit(
                event_name::EXECUTION_STATUS,
                types::ExecutionStatusEvent {
                    execution_id: exec_id.clone(),
                    status,
                    error: result.error.clone(),
                    duration_ms: Some(result.duration_ms),
                    cost_usd: Some(result.cost_usd),
                },
            );

            // Signal frontend that persona health data has changed
            emit_event(
                &app,
                event_name::PERSONA_HEALTH_CHANGED,
                &serde_json::json!({
                    "persona_id": persona_id,
                }),
            );

            // 11. Process healing output — ONLY if the healing run itself
            // succeeded (and wasn't cancelled). A healing session that timed out,
            // was rate-limited, or crashed mid-stream can still have emitted a
            // `{"healing_complete":{"should_retry":true}}` line earlier in its
            // stdout. Applying those fixes to the DB and retrying the ORIGINAL
            // task off that half-finished / possibly-wrong diagnosis is the
            // worst-case "recovery code that fails silently": it presents a
            // failed heal as a successful repair and burns budget (or worsens the
            // persona) on a misdiagnosis. `should_retry` is LLM-reported and must
            // be gated on the heal actually succeeding.
            if !result.success || cancelled.load(Ordering::Acquire) {
                tracing::warn!(
                    execution_id = %original_exec_id,
                    persona_id = %persona_id,
                    "AI healing run did not succeed; not applying fixes or scheduling a retry"
                );
                let _ = app.emit(
                    event_name::AI_HEALING_STATUS,
                    serde_json::json!({
                        "execution_id": original_exec_id,
                        "persona_id": persona_id,
                        "phase": "failed",
                        "healing_execution_id": exec_id,
                    }),
                );
                // Direction 2a: a cancelled heal is a user stop, not an
                // abandonment — only surface the chain-stop when the heal run
                // genuinely failed.
                if !cancelled.load(Ordering::Acquire) {
                    record_healing_chain_stop(
                        &pool,
                        &original_exec_id,
                        &persona_id,
                        chain::stop_reason::HEALING_ABANDONED,
                        "AI-heal run did not succeed; no fix applied".to_string(),
                    );
                }
                return;
            }

            // Parse fixes and apply to DB.
            let _ = app.emit(
                event_name::AI_HEALING_STATUS,
                serde_json::json!({
                    "execution_id": original_exec_id,
                    "persona_id": persona_id,
                    "phase": "applying",
                    "healing_execution_id": exec_id,
                }),
            );

            match ai_healing::process_healing_result(&pool, &persona_id, &result).await {
                Ok(heal_result) => {
                    tracing::info!(
                        "AI healing completed for {}: {} fixes, retry={}",
                        original_exec_id,
                        heal_result.fixes_applied.len(),
                        heal_result.should_retry,
                    );

                    let _ = app.emit(
                        event_name::AI_HEALING_STATUS,
                        serde_json::json!({
                            "execution_id": original_exec_id,
                            "persona_id": persona_id,
                            "phase": "completed",
                            "healing_execution_id": exec_id,
                            "diagnosis": heal_result.diagnosis,
                            "fixes_applied": heal_result.fixes_applied.iter()
                                .map(|f| f.description.clone())
                                .collect::<Vec<_>>(),
                            "should_retry": heal_result.should_retry,
                        }),
                    );

                    // If fixes were applied and retry is recommended, schedule
                    // a fresh retry of the original task (not another heal)
                    if heal_result.should_retry && !heal_result.fixes_applied.is_empty() {
                        tracing::info!(
                            "AI healing: scheduling retry after {} fixes applied",
                            heal_result.fixes_applied.len(),
                        );
                        spawn_delayed_retry(
                            2, // short delay after AI fixes
                            None,
                            None, // AI-healing already resumed; the re-attempt restarts fresh
                            pool.clone(),
                            app.clone(),
                            persona_id.clone(),
                            original_exec_id.clone(),
                            // The healing execution itself was created at
                            // retry_count + 1 (see create_retry above). The actual
                            // re-attempt is the NEXT slot, retry_count + 2 —
                            // sharing + 1 with the heal collided their attempt
                            // numbers and miscounted the retry budget by one.
                            retry_count + 2,
                            tracker.clone(),
                            child_pids.clone(),
                            cancelled_flags.clone(),
                            // log_dir was moved into runner, use a fresh path
                            std::env::temp_dir().join("personas-logs"),
                            // circuit_breaker was moved, create a fresh ref
                            Arc::new(failover::ProviderCircuitBreaker::new()),
                        );
                    } else if heal_result.fixes_applied.is_empty() {
                        // Direction 2a: the heal ran to completion but produced
                        // no actionable fix, so the original (possibly chained)
                        // link stays broken with no retry scheduled. Surface it
                        // as a chain stop for chained runs.
                        record_healing_chain_stop(
                            &pool,
                            &original_exec_id,
                            &persona_id,
                            chain::stop_reason::HEALING_ABANDONED,
                            "AI-heal produced no actionable fix".to_string(),
                        );
                    }
                }
                Err(e) => {
                    tracing::warn!("AI healing: failed to process result: {}", e);
                    let _ = app.emit(
                        event_name::AI_HEALING_STATUS,
                        serde_json::json!({
                            "execution_id": original_exec_id,
                            "persona_id": persona_id,
                            "phase": "failed",
                        }),
                    );
                    // Direction 2a: applying the parsed fixes failed — the heal
                    // did not repair the link.
                    record_healing_chain_stop(
                        &pool,
                        &original_exec_id,
                        &persona_id,
                        chain::stop_reason::HEALING_ABANDONED,
                        format!("AI-heal fix application failed: {e}"),
                    );
                }
            }
        });

        if let Err(panic_info) = work.catch_unwind().await {
            let panic_msg = extract_panic_message(panic_info);
            tracing::error!(
                execution_id = %exec_id_cleanup,
                persona_id = %persona_id_cleanup,
                panic = %panic_msg,
                "Healing execution panicked — releasing concurrency slot",
            );
            persist_status_if_not_final(
                &pool_for_cleanup,
                Some(&app_for_cleanup),
                &exec_id_cleanup,
                UpdateExecutionStatus {
                    status: ExecutionState::Failed,
                    error_message: Some(format!("Internal error (panic): {panic_msg}")),
                    ..Default::default()
                },
            )
            .await;
        }

        // 12. Cleanup (always, regardless of panic)
        tracker
            .lock()
            .await
            .remove_running(&persona_id_cleanup, &exec_id_cleanup);
        cancelled_flags.lock().await.remove(&exec_id_cleanup);
        healing_personas.lock().await.remove(&persona_id_cleanup);

        // Promote queued executions now that a healing slot is free. Fetch
        // the engine via AppState so we don't have to plumb every Arc through
        // the spawn chain.
        if let Some(eng) = app_for_cleanup.try_state::<Arc<ExecutionEngine>>() {
            eng.drain_after_slot_freed(app_for_cleanup.clone(), pool_for_cleanup.clone())
                .await;
        }

        #[cfg(feature = "desktop")]
        (hooks().refresh_tray)(&app_for_cleanup);
    });
}

/// Direction 2a: record a `chain_stop_reasons` row when a self-healing pathway
/// abandons (or caps out on) a CHAINED execution, so the Chain tab can answer
/// "why did this chain stop?" for healing exhaustion the same way it already
/// does for depth/budget/predicate stops.
///
/// Best-effort and chain-scoped: it resolves the ORIGINAL execution's
/// `chain_trace_id` from its `input_data` and records nothing when the run was
/// not part of a chain (mirrors the wave-4 pattern — a non-chain healing
/// abandonment surfaces via the healing audit log, not the chain audit). A lost
/// audit row never affects control flow.
fn record_healing_chain_stop(
    pool: &DbPool,
    original_exec_id: &str,
    persona_id: &str,
    reason_token: &str,
    detail: String,
) {
    let meta = exec_repo::get_by_id(pool, original_exec_id)
        .ok()
        .and_then(|e| e.input_data)
        .map(|input| chain::extract_chain_metadata(Some(&input)));
    let (chain_depth, chain_trace_id) = match meta {
        Some((depth, _visited, Some(ctid), _cost)) => (depth, ctid),
        _ => return, // not a chain participant — nothing to surface here
    };
    if let Err(e) = crate::db::repos::execution::chain_stop_reasons::record(
        pool,
        crate::db::repos::execution::chain_stop_reasons::ChainStopReasonInput {
            chain_trace_id: &chain_trace_id,
            link_execution_id: original_exec_id,
            trigger_id: None,
            target_persona_id: Some(persona_id),
            reason_token,
            detail: Some(detail),
            chain_depth,
        },
    ) {
        tracing::warn!(
            original_exec_id = %original_exec_id,
            reason_token = %reason_token,
            error = %e,
            "Failed to record healing chain stop reason",
        );
    }
}

/// Reason tag stored on a `scheduled_retries` row. Drives the drain path's
/// resume-vs-fresh decision (see [`ExecutionEngine::drain_due_scheduled_retries`]):
/// `api_error_resume` rows resume the prior Claude session so the run continues
/// where it stopped; usage-limit rows restart the task fresh (a usage window may
/// reset hours/days later, by which point the CLI session transcript is gone).
pub(super) fn retry_reason_for(diagnosis: &healing::HealingDiagnosis) -> &'static str {
    match diagnosis.category {
        healing::FailureCategory::ApiError => "api_error_resume",
        _ => "usage_limit_window",
    }
}

/// Spawn a delayed retry execution for a failed persona.
///
/// This is the core of the autonomous self-healing system. It:
/// 1. Sleeps for the specified backoff delay
/// 2. Loads the persona fresh from DB (may have been updated)
/// 3. Checks that the persona is still enabled (circuit breaker not tripped)
/// 4. Creates a new execution record with retry lineage
/// 5. Runs the execution via the standard runner
/// 6. Handles the result (writes status to DB, emits events)
#[allow(clippy::too_many_arguments)]
pub(super) fn spawn_delayed_retry(
    delay_secs: u64,
    timeout_override_ms: Option<u64>,
    // Continuation for the retried run. `Some(SessionResume)` makes the retry
    // `--resume` the prior session and continue ("please continue") rather than
    // restart from a fresh prompt — used for API/server-error retries. `None`
    // restarts the task (rate-limit / timeout / usage-limit retries).
    continuation: Option<types::Continuation>,
    pool: DbPool,
    app: AppHandle,
    persona_id: String,
    original_exec_id: String,
    retry_count: i64,
    tracker: Arc<Mutex<ConcurrencyTracker>>,
    child_pids: Arc<Mutex<HashMap<String, u32>>>,
    cancelled_flags: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    log_dir: PathBuf,
    circuit_breaker: Arc<failover::ProviderCircuitBreaker>,
) {
    tokio::spawn(async move {
        // 1. Sleep for the backoff delay
        tracing::info!(
            persona_id = %persona_id,
            delay_secs = delay_secs,
            retry_count = retry_count,
            original_exec_id = %original_exec_id,
            "Healing retry: sleeping {}s before retry #{}",
            delay_secs, retry_count,
        );
        tokio::time::sleep(std::time::Duration::from_secs(delay_secs)).await;

        // 2. Load persona fresh from DB
        let mut persona = match persona_repo::get_by_id(&pool, &persona_id) {
            Ok(p) => p,
            Err(e) => {
                tracing::error!(
                    persona_id = %persona_id,
                    "Healing retry: failed to load persona: {}", e,
                );
                return;
            }
        };

        // 3. Check persona is still enabled (circuit breaker check)
        if !persona.enabled {
            tracing::warn!(
                persona_id = %persona_id,
                "Healing retry: persona disabled (circuit breaker), skipping retry",
            );
            return;
        }

        // 4. Apply timeout override if specified (for RetryWithTimeout healing)
        if let Some(override_ms) = timeout_override_ms {
            persona.timeout_ms = override_ms as i32;
            // Persist the increased timeout to the persona so future executions use it
            let _ = persona_repo::update(
                &pool,
                &persona_id,
                crate::db::models::UpdatePersonaInput {
                    timeout_ms: Some(override_ms as i32),
                    ..Default::default()
                },
            );
            tracing::info!(
                persona_id = %persona_id,
                new_timeout_ms = override_ms,
                "Healing: persisted increased timeout_ms to persona",
            );
        }

        // 5. Create retry execution record with lineage
        let exec = match exec_repo::create_retry(&pool, &persona_id, &original_exec_id, retry_count)
        {
            Ok(e) => e,
            Err(e) => {
                tracing::error!(
                    persona_id = %persona_id,
                    "Healing retry: failed to create execution record: {}", e,
                );
                return;
            }
        };

        let exec_id = exec.id.clone();

        // 6. Atomically check capacity and register in tracker
        {
            let mut t = tracker.lock().await;
            if !t.try_add_running(&persona_id, &exec_id, persona.max_concurrent) {
                tracing::warn!(
                    persona_id = %persona_id,
                    "Healing retry: no capacity, skipping retry",
                );
                return;
            }
        }

        // 7. Update to running
        persist_status_update(
            &pool,
            Some(&app),
            &exec_id,
            UpdateExecutionStatus {
                status: ExecutionState::Running,
                ..Default::default()
            },
        )
        .await;

        // 9. Get tools for persona
        let tools = tool_repo::get_tools_for_persona(&pool, &persona_id).unwrap_or_default();

        // 10. Create cancellation flag
        let cancelled = Arc::new(AtomicBool::new(false));
        cancelled_flags
            .lock()
            .await
            .insert(exec_id.clone(), cancelled.clone());

        tracing::info!(
            execution_id = %exec_id,
            persona_id = %persona_id,
            retry_count = retry_count,
            "Healing retry: starting execution",
        );

        // 11. Run the execution
        let result = run_execution_with_ceiling(
            app.clone(),
            pool.clone(),
            exec_id.clone(),
            persona.clone(),
            tools,
            None, // retry uses no additional input
            log_dir,
            child_pids.clone(),
            cancelled.clone(),
            continuation, // SessionResume for api-error retries; None restarts fresh
            None,         // chain_trace_id -- healing retries don't inherit chain context
            circuit_breaker,
        )
        .await;

        // 12. Write final status (conditional to avoid cancel race)
        if cancelled.load(Ordering::Acquire) {
            // Cancelled: preserve accumulated metrics so budget tracking
            // accounts for API spend consumed before the kill signal.
            persist_status_if_not_final(
                &pool,
                Some(&app),
                &exec_id,
                UpdateExecutionStatus {
                    status: ExecutionState::Cancelled,
                    error_message: Some("Cancelled by user".into()),
                    duration_ms: Some(result.duration_ms as i64),
                    log_file_path: result.log_file_path.clone(),
                    input_tokens: Some(result.input_tokens as i64),
                    output_tokens: Some(result.output_tokens as i64),
                    cost_usd: Some(result.cost_usd),
                    tool_steps: result.tool_steps.clone(),
                    log_truncated: result.log_truncated,
                    ..Default::default()
                },
            )
            .await;
            emit_event(
                &app,
                event_name::PERSONA_HEALTH_CHANGED,
                &serde_json::json!({
                    "persona_id": persona_id,
                }),
            );
        } else {
            let status = if result.success {
                ExecutionState::Completed
            } else {
                ExecutionState::Failed
            };
            persist_status_if_not_final(
                &pool,
                Some(&app),
                &exec_id,
                UpdateExecutionStatus {
                    status,
                    output_data: result.output.clone(),
                    error_message: result.error.clone(),
                    duration_ms: Some(result.duration_ms as i64),
                    log_file_path: result.log_file_path.clone(),
                    execution_flows: result.execution_flows.clone(),
                    input_tokens: Some(result.input_tokens as i64),
                    output_tokens: Some(result.output_tokens as i64),
                    cost_usd: Some(result.cost_usd),
                    tool_steps: result.tool_steps.clone(),
                    claude_session_id: result.claude_session_id.clone(),
                    execution_config: None,
                    log_truncated: result.log_truncated,
                    business_outcome: result.business_outcome.clone(),
                    error_category: result.error_category.map(error_taxonomy::category_token),
                },
            )
            .await;

            // Emit status to frontend
            let _ = app.emit(
                event_name::EXECUTION_STATUS,
                types::ExecutionStatusEvent {
                    execution_id: exec_id.clone(),
                    status,
                    error: result.error.clone(),
                    duration_ms: Some(result.duration_ms),
                    cost_usd: Some(result.cost_usd),
                },
            );

            emit_event(
                &app,
                event_name::PERSONA_HEALTH_CHANGED,
                &serde_json::json!({
                    "persona_id": persona_id,
                }),
            );

            if result.success {
                tracing::info!(
                    execution_id = %exec_id,
                    persona_id = %persona_id,
                    retry_count = retry_count,
                    "Healing retry: execution succeeded!",
                );
            } else {
                tracing::warn!(
                    execution_id = %exec_id,
                    persona_id = %persona_id,
                    retry_count = retry_count,
                    "Healing retry: execution failed again",
                );
            }

            // Transition healing issues tied to the original execution:
            // confirm (resolved) on success, revert (open) on failure.
            let pending_issues =
                healing_repo::get_by_execution_id(&pool, &original_exec_id).unwrap_or_default();
            for hi in &pending_issues {
                if hi.status == "auto_fix_pending" {
                    let (transition, new_status) = if result.success {
                        let _ = healing_repo::confirm_auto_fix(&pool, &hi.id);
                        ("auto_fix_confirmed", "resolved")
                    } else {
                        let _ = healing_repo::revert_auto_fix_pending(&pool, &hi.id);
                        ("auto_fix_reverted", "open")
                    };
                    // Direction 1: durably record the terminal auto-fix outcome
                    // so per-strategy effectiveness (confirm vs revert rates) is
                    // aggregatable. A reverted issue drops back to `open` and
                    // loses its `auto_fixed` flag, so without this ledger row the
                    // revert is invisible to any after-the-fact query. `detail`
                    // carries the strategy (healing category).
                    healing_repo::create_audit_entry(
                        &pool,
                        Some(&hi.persona_id),
                        hi.execution_id.as_deref(),
                        transition,
                        healing_repo::EFFECTIVENESS_SUBSYSTEM,
                        if result.success {
                            "Auto-fix confirmed — retry succeeded"
                        } else {
                            "Auto-fix reverted — retry failed"
                        },
                        Some(hi.category.as_str()),
                    );
                    let event_payload = types::HealingIssueUpdatedEvent {
                        issue_id: hi.id.clone(),
                        persona_id: hi.persona_id.clone(),
                        execution_id: hi.execution_id.clone(),
                        new_status: new_status.to_string(),
                        transition: transition.to_string(),
                    };
                    emit_event(&app, event_name::HEALING_ISSUE_UPDATED, &event_payload);
                    if result.success {
                        emit_event(&app, event_name::AUTO_FIX_COMPLETED, &event_payload);
                    }
                }
            }

            // Direction 2a: a healing retry that failed again with its retry
            // budget exhausted is a terminal healing exhaustion — record a chain
            // stop so a chained cascade shows why it ended (mirrors wave-4). The
            // per-issue revert above flips the issue back to `open`; this closes
            // the chain-audit gap the retry ladder previously left silent.
            if !result.success && retry_count >= healing::MAX_RETRY_COUNT {
                record_healing_chain_stop(
                    &pool,
                    &original_exec_id,
                    &persona_id,
                    chain::stop_reason::HEALING_CAPPED,
                    format!("healing retry #{retry_count} failed; retry budget exhausted"),
                );
            }

            // Notification
            {
                let persona_for_notify = persona_repo::get_by_id(&pool, &persona_id).ok();
                let notif_channels = persona_for_notify
                    .as_ref()
                    .and_then(|p| p.notification_channels.as_deref());
                let p_name = persona_for_notify
                    .as_ref()
                    .map(|p| p.name.as_str())
                    .unwrap_or("Agent");
                (hooks().notify_execution_completed_rich)(
                    &app,
                    p_name,
                    status.as_str(),
                    result.duration_ms,
                    notif_channels,
                    Some(result.cost_usd),
                    result.model_used.as_deref(),
                    result.error.as_deref(),
                );
            }

            // Chain trigger evaluation — MUST mirror the regular completion
            // path at `handle_execution_result` so a successful retry drives
            // the cascade just like the original would have. Without this, a
            // P3 transient-failure retry would silently strand the team: the
            // retry succeeds, but no `team_handoff.*` event fires, so the
            // next role in the chain never spawns. (Observed cert-3a + cert-
            // 3b: Security Sentinel retry value_delivered but Release
            // Manager never spawned because this hook was missing.)
            //
            // Chain metadata lives on the *original* execution's input_data
            // (`create_retry` doesn't copy input_data — the retry row starts
            // with NULL input). Fall back to the retry exec's own input_data
            // for the rare case the original was lost.
            let source_input = exec_repo::get_by_id(&pool, &original_exec_id)
                .ok()
                .and_then(|exec| exec.input_data)
                .or_else(|| {
                    exec_repo::get_by_id(&pool, &exec_id)
                        .ok()
                        .and_then(|exec| exec.input_data)
                });
            // T1 (dual-driver): see handle_execution_result — same suppression
            // on the retry path.
            let source_is_assignment_step =
                chain::input_is_assignment_step(source_input.as_deref());
            let (chain_depth, mut visited, existing_chain_trace_id, chain_cost_in) = source_input
                .map(|input| chain::extract_chain_metadata(Some(&input)))
                .unwrap_or_default();
            visited.insert(persona_id.clone());
            let is_downstream_hop = existing_chain_trace_id.is_some();
            let chain_trace_id = existing_chain_trace_id.or_else(|| result.trace_id.clone());
            let chain_cost_total = chain_cost_in + result.cost_usd;

            let cascade_metrics = chain::evaluate_chain_triggers(
                &pool,
                &persona_id,
                status.as_str(),
                result.output.as_deref(),
                &exec_id,
                chain_depth,
                &visited,
                chain_trace_id.as_deref(),
                source_is_assignment_step,
                chain_cost_total,
            );
            // Best-effort metrics recording — same as the regular path
            // (`handle_execution_result`) does when a scheduler is present.
            if let Some(sched) = app.try_state::<Arc<background::SchedulerState>>() {
                sched.record_chain_cascade(&cascade_metrics);
            }

            // Direction 1b: back-fill the trace row's chain_trace_id (see
            // handle_execution_result for the rationale). Same guard: only
            // genuine chain participants get stamped.
            if let Some(ctid) = chain_trace_id.as_deref() {
                if is_downstream_hop || cascade_metrics.events_published > 0 {
                    if let Err(e) = crate::db::repos::execution::traces::set_chain_trace_id(
                        &pool, &exec_id, ctid,
                    ) {
                        tracing::warn!(
                            execution_id = %exec_id,
                            chain_trace_id = %ctid,
                            error = %e,
                            "Failed to back-fill chain_trace_id on trace row"
                        );
                    }
                }
            }
        }

        // 13. Cleanup
        tracker.lock().await.remove_running(&persona_id, &exec_id);
        cancelled_flags.lock().await.remove(&exec_id);

        // Promote queued executions now that a retry slot is free. Fetch the
        // engine via AppState so we don't have to plumb every Arc through the
        // spawn chain.
        if let Some(eng) = app.try_state::<Arc<ExecutionEngine>>() {
            eng.drain_after_slot_freed(app.clone(), pool.clone()).await;
        }

        #[cfg(feature = "desktop")]
        (hooks().refresh_tray)(&app);
    });
}

/// Find connector names whose `services` JSON lists at least one of the given tools.
///
/// Iterates tools × connectors, parsing each connector's `services` JSON array
/// and checking if any entry's `toolName` matches a tool name.
fn find_matching_connector_names(
    tools: &[PersonaToolDefinition],
    connectors: &[ConnectorDefinition],
) -> Vec<String> {
    let mut names = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for tool in tools {
        for connector in connectors {
            let services: Vec<serde_json::Value> = match serde_json::from_str(&connector.services) {
                Ok(v) => v,
                Err(e) => {
                    tracing::warn!(
                        connector = %connector.name,
                        error = %e,
                        "unparseable connector.services — excluding this connector from matching"
                    );
                    continue;
                }
            };
            let tool_listed = services.iter().any(|s| {
                s.get("toolName")
                    .and_then(|v| v.as_str())
                    .map(|name| name == tool.name)
                    .unwrap_or(false)
            });
            if tool_listed && seen.insert(connector.name.clone()) {
                names.push(connector.name.clone());
            }
        }
    }
    names
}

/// Resolve a service-level [`KnowledgeHint`] from the healing knowledge base.
///
/// Looks up connectors associated with the persona's tools to determine
/// which service types are in use, then queries the knowledge base for
/// matching failure patterns. Returns the first match.
fn resolve_service_knowledge_hint(
    pool: &DbPool,
    persona_id: &str,
    category: &healing::FailureCategory,
) -> Option<healing::KnowledgeHint> {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return None,
    };

    let tools = tool_repo::get_tools_for_persona(pool, persona_id).ok()?;
    let connectors = crate::db::repos::resources::connectors::get_all(pool).ok()?;

    for service_name in find_matching_connector_names(&tools, &connectors) {
        if let Ok(Some(hint)) = healing_repo::get_knowledge_hint(pool, &service_name, pattern_key) {
            return Some(hint);
        }
    }

    None
}

/// Record a failure pattern to the knowledge base for fleet-wide learning.
fn record_failure_to_knowledge_base(
    pool: &DbPool,
    persona_id: &str,
    category: &healing::FailureCategory,
    diagnosis: &healing::HealingDiagnosis,
) {
    let pattern_key = match category {
        healing::FailureCategory::RateLimit => "rate_limit",
        healing::FailureCategory::Timeout => "timeout",
        _ => return, // Only track auto-fixable patterns
    };

    let recommended_delay = match &diagnosis.action {
        healing::HealingAction::RetryWithBackoff { delay_secs } => Some(*delay_secs as i64),
        healing::HealingAction::RetryWithTimeout { .. } => None,
        // Unreachable through the category gate above (RetryAt only pairs
        // with SessionLimit) — and an absolute reset time is not a learnable
        // backoff delay anyway.
        healing::HealingAction::RetryAt { .. } => return,
        healing::HealingAction::AiHealing | healing::HealingAction::CreateIssue => return,
    };

    let tools = match tool_repo::get_tools_for_persona(pool, persona_id) {
        Ok(t) => t,
        Err(_) => return,
    };
    let connectors = match crate::db::repos::resources::connectors::get_all(pool) {
        Ok(c) => c,
        Err(_) => return,
    };

    for service_name in find_matching_connector_names(&tools, &connectors) {
        let _ = healing_repo::upsert_knowledge(
            pool,
            &service_name,
            pattern_key,
            &diagnosis.description,
            recommended_delay,
        );
    }
}
