//! Import of the dev-project graph.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Dev-tools project + workspace-knowledge import helpers (WP2)
// ============================================================================

/// How a bundled dev project lands in this database.
pub(crate) enum ProjectImportMode {
    /// No conflict — import with the ORIGINAL uuids (nothing collides).
    Fresh,
    /// Conflict resolved as "replace": keep the existing project id, update
    /// the row in place, delete + re-insert the covered child families with
    /// their original bundle uuids. Telemetry tables are never touched.
    Replace { existing_id: String },
    /// Conflict resolved as "duplicate": fresh uuid for the project and every
    /// child row, with all internal refs remapped.
    Duplicate,
}

/// Delete the child families the bundle covers ahead of a "replace"
/// re-insert. Explicit (no reliance on FK cascades) and intentionally NOT
/// touching telemetry / scan-cache tables (dev_llm_spend, dev_auto_runs,
/// dev_scans, dev_run_checkpoints, skill_registry, dev_context_file_hashes,
/// context_health_snapshots, workspace_harvest_coverage).
pub(crate) fn delete_project_children(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
) -> Result<(), rusqlite::Error> {
    const DELETES: &[&str] = &[
        "DELETE FROM dev_goal_dependencies WHERE goal_id IN (SELECT id FROM dev_goals WHERE project_id = ?1)",
        "DELETE FROM dev_goal_signals WHERE goal_id IN (SELECT id FROM dev_goals WHERE project_id = ?1)",
        "DELETE FROM dev_goal_items WHERE goal_id IN (SELECT id FROM dev_goals WHERE project_id = ?1)",
        "DELETE FROM dev_use_case_contexts WHERE use_case_id IN (SELECT id FROM dev_use_cases WHERE project_id = ?1)",
        "DELETE FROM dev_milestone_items WHERE milestone_id IN (SELECT id FROM dev_milestones WHERE project_id = ?1)",
        "DELETE FROM dev_kpi_measurements WHERE kpi_id IN (SELECT id FROM dev_kpis WHERE project_id = ?1)",
        "DELETE FROM dev_kpi_bindings WHERE kpi_id IN (SELECT id FROM dev_kpis WHERE project_id = ?1)",
        "DELETE FROM dev_competition_slots WHERE competition_id IN (SELECT id FROM dev_competitions WHERE project_id = ?1)",
        "DELETE FROM memory_edges WHERE from_id IN (SELECT id FROM memory_nodes WHERE project_id = ?1) \
             OR to_id IN (SELECT id FROM memory_nodes WHERE project_id = ?1)",
        "DELETE FROM dev_tasks WHERE project_id = ?1",
        "DELETE FROM dev_competitions WHERE project_id = ?1",
        "DELETE FROM dev_goals WHERE project_id = ?1",
        "DELETE FROM dev_kpis WHERE project_id = ?1",
        "DELETE FROM dev_use_cases WHERE project_id = ?1",
        "DELETE FROM dev_milestones WHERE project_id = ?1",
        "DELETE FROM dev_ideas WHERE project_id = ?1",
        "DELETE FROM dev_contexts WHERE project_id = ?1",
        "DELETE FROM dev_context_group_relationships WHERE project_id = ?1",
        "DELETE FROM dev_context_groups WHERE project_id = ?1",
        "DELETE FROM dev_context_fingerprints WHERE project_id = ?1",
        "DELETE FROM dev_triage_rules WHERE project_id = ?1",
        "DELETE FROM dev_pipelines WHERE project_id = ?1",
        "DELETE FROM dev_standards WHERE project_id = ?1",
        "DELETE FROM dev_memories WHERE project_id = ?1",
        "DELETE FROM memory_nodes WHERE project_id = ?1",
    ];
    for sql in DELETES {
        tx.execute(sql, [project_id])?;
    }
    Ok(())
}

