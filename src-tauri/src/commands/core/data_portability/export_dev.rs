//! Export of the dev-project graph and its on-disk skill files.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

/// Collect dev projects (with their full child graph + on-disk skills).
/// `filter_ids: None` = all projects (Full scope, capped); `Some(ids)` =
/// exactly those ids, silently skipping unknown ones (same posture as the
/// persona/team selective filters).
pub(crate) fn collect_dev_project_exports(
    pool: &DbPool,
    filter_ids: Option<&[String]>,
    export_warnings: &mut Vec<String>,
) -> Result<Vec<DevProjectExport>, AppError> {
    if filter_ids.is_some_and(|ids| ids.is_empty()) {
        return Ok(Vec::new());
    }
    let conn = pool.get()?;

    const PROJECT_COLS: &str = "id, name, root_path, description, status, tech_stack, team_id, \
         auto_pr_on_success, github_url, main_branch, \
         test_env_url, test_env_branch, workspace_id, data_links, static_scan_config, \
         standards_config, monitoring_project_slug, created_at, updated_at";
    type ProjectRow = (
        String,
        String,
        String,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        bool,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
    );
    let map_project = |r: &rusqlite::Row<'_>| -> rusqlite::Result<ProjectRow> {
        Ok((
            r.get(0)?,
            r.get(1)?,
            r.get(2)?,
            r.get(3)?,
            r.get(4)?,
            r.get(5)?,
            r.get(6)?,
            r.get(7)?,
            r.get(8)?,
            r.get(9)?,
            r.get(10)?,
            r.get(11)?,
            r.get(12)?,
            r.get(13)?,
            r.get(14)?,
            r.get(15)?,
            r.get(16)?,
            r.get(17)?,
            r.get(18)?,
        ))
    };

    let project_rows: Vec<ProjectRow> = match filter_ids {
        None => {
            let total: usize = conn
                .query_row("SELECT COUNT(*) FROM dev_projects", [], |r| {
                    r.get::<_, i64>(0)
                })
                .unwrap_or(0) as usize;
            let sql = format!("SELECT {PROJECT_COLS} FROM dev_projects ORDER BY created_at");
            let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
            let rows = stmt
                .query_map([], map_project)
                .map_err(AppError::Database)?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r.map_err(AppError::Database)?);
                if out.len() >= MAX_DEV_PROJECTS {
                    break;
                }
            }
            push_truncation_warning(
                export_warnings,
                "projects",
                out.len(),
                total,
                "Dev projects",
            );
            out
        }
        Some(ids) => {
            let mut unique: Vec<&String> = Vec::new();
            let mut seen = std::collections::HashSet::new();
            for id in ids {
                if seen.insert(id.clone()) {
                    unique.push(id);
                }
            }
            push_truncation_warning(
                export_warnings,
                "selected projects",
                MAX_DEV_PROJECTS.min(unique.len()),
                unique.len(),
                "Dev projects",
            );
            let sql = format!("SELECT {PROJECT_COLS} FROM dev_projects WHERE id = ?1");
            let mut out = Vec::new();
            for id in unique.into_iter().take(MAX_DEV_PROJECTS) {
                let mut stmt = conn.prepare(&sql).map_err(AppError::Database)?;
                let mut rows = stmt
                    .query_map([id.as_str()], map_project)
                    .map_err(AppError::Database)?;
                if let Some(row) = rows.next() {
                    out.push(row.map_err(AppError::Database)?);
                }
            }
            out
        }
    };

    let mut exports = Vec::with_capacity(project_rows.len());
    for row in project_rows {
        let (
            id,
            name,
            root_path,
            description,
            status,
            tech_stack,
            team_id,
            auto_pr_on_success,
            github_url,
            main_branch,
            test_env_url,
            test_env_branch,
            workspace_id,
            data_links,
            static_scan_config,
            standards_config,
            monitoring_project_slug,
            created_at,
            updated_at,
        ) = row;
        let pid = id.as_str();

        let goals = query_rows(
            &conn,
            "SELECT id, parent_goal_id, context_id, kpi_id, order_index, title, description, \
                    status, progress, target_date, started_at, completed_at, created_at, updated_at \
             FROM dev_goals WHERE project_id = ?1 ORDER BY order_index, created_at",
            pid,
            |r| {
                Ok(DevGoalExport {
                    id: r.get(0)?,
                    parent_goal_id: r.get(1)?,
                    context_id: r.get(2)?,
                    kpi_id: r.get(3)?,
                    order_index: r.get(4)?,
                    title: r.get(5)?,
                    description: r.get(6)?,
                    status: r.get(7)?,
                    progress: r.get(8)?,
                    target_date: r.get(9)?,
                    started_at: r.get(10)?,
                    completed_at: r.get(11)?,
                    created_at: r.get(12)?,
                    updated_at: r.get(13)?,
                })
            },
        )?;

        let goal_dependencies = query_rows(
            &conn,
            "SELECT d.id, d.goal_id, d.depends_on_id, d.dependency_type, d.created_at \
             FROM dev_goal_dependencies d JOIN dev_goals g ON g.id = d.goal_id \
             WHERE g.project_id = ?1",
            pid,
            |r| {
                Ok(DevGoalDependencyExport {
                    id: r.get(0)?,
                    goal_id: r.get(1)?,
                    depends_on_id: r.get(2)?,
                    dependency_type: r.get(3)?,
                    created_at: r.get(4)?,
                })
            },
        )?;

        let goal_signals = query_rows(
            &conn,
            "SELECT s.id, s.goal_id, s.signal_type, s.source_id, s.delta, s.message, s.created_at \
             FROM dev_goal_signals s JOIN dev_goals g ON g.id = s.goal_id \
             WHERE g.project_id = ?1",
            pid,
            |r| {
                Ok(DevGoalSignalExport {
                    id: r.get(0)?,
                    goal_id: r.get(1)?,
                    signal_type: r.get(2)?,
                    source_id: r.get(3)?,
                    delta: r.get(4)?,
                    message: r.get(5)?,
                    created_at: r.get(6)?,
                })
            },
        )?;

        let goal_items = query_rows(
            &conn,
            "SELECT i.id, i.goal_id, i.title, i.done, i.order_index, i.created_at, i.updated_at \
             FROM dev_goal_items i JOIN dev_goals g ON g.id = i.goal_id \
             WHERE g.project_id = ?1 ORDER BY i.goal_id, i.order_index",
            pid,
            |r| {
                Ok(DevGoalItemExport {
                    id: r.get(0)?,
                    goal_id: r.get(1)?,
                    title: r.get(2)?,
                    done: r.get(3)?,
                    order_index: r.get(4)?,
                    created_at: r.get(5)?,
                    updated_at: r.get(6)?,
                })
            },
        )?;

        let context_groups = query_rows(
            &conn,
            "SELECT id, name, color, icon, group_type, position, health_score, last_scan_at, \
                    created_at, updated_at \
             FROM dev_context_groups WHERE project_id = ?1 ORDER BY position",
            pid,
            |r| {
                Ok(DevContextGroupExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    icon: r.get(3)?,
                    group_type: r.get(4)?,
                    position: r.get(5)?,
                    health_score: r.get(6)?,
                    last_scan_at: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let contexts = query_rows(
            &conn,
            "SELECT id, group_id, name, description, file_paths, entry_points, db_tables, \
                    keywords, api_surface, cross_refs, tech_stack, category, business_feature, \
                    pinned, created_at, updated_at \
             FROM dev_contexts WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevContextExport {
                    id: r.get(0)?,
                    group_id: r.get(1)?,
                    name: r.get(2)?,
                    description: r.get(3)?,
                    file_paths: r.get(4)?,
                    entry_points: r.get(5)?,
                    db_tables: r.get(6)?,
                    keywords: r.get(7)?,
                    api_surface: r.get(8)?,
                    cross_refs: r.get(9)?,
                    tech_stack: r.get(10)?,
                    category: r.get(11)?,
                    business_feature: r.get(12)?,
                    pinned: r.get(13)?,
                    created_at: r.get(14)?,
                    updated_at: r.get(15)?,
                })
            },
        )?;

        let context_group_relationships = query_rows(
            &conn,
            "SELECT id, source_group_id, target_group_id, created_at \
             FROM dev_context_group_relationships WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevContextGroupRelationshipExport {
                    id: r.get(0)?,
                    source_group_id: r.get(1)?,
                    target_group_id: r.get(2)?,
                    created_at: r.get(3)?,
                })
            },
        )?;

        let context_fingerprints = query_rows(
            &conn,
            "SELECT context_id, content_hash, file_count, missing_file_count, imports, \
                    primitives, promise_all_count, join_all_count, await_count, sql_write_count, \
                    spawn_count, use_effect_count, set_state_after_await_count, \
                    exports_components, exports_hooks, exports_commands, exports_repo_fns, \
                    computed_at \
             FROM dev_context_fingerprints WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevContextFingerprintExport {
                    context_id: r.get(0)?,
                    content_hash: r.get(1)?,
                    file_count: r.get(2)?,
                    missing_file_count: r.get(3)?,
                    imports: r.get(4)?,
                    primitives: r.get(5)?,
                    promise_all_count: r.get(6)?,
                    join_all_count: r.get(7)?,
                    await_count: r.get(8)?,
                    sql_write_count: r.get(9)?,
                    spawn_count: r.get(10)?,
                    use_effect_count: r.get(11)?,
                    set_state_after_await_count: r.get(12)?,
                    exports_components: r.get(13)?,
                    exports_hooks: r.get(14)?,
                    exports_commands: r.get(15)?,
                    exports_repo_fns: r.get(16)?,
                    computed_at: r.get(17)?,
                })
            },
        )?;

        let ideas = query_rows(
            &conn,
            "SELECT id, context_id, scan_type, category, title, description, reasoning, status, \
                    effort, impact, risk, priority, provider, model, rejection_reason, origin, \
                    use_case_id, evidence, dedup_key, verify_state, verify_checked_at, \
                    verify_evidence, created_at, updated_at \
             FROM dev_ideas WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevIdeaExport {
                    id: r.get(0)?,
                    context_id: r.get(1)?,
                    scan_type: r.get(2)?,
                    category: r.get(3)?,
                    title: r.get(4)?,
                    description: r.get(5)?,
                    reasoning: r.get(6)?,
                    status: r.get(7)?,
                    effort: r.get(8)?,
                    impact: r.get(9)?,
                    risk: r.get(10)?,
                    priority: r.get(11)?,
                    provider: r.get(12)?,
                    model: r.get(13)?,
                    rejection_reason: r.get(14)?,
                    origin: r.get(15)?,
                    use_case_id: r.get(16)?,
                    evidence: r.get(17)?,
                    dedup_key: r.get(18)?,
                    verify_state: r.get(19)?,
                    verify_checked_at: r.get(20)?,
                    verify_evidence: r.get(21)?,
                    created_at: r.get(22)?,
                    updated_at: r.get(23)?,
                })
            },
        )?;

        let tasks = query_rows(
            &conn,
            "SELECT id, title, description, source_idea_id, goal_id, status, session_id, \
                    progress_pct, output_lines, error, depth, parent_task_id, attempt, \
                    started_at, completed_at, created_at \
             FROM dev_tasks WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevTaskExport {
                    id: r.get(0)?,
                    title: r.get(1)?,
                    description: r.get(2)?,
                    source_idea_id: r.get(3)?,
                    goal_id: r.get(4)?,
                    status: r.get(5)?,
                    session_id: r.get(6)?,
                    progress_pct: r.get(7)?,
                    output_lines: r.get(8)?,
                    error: r.get(9)?,
                    depth: r.get(10)?,
                    parent_task_id: r.get(11)?,
                    attempt: r.get(12)?,
                    started_at: r.get(13)?,
                    completed_at: r.get(14)?,
                    created_at: r.get(15)?,
                })
            },
        )?;

        let competitions = query_rows(
            &conn,
            "SELECT id, task_title, task_description, source_idea_id, source_goal_id, \
                    slot_count, status, winner_task_id, winner_insight, baseline_json, \
                    reviewer_notes, worktree_base_ref, created_at, resolved_at \
             FROM dev_competitions WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevCompetitionExport {
                    id: r.get(0)?,
                    task_title: r.get(1)?,
                    task_description: r.get(2)?,
                    source_idea_id: r.get(3)?,
                    source_goal_id: r.get(4)?,
                    slot_count: r.get(5)?,
                    status: r.get(6)?,
                    winner_task_id: r.get(7)?,
                    winner_insight: r.get(8)?,
                    baseline_json: r.get(9)?,
                    reviewer_notes: r.get(10)?,
                    worktree_base_ref: r.get(11)?,
                    created_at: r.get(12)?,
                    resolved_at: r.get(13)?,
                })
            },
        )?;

        let competition_slots = query_rows(
            &conn,
            "SELECT s.id, s.competition_id, s.task_id, s.strategy_label, s.strategy_prompt, \
                    s.worktree_name, s.branch_name, s.slot_index, s.disqualified, \
                    s.disqualify_reason, s.diff_hash, s.diff_stats_json, s.diff_analyzed_at, \
                    s.created_at \
             FROM dev_competition_slots s \
             JOIN dev_competitions c ON c.id = s.competition_id \
             WHERE c.project_id = ?1 ORDER BY s.competition_id, s.slot_index",
            pid,
            |r| {
                Ok(DevCompetitionSlotExport {
                    id: r.get(0)?,
                    competition_id: r.get(1)?,
                    task_id: r.get(2)?,
                    strategy_label: r.get(3)?,
                    strategy_prompt: r.get(4)?,
                    worktree_name: r.get(5)?,
                    branch_name: r.get(6)?,
                    slot_index: r.get(7)?,
                    disqualified: r.get(8)?,
                    disqualify_reason: r.get(9)?,
                    diff_hash: r.get(10)?,
                    diff_stats_json: r.get(11)?,
                    diff_analyzed_at: r.get(12)?,
                    created_at: r.get(13)?,
                })
            },
        )?;

        let triage_rules = query_rows(
            &conn,
            "SELECT id, name, conditions, action, enabled, times_fired, created_at \
             FROM dev_triage_rules WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevTriageRuleExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    conditions: r.get(2)?,
                    action: r.get(3)?,
                    enabled: r.get(4)?,
                    times_fired: r.get(5)?,
                    created_at: r.get(6)?,
                })
            },
        )?;

        // dev_pipelines carries project_id with no FK — enumerate by the
        // column explicitly (same below for dev_memories).
        let pipelines = query_rows(
            &conn,
            "SELECT id, idea_id, task_id, stage, auto_execute, verify_after, \
                    verification_scan_id, error, created_at, updated_at \
             FROM dev_pipelines WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevPipelineExport {
                    id: r.get(0)?,
                    idea_id: r.get(1)?,
                    task_id: r.get(2)?,
                    stage: r.get(3)?,
                    auto_execute: r.get(4)?,
                    verify_after: r.get(5)?,
                    verification_scan_id: r.get(6)?,
                    error: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let standards = query_rows(
            &conn,
            "SELECT id, scan_id, rule_key, category, title, status, severity, evidence, \
                    recommendation, created_at, updated_at \
             FROM dev_standards WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevStandardExport {
                    id: r.get(0)?,
                    scan_id: r.get(1)?,
                    rule_key: r.get(2)?,
                    category: r.get(3)?,
                    title: r.get(4)?,
                    status: r.get(5)?,
                    severity: r.get(6)?,
                    evidence: r.get(7)?,
                    recommendation: r.get(8)?,
                    created_at: r.get(9)?,
                    updated_at: r.get(10)?,
                })
            },
        )?;

        let use_cases = query_rows(
            &conn,
            "SELECT id, name, slug, description, kind, primary_context_id, status, created_by, \
                    pinned, rationale, created_at, updated_at \
             FROM dev_use_cases WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevUseCaseExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    slug: r.get(2)?,
                    description: r.get(3)?,
                    kind: r.get(4)?,
                    primary_context_id: r.get(5)?,
                    status: r.get(6)?,
                    created_by: r.get(7)?,
                    pinned: r.get(8)?,
                    rationale: r.get(9)?,
                    created_at: r.get(10)?,
                    updated_at: r.get(11)?,
                })
            },
        )?;

        let use_case_contexts = query_rows(
            &conn,
            "SELECT ucc.use_case_id, ucc.context_id \
             FROM dev_use_case_contexts ucc \
             JOIN dev_use_cases uc ON uc.id = ucc.use_case_id \
             WHERE uc.project_id = ?1",
            pid,
            |r| {
                Ok(DevUseCaseContextExport {
                    use_case_id: r.get(0)?,
                    context_id: r.get(1)?,
                })
            },
        )?;

        let milestones = query_rows(
            &conn,
            "SELECT id, name, goal, status, order_index, target_date, cut_at, shipped_at, \
                    created_at, updated_at \
             FROM dev_milestones WHERE project_id = ?1 ORDER BY order_index",
            pid,
            |r| {
                Ok(DevMilestoneExport {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    goal: r.get(2)?,
                    status: r.get(3)?,
                    order_index: r.get(4)?,
                    target_date: r.get(5)?,
                    cut_at: r.get(6)?,
                    shipped_at: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let milestone_items = query_rows(
            &conn,
            "SELECT mi.milestone_id, mi.item_kind, mi.item_id, mi.bucket, mi.added_after_cut, \
                    mi.order_index, mi.created_at, mi.description, mi.rating \
             FROM dev_milestone_items mi \
             JOIN dev_milestones m ON m.id = mi.milestone_id \
             WHERE m.project_id = ?1 ORDER BY mi.milestone_id, mi.order_index",
            pid,
            |r| {
                Ok(DevMilestoneItemExport {
                    milestone_id: r.get(0)?,
                    item_kind: r.get(1)?,
                    item_id: r.get(2)?,
                    bucket: r.get(3)?,
                    added_after_cut: r.get(4)?,
                    order_index: r.get(5)?,
                    created_at: r.get(6)?,
                    description: r.get(7)?,
                    rating: r.get(8)?,
                })
            },
        )?;

        let kpis = query_rows(
            &conn,
            "SELECT id, context_group_id, context_id, use_case_id, name, description, category, \
                    measure_kind, measure_config, unit, direction, baseline_value, target_value, \
                    target_date, current_value, last_measured_at, cadence, status, created_by, \
                    rationale, needed_connector, metric_type, tier, warn_at, crit_at, \
                    manual_rating, assessment_pros, assessment_cons, last_skip_at, \
                    last_skip_rationale, created_at, updated_at \
             FROM dev_kpis WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevKpiExport {
                    id: r.get(0)?,
                    context_group_id: r.get(1)?,
                    context_id: r.get(2)?,
                    use_case_id: r.get(3)?,
                    name: r.get(4)?,
                    description: r.get(5)?,
                    category: r.get(6)?,
                    measure_kind: r.get(7)?,
                    measure_config: r.get(8)?,
                    unit: r.get(9)?,
                    direction: r.get(10)?,
                    baseline_value: r.get(11)?,
                    target_value: r.get(12)?,
                    target_date: r.get(13)?,
                    current_value: r.get(14)?,
                    last_measured_at: r.get(15)?,
                    cadence: r.get(16)?,
                    status: r.get(17)?,
                    created_by: r.get(18)?,
                    rationale: r.get(19)?,
                    needed_connector: r.get(20)?,
                    metric_type: r.get(21)?,
                    tier: r.get(22)?,
                    warn_at: r.get(23)?,
                    crit_at: r.get(24)?,
                    manual_rating: r.get(25)?,
                    assessment_pros: r.get(26)?,
                    assessment_cons: r.get(27)?,
                    last_skip_at: r.get(28)?,
                    last_skip_rationale: r.get(29)?,
                    created_at: r.get(30)?,
                    updated_at: r.get(31)?,
                })
            },
        )?;

        let kpi_measurements = query_rows(
            &conn,
            "SELECT m.id, m.kpi_id, m.value, m.measured_at, m.source, m.env, m.evidence, m.note \
             FROM dev_kpi_measurements m JOIN dev_kpis k ON k.id = m.kpi_id \
             WHERE k.project_id = ?1 ORDER BY m.kpi_id, m.measured_at",
            pid,
            |r| {
                Ok(DevKpiMeasurementExport {
                    id: r.get(0)?,
                    kpi_id: r.get(1)?,
                    value: r.get(2)?,
                    measured_at: r.get(3)?,
                    source: r.get(4)?,
                    env: r.get(5)?,
                    evidence: r.get(6)?,
                    note: r.get(7)?,
                })
            },
        )?;

        // credential_id intentionally not selected — see DevKpiBindingExport.
        let kpi_bindings = query_rows(
            &conn,
            "SELECT b.id, b.kpi_id, b.service_type, b.procedure, b.composed_by, b.status, \
                    b.verified_at, b.created_at \
             FROM dev_kpi_bindings b JOIN dev_kpis k ON k.id = b.kpi_id \
             WHERE k.project_id = ?1",
            pid,
            |r| {
                Ok(DevKpiBindingExport {
                    id: r.get(0)?,
                    kpi_id: r.get(1)?,
                    service_type: r.get(2)?,
                    procedure: r.get(3)?,
                    composed_by: r.get(4)?,
                    status: r.get(5)?,
                    verified_at: r.get(6)?,
                    created_at: r.get(7)?,
                })
            },
        )?;

        let memories = query_rows(
            &conn,
            "SELECT id, category, title, content, importance, source_kind, source_id, \
                    created_at, updated_at \
             FROM dev_memories WHERE project_id = ?1",
            pid,
            |r| {
                Ok(DevMemoryExport {
                    id: r.get(0)?,
                    category: r.get(1)?,
                    title: r.get(2)?,
                    content: r.get(3)?,
                    importance: r.get(4)?,
                    source_kind: r.get(5)?,
                    source_id: r.get(6)?,
                    created_at: r.get(7)?,
                    updated_at: r.get(8)?,
                })
            },
        )?;

        let memory_nodes = query_rows(
            &conn,
            "SELECT id, context_id, kind, title, body, source, status, content_hash, \
                    created_at, updated_at \
             FROM memory_nodes WHERE project_id = ?1",
            pid,
            |r| {
                Ok(MemoryNodeExport {
                    id: r.get(0)?,
                    context_id: r.get(1)?,
                    kind: r.get(2)?,
                    title: r.get(3)?,
                    body: r.get(4)?,
                    source: r.get(5)?,
                    status: r.get(6)?,
                    content_hash: r.get(7)?,
                    created_at: r.get(8)?,
                    updated_at: r.get(9)?,
                })
            },
        )?;

        let memory_edges = query_rows(
            &conn,
            "SELECT e.from_id, e.to_id, e.rel, e.created_at \
             FROM memory_edges e JOIN memory_nodes n ON n.id = e.from_id \
             WHERE n.project_id = ?1",
            pid,
            |r| {
                Ok(MemoryEdgeExport {
                    from_id: r.get(0)?,
                    to_id: r.get(1)?,
                    rel: r.get(2)?,
                    created_at: r.get(3)?,
                })
            },
        )?;

        let skills = collect_project_skills(&root_path, &name, export_warnings);

        exports.push(DevProjectExport {
            id,
            name,
            root_path,
            description,
            status,
            tech_stack,
            team_id,
            auto_pr_on_success,
            github_url,
            main_branch,
            test_env_url,
            test_env_branch,
            workspace_id,
            data_links,
            static_scan_config,
            standards_config,
            monitoring_project_slug,
            created_at,
            updated_at,
            goals,
            goal_dependencies,
            goal_signals,
            goal_items,
            context_groups,
            contexts,
            context_group_relationships,
            context_fingerprints,
            ideas,
            tasks,
            competitions,
            competition_slots,
            triage_rules,
            pipelines,
            standards,
            use_cases,
            use_case_contexts,
            milestones,
            milestone_items,
            kpis,
            kpi_measurements,
            kpi_bindings,
            memories,
            memory_nodes,
            memory_edges,
            skills,
        });
    }

    Ok(exports)
}

