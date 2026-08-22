use std::path::PathBuf;
use std::sync::Arc;
use tauri::AppHandle;

use crate::event_registry::event_name;

use personas_core::types::EphemeralPersona;
use personas_db::models::{
    CreateAbResultInput, CreateArenaResultInput, CreateConsensusResultInput, CreateEvalResultInput,
    CreateMatrixResultInput, CreateTestResultInput, LabResultKind, LabRunStatus, Persona,
    PersonaToolDefinition,
};
use personas_db::repos::execution::test_runs as repo;
use personas_db::repos::lab::ab as ab_repo;
use personas_db::repos::lab::arena as arena_repo;
use personas_db::repos::lab::consensus as consensus_repo;
use personas_db::repos::lab::eval as eval_repo;
use personas_db::repos::lab::events as events_repo;
use personas_db::repos::lab::matrix as matrix_repo;
use personas_db::DbPool;

use super::{
    build_arena_summary, build_consensus_summary, build_draft_generation_prompt,
    build_keyed_summary, compute_agreement_rate, emit_lab_status, make_common_result_fields,
    parse_draft_from_output, resolve_active_version, run_lab_loop, spawn_cli_and_collect,
    LabCallbacks, LabVariant, TestModelConfig, TestScenario, LAB_MODEL,
};
use crate::prompt;

// -- Main entry point -------------------------------------------