/// Import one bundled dev project (row + full child graph) under `mode`.
/// Returns `Some((target_project_id, final_root_path))` on success, `None`
/// when the project row itself could not be written (already warned).
#[allow(clippy::too_many_lines)]
pub(crate) fn import_dev_project_graph(
    tx: &rusqlite::Transaction<'_>,
    p: &DevProjectExport,
    mode: &ProjectImportMode,
    team_id: Option<String>,
    workspace_id: Option<String>,
    now: &str,
    warnings: &mut Vec<String>,
) -> Option<(String, String)> {
    let strict = matches!(mode, ProjectImportMode::Duplicate);

    // Old id → target id for every id-bearing child row. Identity in
    // fresh/replace modes (original uuids preserved), fresh uuids in
    // duplicate mode.
    let mut map: HashMap<String, String> = HashMap::new();
    {
        let mut add = |old: &String| {
            let new = if strict {
                uuid::Uuid::new_v4().to_string()
            } else {
                old.clone()
            };
            map.insert(old.clone(), new);
        };
        for r in &p.goals {
            add(&r.id);
        }
        for r in &p.goal_dependencies {
            add(&r.id);
        }
        for r in &p.goal_signals {
            add(&r.id);
        }
        for r in &p.goal_items {
            add(&r.id);
        }
        for r in &p.context_groups {
            add(&r.id);
        }
        for r in &p.contexts {
            add(&r.id);
        }
        for r in &p.context_group_relationships {
            add(&r.id);
        }
        for r in &p.ideas {
            add(&r.id);
        }
        for r in &p.tasks {
            add(&r.id);
        }
        for r in &p.competitions {
            add(&r.id);
        }
        for r in &p.competition_slots {
            add(&r.id);
        }
        for r in &p.triage_rules {
            add(&r.id);
        }
        for r in &p.pipelines {
            add(&r.id);
        }
        for r in &p.standards {
            add(&r.id);
        }
        for r in &p.use_cases {
            add(&r.id);
        }
        for r in &p.milestones {
            add(&r.id);
        }
        for r in &p.kpis {
            add(&r.id);
        }
        for r in &p.kpi_measurements {
            add(&r.id);
        }
        for r in &p.kpi_bindings {
            add(&r.id);
        }
        for r in &p.memories {
            add(&r.id);
        }
        for r in &p.memory_nodes {
            add(&r.id);
        }
    }

    // Project row.
    let (target_id, final_name, final_root_path) = match mode {
        ProjectImportMode::Fresh => (p.id.clone(), p.name.clone(), p.root_path.clone()),
        ProjectImportMode::Replace { existing_id } => {
            (existing_id.clone(), p.name.clone(), p.root_path.clone())
        }
        ProjectImportMode::Duplicate => {
            // Dodge the UNIQUE(root_path) constraint deterministically.
            let mut root = format!("{}-imported", p.root_path);
            let mut n = 2;
            while row_exists(tx, "SELECT 1 FROM dev_projects WHERE root_path = ?1", &root) {
                root = format!("{}-imported-{n}", p.root_path);
                n += 1;
            }
            (
                uuid::Uuid::new_v4().to_string(),
                format!("{} (imported)", p.name),
                root,
            )
        }
    };

    match mode {
        ProjectImportMode::Replace { existing_id } => {
            if let Err(e) = delete_project_children(tx, existing_id) {
                warnings.push(format!(
                    "Project '{}': failed to clear existing rows for replace: {e}",
                    p.name
                ));
                return None;
            }
            // root_path only follows the bundle when it doesn't collide with a
            // DIFFERENT project (UNIQUE column).
            let root_taken_by_other = tx
                .query_row(
                    "SELECT id FROM dev_projects WHERE root_path = ?1",
                    [p.root_path.as_str()],
                    |r| r.get::<_, String>(0),
                )
                .ok()
                .is_some_and(|id| id != *existing_id);
            let (root_for_update, effective_root) = if root_taken_by_other {
                warnings.push(format!(
                    "Project '{}': root path '{}' already belongs to another project; kept the existing path",
                    p.name, p.root_path
                ));
                let existing_root: String = tx
                    .query_row(
                        "SELECT root_path FROM dev_projects WHERE id = ?1",
                        [existing_id.as_str()],
                        |r| r.get(0),
                    )
                    .unwrap_or_else(|_| p.root_path.clone());
                (None::<String>, existing_root)
            } else {
                (Some(p.root_path.clone()), p.root_path.clone())
            };
            let ok = exec_row(
                tx,
                "UPDATE dev_projects SET name = ?1, root_path = COALESCE(?2, root_path), \
                     description = ?3, status = ?4, tech_stack = ?5, team_id = ?6, \
                     auto_pr_on_success = ?7, github_url = ?8, main_branch = ?9, \
                     test_env_url = ?10, test_env_branch = ?11, workspace_id = ?12, \
                     data_links = ?13, static_scan_config = ?14, standards_config = ?15, \
                     monitoring_project_slug = ?16, updated_at = ?17 \
                 WHERE id = ?18",
                rusqlite::params![
                    final_name,
                    root_for_update,
                    p.description,
                    p.status,
                    p.tech_stack,
                    team_id,
                    p.auto_pr_on_success,
                    p.github_url,
                    p.main_branch,
                    p.test_env_url,
                    p.test_env_branch,
                    workspace_id,
                    p.data_links,
                    p.static_scan_config,
                    p.standards_config,
                    p.monitoring_project_slug,
                    now,
                    existing_id,
                ],
                &format!("Project '{}' (replace)", p.name),
                warnings,
            );
            if !ok {
                return None;
            }
            // The children below re-insert under the surviving id; the
            // effective root path drives the folder warning + skills.
            insert_project_children(tx, p, &target_id, &map, strict, warnings);
            return Some((target_id, effective_root));
        }
        ProjectImportMode::Fresh | ProjectImportMode::Duplicate => {
            let ok = exec_row(
                tx,
                "INSERT INTO dev_projects \
                     (id, name, root_path, description, status, tech_stack, team_id, \
                      auto_pr_on_success, github_url, main_branch, test_env_url, \
                      test_env_branch, workspace_id, data_links, static_scan_config, \
                      standards_config, monitoring_project_slug, created_at, updated_at) \
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
                rusqlite::params![
                    target_id,
                    final_name,
                    final_root_path,
                    p.description,
                    p.status,
                    p.tech_stack,
                    team_id,
                    p.auto_pr_on_success,
                    p.github_url,
                    p.main_branch,
                    p.test_env_url,
                    p.test_env_branch,
                    workspace_id,
                    p.data_links,
                    p.static_scan_config,
                    p.standards_config,
                    p.monitoring_project_slug,
                    p.created_at,
                    p.updated_at,
                ],
                &format!("Project '{}'", p.name),
                warnings,
            );
            if !ok {
                return None;
            }
        }
    }

    insert_project_children(tx, p, &target_id, &map, strict, warnings);
    Some((target_id, final_root_path))
}

