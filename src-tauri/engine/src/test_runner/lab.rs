use std::collections::HashMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

use personas_db::models::{LabRunStatus, Persona, PersonaToolDefinition};
use personas_db::DbPool;

use super::{
    avg_scored, await_cancel, execute_scenario, generate_scenarios, renormalized_composite,
    score_result, spawn_cli_and_collect, verdict_status, ScoreResult, TestModelConfig,
    TestRunStatusEvent, TestScenario, TestScores,
};
use crate::prompt;

/// Model for the lab/test/evolution tooling (scenario generation, result
/// summaries, draft + improvement passes). Pinned deliberately — without an
/// explicit `--model` these headless spawns ride the undeclared account default
/// (typically Opus 4.8), making cost neither predictable nor aligned with the
/// rest of the headless tier. Mirrors `DEFAULT_CAPABILITY_MODEL` /
/// `SYNTHESIS_MODEL` (tiger finding: lab tier rode account-default).
pub(crate) const LAB_MODEL: &str = "claude-sonnet-4-6";

/// Maximum number of lab cells (model × variant × scenario executions) allowed to
/// run their CLI child concurrently within a single run. `run_lab_loop` used to
/// `tokio::spawn` every model×variant pair for a scenario at once with no cap,
/// so a wide roster (e.g. 6 models × 2 variants) launched a dozen Claude CLI
/// children simultaneously — heavy on CPU, memory, and subscription rate limits.
/// A small semaphore bounds the in-flight fan-out while keeping enough parallelism
/// to hide per-cell latency. Tune here.
pub(crate) const LAB_CELL_CONCURRENCY: usize = 4;

// ============================================================================
// Lab: Generic executor for standard tests, arena, A/B, eval, matrix, and
// consensus modes
// ============================================================================

pub(crate) fn emit_lab_status(
    app: &AppHandle,
    event_name: &str,
    run_id: &str,
    phase: &str,
    error: Option<&str>,
) {
    let _ = app.emit(
        event_name,
        TestRunStatusEvent {
            run_id: run_id.to_string(),
            phase: phase.to_string(),
            scenarios_count: None,
            current: None,
            total: None,
            model_id: None,
            scenario_name: None,
            status: None,
            scores: None,
            summary: None,
            error: error.map(|s| s.to_string()),
            scenarios: None,
            elapsed_ms: None,
        },
    );
}

/// A variant to test: a persona reference + a label used as tracker key prefix.
/// Each variant can carry its own tool set for full persona versioning.
pub(crate) struct LabVariant<'a> {
    pub(crate) persona: &'a Persona,
    pub(crate) label: String,
    /// Per-variant tools. If empty, falls back to shared tools from run_lab_loop.
    pub(crate) tools: Vec<PersonaToolDefinition>,
}

/// Callbacks that abstract mode-specific persistence and summary building.
#[allow(clippy::type_complexity)]
pub(crate) struct LabCallbacks<'a> {
    pub(crate) event_name: &'a str,
    pub(crate) update_status: Box<
        dyn Fn(&DbPool, &str, LabRunStatus, Option<i32>, Option<&str>, Option<&str>, Option<&str>)
            + Send
            + Sync
            + 'a,
    >,
    pub(crate) persist_result: Box<
        dyn Fn(&DbPool, &str, &LabVariant<'_>, &TestScenario, &TestModelConfig, &str, &ScoreResult)
            + Send
            + Sync
            + 'a,
    >,
    pub(crate) build_summary: Box<
        dyn Fn(
                &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
                &[TestModelConfig],
            ) -> serde_json::Value
            + Send
            + Sync
            + 'a,
    >,
    pub(crate) update_llm_summary: Box<dyn Fn(&DbPool, &str, &str) + Send + Sync + 'a>,
    /// Optional aggregate-cost ceiling check, polled once per scenario before
    /// spawning its cells. Only the standard test-run path wires a real budget
    /// ledger (see `run_budget`); other lab modes pass a constant `false` and
    /// are unaffected. Returning `true` halts further scenario launches (the
    /// run still finalizes using the partial results already collected — see
    /// `halted_by_budget` below, which keeps that intentional stop from
    /// tripping the completeness gate).
    pub(crate) should_halt_budget: Box<dyn Fn(&str) -> bool + Send + Sync + 'a>,
    /// Optional per-cell cost recorder, called once per completed cell with
    /// its `cost_usd`. Only the standard test-run path records into the
    /// budget ledger; other lab modes pass a no-op.
    pub(crate) record_cost: Box<dyn Fn(&str, f64) + Send + Sync + 'a>,
}