/// Read a project's `.claude/skills/` library from disk. Mirrors the layout
/// scanned by `commands::infrastructure::skill_files`: each skill is a
/// directory (SKILL.md + optional reference files, possibly nested) or a
/// single `<name>.md`. Missing/unreadable dirs yield an empty vec — a
/// project whose repo isn't on this machine still exports its DB graph.
pub(crate) fn collect_project_skills(
    root_path: &str,
    project_name: &str,
    export_warnings: &mut Vec<String>,
) -> Vec<SkillFileExport> {
    let skills_dir = std::path::Path::new(root_path)
        .join(".claude")
        .join("skills");
    let Ok(read_dir) = std::fs::read_dir(&skills_dir) else {
        return Vec::new();
    };

    let mut skills = Vec::new();
    for entry in read_dir.flatten() {
        let path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().to_string();
        // Same shape as skill_files::validate_skill_name — a skill is one
        // safe path segment. Anything else is skipped, never an error.
        if entry_name.is_empty()
            || entry_name.contains('/')
            || entry_name.contains('\\')
            || entry_name.contains("..")
            || entry_name.contains(':')
        {
            continue;
        }

        // A symlinked entry resolves outside the skills dir; exporting through
        // it would put arbitrary repo/home content into a shareable bundle.
        let kind = skill_files::classify_skill_entry(&entry);
        if let skill_files::SkillEntryKind::Rejected(reason) = kind {
            export_warnings.push(format!(
                "Project '{project_name}': skill '{entry_name}' not exported ({reason})."
            ));
            continue;
        }

        let mut dropped: Vec<String> = Vec::new();
        let (name, mut files) = if matches!(kind, skill_files::SkillEntryKind::Dir) {
            let mut files = Vec::new();
            collect_skill_dir_files(&path, &path, &mut files, &mut dropped, 0);
            (entry_name.clone(), files)
        } else if path.extension().and_then(|e| e.to_str()) == Some("md") {
            // Single-file skill: skills/<name>.md
            let stem = path
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("unknown")
                .to_string();
            match read_skill_file_checked(&path) {
                Ok(content) => (
                    stem,
                    vec![SkillFileEntry {
                        rel_path: entry_name.clone(),
                        content,
                    }],
                ),
                Err(reason) => {
                    export_warnings.push(format!(
                        "Project '{project_name}': skill '{entry_name}' not exported ({reason})."
                    ));
                    continue;
                }
            }
        } else {
            continue;
        };
        for d in dropped {
            export_warnings.push(format!(
                "Project '{project_name}': skill '{entry_name}' file {d} — not exported."
            ));
        }

        if files.is_empty() {
            continue;
        }
        // Deterministic order → deterministic content_hash.
        files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));

        use sha2::Digest as _;
        let mut hasher = sha2::Sha256::new();
        for f in &files {
            hasher.update(f.rel_path.as_bytes());
            hasher.update([0u8]);
            hasher.update(f.content.as_bytes());
            hasher.update([0u8]);
        }
        let content_hash = format!("{:x}", hasher.finalize());

        skills.push(SkillFileExport {
            name,
            files,
            content_hash,
        });
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