/// Insert a bundled project's full child graph under `project_id`, remapping
/// ids through `map`. Ordered FK-safe (groups → contexts → use cases → KPIs →
/// goals → …); every row failure degrades to a warning.
#[allow(clippy::too_many_lines)]
// `Option::is_none_or` is stable since 1.82.0 and the manifests declare
// `rust-version = "1.80.0"`. Nothing in this workspace actually requires
// 1.80 — all five crates are `publish = false` and CI pins no toolchain — so
// the honest fix is to correct the manifest, which is a policy call for the
// Director rather than this lane's to make. Allowed here, narrowly, until
// that decision lands. See the W0 clippy lane report.
#[allow(clippy::incompatible_msrv)]
pub(crate) fn insert_project_children(
    tx: &rusqlite::Transaction<'_>,
    p: &DevProjectExport,
    project_id: &str,
    map: &HashMap<String, String>,
    strict: bool,
    warnings: &mut Vec<String>,
) {
    let pname = p.name.as_str();

    for g in &p.context_groups {
        exec_row(
            tx,
            "INSERT INTO dev_context_groups (id, project_id, name, color, icon, group_type, \
                 position, health_score, last_scan_at, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &g.id),
                project_id,
                g.name,
                g.color,
                g.icon,
                g.group_type,
                g.position,
                g.health_score,
                g.last_scan_at,
                g.created_at,
                g.updated_at,
            ],
            &format!("Project '{pname}' context group '{}'", g.name),
            warnings,
        );
    }

    for c in &p.contexts {
        let group_id = remap_soft(
            map,
            &c.group_id,
            strict,
            warnings,
            &format!("Project '{pname}' context '{}'", c.name),
        );
        exec_row(
            tx,
            "INSERT INTO dev_contexts (id, project_id, group_id, name, description, file_paths, \
                 entry_points, db_tables, keywords, api_surface, cross_refs, tech_stack, \
                 category, business_feature, pinned, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
            rusqlite::params![
                remap_req(map, &c.id),
                project_id,
                group_id,
                c.name,
                c.description,
                c.file_paths,
                c.entry_points,
                c.db_tables,
                c.keywords,
                c.api_surface,
                c.cross_refs,
                c.tech_stack,
                c.category,
                c.business_feature,
                c.pinned,
                c.created_at,
                c.updated_at,
            ],
            &format!("Project '{pname}' context '{}'", c.name),
            warnings,
        );
    }

    for r in &p.context_group_relationships {
        exec_row(
            tx,
            "INSERT INTO dev_context_group_relationships (id, project_id, source_group_id, \
                 target_group_id, created_at) VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                remap_req(map, &r.id),
                project_id,
                remap_req(map, &r.source_group_id),
                remap_req(map, &r.target_group_id),
                r.created_at,
            ],
            &format!("Project '{pname}' context group relationship"),
            warnings,
        );
    }

    for f in &p.context_fingerprints {
        exec_row(
            tx,
            "INSERT INTO dev_context_fingerprints (project_id, context_id, content_hash, \
                 file_count, missing_file_count, imports, primitives, promise_all_count, \
                 join_all_count, await_count, sql_write_count, spawn_count, use_effect_count, \
                 set_state_after_await_count, exports_components, exports_hooks, \
                 exports_commands, exports_repo_fns, computed_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)",
            rusqlite::params![
                project_id,
                remap_req(map, &f.context_id),
                f.content_hash,
                f.file_count,
                f.missing_file_count,
                f.imports,
                f.primitives,
                f.promise_all_count,
                f.join_all_count,
                f.await_count,
                f.sql_write_count,
                f.spawn_count,
                f.use_effect_count,
                f.set_state_after_await_count,
                f.exports_components,
                f.exports_hooks,
                f.exports_commands,
                f.exports_repo_fns,
                f.computed_at,
            ],
            &format!("Project '{pname}' context fingerprint"),
            warnings,
        );
    }

    for uc in &p.use_cases {
        let primary = remap_soft(
            map,
            &uc.primary_context_id,
            strict,
            warnings,
            &format!("Project '{pname}' use case '{}'", uc.name),
        );
        exec_row(
            tx,
            "INSERT INTO dev_use_cases (id, project_id, name, slug, description, kind, \
                 primary_context_id, status, created_by, pinned, rationale, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            rusqlite::params![
                remap_req(map, &uc.id), project_id, uc.name, uc.slug, uc.description, uc.kind,
                primary, uc.status, uc.created_by, uc.pinned, uc.rationale,
                uc.created_at, uc.updated_at,
            ],
            &format!("Project '{pname}' use case '{}'", uc.name),
            warnings,
        );
    }

    for k in &p.kpis {
        let ctx_group = remap_soft(
            map,
            &k.context_group_id,
            strict,
            warnings,
            &format!("Project '{pname}' KPI '{}'", k.name),
        );
        let ctx = remap_soft(
            map,
            &k.context_id,
            strict,
            warnings,
            &format!("Project '{pname}' KPI '{}'", k.name),
        );
        let uc = remap_soft(
            map,
            &k.use_case_id,
            strict,
            warnings,
            &format!("Project '{pname}' KPI '{}'", k.name),
        );
        exec_row(
            tx,
            "INSERT INTO dev_kpis (id, project_id, context_group_id, context_id, use_case_id, \
                 name, description, category, measure_kind, measure_config, unit, direction, \
                 baseline_value, target_value, target_date, current_value, last_measured_at, \
                 cadence, status, created_by, rationale, needed_connector, metric_type, tier, \
                 warn_at, crit_at, manual_rating, assessment_pros, assessment_cons, \
                 last_skip_at, last_skip_rationale, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,\
                 ?21,?22,?23,?24,?25,?26,?27,?28,?29,?30,?31,?32,?33)",
            rusqlite::params![
                remap_req(map, &k.id),
                project_id,
                ctx_group,
                ctx,
                uc,
                k.name,
                k.description,
                k.category,
                k.measure_kind,
                k.measure_config,
                k.unit,
                k.direction,
                k.baseline_value,
                k.target_value,
                k.target_date,
                k.current_value,
                k.last_measured_at,
                k.cadence,
                k.status,
                k.created_by,
                k.rationale,
                k.needed_connector,
                k.metric_type,
                k.tier,
                k.warn_at,
                k.crit_at,
                k.manual_rating,
                k.assessment_pros,
                k.assessment_cons,
                k.last_skip_at,
                k.last_skip_rationale,
                k.created_at,
                k.updated_at,
            ],
            &format!("Project '{pname}' KPI '{}'", k.name),
            warnings,
        );
    }

    for m in &p.kpi_measurements {
        exec_row(
            tx,
            "INSERT INTO dev_kpi_measurements (id, kpi_id, value, measured_at, source, env, \
                 evidence, note) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                remap_req(map, &m.id),
                remap_req(map, &m.kpi_id),
                m.value,
                m.measured_at,
                m.source,
                m.env,
                m.evidence,
                m.note,
            ],
            &format!("Project '{pname}' KPI measurement"),
            warnings,
        );
    }

    // credential_id never travels — bindings land without a vault reference
    // only if the column allows it; a NOT NULL constraint degrades to a
    // per-row warning (the binding is a convenience, not core data).
    for b in &p.kpi_bindings {
        exec_row(
            tx,
            "INSERT INTO dev_kpi_bindings (id, kpi_id, credential_id, service_type, procedure, \
                 composed_by, status, verified_at, created_at) \
             VALUES (?1,?2,'',?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                remap_req(map, &b.id),
                remap_req(map, &b.kpi_id),
                b.service_type,
                b.procedure,
                b.composed_by,
                b.status,
                b.verified_at,
                b.created_at,
            ],
            &format!("Project '{pname}' KPI binding"),
            warnings,
        );
    }

    // Goals: parent_goal_id is a self-FK — insert parents before children.
    // A stuck pass (cycle or dangling parent) degrades to parent = NULL.
    {
        let mut remaining: Vec<&DevGoalExport> = p.goals.iter().collect();
        let mut inserted: std::collections::HashSet<&str> = std::collections::HashSet::new();
        let goal_ids: std::collections::HashSet<&str> =
            p.goals.iter().map(|g| g.id.as_str()).collect();
        loop {
            let before = remaining.len();
            let mut next = Vec::new();
            for g in remaining {
                let ready = g
                    .parent_goal_id
                    .as_deref()
                    .is_none_or(|pg| inserted.contains(pg) || !goal_ids.contains(pg));
                if !ready {
                    next.push(g);
                    continue;
                }
                let parent = remap_soft(
                    map,
                    &g.parent_goal_id,
                    strict,
                    warnings,
                    &format!("Project '{pname}' goal '{}'", g.title),
                );
                insert_goal_row(tx, project_id, g, map, parent, pname, warnings);
                inserted.insert(g.id.as_str());
            }
            if next.is_empty() {
                break;
            }
            if next.len() == before {
                for g in next {
                    warnings.push(format!(
                        "Project '{pname}' goal '{}': parent chain unresolvable; imported without parent",
                        g.title
                    ));
                    insert_goal_row(tx, project_id, g, map, None, pname, warnings);
                }
                break;
            }
            remaining = next;
        }
    }

    for d in &p.goal_dependencies {
        exec_row(
            tx,
            "INSERT INTO dev_goal_dependencies (id, goal_id, depends_on_id, dependency_type, created_at) \
             VALUES (?1,?2,?3,?4,?5)",
            rusqlite::params![
                remap_req(map, &d.id), remap_req(map, &d.goal_id),
                remap_req(map, &d.depends_on_id), d.dependency_type, d.created_at,
            ],
            &format!("Project '{pname}' goal dependency"),
            warnings,
        );
    }

    for s in &p.goal_signals {
        exec_row(
            tx,
            "INSERT INTO dev_goal_signals (id, goal_id, signal_type, source_id, delta, message, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                remap_req(map, &s.id), remap_req(map, &s.goal_id), s.signal_type,
                // source_id points outside the bundled graph (runs/scans) —
                // always kept as-is.
                s.source_id, s.delta, s.message, s.created_at,
            ],
            &format!("Project '{pname}' goal signal"),
            warnings,
        );
    }

    for i in &p.goal_items {
        exec_row(
            tx,
            "INSERT INTO dev_goal_items (id, goal_id, title, done, order_index, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7)",
            rusqlite::params![
                remap_req(map, &i.id), remap_req(map, &i.goal_id), i.title, i.done,
                i.order_index, i.created_at, i.updated_at,
            ],
            &format!("Project '{pname}' goal item"),
            warnings,
        );
    }

    for i in &p.ideas {
        let ctx = remap_soft(
            map,
            &i.context_id,
            strict,
            warnings,
            &format!("Project '{pname}' idea '{}'", i.title),
        );
        let uc = remap_soft(
            map,
            &i.use_case_id,
            strict,
            warnings,
            &format!("Project '{pname}' idea '{}'", i.title),
        );
        exec_row(
            tx,
            "INSERT INTO dev_ideas (id, project_id, context_id, scan_type, category, title, \
                 description, reasoning, status, effort, impact, risk, priority, provider, \
                 model, rejection_reason, origin, use_case_id, evidence, dedup_key, \
                 verify_state, verify_checked_at, verify_evidence, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,\
                 ?21,?22,?23,?24,?25)",
            rusqlite::params![
                remap_req(map, &i.id),
                project_id,
                ctx,
                i.scan_type,
                i.category,
                i.title,
                i.description,
                i.reasoning,
                i.status,
                i.effort,
                i.impact,
                i.risk,
                i.priority,
                i.provider,
                i.model,
                i.rejection_reason,
                i.origin,
                uc,
                i.evidence,
                i.dedup_key,
                i.verify_state,
                i.verify_checked_at,
                i.verify_evidence,
                i.created_at,
                i.updated_at,
            ],
            &format!("Project '{pname}' idea '{}'", i.title),
            warnings,
        );
    }

    for t in &p.tasks {
        let src_idea = remap_soft(
            map,
            &t.source_idea_id,
            strict,
            warnings,
            &format!("Project '{pname}' task '{}'", t.title),
        );
        let goal = remap_soft(
            map,
            &t.goal_id,
            strict,
            warnings,
            &format!("Project '{pname}' task '{}'", t.title),
        );
        let parent = remap_soft(
            map,
            &t.parent_task_id,
            strict,
            warnings,
            &format!("Project '{pname}' task '{}'", t.title),
        );
        exec_row(
            tx,
            // `updated_at` is derived, not carried: the export format predates the
            // column, so an imported task gets the same COALESCE the migration
            // backfills with rather than a NULL (invisible to the staleness
            // engine) or a fake `now` (every imported task looks freshly touched).
            "INSERT INTO dev_tasks (id, project_id, title, description, source_idea_id, goal_id, \
                 status, session_id, progress_pct, output_lines, error, depth, parent_task_id, \
                 attempt, started_at, completed_at, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,\
                 COALESCE(?16,?15,?17))",
            rusqlite::params![
                remap_req(map, &t.id),
                project_id,
                t.title,
                t.description,
                src_idea,
                goal,
                t.status,
                t.session_id,
                t.progress_pct,
                t.output_lines,
                t.error,
                t.depth,
                parent,
                t.attempt,
                t.started_at,
                t.completed_at,
                t.created_at,
            ],
            &format!("Project '{pname}' task '{}'", t.title),
            warnings,
        );
    }

    for c in &p.competitions {
        let src_idea = remap_soft(
            map,
            &c.source_idea_id,
            strict,
            warnings,
            &format!("Project '{pname}' competition '{}'", c.task_title),
        );
        let src_goal = remap_soft(
            map,
            &c.source_goal_id,
            strict,
            warnings,
            &format!("Project '{pname}' competition '{}'", c.task_title),
        );
        let winner = remap_soft(
            map,
            &c.winner_task_id,
            strict,
            warnings,
            &format!("Project '{pname}' competition '{}'", c.task_title),
        );
        exec_row(
            tx,
            "INSERT INTO dev_competitions (id, project_id, task_title, task_description, \
                 source_idea_id, source_goal_id, slot_count, status, winner_task_id, \
                 winner_insight, baseline_json, reviewer_notes, worktree_base_ref, created_at, \
                 resolved_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
            rusqlite::params![
                remap_req(map, &c.id),
                project_id,
                c.task_title,
                c.task_description,
                src_idea,
                src_goal,
                c.slot_count,
                c.status,
                winner,
                c.winner_insight,
                c.baseline_json,
                c.reviewer_notes,
                c.worktree_base_ref,
                c.created_at,
                c.resolved_at,
            ],
            &format!("Project '{pname}' competition '{}'", c.task_title),
            warnings,
        );
    }

    for s in &p.competition_slots {
        exec_row(
            tx,
            "INSERT INTO dev_competition_slots (id, competition_id, task_id, strategy_label, \
                 strategy_prompt, worktree_name, branch_name, slot_index, disqualified, \
                 disqualify_reason, diff_hash, diff_stats_json, diff_analyzed_at, created_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14)",
            rusqlite::params![
                remap_req(map, &s.id),
                remap_req(map, &s.competition_id),
                remap_req(map, &s.task_id),
                s.strategy_label,
                s.strategy_prompt,
                s.worktree_name,
                s.branch_name,
                s.slot_index,
                s.disqualified,
                s.disqualify_reason,
                s.diff_hash,
                s.diff_stats_json,
                s.diff_analyzed_at,
                s.created_at,
            ],
            &format!("Project '{pname}' competition slot"),
            warnings,
        );
    }

    for r in &p.triage_rules {
        exec_row(
            tx,
            "INSERT INTO dev_triage_rules (id, project_id, name, conditions, action, enabled, \
                 times_fired, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            rusqlite::params![
                remap_req(map, &r.id),
                project_id,
                r.name,
                r.conditions,
                r.action,
                r.enabled,
                r.times_fired,
                r.created_at,
            ],
            &format!("Project '{pname}' triage rule '{}'", r.name),
            warnings,
        );
    }

    for pl in &p.pipelines {
        exec_row(
            tx,
            "INSERT INTO dev_pipelines (id, project_id, idea_id, task_id, stage, auto_execute, \
                 verify_after, verification_scan_id, error, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &pl.id),
                project_id,
                remap_req(map, &pl.idea_id),
                remap_soft(
                    map,
                    &pl.task_id,
                    strict,
                    warnings,
                    &format!("Project '{pname}' pipeline")
                ),
                pl.stage,
                pl.auto_execute,
                pl.verify_after,
                // Scans don't travel — verification_scan_id stays as-is.
                pl.verification_scan_id,
                pl.error,
                pl.created_at,
                pl.updated_at,
            ],
            &format!("Project '{pname}' pipeline"),
            warnings,
        );
    }

    for s in &p.standards {
        exec_row(
            tx,
            "INSERT INTO dev_standards (id, project_id, scan_id, rule_key, category, title, \
                 status, severity, evidence, recommendation, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
            rusqlite::params![
                remap_req(map, &s.id),
                project_id,
                // Scans don't travel — scan_id stays as-is.
                s.scan_id,
                s.rule_key,
                s.category,
                s.title,
                s.status,
                s.severity,
                s.evidence,
                s.recommendation,
                s.created_at,
                s.updated_at,
            ],
            &format!("Project '{pname}' standard '{}'", s.rule_key),
            warnings,
        );
    }

    for ucc in &p.use_case_contexts {
        exec_row(
            tx,
            "INSERT OR IGNORE INTO dev_use_case_contexts (use_case_id, context_id) VALUES (?1,?2)",
            rusqlite::params![
                remap_req(map, &ucc.use_case_id),
                remap_req(map, &ucc.context_id),
            ],
            &format!("Project '{pname}' use case context pair"),
            warnings,
        );
    }

    for m in &p.milestones {
        exec_row(
            tx,
            "INSERT INTO dev_milestones (id, project_id, name, goal, status, order_index, \
                 target_date, cut_at, shipped_at, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &m.id),
                project_id,
                m.name,
                m.goal,
                m.status,
                m.order_index,
                m.target_date,
                m.cut_at,
                m.shipped_at,
                m.created_at,
                m.updated_at,
            ],
            &format!("Project '{pname}' milestone '{}'", m.name),
            warnings,
        );
    }

    for mi in &p.milestone_items {
        // item_id is polymorphic (use_case | goal) and NOT NULL: remap when
        // mappable, otherwise keep the original id (orphans are swept at read
        // time by design) with a warning in duplicate mode.
        let item_id = match map.get(&mi.item_id) {
            Some(n) => n.clone(),
            None => {
                if strict {
                    warnings.push(format!(
                        "Project '{pname}' milestone item ({} '{}'): unresolved reference kept as-is",
                        mi.item_kind, mi.item_id
                    ));
                }
                mi.item_id.clone()
            }
        };
        exec_row(
            tx,
            "INSERT OR IGNORE INTO dev_milestone_items (milestone_id, item_kind, item_id, \
                 bucket, added_after_cut, order_index, created_at, description, rating) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            rusqlite::params![
                remap_req(map, &mi.milestone_id),
                mi.item_kind,
                item_id,
                mi.bucket,
                mi.added_after_cut,
                mi.order_index,
                mi.created_at,
                mi.description,
                mi.rating,
            ],
            &format!("Project '{pname}' milestone item"),
            warnings,
        );
    }

    for m in &p.memories {
        exec_row(
            tx,
            "INSERT INTO dev_memories (id, project_id, category, title, content, importance, \
                 source_kind, source_id, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
            rusqlite::params![
                remap_req(map, &m.id),
                project_id,
                m.category,
                m.title,
                m.content,
                m.importance,
                // source_id points at runs/tasks in the source workspace —
                // advisory, kept as-is.
                m.source_kind,
                m.source_id,
                m.created_at,
                m.updated_at,
            ],
            &format!("Project '{pname}' memory '{}'", m.title),
            warnings,
        );
    }

    for n in &p.memory_nodes {
        let ctx = remap_soft(
            map,
            &n.context_id,
            strict,
            warnings,
            &format!("Project '{pname}' memory node '{}'", n.title),
        );
        exec_row(
            tx,
            "INSERT INTO memory_nodes (id, project_id, context_id, kind, title, body, source, \
                 status, content_hash, created_at, updated_at) \
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
            rusqlite::params![
                remap_req(map, &n.id),
                project_id,
                ctx,
                n.kind,
                n.title,
                n.body,
                n.source,
                n.status,
                n.content_hash,
                n.created_at,
                n.updated_at,
            ],
            &format!("Project '{pname}' memory node '{}'", n.title),
            warnings,
        );
    }

    for e in &p.memory_edges {
        exec_row(
            tx,
            "INSERT OR IGNORE INTO memory_edges (from_id, to_id, rel, created_at) VALUES (?1,?2,?3,?4)",
            rusqlite::params![
                remap_req(map, &e.from_id), remap_req(map, &e.to_id), e.rel, e.created_at,
            ],
            &format!("Project '{pname}' memory edge"),
            warnings,
        );
    }
}