/// Run a full test session: generate scenarios, execute across models, score, summarize.
/// If `preloaded_scenarios` is Some, skip generation and use those scenarios directly.
///
/// Thin wrapper around the shared `run_lab_loop` (the same engine arena, A/B,
/// eval, matrix, and consensus modes use) — see the refactor-audit note on
/// `run_lab_loop` for why this consolidation exists. What stays here, because
/// it genuinely isn't part of the generic shape: the `preloaded_scenarios` /
/// `fixture_inputs` passthrough (threaded into `run_lab_loop` as params), the
/// P2 aggregate-cost budget ledger (wired via `LabCallbacks::should_halt_budget`
/// / `record_cost`, register/finish as bookends), and the dashboard
/// "recent activity" feed (`process_activity`, which only standard test runs
/// emit — no other lab mode does).
#[allow(clippy::too_many_arguments)]
pub async fn run_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    model_configs: Vec<TestModelConfig>,
    _log_dir: PathBuf,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
    preloaded_scenarios: Option<Vec<TestScenario>>,
    fixture_inputs: Option<String>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;

    // P2: track aggregate cost across this run's scenario × model spawns.
    personas_core::run_budget::ledger().register(
        &run_id,
        "lab",
        personas_core::run_budget::lab_ceiling_usd(),
    );

    crate::process_activity::emit_process_activity(
        &app,
        "test",
        "started",
        Some(&run_id),
        Some(&persona.name),
    );

    // Single unlabeled variant: standard tests don't compare persona
    // variants, only models — matching the (empty-label) key shape
    // `build_arena_summary` already expects.
    let variants = vec![LabVariant {
        persona,
        label: String::new(),
        tools: Vec::new(),
    }];

    let cb = LabCallbacks {
        event_name: event_name::TEST_RUN_STATUS,
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(|pool, run_id, _variant, scenario, model, status, scores| {
            let input = CreateTestResultInput {
                test_run_id: run_id.to_string(),
                scenario_name: scenario.name.clone(),
                model_id: model.id.clone(),
                provider: model.provider.clone(),
                status: status.to_string(),
                output_preview: scores.output_preview.clone(),
                tool_calls_expected: scenario
                    .expected_tool_sequence
                    .as_ref()
                    .map(|v| personas_db::models::Json(v.clone())),
                tool_calls_actual: scores.tool_calls_actual.clone(),
                tool_accuracy_score: scores.tool_accuracy,
                output_quality_score: scores.output_quality,
                protocol_compliance: scores.protocol_compliance,
                input_tokens: scores.input_tokens,
                output_tokens: scores.output_tokens,
                cost_usd: scores.cost_usd,
                duration_ms: scores.duration_ms,
                error_message: scores.error_message.clone(),
            };
            if let Err(e) = repo::create_result(pool, &input) {
                tracing::error!("Test result create failed: {e}");
            }
        }),
        build_summary: Box::new(build_arena_summary),
        // `persona_test_runs` has no llm_summary column (unlike the other lab
        // run tables) — the prose summary `run_lab_loop` generates is simply
        // not persisted for standard tests. Known trade-off of the
        // consolidation: standard runs now pay for that extra LLM call same
        // as every other lab mode, with nowhere (yet) to show the result.
        update_llm_summary: Box::new(|_pool, _id, _text| {}),
        should_halt_budget: Box::new(|run_id| {
            personas_core::run_budget::ledger().should_halt(run_id)
        }),
        record_cost: Box::new(|run_id, cost_usd| {
            // scores.cost_usd mirrors lab_results.cost_usd, so the ledger
            // total tracks SUM(persona_test_results.cost_usd) for this run.
            let outcome = personas_core::run_budget::ledger().record(run_id, cost_usd);
            if outcome.exceeded_now {
                tracing::warn!(
                    run_id,
                    spent_usd = outcome.spent_usd,
                    ceiling_usd = outcome.ceiling_usd,
                    "Lab run exceeded its aggregate budget ceiling (warn-only; run continues)",
                );
            }
        }),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        fixture_inputs.as_deref(),
        preloaded_scenarios,
        &cb,
    )
    .await;

    // P2: finalize + persist the run's budget (in-memory 30m; the row survives
    // restarts for cost-trend dashboards).
    if let Some(budget) = personas_core::run_budget::ledger().finish(&run_id) {
        if let Err(e) = personas_db::repos::run_budget::persist(&pool, &budget) {
            tracing::warn!(run_id = %run_id, "run-budget persist failed: {e}");
        }
    }

    // Dashboard activity feed: only announce "completed" when the run
    // actually finalized as Completed (mirrors the old unconditional-success
    // emission, but now correctly stays silent on Failed/Cancelled instead of
    // always claiming success once the loop returns).
    if let Ok(run) = repo::get_run_by_id(&pool, &run_id) {
        if run.status == LabRunStatus::Completed {
            crate::process_activity::emit_process_activity(
                &app,
                "test",
                "completed",
                Some(&run_id),
                Some(&persona.name),
            );
        }
    }
}

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_arena_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    model_configs: Vec<TestModelConfig>,
    _log_dir: std::path::PathBuf,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
    // When the arena was launched scoped to a specific prompt version (the
    // consolidated "Versions & Ratings" table), `ephemeral.persona` already
    // carries that version's prompt and this stamps the attribution onto each
    // result so the ratings rollup can group by (version, model). `None` = the
    // legacy current-prompt arena, results stay version-less.
    version: Option<(String, i32)>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;
    // `label` reflects the *explicit* version scope only: it keys the summary
    // tracker, and build_arena_summary looks results up by `model.id` (empty
    // label). Deriving it from the resolved attribution below would change the
    // key to `vN:model` and make the arena summary miss every cell — so it must
    // stay tied to the original `version` argument.
    let label = version
        .as_ref()
        .map(|(_, num)| format!("v{}", num))
        .unwrap_or_default();
    let variants = vec![LabVariant {
        persona,
        label,
        tools: Vec::new(),
    }];

    // Attribution version stamped onto every persisted result. When the arena
    // was launched version-scoped, that scope wins. Otherwise (the arena
    // chrome's own unscoped "Begin the Match") we resolve the persona's active
    // production version — the same rule the frontend uses — so these results
    // reach `get_version_ratings` (which filters `version_id IS NOT NULL`) and
    // the champion tally and ratings table stay in agreement. A persona with no
    // prompt versions at all keeps `None` (we never invent an id). Kept separate
    // from `label` so summary keying is unchanged.
    let attribution: Option<(String, i32)> = match &version {
        Some(v) => Some(v.clone()),
        None => resolve_active_version(&pool, &persona.id),
    };

    let cb = LabCallbacks {
        event_name: "lab-arena-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = arena_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, _variant, scenario, model, status, scores| {
                let base = make_common_result_fields(scenario, model, status, scores);
                let (version_id, version_number) = match &attribution {
                    Some((vid, vnum)) => (Some(vid.clone()), Some(*vnum)),
                    None => (None, None),
                };
                match arena_repo::create_result(
                    pool,
                    &CreateArenaResultInput {
                        run_id: run_id.to_string(),
                        version_id,
                        version_number,
                        base,
                    },
                ) {
                    Ok(result) => {
                        if let Err(e) = events_repo::insert_events_batch(
                            pool,
                            &result.id,
                            LabResultKind::Arena,
                            &scores.events,
                        ) {
                            tracing::warn!(
                                "Failed to persist arena event stream for result {}: {e}",
                                result.id
                            );
                        }
                    }
                    Err(e) => tracing::error!("Arena result create failed: {e}"),
                }
            },
        ),
        build_summary: Box::new(build_arena_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = arena_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// ============================================================================
// Lab: Consensus (stochastic multi-run agreement)
// ============================================================================

/// Run the same persona N times per scenario with natural temperature variation,
/// then compute agreement rate across samples. Uses the standard lab loop with
/// N identical "sample" variants pointing to the same persona config.
#[allow(clippy::too_many_arguments)]
#[allow(dead_code)] // pending: consensus mode unwired in commands::execution; standard lab loop is the only entry today
pub async fn run_consensus_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    model_config: TestModelConfig,
    num_samples: i32,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;
    let n = num_samples.clamp(2, 20) as usize;

    // Create N identical variants labeled sample-0..sample-N
    let variants: Vec<LabVariant<'_>> = (0..n)
        .map(|i| LabVariant {
            persona,
            label: format!("sample-{i}"),
            tools: Vec::new(),
        })
        .collect();

    // Track sample index from label
    let _sample_counter = std::sync::Arc::new(std::sync::atomic::AtomicI32::new(0));

    let cb = LabCallbacks {
        event_name: "lab-consensus-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = consensus_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, variant, scenario, model, status, scores| {
                let idx: i32 = variant
                    .label
                    .strip_prefix("sample-")
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(0);
                let base = make_common_result_fields(scenario, model, status, scores);
                match consensus_repo::create_result(
                    pool,
                    &CreateConsensusResultInput {
                        run_id: run_id.to_string(),
                        sample_index: idx,
                        base,
                    },
                ) {
                    Ok(result) => {
                        if let Err(e) = events_repo::insert_events_batch(
                            pool,
                            &result.id,
                            LabResultKind::Consensus,
                            &scores.events,
                        ) {
                            tracing::warn!(
                                "Failed to persist consensus event stream for result {}: {e}",
                                result.id
                            );
                        }
                    }
                    Err(e) => tracing::error!("Consensus result create failed: {e}"),
                }
            },
        ),
        build_summary: Box::new(build_consensus_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = consensus_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    let model_configs = vec![model_config];
    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;

    // After the loop, compute and persist agreement rate
    if let Ok(results) = consensus_repo::get_results_by_run(&pool, &run_id) {
        let rate = compute_agreement_rate(&results);
        let _ = consensus_repo::update_agreement_rate(&pool, &run_id, rate);
    }
}