/// Recursively collect a skill directory's exportable files (rel paths with
/// forward slashes). Skips the provenance sidecar, oversize files, and
/// non-UTF-8 content.
pub(crate) fn collect_skill_dir_files(
    base: &std::path::Path,
    dir: &std::path::Path,
    out: &mut Vec<SkillFileEntry>,
    dropped: &mut Vec<String>,
    depth: usize,
) {
    if depth >= skill_files::MAX_SKILL_DIR_DEPTH {
        dropped.push(format!(
            "'{}' (nested deeper than {})",
            dir.display(),
            skill_files::MAX_SKILL_DIR_DEPTH
        ));
        return;
    }
    let Ok(read_dir) = std::fs::read_dir(dir) else {
        return;
    };
    for entry in read_dir.flatten() {
        let path = entry.path();
        let rel_of = |p: &std::path::Path| {
            p.strip_prefix(base)
                .map(|r| r.to_string_lossy().replace('\\', "/"))
                .unwrap_or_else(|_| p.to_string_lossy().to_string())
        };
        match skill_files::classify_skill_entry(&entry) {
            skill_files::SkillEntryKind::Dir => {
                collect_skill_dir_files(base, &path, out, dropped, depth + 1);
                continue;
            }
            skill_files::SkillEntryKind::Rejected(reason) => {
                dropped.push(format!("'{}' ({reason})", rel_of(&path)));
                continue;
            }
            skill_files::SkillEntryKind::File => {}
        }
        if path.file_name().and_then(|n| n.to_str()) == Some(SKILL_PROVENANCE_FILE) {
            continue;
        }
        let rel_label = path
            .strip_prefix(base)
            .map(|r| r.to_string_lossy().replace('\\', "/"))
            .unwrap_or_else(|_| path.to_string_lossy().to_string());
        let content = match read_skill_file_checked(&path) {
            Ok(c) => c,
            Err(reason) => {
                dropped.push(format!("'{rel_label}' ({reason})"));
                continue;
            }
        };
        let Ok(rel) = path.strip_prefix(base) else {
            continue;
        };
        let rel_path = rel
            .components()
            .map(|c| c.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        out.push(SkillFileEntry { rel_path, content });
    }
}

/// Why a skill file did not make it into the bundle. Reported (not swallowed)
/// on the export path — a skill silently missing half its reference files is
/// indistinguishable from a skill that never had them.
pub(crate) enum SkillFileSkip {
    Oversize(u64),
    NotUtf8,
    Unreadable,
}

impl std::fmt::Display for SkillFileSkip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            SkillFileSkip::Oversize(len) => write!(
                f,
                "{len} bytes exceeds the {MAX_SKILL_FILE_BYTES}-byte per-file cap"
            ),
            SkillFileSkip::NotUtf8 => write!(f, "not valid UTF-8 text"),
            SkillFileSkip::Unreadable => write!(f, "unreadable"),
        }
    }
}

/// Read one skill file as UTF-8 text, naming the reason when it cannot travel.
pub(crate) fn read_skill_file_checked(path: &std::path::Path) -> Result<String, SkillFileSkip> {
    let meta = std::fs::metadata(path).map_err(|_| SkillFileSkip::Unreadable)?;
    if meta.len() > MAX_SKILL_FILE_BYTES {
        return Err(SkillFileSkip::Oversize(meta.len()));
    }
    let bytes = std::fs::read(path).map_err(|_| SkillFileSkip::Unreadable)?;
    String::from_utf8(bytes).map_err(|_| SkillFileSkip::NotUtf8)
}

/// Read one skill file as UTF-8 text, or None when it is oversize
/// (> [`MAX_SKILL_FILE_BYTES`]), unreadable, or not valid UTF-8. Used where
/// the reason does not matter (the import-side drift comparison).
pub(crate) fn read_skill_file(path: &std::path::Path) -> Option<String> {
    read_skill_file_checked(path).ok()
}