pub(crate) fn insert_goal_row(
    tx: &rusqlite::Transaction<'_>,
    project_id: &str,
    g: &DevGoalExport,
    map: &HashMap<String, String>,
    parent: Option<String>,
    pname: &str,
    warnings: &mut Vec<String>,
) {
    // context_id / kpi_id are soft TEXT columns (no FK): remap when possible,
    // keep as-is otherwise (identity modes) — the strict handling happened at
    // the call site for parent; these two follow remap_req-with-keep semantics
    // because they always ride inside the same bundle.
    let context_id = g.context_id.as_deref().map(|id| remap_req(map, id));
    let kpi_id = g.kpi_id.as_deref().map(|id| remap_req(map, id));
    exec_row(
        tx,
        "INSERT INTO dev_goals (id, project_id, parent_goal_id, context_id, kpi_id, order_index, \
             title, description, status, progress, target_date, started_at, completed_at, \
             created_at, updated_at) \
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)",
        rusqlite::params![
            remap_req(map, &g.id),
            project_id,
            parent,
            context_id,
            kpi_id,
            g.order_index,
            g.title,
            g.description,
            g.status,
            g.progress,
            g.target_date,
            g.started_at,
            g.completed_at,
            g.created_at,
            g.updated_at,
        ],
        &format!("Project '{pname}' goal '{}'", g.title),
        warnings,
    );
}