// ============================================================================
// Lab: A/B
// ============================================================================

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_ab_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    variants: Vec<(String, i32, Persona)>,
    tools: Vec<PersonaToolDefinition>,
    model_configs: Vec<TestModelConfig>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    // Capture version lookup data before borrowing personas
    let version_lookup: Vec<(String, i32)> = variants
        .iter()
        .map(|(vid, vnum, _)| (vid.clone(), *vnum))
        .collect();

    let lab_variants: Vec<LabVariant<'_>> = variants
        .iter()
        .map(|(_, num, p)| LabVariant {
            persona: p,
            label: format!("v{}", num),
            tools: Vec::new(),
        })
        .collect();
    let primary_persona = &variants[0].2;

    let cb = LabCallbacks {
        event_name: "lab-ab-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = ab_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, variant, scenario, model, status, scores| {
                let Some(src) = version_lookup
                    .iter()
                    .find(|(_, num)| format!("v{}", num) == variant.label)
                else {
                    tracing::error!(
                        "Version lookup failed for label '{}' during A/B persist_result",
                        variant.label
                    );
                    return;
                };
                let base = make_common_result_fields(scenario, model, status, scores);
                let _ = ab_repo::create_result(
                    pool,
                    &CreateAbResultInput {
                        run_id: run_id.to_string(),
                        version_id: src.0.clone(),
                        version_number: src.1,
                        base,
                    },
                );
            },
        ),
        build_summary: Box::new(build_keyed_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = ab_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        primary_persona,
        &tools,
        &model_configs,
        &lab_variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// ============================================================================
// Lab: Eval
// ============================================================================

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_eval_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    variants: Vec<(String, i32, Persona)>,
    tools: Vec<PersonaToolDefinition>,
    model_configs: Vec<TestModelConfig>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    let version_lookup: Vec<(String, i32)> = variants
        .iter()
        .map(|(vid, vnum, _)| (vid.clone(), *vnum))
        .collect();

    let lab_variants: Vec<LabVariant<'_>> = variants
        .iter()
        .map(|(_, num, p)| LabVariant {
            persona: p,
            label: format!("v{}", num),
            tools: Vec::new(),
        })
        .collect();
    let primary_persona = &variants[0].2;

    let cb = LabCallbacks {
        event_name: "lab-eval-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = eval_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(
            move |pool, run_id, variant, scenario, model, status, scores| {
                let Some(src) = version_lookup
                    .iter()
                    .find(|(_, num)| format!("v{}", num) == variant.label)
                else {
                    tracing::error!(
                        "Version lookup failed for label '{}' during eval persist_result",
                        variant.label
                    );
                    return;
                };
                let base = make_common_result_fields(scenario, model, status, scores);
                let _ = eval_repo::create_result(
                    pool,
                    &CreateEvalResultInput {
                        run_id: run_id.to_string(),
                        version_id: src.0.clone(),
                        version_number: src.1,
                        base,
                    },
                );
            },
        ),
        build_summary: Box::new(build_keyed_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = eval_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        primary_persona,
        &tools,
        &model_configs,
        &lab_variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}

// ============================================================================
// Lab: Matrix -- draft generation + current vs draft comparison
// ============================================================================

#[allow(clippy::too_many_arguments, clippy::type_complexity)]
pub async fn run_matrix_test(
    app: AppHandle,
    pool: DbPool,
    run_id: String,
    ephemeral: EphemeralPersona,
    user_instruction: String,
    model_configs: Vec<TestModelConfig>,
    cancelled: Arc<std::sync::atomic::AtomicBool>,
    use_case_filter: Option<String>,
) {
    let persona = &ephemeral.persona;
    let tools = &ephemeral.tools;

    // Phase 0: Generate draft persona
    emit_lab_status(&app, "lab-matrix-status", &run_id, "drafting", None);

    let draft_prompt_text = build_draft_generation_prompt(persona, &user_instruction, None);
    let mut cli_args = prompt::build_cli_args(None, None);
    cli_args.args.push("--model".to_string());
    cli_args.args.push(LAB_MODEL.to_string());
    cli_args.args.push("--max-turns".to_string());
    cli_args.args.push("1".to_string());

    let draft_output = match spawn_cli_and_collect(
        &cli_args,
        &draft_prompt_text,
        &pool,
        personas_db::repos::llm_spend::SpendCtx {
            source: "evaluator",
            trigger_kind: "lab_draft",
            model: Some(LAB_MODEL),
            persona_id: Some(persona.id.as_str()),
            project_id: None,
        },
    )
    .await
    {
        Ok(o) => o,
        Err(e) => {
            let msg = format!("Draft generation failed: {e}");
            let now = chrono::Utc::now().to_rfc3339();
            let _ = matrix_repo::update_run_status(
                &pool,
                &run_id,
                LabRunStatus::Failed,
                None,
                None,
                Some(&msg),
                Some(&now),
            );
            emit_lab_status(&app, "lab-matrix-status", &run_id, "failed", Some(&msg));
            return;
        }
    };

    let (draft_structured_prompt, draft_change_summary) =
        match parse_draft_from_output(&draft_output) {
            Ok(v) => v,
            Err(e) => {
                let msg = format!("Failed to parse draft: {e}");
                let now = chrono::Utc::now().to_rfc3339();
                let _ = matrix_repo::update_run_status(
                    &pool,
                    &run_id,
                    LabRunStatus::Failed,
                    None,
                    None,
                    Some(&msg),
                    Some(&now),
                );
                emit_lab_status(&app, "lab-matrix-status", &run_id, "failed", Some(&msg));
                return;
            }
        };

    let draft_json_str = serde_json::to_string(&draft_structured_prompt).unwrap_or_default();
    let _ = matrix_repo::update_run_draft(&pool, &run_id, &draft_json_str, &draft_change_summary);

    let mut draft_persona = persona.clone();
    draft_persona.structured_prompt = Some(draft_json_str.clone());

    let variants = vec![
        LabVariant {
            persona,
            label: "current".to_string(),
            tools: Vec::new(),
        },
        LabVariant {
            persona: &draft_persona,
            label: "draft".to_string(),
            tools: Vec::new(),
        },
    ];

    let cb = LabCallbacks {
        event_name: "lab-matrix-status",
        update_status: Box::new(|pool, id, status, sc, sum, err, ca| {
            let _ = matrix_repo::update_run_status(pool, id, status, sc, sum, err, ca);
        }),
        persist_result: Box::new(|pool, run_id, variant, scenario, model, status, scores| {
            let base = make_common_result_fields(scenario, model, status, scores);
            let _ = matrix_repo::create_result(
                pool,
                &CreateMatrixResultInput {
                    run_id: run_id.to_string(),
                    variant: variant.label.clone(),
                    base,
                },
            );
        }),
        build_summary: Box::new(build_keyed_summary),
        update_llm_summary: Box::new(|pool, id, text| {
            let _ = matrix_repo::update_llm_summary(pool, id, text);
        }),
        should_halt_budget: Box::new(|_run_id| false),
        record_cost: Box::new(|_run_id, _cost| {}),
    };

    // Transition Drafting -> Generating so run_lab_loop can then go Generating -> Running -> Completed
    let _ = matrix_repo::update_run_status(
        &pool,
        &run_id,
        LabRunStatus::Generating,
        None,
        None,
        None,
        None,
    );

    run_lab_loop(
        &app,
        &pool,
        &run_id,
        persona,
        tools,
        &model_configs,
        &variants,
        &cancelled,
        use_case_filter.as_deref(),
        None,
        None,
        &cb,
    )
    .await;
}