/// Generate a prose LLM summary of test results. Returns the summary text, or None on failure.
#[allow(clippy::type_complexity)]
async fn generate_llm_run_summary(
    persona_name: &str,
    persona_description: &str,
    tracker: &HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>>,
    scenario_count: usize,
    pool: &DbPool,
) -> Option<String> {
    let mut results_text = String::new();
    for (key, entries) in tracker.iter() {
        let n = entries.len() as f64;
        if n == 0.0 {
            continue;
        }
        let avg_ta = avg_scored(entries.iter().map(|r| r.0)).unwrap_or(0.0);
        let avg_oq = avg_scored(entries.iter().map(|r| r.1)).unwrap_or(0.0);
        let avg_pc = avg_scored(entries.iter().map(|r| r.2)).unwrap_or(0.0);
        let total_cost = entries.iter().map(|r| r.3).sum::<f64>();
        // Renormalise over present sub-scores (sandbox runs omit tool_accuracy)
        // — mirrors `verdict_status`.
        let composite = renormalized_composite(
            avg_scored(entries.iter().map(|r| r.0)),
            avg_scored(entries.iter().map(|r| r.1)),
            avg_scored(entries.iter().map(|r| r.2)),
        )
        .unwrap_or(0.0);
        results_text.push_str(&format!(
            "- {key}: composite={:.0}/100 (tool_accuracy={:.0}, output_quality={:.0}, protocol={:.0}), cost=${:.4}, {:.0} scenarios\n",
            composite, avg_ta, avg_oq, avg_pc, total_cost, n
        ));
    }

    let prompt = format!(
        r#"Write a 3-4 sentence executive summary of these test results. Be specific and actionable.

Persona: {persona_name}
Purpose: {persona_description}
Scenarios tested: {scenario_count}

Results by variant/model:
{results_text}
Rules:
- Start with the key finding (which variant/model performed best and why)
- Mention the weakest dimension and its impact on usability
- End with the single most impactful improvement the user should make
- Be concise — no bullet points, no headers, just flowing prose
- Do not repeat the raw numbers — interpret them"#
    );

    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(LAB_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    match spawn_cli_and_collect(
        &cli_args,
        &prompt,
        pool,
        personas_db::repos::llm_spend::SpendCtx {
            source: "evaluator",
            trigger_kind: "lab_summary",
            model: Some(LAB_MODEL),
            persona_id: None,
            project_id: None,
        },
    )
    .await
    {
        Ok(output) => {
            let text = output.trim().to_string();
            if text.is_empty() {
                None
            } else {
                Some(text)
            }
        }
        Err(e) => {
            tracing::warn!("LLM run summary generation failed: {e}");
            None
        }
    }
}

/// Generic lab execution loop shared by standard tests, arena, A/B, eval,
/// matrix, and consensus modes.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_lab_loop(
    app: &AppHandle,
    pool: &DbPool,
    run_id: &str,
    persona_for_scenarios: &Persona,
    tools: &[PersonaToolDefinition],
    model_configs: &[TestModelConfig],
    variants: &[LabVariant<'_>],
    cancelled: &Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<&str>,
    // Custom scenario-generation input. `None` for every mode except standard
    // tests, which can seed a saved suite's fixture data.
    fixture_inputs: Option<&str>,
    // When `Some`, skip generation entirely and use these scenarios directly
    // (standard tests re-running a saved suite). An empty vec fails the run
    // with the same "no scenarios" message generation-failure uses.
    preloaded_scenarios: Option<Vec<TestScenario>>,
    cb: &LabCallbacks<'_>,
) {
    let run_start = std::time::Instant::now();

    let scenarios = if let Some(preloaded) = preloaded_scenarios {
        if preloaded.is_empty() {
            let now = chrono::Utc::now().to_rfc3339();
            (cb.update_status)(
                pool,
                run_id,
                LabRunStatus::Failed,
                None,
                None,
                Some("Saved test suite has no scenarios"),
                Some(&now),
            );
            emit_lab_status(
                app,
                cb.event_name,
                run_id,
                "failed",
                Some("Saved test suite has no scenarios"),
            );
            return;
        }
        preloaded
    } else {
        emit_lab_status(app, cb.event_name, run_id, "generating", None);

        match generate_scenarios(
            persona_for_scenarios,
            tools,
            use_case_filter,
            fixture_inputs,
            pool,
        )
        .await
        {
            Ok(s) if s.is_empty() => {
                let now = chrono::Utc::now().to_rfc3339();
                (cb.update_status)(
                    pool,
                    run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some("No test scenarios were generated"),
                    Some(&now),
                );
                emit_lab_status(
                    app,
                    cb.event_name,
                    run_id,
                    "failed",
                    Some("No test scenarios were generated"),
                );
                return;
            }
            Ok(s) => s,
            Err(e) => {
                let msg = format!("Scenario generation failed: {e}");
                let now = chrono::Utc::now().to_rfc3339();
                (cb.update_status)(
                    pool,
                    run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some(&msg),
                    Some(&now),
                );
                emit_lab_status(app, cb.event_name, run_id, "failed", Some(&msg));
                return;
            }
        }
    };

    let scenario_count = scenarios.len();
    (cb.update_status)(
        pool,
        run_id,
        LabRunStatus::Running,
        Some(scenario_count as i32),
        None,
        None,
        None,
    );

    let _ = app.emit(
        cb.event_name,
        TestRunStatusEvent {
            run_id: run_id.to_string(),
            phase: "generated".into(),
            scenarios_count: Some(scenario_count),
            // Standard test runs use this to let the frontend save the
            // generated scenarios into a reusable suite (see testSlice's
            // `scenarios` / `createTestSuite`). Harmless for other lab modes,
            // which don't read this field off their own progress payload.
            scenarios: Some(scenarios.clone()),
            elapsed_ms: Some(run_start.elapsed().as_millis() as u64),
            ..Default::default()
        },
    );

    let total = scenario_count * model_configs.len() * variants.len();
    let mut current = 0usize;
    // Set when a mode-specific budget ceiling halts further scenario launches
    // (see `should_halt_budget`). This is an intentional, disclosed partial
    // run — distinct from cells lost to task panics/errors — so it must not
    // trip the completeness gate below.
    let mut halted_by_budget = false;
    #[allow(clippy::type_complexity)]
    let mut tracker: HashMap<String, Vec<(Option<i32>, Option<i32>, Option<i32>, f64, i64)>> =
        HashMap::new();

    // Cap concurrent CLI children across the whole run (see LAB_CELL_CONCURRENCY).
    let cell_semaphore = Arc::new(tokio::sync::Semaphore::new(LAB_CELL_CONCURRENCY));

    for scenario in &scenarios {
        if cancelled.load(std::sync::atomic::Ordering::Acquire) {
            (cb.update_status)(
                pool,
                run_id,
                LabRunStatus::Cancelled,
                None,
                None,
                None,
                None,
            );
            emit_lab_status(app, cb.event_name, run_id, "cancelled", None);
            return;
        }

        // Mode-specific budget ceiling (currently only standard test runs):
        // stop launching further scenarios once the run's aggregate cost
        // ceiling is reached (warn-only never halts). The run still finalizes
        // below with the partial results already collected.
        if (cb.should_halt_budget)(run_id) {
            tracing::warn!(
                run_id,
                "Lab run halted scenario execution — budget ceiling reached (enforce mode)",
            );
            halted_by_budget = true;
            break;
        }

        // Spawn all model × variant pairs for this scenario concurrently
        let mut handles = Vec::new();
        for (mi, model) in model_configs.iter().enumerate() {
            for (vi, variant) in variants.iter().enumerate() {
                let persona_c = variant.persona.clone();
                let pool_c = pool.clone();
                let tools_c = if variant.tools.is_empty() {
                    tools.to_vec()
                } else {
                    variant.tools.clone()
                };
                let scenario_c = scenario.clone();
                let model_c = model.clone();
                let cancelled_c = cancelled.clone();
                // Acquire the concurrency permit BEFORE spawning so the loop
                // throttles the fan-out at the source; the task holds it for its
                // lifetime. `acquire_owned` only errors if the semaphore is
                // closed, which never happens here.
                let permit = cell_semaphore.clone().acquire_owned().await.ok();

                handles.push(tokio::spawn(async move {
                    let _permit = permit;
                    if cancelled_c.load(std::sync::atomic::Ordering::Acquire) {
                        return (
                            mi,
                            vi,
                            "cancelled".to_string(),
                            ScoreResult::from_error("Cancelled"),
                        );
                    }
                    // Race execution against cancellation. If cancel fires mid-run
                    // the execute future (which owns the CLI driver) is dropped;
                    // the driver's `kill_on_drop` terminates the child within the
                    // 200ms poll window rather than blocking on the CLI timeout.
                    let result = tokio::select! {
                        biased;
                        _ = await_cancel(&cancelled_c) => Err("Cancelled".to_string()),
                        r = execute_scenario(&persona_c, &tools_c, &scenario_c, &model_c) => r,
                    };
                    let (status, scores) = match &result {
                        Ok(r) => {
                            let s = score_result(r, &scenario_c, &persona_c, &pool_c).await;
                            (verdict_status(&s), s)
                        }
                        Err(e) => {
                            let mut sr = ScoreResult::from_error(e.clone());
                            sr.output_preview = Some(e.clone());
                            ("error".to_string(), sr)
                        }
                    };
                    (mi, vi, status, scores)
                }));
            }
        }

        // Collect results and process sequentially (persist, emit progress, update tracker)
        for handle in handles {
            let (mi, vi, status, scores) = match handle.await {
                Ok(r) => r,
                Err(e) => {
                    tracing::error!("Lab task panicked: {e}");
                    continue;
                }
            };
            // Do not persist or count any cell once cancellation has been
            // requested — its result is either a killed-mid-flight stub or a
            // late arrival, and the run finalizes as Cancelled below. We still
            // drain the remaining handles (the loop) so no task is detached.
            if cancelled.load(std::sync::atomic::Ordering::Acquire) {
                continue;
            }
            current += 1;
            let model = &model_configs[mi];
            let variant = &variants[vi];

            let key = if variant.label.is_empty() {
                model.id.clone()
            } else {
                format!("{}:{}", variant.label, model.id)
            };
            tracker.entry(key).or_default().push((
                scores.tool_accuracy,
                scores.output_quality,
                scores.protocol_compliance,
                scores.cost_usd,
                scores.duration_ms,
            ));

            (cb.persist_result)(pool, run_id, variant, scenario, model, &status, &scores);
            (cb.record_cost)(run_id, scores.cost_usd);

            let _ = app.emit(
                cb.event_name,
                TestRunStatusEvent {
                    run_id: run_id.to_string(),
                    phase: "executing".into(),
                    scenarios_count: Some(scenario_count),
                    current: Some(current),
                    total: Some(total),
                    model_id: Some(model.id.clone()),
                    scenario_name: Some(scenario.name.clone()),
                    status: Some(status),
                    scores: Some(TestScores {
                        tool_accuracy: scores.tool_accuracy,
                        output_quality: scores.output_quality,
                        protocol_compliance: scores.protocol_compliance,
                    }),
                    summary: None,
                    error: scores.error_message,
                    scenarios: None,
                    elapsed_ms: Some(run_start.elapsed().as_millis() as u64),
                },
            );
        }
    }

    // Finalize as Cancelled if cancellation landed during the final scenario's
    // collection (the per-scenario guard at the loop top only catches cancels
    // between scenarios). Returning here keeps the status Cancelled and skips the
    // (CLI-spawning) summary work — and the completeness gate below, so a
    // cancelled run never mis-finalizes as Failed for having `current < total`.
    if cancelled.load(std::sync::atomic::Ordering::Acquire) {
        let now = chrono::Utc::now().to_rfc3339();
        (cb.update_status)(
            pool,
            run_id,
            LabRunStatus::Cancelled,
            None,
            None,
            None,
            Some(&now),
        );
        emit_lab_status(app, cb.event_name, run_id, "cancelled", None);
        return;
    }

    let summary = (cb.build_summary)(&tracker, model_configs);
    let summary_str = serde_json::to_string(&summary).unwrap_or_default();

    // Generate LLM prose summary (non-blocking, falls back to None on failure)
    emit_lab_status(app, cb.event_name, run_id, "summarizing", None);
    let llm_summary = generate_llm_run_summary(
        &persona_for_scenarios.name,
        persona_for_scenarios.description.as_deref().unwrap_or(""),
        &tracker,
        scenario_count as usize,
        pool,
    )
    .await;

    // Persist the LLM summary if available (best-effort, non-fatal)
    if let Some(ref text) = llm_summary {
        let _ = (cb.update_llm_summary)(pool, run_id, text);
    }

    let now = chrono::Utc::now().to_rfc3339();

    // Guard: if the run was cancelled while we were finishing, do not overwrite
    // the "cancelled" status with "completed" — that would corrupt the state.
    if cancelled.load(std::sync::atomic::Ordering::Acquire) {
        tracing::info!(
            run_id,
            "Skipping completed status write — run was cancelled"
        );
        emit_lab_status(app, cb.event_name, run_id, "cancelled", None);
        return;
    }

    // Completeness gate: a run is "completed" only if every fanned-out cell
    // produced a result. Panicked / JoinError tasks are `continue`d above without
    // incrementing `current`, so `current < total` means cells were silently lost.
    // Finalize as Failed with a count rather than presenting a partial sample as a
    // trustworthy comparison (the leaderboards would average over missing data).
    //
    // Exception: a budget-halted run is *intentionally* short of `total` — the
    // scenario loop stopped on purpose, not because a cell was lost — so it
    // must not trip this gate.
    let incomplete = !halted_by_budget && current < total;
    let (run_status, status_error, phase): (LabRunStatus, Option<String>, &str) = if incomplete {
        let msg = format!(
            "Run incomplete: {current}/{total} cells produced results; {} lost to task panics/errors",
            total - current
        );
        tracing::error!(run_id, current, total, "{msg}");
        (LabRunStatus::Failed, Some(msg), "failed")
    } else {
        (LabRunStatus::Completed, None, "completed")
    };

    (cb.update_status)(
        pool,
        run_id,
        run_status,
        None,
        Some(&summary_str),
        None,
        Some(&now),
    );

    let _ = app.emit(
        cb.event_name,
        TestRunStatusEvent {
            run_id: run_id.to_string(),
            phase: phase.into(),
            scenarios_count: Some(scenario_count),
            current: Some(current),
            total: Some(total),
            summary: Some(summary),
            error: status_error,
            elapsed_ms: Some(run_start.elapsed().as_millis() as u64),
            ..Default::default()
        },
    );
}
