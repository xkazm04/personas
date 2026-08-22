#[cfg(test)]
mod tests {
    use crate::commands::core::data_portability::*;
    use crate::db::init_test_db;

    fn empty_bundle() -> PortabilityBundle {
        PortabilityBundle {
            format_version: 2,
            exported_at: "2026-05-28T00:00:00Z".into(),
            app_version: "test".into(),
            scope: ExportScope::Full,
            personas: Vec::new(),
            tool_definitions: Vec::new(),
            teams: Vec::new(),
            credentials: Vec::new(),
            kpis: Vec::new(),
            dev_projects: Vec::new(),
            workspace_knowledge: Vec::new(),
            twins: Vec::new(),
            athena: None,
            export_warnings: Vec::new(),
            encrypted_credentials: None,
            encrypted_twins: None,
            encrypted_athena: None,
        }
    }

    fn team_with_memories(memories: Vec<TeamMemoryExport>) -> TeamExport {
        TeamExport {
            id: "old-team-1".into(),
            name: "Squad".into(),
            description: None,
            canvas_data: None,
            team_config: None,
            icon: None,
            members: Vec::new(),
            connections: Vec::new(),
            memories,
        }
    }

    #[test]
    fn import_bundle_recreates_team_memories_under_new_team_id() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        bundle.teams.push(team_with_memories(vec![
            TeamMemoryExport {
                title: "Pricing rule".into(),
                content: "Always round up".into(),
                category: "decision".into(),
                importance: 7,
                tags: Some("manual".into()),
            },
            TeamMemoryExport {
                title: "Customer note".into(),
                content: "VIP threshold $1k".into(),
                category: "observation".into(),
                importance: 4,
                tags: None,
            },
        ]));

        let result =
            import_bundle(&pool, None, &bundle, &HashMap::new()).expect("import must succeed");
        assert_eq!(result.teams_created, 1);
        assert_eq!(result.team_memories_created, 2);

        let new_team_id = result
            .id_mapping
            .get("old-team-1")
            .expect("team id should be remapped");
        let count =
            team_memory_repo::get_total_count(&pool, new_team_id, None, None, None).unwrap();
        assert_eq!(count, 2);

        let rows =
            team_memory_repo::get_all(&pool, new_team_id, None, None, None, Some(50), Some(0))
                .unwrap();
        // Provenance is intentionally nulled — imported memories are manual.
        assert!(rows
            .iter()
            .all(|m| m.run_id.is_none() && m.member_id.is_none() && m.persona_id.is_none()));
        assert!(rows.iter().any(|m| m.importance == 7));
    }

    #[test]
    fn import_bundle_with_empty_team_memories_creates_none() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        bundle.teams.push(team_with_memories(Vec::new()));

        let result =
            import_bundle(&pool, None, &bundle, &HashMap::new()).expect("import must succeed");
        assert_eq!(result.teams_created, 1);
        assert_eq!(result.team_memories_created, 0);
    }

    #[test]
    fn validate_bundle_rejects_too_many_team_memories() {
        let mut bundle = empty_bundle();
        let memories = (0..=MAX_TEAM_MEMORIES_PER_TEAM)
            .map(|i| TeamMemoryExport {
                title: format!("m{i}"),
                content: "c".into(),
                category: "observation".into(),
                importance: 3,
                tags: None,
            })
            .collect();
        bundle.teams.push(team_with_memories(memories));
        assert!(validate_bundle(&bundle).is_err());
    }

    #[test]
    fn validate_bundle_rejects_empty_team_memory_title() {
        let mut bundle = empty_bundle();
        bundle.teams.push(team_with_memories(vec![TeamMemoryExport {
            title: "   ".into(),
            content: "c".into(),
            category: "observation".into(),
            importance: 3,
            tags: None,
        }]));
        assert!(validate_bundle(&bundle).is_err());
    }

    #[test]
    fn portable_team_memory_tags_strips_revision_history() {
        let with_revisions = Some(r#"{"source":"auto","revisions":[{"title":"old"}]}"#.to_string());
        assert_eq!(
            portable_team_memory_tags(&with_revisions),
            Some("auto".into())
        );

        let empty_source = Some(r#"{"source":"","revisions":[]}"#.to_string());
        assert_eq!(portable_team_memory_tags(&empty_source), None);

        let plain = Some("manual".to_string());
        assert_eq!(portable_team_memory_tags(&plain), Some("manual".into()));

        assert_eq!(portable_team_memory_tags(&None), None);
    }

    fn kpi_export(name: &str, measurements: Vec<KpiMeasurementExport>) -> KpiExport {
        KpiExport {
            name: name.into(),
            description: Some("desc".into()),
            category: "quality".into(),
            measure_kind: "manual".into(),
            measure_config: "{}".into(),
            unit: "pct".into(),
            direction: "up".into(),
            baseline_value: Some(10.0),
            target_value: Some(90.0),
            target_date: None,
            cadence: "weekly".into(),
            status: "active".into(),
            tier: "primary".into(),
            rationale: Some("why".into()),
            needed_connector: None,
            metric_type: None,
            warn_at: Some(40.0),
            crit_at: Some(20.0),
            measurements,
        }
    }

    #[test]
    fn import_bundle_lands_kpis_paused_in_imported_project_with_history() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        // Measurements are exported newest-first; the head seeds current state.
        bundle.kpis.push(kpi_export(
            "Coverage",
            vec![
                KpiMeasurementExport {
                    value: 72.0,
                    measured_at: "2026-06-19T10:00:00Z".into(),
                    source: "manual".into(),
                    evidence: None,
                    note: None,
                },
                KpiMeasurementExport {
                    value: 65.0,
                    measured_at: "2026-06-12T10:00:00Z".into(),
                    source: "evaluator".into(),
                    evidence: None,
                    note: None,
                },
            ],
        ));

        let result =
            import_bundle(&pool, None, &bundle, &HashMap::new()).expect("import must succeed");
        assert_eq!(result.kpis_created, 1);

        let conn = pool.get().unwrap();
        let project_id: String = conn
            .query_row(
                "SELECT id FROM dev_projects WHERE name = 'Imported'",
                [],
                |r| r.get(0),
            )
            .expect("dedicated Imported project should exist");

        let kpis = dev_tools_repo::list_kpis(&pool, &project_id, None).unwrap();
        assert_eq!(kpis.len(), 1);
        let k = &kpis[0];
        assert_eq!(k.name, "Coverage");
        // Always dormant on import, regardless of the source 'active' status.
        assert_eq!(k.status, "paused");
        assert_eq!(k.tier, "primary");
        assert_eq!(k.warn_at, Some(40.0));
        assert_eq!(k.crit_at, Some(20.0));
        // Newest measurement seeds current_value/last_measured_at.
        assert_eq!(k.current_value, Some(72.0));
        assert_eq!(k.last_measured_at.as_deref(), Some("2026-06-19T10:00:00Z"));

        let measurements = dev_tools_repo::list_kpi_measurements(&pool, &k.id, Some(100)).unwrap();
        assert_eq!(measurements.len(), 2);
    }

    #[test]
    fn import_bundle_dedups_kpis_by_name_on_reimport() {
        let pool = init_test_db().unwrap();
        let mut bundle = empty_bundle();
        bundle.kpis.push(kpi_export("Coverage", Vec::new()));

        assert_eq!(
            import_bundle(&pool, None, &bundle, &HashMap::new())
                .unwrap()
                .kpis_created,
            1
        );
        // Second import reuses the Imported project and skips the duplicate.
        assert_eq!(
            import_bundle(&pool, None, &bundle, &HashMap::new())
                .unwrap()
                .kpis_created,
            0
        );

        let conn = pool.get().unwrap();
        let kpi_count: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_kpis", [], |r| r.get(0))
            .unwrap();
        assert_eq!(kpi_count, 1);
        let project_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_projects WHERE name = 'Imported'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(project_count, 1);
    }

    #[test]
    fn validate_bundle_rejects_too_many_kpi_measurements() {
        let mut bundle = empty_bundle();
        let measurements = (0..=MAX_KPI_MEASUREMENTS)
            .map(|i| KpiMeasurementExport {
                value: i as f64,
                measured_at: "2026-06-19T10:00:00Z".into(),
                source: "manual".into(),
                evidence: None,
                note: None,
            })
            .collect();
        bundle.kpis.push(kpi_export("Coverage", measurements));
        assert!(validate_bundle(&bundle).is_err());
    }

    // ------------------------------------------------------------------
    // Dev-tools export (WP1 — export side)
    // ------------------------------------------------------------------

    /// Insert a dev project row with every credential-id column populated so
    /// the stripping assertion below has something real to strip.
    fn seed_dev_project(pool: &DbPool, id: &str, root_path: &str) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, description, status, tech_stack, \
                 team_id, auto_pr_on_success, github_url, \
                 main_branch, monitoring_credential_id, llm_tracking_credential_id, \
                 support_credential_id, pr_credential_id, monitoring_project_slug) \
             VALUES (?1, ?2, ?3, 'a project', 'paused', 'rust+react', 'team-x', 1, \
                 'https://github.com/x/y', 'main', \
                 'cred-mon', 'cred-llm', 'cred-sup', 'cred-pr', 'proj-slug')",
            rusqlite::params![id, format!("Project {id}"), root_path],
        )
        .unwrap();
    }

    fn seed_dev_project_graph(pool: &DbPool, pid: &str) {
        let conn = pool.get().unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO dev_goals (id, project_id, title, status) VALUES ('g1-{pid}', '{pid}', 'Goal one', 'open');
             INSERT INTO dev_goals (id, project_id, title, status) VALUES ('g2-{pid}', '{pid}', 'Goal two', 'open');
             INSERT INTO dev_goal_dependencies (id, goal_id, depends_on_id) VALUES ('gd1-{pid}', 'g2-{pid}', 'g1-{pid}');
             INSERT INTO dev_goal_items (id, goal_id, title, done) VALUES ('gi1-{pid}', 'g1-{pid}', 'todo', 1);
             INSERT INTO dev_context_groups (id, project_id, name) VALUES ('cg1-{pid}', '{pid}', 'Core');
             INSERT INTO dev_contexts (id, project_id, group_id, name, file_paths) VALUES ('c1-{pid}', '{pid}', 'cg1-{pid}', 'Auth', '[\"src/a.ts\"]');
             INSERT INTO dev_ideas (id, project_id, context_id, scan_type, title, status) VALUES ('i1-{pid}', '{pid}', 'c1-{pid}', 'feature', 'An idea', 'pending');
             INSERT INTO dev_tasks (id, project_id, title, status) VALUES ('t1-{pid}', '{pid}', 'A task', 'queued');
             INSERT INTO dev_use_cases (id, project_id, name, slug) VALUES ('uc1-{pid}', '{pid}', 'Login', 'login');
             INSERT INTO dev_use_case_contexts (use_case_id, context_id) VALUES ('uc1-{pid}', 'c1-{pid}');
             INSERT INTO dev_milestones (id, project_id, name, status) VALUES ('m1-{pid}', '{pid}', 'M1', 'active');
             INSERT INTO dev_milestone_items (milestone_id, item_kind, item_id, description, rating) VALUES ('m1-{pid}', 'use_case', 'uc1-{pid}', 'why it is core', 4);
             INSERT INTO dev_kpis (id, project_id, name, status) VALUES ('k1-{pid}', '{pid}', 'Coverage', 'active');
             INSERT INTO dev_kpi_measurements (id, kpi_id, value, source, env) VALUES ('km1-{pid}', 'k1-{pid}', 42.0, 'manual', 'local');
             INSERT INTO dev_kpi_bindings (id, kpi_id, credential_id, service_type, procedure) VALUES ('kb1-{pid}', 'k1-{pid}', 'cred-bind', 'sentry', 'count errors');
             INSERT INTO dev_memories (id, project_id, title, content) VALUES ('dm1-{pid}', '{pid}', 'Learned', 'a fact');
             INSERT INTO memory_nodes (id, project_id, title) VALUES ('n1-{pid}', '{pid}', 'Node one');
             INSERT INTO memory_nodes (id, project_id, title) VALUES ('n2-{pid}', '{pid}', 'Node two');
             INSERT INTO memory_edges (from_id, to_id, rel) VALUES ('n1-{pid}', 'n2-{pid}', 'relates');"
        ))
        .unwrap();
    }

    fn seed_workspace_with_knowledge(pool: &DbPool, wid: &str) {
        let conn = pool.get().unwrap();
        conn.execute_batch(&format!(
            "INSERT INTO dev_workspaces (id, name, color, created_at, updated_at)
                VALUES ('{wid}', 'Shared WS', '#fff', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, status, dedup_key, confidence, created_at, updated_at)
                VALUES ('kn-obs-{wid}', '{wid}', 'pattern', 'Observed one', 'Do X', 'observed', 'dk1', 0.7, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, status, created_at, updated_at)
                VALUES ('kn-ado-{wid}', '{wid}', 'pitfall', 'Adopted one', 'Never Y', 'adopted', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
             INSERT INTO workspace_knowledge (id, workspace_id, kind, title, statement, status, created_at, updated_at)
                VALUES ('kn-rej-{wid}', '{wid}', 'fact', 'Rejected one', 'Z is true', 'rejected', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');"
        ))
        .unwrap();
    }

    #[test]
    fn export_full_includes_dev_project_graph_and_skills() {
        let pool = init_test_db().unwrap();

        // Real skills dir: a directory skill (SKILL.md + provenance sidecar +
        // an oversize file, both of which must NOT travel) and a single-file
        // skill.
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join(".claude").join("skills").join("foo");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# Foo skill\nbody").unwrap();
        std::fs::write(skill_dir.join(SKILL_PROVENANCE_FILE), "{\"local\":true}").unwrap();
        std::fs::write(skill_dir.join("huge.md"), "a".repeat(300 * 1024)).unwrap();
        std::fs::write(
            tmp.path().join(".claude").join("skills").join("bar.md"),
            "# Bar skill",
        )
        .unwrap();

        seed_dev_project(&pool, "p1", &tmp.path().to_string_lossy());
        seed_dev_project_graph(&pool, "p1");

        let bundle = build_export_bundle(
            &pool,
            None,
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        assert_eq!(bundle.dev_projects.len(), 1);
        let p = &bundle.dev_projects[0];
        assert_eq!(p.id, "p1");
        assert_eq!(p.monitoring_project_slug.as_deref(), Some("proj-slug"));
        assert_eq!(p.status, "paused");
        assert_eq!(p.tech_stack.as_deref(), Some("rust+react"));
        assert_eq!(p.team_id.as_deref(), Some("team-x"));
        assert!(p.auto_pr_on_success);
        assert_eq!(p.goals.len(), 2);
        assert_eq!(p.goal_dependencies.len(), 1);
        assert_eq!(p.goal_items.len(), 1);
        assert!(p.goal_items[0].done);
        assert_eq!(p.context_groups.len(), 1);
        assert_eq!(p.contexts.len(), 1);
        assert_eq!(p.ideas.len(), 1);
        assert_eq!(p.tasks.len(), 1);
        assert_eq!(p.use_cases.len(), 1);
        assert_eq!(p.use_case_contexts.len(), 1);
        assert_eq!(p.milestones.len(), 1);
        assert_eq!(p.milestone_items.len(), 1);
        assert_eq!(p.kpis.len(), 1);
        assert_eq!(p.kpi_measurements.len(), 1);
        assert_eq!(p.kpi_bindings.len(), 1);
        assert_eq!(p.memories.len(), 1);
        assert_eq!(p.memory_nodes.len(), 2);
        assert_eq!(p.memory_edges.len(), 1);

        // Skills: sorted by name; provenance sidecar + oversize file skipped.
        assert_eq!(p.skills.len(), 2);
        assert_eq!(p.skills[0].name, "bar");
        assert_eq!(p.skills[1].name, "foo");
        let foo = &p.skills[1];
        assert_eq!(foo.files.len(), 1);
        assert_eq!(foo.files[0].rel_path, "SKILL.md");
        assert!(!foo.content_hash.is_empty());

        // Credential ids never travel — neither the project's four columns
        // nor the KPI binding's vault reference.
        let json = serde_json::to_string(&bundle).unwrap();
        assert!(!json.contains("cred-mon"));
        assert!(!json.contains("cred-llm"));
        assert!(!json.contains("cred-sup"));
        assert!(!json.contains("cred-pr"));
        assert!(!json.contains("cred-bind"));
        assert!(!json.contains("credential_id"));

        // Round-trip: the bundle re-parses with the dev sections intact, and
        // a legacy bundle without them still deserializes (serde defaults).
        let reparsed: PortabilityBundle = serde_json::from_str(&json).unwrap();
        assert_eq!(reparsed.dev_projects.len(), 1);
        assert_eq!(reparsed.dev_projects[0].kpi_bindings.len(), 1);
        assert_eq!(reparsed.dev_projects[0].status, "paused");
        assert_eq!(
            reparsed.dev_projects[0].tech_stack.as_deref(),
            Some("rust+react")
        );
        assert_eq!(reparsed.dev_projects[0].team_id.as_deref(), Some("team-x"));
        assert!(reparsed.dev_projects[0].auto_pr_on_success);
        let legacy: PortabilityBundle = serde_json::from_str(
            r#"{"format_version":2,"exported_at":"x","app_version":"x","scope":"full",
                "personas":[],"tool_definitions":[],"teams":[],"credentials":[]}"#,
        )
        .unwrap();
        assert!(legacy.dev_projects.is_empty());
        assert!(legacy.workspace_knowledge.is_empty());
    }

    #[test]
    fn export_selective_scopes_dev_projects_and_workspaces() {
        let pool = init_test_db().unwrap();
        seed_dev_project(&pool, "p1", "/tmp/portability-p1");
        seed_dev_project(&pool, "p2", "/tmp/portability-p2");
        seed_workspace_with_knowledge(&pool, "w1");

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: vec!["p1".into()],
            workspace_ids: Vec::new(),
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle =
            build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include)
                .unwrap();
        assert_eq!(bundle.dev_projects.len(), 1);
        assert_eq!(bundle.dev_projects[0].id, "p1");
        // Empty workspace selection means none travel.
        assert!(bundle.workspace_knowledge.is_empty());

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: vec!["w1".into()],
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle =
            build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include)
                .unwrap();
        assert!(bundle.dev_projects.is_empty());
        assert_eq!(bundle.workspace_knowledge.len(), 1);
        assert_eq!(bundle.workspace_knowledge[0].id, "w1");
    }

    #[test]
    fn workspace_knowledge_keeps_statuses_and_filters_adoption_to_bundled_projects() {
        let pool = init_test_db().unwrap();
        seed_dev_project(&pool, "p1", "/tmp/portability-wp1");
        seed_dev_project(&pool, "p2", "/tmp/portability-wp2");
        seed_workspace_with_knowledge(&pool, "w1");
        {
            let conn = pool.get().unwrap();
            conn.execute_batch(
                "INSERT INTO workspace_practice_adoption (practice_id, project_id, state, note, updated_at)
                    VALUES ('kn-ado-w1', 'p1', 'adopted', 'in use', '2026-01-01T00:00:00Z');
                 INSERT INTO workspace_practice_adoption (practice_id, project_id, state, updated_at)
                    VALUES ('kn-ado-w1', 'p2', 'proposed', '2026-01-01T00:00:00Z');",
            )
            .unwrap();
        }

        // Only p1 travels — the p2 adoption cell must be filtered out.
        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: vec!["p1".into()],
            workspace_ids: vec!["w1".into()],
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle =
            build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include)
                .unwrap();
        assert_eq!(bundle.workspace_knowledge.len(), 1);
        let w = &bundle.workspace_knowledge[0];
        assert_eq!(w.knowledge.len(), 3);
        let statuses: std::collections::HashSet<&str> =
            w.knowledge.iter().map(|k| k.status.as_str()).collect();
        assert_eq!(
            statuses,
            ["observed", "adopted", "rejected"].into_iter().collect()
        );
        // Lifecycle columns survive.
        let observed = w.knowledge.iter().find(|k| k.status == "observed").unwrap();
        assert_eq!(observed.dedup_key.as_deref(), Some("dk1"));
        assert_eq!(observed.confidence, Some(0.7));

        assert_eq!(w.adoption.len(), 1);
        assert_eq!(w.adoption[0].project_id, "p1");
        assert_eq!(w.adoption[0].state, "adopted");
        assert_eq!(w.adoption[0].note.as_deref(), Some("in use"));
    }

    #[test]
    fn compute_export_stats_counts_dev_projects_and_knowledge() {
        let pool = init_test_db().unwrap();
        seed_dev_project(&pool, "p1", "/tmp/portability-sp1");
        seed_dev_project(&pool, "p2", "/tmp/portability-sp2");
        seed_workspace_with_knowledge(&pool, "w1");

        let stats = compute_export_stats(&pool, None).unwrap();
        assert_eq!(stats.dev_project_count, 2);
        assert_eq!(stats.workspace_knowledge_count, 3);
    }

    fn minimal_dev_project(id: &str) -> DevProjectExport {
        DevProjectExport {
            id: id.into(),
            name: format!("P {id}"),
            root_path: format!("/tmp/{id}"),
            description: None,
            status: "active".into(),
            tech_stack: None,
            team_id: None,
            auto_pr_on_success: false,
            github_url: None,
            main_branch: None,
            test_env_url: None,
            test_env_branch: None,
            workspace_id: None,
            data_links: None,
            static_scan_config: None,
            standards_config: None,
            monitoring_project_slug: None,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            goals: Vec::new(),
            goal_dependencies: Vec::new(),
            goal_signals: Vec::new(),
            goal_items: Vec::new(),
            context_groups: Vec::new(),
            contexts: Vec::new(),
            context_group_relationships: Vec::new(),
            context_fingerprints: Vec::new(),
            ideas: Vec::new(),
            tasks: Vec::new(),
            competitions: Vec::new(),
            competition_slots: Vec::new(),
            triage_rules: Vec::new(),
            pipelines: Vec::new(),
            standards: Vec::new(),
            use_cases: Vec::new(),
            use_case_contexts: Vec::new(),
            milestones: Vec::new(),
            milestone_items: Vec::new(),
            kpis: Vec::new(),
            kpi_measurements: Vec::new(),
            kpi_bindings: Vec::new(),
            memories: Vec::new(),
            memory_nodes: Vec::new(),
            memory_edges: Vec::new(),
            skills: Vec::new(),
        }
    }

    #[test]
    fn validate_bundle_rejects_too_many_dev_projects() {
        let mut bundle = empty_bundle();
        for i in 0..=MAX_DEV_PROJECTS {
            bundle
                .dev_projects
                .push(minimal_dev_project(&format!("p{i}")));
        }
        assert!(validate_bundle(&bundle).is_err());
    }

    // ------------------------------------------------------------------
    // Dev-tools import (WP2 — import side)
    // ------------------------------------------------------------------

    fn empty_import_result() -> PortabilityImportResult {
        PortabilityImportResult {
            personas_created: 0,
            teams_created: 0,
            tools_created: 0,
            credentials_created: 0,
            team_memories_created: 0,
            kpis_created: 0,
            projects_imported: 0,
            projects_skipped: 0,
            knowledge_imported: 0,
            knowledge_skipped_duplicates: 0,
            skills_written: 0,
            skills_deferred: 0,
            twins_imported: 0,
            twins_skipped: 0,
            twin_kb_chunks_imported: 0,
            athena_memory_imported: 0,
            athena_identity_replaced: false,
            reembed_queued: 0,
            import_conflicts: Vec::new(),
            bundle_file_path: None,
            warnings: Vec::new(),
            id_mapping: HashMap::new(),
            pending_kb_reindex: Vec::new(),
        }
    }

    /// Export a seeded source DB (project graph + workspace + adoption) into a
    /// bundle for the import tests.
    fn source_bundle(root_path: &str) -> PortabilityBundle {
        let source = init_test_db().unwrap();
        seed_dev_project(&source, "p1", root_path);
        seed_dev_project_graph(&source, "p1");
        seed_workspace_with_knowledge(&source, "w1");
        {
            let conn = source.get().unwrap();
            conn.execute_batch(
                "INSERT INTO workspace_practice_adoption (practice_id, project_id, state, note, updated_at)
                    VALUES ('kn-ado-w1', 'p1', 'adopted', 'in use', '2026-01-01T00:00:00Z');",
            )
            .unwrap();
        }
        build_export_bundle(
            &source,
            None,
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap()
    }

    #[test]
    fn import_bundle_round_trips_projects_and_knowledge_with_original_uuids() {
        let bundle = source_bundle("/tmp/portability-rt-p1");
        let target = init_test_db().unwrap();

        let result = import_bundle(&target, None, &bundle, &HashMap::new()).expect("import");
        assert_eq!(result.projects_imported, 1);
        assert!(result.import_conflicts.is_empty());
        assert_eq!(result.projects_skipped, 0);
        assert_eq!(result.knowledge_imported, 3);
        assert_eq!(result.knowledge_skipped_duplicates, 0);

        let conn = target.get().unwrap();
        // Original uuids preserved across the graph.
        let pid: String = conn
            .query_row(
                "SELECT project_id FROM dev_goals WHERE id = 'g1-p1'",
                [],
                |r| r.get(0),
            )
            .expect("goal with original uuid");
        assert_eq!(pid, "p1");
        let goal_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_goals WHERE project_id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(goal_count, 2);
        let item_id: String = conn
            .query_row(
                "SELECT item_id FROM dev_milestone_items WHERE milestone_id = 'm1-p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(item_id, "uc1-p1");
        // A column the export SELECT forgets is silently dropped from every
        // bundle, so assert the annotations survived the whole trip.
        let (desc, rating): (Option<String>, Option<i64>) = conn
            .query_row(
                "SELECT description, rating FROM dev_milestone_items WHERE milestone_id = 'm1-p1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(desc.as_deref(), Some("why it is core"));
        assert_eq!(rating, Some(4), "milestone item rating round-trips");
        let edge_count: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM memory_edges WHERE from_id = 'n1-p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(edge_count, 1);
        // The stripped vault ref lands as an empty placeholder.
        let cred: String = conn
            .query_row(
                "SELECT credential_id FROM dev_kpi_bindings WHERE id = 'kb1-p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(cred, "");
        // team-x does not exist in the target — nulled with a warning.
        let team: Option<String> = conn
            .query_row(
                "SELECT team_id FROM dev_projects WHERE id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert!(team.is_none());
        assert!(result.warnings.iter().any(|w| w.contains("team not found")));
        // Folder does not exist on this machine — advisory warning, never a failure.
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("Project Manager")));

        // Knowledge statuses survive faithfully, including rejected.
        let rejected: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_knowledge WHERE status = 'rejected'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(rejected, 1);
        // Adoption cell landed because both the practice and project exist.
        let adoption: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_practice_adoption WHERE practice_id = 'kn-ado-w1' AND project_id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(adoption, 1);
    }

    #[test]
    fn reimport_returns_conflicts_then_skip_resolution_imports_nothing() {
        let bundle = source_bundle("/tmp/portability-cf-p1");
        let target = init_test_db().unwrap();
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        // Pass 1 again: the project now conflicts by root_path and is NOT imported.
        let second = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.projects_imported, 0);
        assert_eq!(second.import_conflicts.len(), 1);
        let c = &second.import_conflicts[0];
        assert_eq!(c.kind, "project");
        assert_eq!(c.bundle_id, "p1");
        assert_eq!(c.existing_id, "p1");
        assert_eq!(c.matched_by, "root_path");
        // Re-run of the knowledge phase skipped everything as duplicates.
        assert_eq!(second.knowledge_imported, 0);
        assert_eq!(second.knowledge_skipped_duplicates, 3);

        // Pass 2 with skip: nothing imported, nothing duplicated.
        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "skip".to_string());
        let third = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(third.projects_skipped, 1);
        assert_eq!(third.projects_imported, 0);

        let conn = target.get().unwrap();
        let projects: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_projects WHERE id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(projects, 1);
        let goals: i32 = conn
            .query_row("SELECT COUNT(*) FROM dev_goals", [], |r| r.get(0))
            .unwrap();
        assert_eq!(goals, 2);
    }

    #[test]
    fn replace_resolution_keeps_id_replaces_children_and_spares_telemetry() {
        let bundle = source_bundle("/tmp/portability-rp-p1");
        let target = init_test_db().unwrap();
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        {
            let conn = target.get().unwrap();
            // Telemetry row (not a covered family) must survive the replace.
            conn.execute(
                "INSERT INTO dev_scans (id, project_id, scan_type) VALUES ('scan1', 'p1', 'feature')",
                [],
            )
            .unwrap();
            // Local drift the replace must undo…
            conn.execute(
                "UPDATE dev_goals SET title = 'mutated' WHERE id = 'g1-p1'",
                [],
            )
            .unwrap();
            // …and a local extra child the replace must clear.
            conn.execute(
                "INSERT INTO dev_goals (id, project_id, title, status) VALUES ('local-extra', 'p1', 'local', 'open')",
                [],
            )
            .unwrap();
        }

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "replace".to_string());
        let result = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(result.projects_imported, 1);
        assert!(result.import_conflicts.is_empty());

        let conn = target.get().unwrap();
        // Project id is stable, children carry their original uuids again.
        let title: String = conn
            .query_row("SELECT title FROM dev_goals WHERE id = 'g1-p1'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(title, "Goal one");
        let extra: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_goals WHERE id = 'local-extra'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(extra, 0);
        let scans: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_scans WHERE id = 'scan1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(scans, 1);
        let goals: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_goals WHERE project_id = 'p1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(goals, 2);
    }

    #[test]
    fn duplicate_resolution_remaps_milestone_items_and_task_parent_chains() {
        let mut bundle = source_bundle("/tmp/portability-dup-p1");
        // A child task so the parent chain remap is observable.
        bundle.dev_projects[0].tasks.push(DevTaskExport {
            id: "t2-p1".into(),
            title: "Child task".into(),
            description: None,
            source_idea_id: None,
            goal_id: None,
            status: "queued".into(),
            session_id: None,
            progress_pct: None,
            output_lines: None,
            error: None,
            depth: "quick".into(),
            parent_task_id: Some("t1-p1".into()),
            attempt: 2,
            started_at: None,
            completed_at: None,
            created_at: "2026-01-01T00:00:00Z".into(),
        });

        let target = init_test_db().unwrap();
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "duplicate".to_string());
        let result = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(result.projects_imported, 1);

        let conn = target.get().unwrap();
        let (new_pid, new_name, new_root): (String, String, String) = conn
            .query_row(
                "SELECT id, name, root_path FROM dev_projects WHERE id != 'p1' AND name LIKE '%(imported)'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("duplicated project");
        assert_ne!(new_pid, "p1");
        assert_eq!(new_name, "Project p1 (imported)");
        assert!(new_root.starts_with("/tmp/portability-dup-p1-imported"));

        // Every child got a fresh uuid.
        let old_id_children: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM dev_goals WHERE project_id = ?1 AND id LIKE '%-p1'",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(old_id_children, 0);

        // Milestone item (kind use_case) points at the duplicated use case.
        let new_uc: String = conn
            .query_row(
                "SELECT id FROM dev_use_cases WHERE project_id = ?1",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(new_uc, "uc1-p1");
        let item_id: String = conn
            .query_row(
                "SELECT mi.item_id FROM dev_milestone_items mi \
                 JOIN dev_milestones m ON m.id = mi.milestone_id WHERE m.project_id = ?1",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(item_id, new_uc);

        // Task parent chain remapped onto the duplicated parent.
        let new_parent: String = conn
            .query_row(
                "SELECT id FROM dev_tasks WHERE project_id = ?1 AND title = 'A task'",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(new_parent, "t1-p1");
        let child_parent: Option<String> = conn
            .query_row(
                "SELECT parent_task_id FROM dev_tasks WHERE project_id = ?1 AND title = 'Child task'",
                [new_pid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(child_parent.as_deref(), Some(new_parent.as_str()));
    }

    #[test]
    fn knowledge_dedups_by_dedup_key_and_kind_title_across_fresh_ids() {
        let bundle = source_bundle("/tmp/portability-kn-p1");
        let target = init_test_db().unwrap();
        let first = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.knowledge_imported, 3);

        // Same entries under FRESH ids: dedup_key catches dk1, (kind, title)
        // catches the NULL-key rows.
        let mut rekeyed = source_bundle("/tmp/portability-kn2-p1");
        for k in &mut rekeyed.workspace_knowledge[0].knowledge {
            k.id = format!("fresh-{}", k.id);
        }
        rekeyed.dev_projects.clear();
        let second = import_bundle(&target, None, &rekeyed, &HashMap::new()).unwrap();
        assert_eq!(second.knowledge_imported, 0);
        assert_eq!(second.knowledge_skipped_duplicates, 3);

        let conn = target.get().unwrap();
        let count: i32 = conn
            .query_row("SELECT COUNT(*) FROM workspace_knowledge", [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 3);
    }

    #[test]
    fn adoption_cells_skip_pairs_whose_project_is_absent() {
        let mut bundle = source_bundle("/tmp/portability-ad-p1");
        // The adoption cell references p1 — which never lands because the
        // projects section is emptied out.
        bundle.dev_projects.clear();
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.knowledge_imported, 3);

        let conn = target.get().unwrap();
        let adoption: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM workspace_practice_adoption",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(adoption, 0);
    }

    #[test]
    fn skills_written_to_existing_root_and_deferred_when_missing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();

        let dir_files = vec![
            SkillFileEntry {
                rel_path: "SKILL.md".into(),
                content: "# Foo skill".into(),
            },
            SkillFileEntry {
                rel_path: "references/notes.md".into(),
                content: "notes".into(),
            },
        ];
        let single = vec![SkillFileEntry {
            rel_path: "bar.md".into(),
            content: "# Bar".into(),
        }];
        let evil = vec![SkillFileEntry {
            rel_path: "../escape.md".into(),
            content: "nope".into(),
        }];

        let mut bundle = empty_bundle();
        let mut p = minimal_dev_project("ps1");
        p.root_path = root.clone();
        p.skills = vec![
            SkillFileExport {
                name: "foo".into(),
                content_hash: hash_skill_entries(&dir_files),
                files: dir_files,
            },
            SkillFileExport {
                name: "bar".into(),
                content_hash: hash_skill_entries(&single),
                files: single,
            },
            SkillFileExport {
                name: "evil".into(),
                content_hash: hash_skill_entries(&evil),
                files: evil,
            },
        ];
        let mut p2 = minimal_dev_project("ps2");
        p2.root_path = format!("{root}/definitely/missing/subdir");
        p2.skills = vec![SkillFileExport {
            name: "lonely".into(),
            content_hash: "x".into(),
            files: vec![SkillFileEntry {
                rel_path: "SKILL.md".into(),
                content: "body".into(),
            }],
        }];
        bundle.dev_projects = vec![p, p2];

        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.projects_imported, 2);
        assert_eq!(result.skills_written, 2, "warnings: {:?}", result.warnings);
        assert_eq!(result.skills_deferred, 1);
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("unsafe file path")));

        let skills = tmp.path().join(".claude").join("skills");
        assert_eq!(
            std::fs::read_to_string(skills.join("foo").join("SKILL.md")).unwrap(),
            "# Foo skill"
        );
        assert_eq!(
            std::fs::read_to_string(skills.join("foo").join("references").join("notes.md"))
                .unwrap(),
            "notes"
        );
        assert_eq!(
            std::fs::read_to_string(skills.join("bar.md")).unwrap(),
            "# Bar"
        );
        // Provenance sidecar: bundle-kind, no absolute source path, real hash.
        let prov = std::fs::read_to_string(skills.join("foo").join(SKILL_PROVENANCE_FILE)).unwrap();
        let prov: serde_json::Value = serde_json::from_str(&prov).unwrap();
        assert_eq!(prov["source_kind"], "bundle");
        assert_eq!(prov["source_path"], "");
        assert!(!prov["content_hash"].as_str().unwrap().is_empty());
        // The escape attempt never materialized anywhere.
        assert!(!tmp.path().join("escape.md").exists());
        assert!(!skills.join("evil").exists());
    }

    #[test]
    fn write_project_skills_respects_local_divergence_unless_replacing() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path().to_string_lossy().to_string();
        let foo_dir = tmp.path().join(".claude").join("skills").join("foo");
        std::fs::create_dir_all(&foo_dir).unwrap();
        std::fs::write(foo_dir.join("SKILL.md"), "local content").unwrap();

        let files = vec![SkillFileEntry {
            rel_path: "SKILL.md".into(),
            content: "incoming content".into(),
        }];
        let skill = SkillFileExport {
            name: "foo".into(),
            content_hash: hash_skill_entries(&files),
            files,
        };

        // Non-replace: the local copy wins.
        let mut result = empty_import_result();
        write_project_skills(&root, std::slice::from_ref(&skill), false, &mut result);
        assert_eq!(result.skills_written, 0);
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("incoming copy skipped")));
        assert_eq!(
            std::fs::read_to_string(foo_dir.join("SKILL.md")).unwrap(),
            "local content"
        );

        // Replace: overwritten, with a warning saying so.
        let mut result = empty_import_result();
        write_project_skills(&root, std::slice::from_ref(&skill), true, &mut result);
        assert_eq!(result.skills_written, 1);
        assert!(result.warnings.iter().any(|w| w.contains("overwritten")));
        assert_eq!(
            std::fs::read_to_string(foo_dir.join("SKILL.md")).unwrap(),
            "incoming content"
        );
        assert!(foo_dir.join(SKILL_PROVENANCE_FILE).exists());
    }

    // ------------------------------------------------------------------
    // Twins (WP1)
    // ------------------------------------------------------------------

    /// Seed one twin with at least one row in every EXPORTED child table,
    /// plus a `twin_voice_profiles` row that must NOT travel.
    fn seed_twin(pool: &DbPool, id: &str, name: &str, kb_id: Option<&str>) {
        let conn = pool.get().unwrap();
        conn.execute(
            "INSERT INTO twin_profiles \
                (id, name, slug, bio, role, languages, pronouns, obsidian_subpath, is_active, \
                 knowledge_base_id, training_directives, created_at, updated_at) \
             VALUES (?1,?2,?3,'A bio','Founder','en,cs','they/them',?4,1,?5,'Be terse.',\
                     '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            rusqlite::params![
                id,
                name,
                format!("slug-{id}"),
                format!("personas/twins/slug-{id}"),
                kb_id
            ],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_tones \
                (id, twin_id, channel, voice_directives, examples_json, constraints_json, \
                 length_hint, updated_at) \
             VALUES (?1,?2,'generic','Warm but brief','[\"hi\"]','{\"no\":1}','short',\
                     '2026-01-02T00:00:00Z')",
            rusqlite::params![format!("tone-{id}"), id],
        )
        .unwrap();

        // Two communications: the training pair (question in `summary`) and a
        // plain inbound message.
        conn.execute(
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, \
                 key_facts_json, occurred_at, created_at) \
             VALUES (?1,?2,'discord','out','alice','The answer text',\
                     'What is your pricing philosophy?','[\"round up\"]',\
                     '2026-01-03T00:00:00Z','2026-01-03T00:00:00Z')",
            rusqlite::params![format!("comm-a-{id}"), id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO twin_communications \
                (id, twin_id, channel, direction, contact_handle, content, summary, \
                 key_facts_json, occurred_at, created_at) \
             VALUES (?1,?2,'discord','in','alice','Hello there',NULL,NULL,\
                     '2026-01-04T00:00:00Z','2026-01-04T00:00:00Z')",
            rusqlite::params![format!("comm-b-{id}"), id],
        )
        .unwrap();

        for (suffix, status, notes) in [
            ("p", "pending", None::<&str>),
            ("a", "approved", Some("looks right")),
            ("r", "rejected", Some("too personal")),
        ] {
            conn.execute(
                "INSERT INTO twin_pending_memories \
                    (id, twin_id, channel, content, title, importance, status, reviewer_notes, \
                     source_communication_id, created_at, reviewed_at) \
                 VALUES (?1,?2,'discord',?3,'A memory',4,?4,?5,?6,'2026-01-05T00:00:00Z',NULL)",
                rusqlite::params![
                    format!("mem-{suffix}-{id}"),
                    id,
                    format!("memory {suffix}"),
                    status,
                    notes,
                    format!("comm-a-{id}")
                ],
            )
            .unwrap();
        }

        // One fact whose sources all travel, one whose source does not exist.
        conn.execute(
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, \
                 last_seen_at) \
             VALUES (?1,?2,'alice','Prefers async',5,?3,'2026-01-06T00:00:00Z',\
                     '2026-01-06T00:00:00Z')",
            rusqlite::params![format!("fact-ok-{id}"), id, format!("[\"comm-a-{id}\"]")],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO twin_distilled_facts \
                (id, twin_id, contact_handle, content, importance, sources_json, created_at, \
                 last_seen_at) \
             VALUES (?1,?2,NULL,'Orphan fact',3,'[\"comm-gone\"]','2026-01-06T00:00:00Z',\
                     '2026-01-06T00:00:00Z')",
            rusqlite::params![format!("fact-orphan-{id}"), id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_contacts (id, twin_id, handle, alias, notes, created_at, updated_at) \
             VALUES (?1,?2,'alice','Alice A.','Main collaborator','2026-01-01T00:00:00Z',\
                     '2026-01-07T00:00:00Z')",
            rusqlite::params![format!("contact-{id}"), id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
             VALUES (?1,?2,'How is Alice?','A long reflection','2026-01-08T00:00:00Z')",
            rusqlite::params![format!("refl-{id}"), id],
        )
        .unwrap();

        conn.execute(
            "INSERT INTO twin_channels \
                (id, twin_id, channel_type, credential_id, persona_id, label, is_active, \
                 created_at, updated_at) \
             VALUES (?1,?2,'discord','cred-does-not-exist','persona-gone','Main server',1,\
                     '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            rusqlite::params![format!("chan-{id}"), id],
        )
        .unwrap();

        // Dead table — must never appear in a bundle.
        conn.execute(
            "INSERT INTO twin_voice_profiles (id, twin_id, provider, voice_id) \
             VALUES (?1,?2,'elevenlabs','voice-123')",
            rusqlite::params![format!("voice-{id}"), id],
        )
        .unwrap();
    }

    fn seed_twin_kb(user_db: &UserDbPool, kb_id: &str) {
        let conn = user_db.get().unwrap();
        conn.execute(
            "INSERT INTO knowledge_bases \
                (id, credential_id, name, description, embedding_model, embedding_dims, \
                 chunk_size, chunk_overlap, created_at, updated_at) \
             VALUES (?1,'kb-cred-old','Twin Brain','Notes','AllMiniLML6V2Q',384,512,50,\
                     '2026-01-01T00:00:00Z','2026-01-01T00:00:00Z')",
            rusqlite::params![kb_id],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO kb_documents \
                (id, kb_id, source_type, source_path, title, content_hash, byte_size, \
                 chunk_count, status, created_at) \
             VALUES ('doc-1',?1,'file','/tmp/notes.md','Notes','deadbeef',123,2,'indexed',\
                     '2026-01-01T00:00:00Z')",
            rusqlite::params![kb_id],
        )
        .unwrap();
        for (cid, idx, text) in [
            ("chunk-1", 0, "first chunk"),
            ("chunk-2", 1, "second chunk"),
        ] {
            conn.execute(
                "INSERT INTO kb_chunks \
                    (id, kb_id, document_id, chunk_index, content, token_count, created_at) \
                 VALUES (?1,?2,'doc-1',?3,?4,7,'2026-01-01T00:00:00Z')",
                rusqlite::params![cid, kb_id, idx, text],
            )
            .unwrap();
        }
    }

    fn twin_bundle(pool: &DbPool, user_db: Option<&UserDbPool>) -> PortabilityBundle {
        build_export_bundle(
            pool,
            user_db,
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap()
    }

    /// AC1 — every exported column survives a round trip, `summary` and
    /// `key_facts_json` included.
    #[test]
    fn twin_round_trips_every_exported_table_and_column() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);

        assert_eq!(bundle.twins.len(), 1);
        let tw = &bundle.twins[0];
        assert_eq!(tw.name, "Founder Twin");
        assert_eq!(tw.bio.as_deref(), Some("A bio"));
        assert_eq!(tw.role.as_deref(), Some("Founder"));
        assert_eq!(tw.languages.as_deref(), Some("en,cs"));
        assert_eq!(tw.pronouns.as_deref(), Some("they/them"));
        assert_eq!(tw.training_directives.as_deref(), Some("Be terse."));
        assert_eq!(tw.tones.len(), 1);
        assert_eq!(tw.communications.len(), 2);
        assert_eq!(tw.pending_memories.len(), 3);
        assert_eq!(tw.distilled_facts.len(), 2);
        assert_eq!(tw.contacts.len(), 1);
        assert_eq!(tw.reflections.len(), 1);
        assert_eq!(tw.channels.len(), 1);

        // The interview QUESTION lives only in `summary`; its extracted facts
        // only in `key_facts_json`. Losing either halves every training pair.
        let training = tw
            .communications
            .iter()
            .find(|c| c.direction == "out")
            .expect("outbound communication");
        assert_eq!(
            training.summary.as_deref(),
            Some("What is your pricing philosophy?")
        );
        assert_eq!(training.key_facts_json.as_deref(), Some("[\"round up\"]"));

        // All three memory statuses + reviewer notes travel.
        let statuses: std::collections::HashSet<&str> = tw
            .pending_memories
            .iter()
            .map(|m| m.status.as_str())
            .collect();
        assert_eq!(
            statuses,
            ["pending", "approved", "rejected"].into_iter().collect()
        );
        assert!(tw
            .pending_memories
            .iter()
            .any(|m| m.reviewer_notes.as_deref() == Some("too personal")));

        // Contact aliases/notes, tone payloads, reflections, channel refs.
        assert_eq!(tw.contacts[0].alias.as_deref(), Some("Alice A."));
        assert_eq!(tw.contacts[0].notes.as_deref(), Some("Main collaborator"));
        assert_eq!(tw.tones[0].examples_json.as_deref(), Some("[\"hi\"]"));
        assert_eq!(tw.reflections[0].prompt_seed, "How is Alice?");
        assert_eq!(tw.channels[0].credential_id, "cred-does-not-exist");
        assert_eq!(tw.channels[0].persona_id.as_deref(), Some("persona-gone"));

        // Import into a fresh DB and read the rows back.
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.twins_imported, 1);
        assert!(result.import_conflicts.is_empty());

        let conn = target.get().unwrap();
        let (tid, slug, is_active, directives): (String, String, i32, Option<String>) = conn
            .query_row(
                "SELECT id, slug, is_active, training_directives FROM twin_profiles \
                 WHERE name = 'Founder Twin'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        // Fresh uuid, re-derived slug, never active.
        assert_ne!(tid, "t1");
        assert_eq!(slug, "founder-twin");
        assert_eq!(is_active, 0);
        assert_eq!(directives.as_deref(), Some("Be terse."));

        let child_count = |table: &str| -> i32 {
            conn.query_row(
                &format!("SELECT COUNT(*) FROM {table} WHERE twin_id = ?1"),
                [tid.as_str()],
                |r| r.get(0),
            )
            .unwrap()
        };
        assert_eq!(child_count("twin_tones"), 1);
        assert_eq!(child_count("twin_communications"), 2);
        assert_eq!(child_count("twin_pending_memories"), 3);
        assert_eq!(child_count("twin_contacts"), 1);
        assert_eq!(child_count("twin_reflections"), 1);
        assert_eq!(child_count("twin_channels"), 1);
        // The orphan-sourced fact is dropped (AC3); the cited one survives.
        assert_eq!(child_count("twin_distilled_facts"), 1);

        let summary: Option<String> = conn
            .query_row(
                "SELECT summary FROM twin_communications WHERE twin_id = ?1 AND direction = 'out'",
                [tid.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(summary.as_deref(), Some("What is your pricing philosophy?"));
    }

    /// AC5 — the three excluded profile columns and the dead voice table never
    /// appear anywhere in a serialized bundle, by name or by value.
    #[test]
    fn twin_bundle_never_carries_slug_is_active_subpath_or_voice() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let json = serde_json::to_string(&bundle).unwrap();

        for forbidden in [
            "\"slug\"",
            "\"obsidian_subpath\"",
            "voice_profiles",
            "\"voice_id\"",
            "voice-123",
            "slug-t1",
            "personas/twins/slug-t1",
        ] {
            assert!(
                !json.contains(forbidden),
                "bundle must not contain {forbidden}"
            );
        }
        // `is_active` DOES appear on channel rows (it is a real exported column
        // there, and the import forces it to 0); the PROFILE-level one is what
        // must never travel, so assert on the twin object's shape.
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        let twin = &v["twins"][0];
        assert!(twin.get("slug").is_none());
        assert!(twin.get("is_active").is_none());
        assert!(twin.get("obsidian_subpath").is_none());
        assert!(twin.get("knowledge_base_id").is_none());
    }

    /// AC3 — a fact whose sources all fail to remap is dropped with a warning,
    /// never written with an empty `sources_json` (which the repo rejects).
    #[test]
    fn twin_facts_never_import_with_empty_sources() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let conn = target.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT sources_json FROM twin_distilled_facts")
            .unwrap();
        let rows: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(rows.len(), 1);
        for s in &rows {
            let ids: Vec<String> = serde_json::from_str(s).unwrap();
            assert!(!ids.is_empty(), "sources_json must never be empty");
            // Remapped, not the source machine's ids.
            assert!(!ids.iter().any(|i| i.starts_with("comm-")));
        }
        assert!(result
            .warnings
            .iter()
            .any(|w| w.contains("Orphan fact") && w.contains("without provenance")));
    }

    /// AC4 — an unresolvable channel imports disabled and says what to re-link.
    #[test]
    fn twin_channel_with_dead_credential_imports_disabled_with_warning() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let conn = target.get().unwrap();
        let (is_active, cred, persona): (i32, String, Option<String>) = conn
            .query_row(
                "SELECT is_active, credential_id, persona_id FROM twin_channels",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(is_active, 0, "an imported channel must never be live");
        // Kept verbatim — never auto-matched onto some other credential.
        assert_eq!(cred, "cred-does-not-exist");
        assert_eq!(persona.as_deref(), Some("persona-gone"));
        assert!(result.warnings.iter().any(|w| {
            w.contains("Main server") && w.contains("credential") && w.contains("persona")
        }));
    }

    /// AC2 — twin conflict detection + all three resolutions.
    #[test]
    fn twin_reimport_conflicts_then_skip_replace_duplicate() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let bundle = twin_bundle(&source, None);
        let target = init_test_db().unwrap();
        import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();

        let first_id: String = {
            let conn = target.get().unwrap();
            conn.query_row("SELECT id FROM twin_profiles", [], |r| r.get(0))
                .unwrap()
        };

        // Pass 1 again: matched by name (NOT slug — the slug was re-derived).
        let second = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.twins_imported, 0);
        assert_eq!(second.import_conflicts.len(), 1);
        let c = &second.import_conflicts[0];
        assert_eq!(c.kind, "twin");
        assert_eq!(c.bundle_id, "t1");
        assert_eq!(c.name, "Founder Twin");
        assert_eq!(c.detail, None);
        assert_eq!(c.existing_id, first_id);
        assert_eq!(c.matched_by, "name");

        // skip → nothing new.
        let mut res = HashMap::new();
        res.insert("twin:t1".to_string(), "skip".to_string());
        let third = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(third.twins_skipped, 1);
        assert_eq!(third.twins_imported, 0);
        {
            let conn = target.get().unwrap();
            let n: i32 = conn
                .query_row("SELECT COUNT(*) FROM twin_profiles", [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, 1);
        }

        // replace → same id survives, children rebuilt (no duplication).
        let mut res = HashMap::new();
        res.insert("twin:t1".to_string(), "replace".to_string());
        let fourth = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(fourth.twins_imported, 1);
        {
            let conn = target.get().unwrap();
            let ids: Vec<String> = conn
                .prepare("SELECT id FROM twin_profiles")
                .unwrap()
                .query_map([], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            assert_eq!(ids, vec![first_id.clone()]);
            let comms: i32 = conn
                .query_row("SELECT COUNT(*) FROM twin_communications", [], |r| r.get(0))
                .unwrap();
            assert_eq!(comms, 2, "replace rebuilds children, it does not append");
        }

        // duplicate → a second twin, every soft ref remapped onto its own rows.
        let mut res = HashMap::new();
        res.insert("twin:t1".to_string(), "duplicate".to_string());
        let fifth = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(fifth.twins_imported, 1);

        let conn = target.get().unwrap();
        let dup_id: String = conn
            .query_row(
                "SELECT id FROM twin_profiles WHERE name = 'Founder Twin (imported)'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_ne!(dup_id, first_id);
        let dup_slug: String = conn
            .query_row(
                "SELECT slug FROM twin_profiles WHERE id = ?1",
                [dup_id.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(dup_slug, "founder-twin-imported");
        // The duplicate's fact cites the duplicate's OWN communication.
        let (fact_sources, dup_comm_ids): (String, Vec<String>) = {
            let s: String = conn
                .query_row(
                    "SELECT sources_json FROM twin_distilled_facts WHERE twin_id = ?1",
                    [dup_id.as_str()],
                    |r| r.get(0),
                )
                .unwrap();
            let ids: Vec<String> = conn
                .prepare("SELECT id FROM twin_communications WHERE twin_id = ?1")
                .unwrap()
                .query_map([dup_id.as_str()], |r| r.get::<_, String>(0))
                .unwrap()
                .map(Result::unwrap)
                .collect();
            (s, ids)
        };
        let cited: Vec<String> = serde_json::from_str(&fact_sources).unwrap();
        assert_eq!(cited.len(), 1);
        assert!(dup_comm_ids.contains(&cited[0]));
        // …and the memory's provenance points at the duplicate's own row too.
        let mem_source: Option<String> = conn
            .query_row(
                "SELECT source_communication_id FROM twin_pending_memories \
                 WHERE twin_id = ?1 LIMIT 1",
                [dup_id.as_str()],
                |r| r.get(0),
            )
            .unwrap();
        assert!(dup_comm_ids.contains(&mem_source.expect("memory keeps its provenance")));
    }

    /// AC6 — exceeding a cap warns, naming what was dropped and how much.
    #[test]
    fn exceeding_twin_caps_warns_instead_of_dropping_silently() {
        let pool = init_test_db().unwrap();
        seed_twin(&pool, "t1", "Founder Twin", None);
        {
            let conn = pool.get().unwrap();
            for i in 0..(MAX_TWIN_REFLECTIONS + 3) {
                conn.execute(
                    "INSERT INTO twin_reflections (id, twin_id, prompt_seed, content, created_at) \
                     VALUES (?1,'t1','seed','body','2026-01-09T00:00:00Z')",
                    rusqlite::params![format!("extra-refl-{i}")],
                )
                .unwrap();
            }
        }
        let mut warnings = Vec::new();
        let twins = collect_twin_exports(&pool, None, None, &mut warnings).unwrap();
        assert_eq!(twins[0].reflections.len(), MAX_TWIN_REFLECTIONS);
        let w = warnings
            .iter()
            .find(|w| w.contains("reflections"))
            .expect("truncation must be reported");
        assert!(w.contains("Founder Twin"), "warning names the twin: {w}");
        assert!(w.contains("dropped"), "warning says how much: {w}");
        assert!(w.contains(&format!("{}", MAX_TWIN_REFLECTIONS)));

        // …and the bundle carries the warning to whoever imports it.
        let bundle = twin_bundle(&pool, None);
        assert!(bundle
            .export_warnings
            .iter()
            .any(|w| w.contains("reflections")));
        let target = init_test_db().unwrap();
        let result = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert!(result
            .warnings
            .iter()
            .any(|w| w.starts_with("Export note —") && w.contains("reflections")));
    }

    /// The workspace-wide caps a preview CAN see are forecast on the stats
    /// call, which is the only export channel that reaches the exporting user.
    #[test]
    fn export_stats_forecasts_twin_cap_overflow() {
        let pool = init_test_db().unwrap();
        for i in 0..(MAX_TWINS + 2) {
            seed_twin(&pool, &format!("t{i}"), &format!("Twin {i}"), None);
            // Only the first twin may be active; seed_twin sets is_active=1.
            let conn = pool.get().unwrap();
            conn.execute("UPDATE twin_profiles SET is_active = 0", [])
                .unwrap();
        }
        let stats = compute_export_stats(&pool, None).unwrap();
        assert_eq!(stats.twin_count as usize, MAX_TWINS + 2);
        assert!(stats
            .warnings
            .iter()
            .any(|w| w.contains("Twins") && w.contains("at most")));
    }

    /// Selective scope honours `twin_ids` — empty means none, like every other
    /// selective section.
    #[test]
    fn selective_scope_filters_twins() {
        let pool = init_test_db().unwrap();
        seed_twin(&pool, "t1", "Founder Twin", None);
        seed_twin(&pool, "t2", "Personal Twin", None);

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: Vec::new(),
            twin_ids: vec!["t2".into()],
            athena_tiers: Vec::new(),
        };
        let bundle =
            build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include)
                .unwrap();
        assert_eq!(bundle.twins.len(), 1);
        assert_eq!(bundle.twins[0].name, "Personal Twin");

        let scope = ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: Vec::new(),
            twin_ids: Vec::new(),
            athena_tiers: Vec::new(),
        };
        let bundle =
            build_export_bundle(&pool, None, scope, true, true, SensitiveSections::Include)
                .unwrap();
        assert!(bundle.twins.is_empty());
    }

    /// AC2/§2 — the knowledge base travels as TEXT only, lands under fresh
    /// ids in the user database, rebinds the twin, and queues a re-embed.
    #[test]
    fn twin_knowledge_base_round_trips_text_only_and_queues_reindex() {
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_twin_kb(&source_user, "kb-old");
        seed_twin(&source, "t1", "Founder Twin", Some("kb-old"));

        let bundle = twin_bundle(&source, Some(&source_user));
        let kb = bundle.twins[0]
            .knowledge_base
            .as_ref()
            .expect("bound KB travels");
        assert_eq!(kb.documents.len(), 1);
        assert_eq!(kb.chunks.len(), 2);
        assert_eq!(kb.embedding_dims, 384);

        // No vectors, no embeddings, no local credential ref.
        let json = serde_json::to_string(&bundle).unwrap();
        for forbidden in ["kb_vec", "embedding\"", "\"credential_id\":\"kb-cred-old\""] {
            assert!(
                !json.contains(forbidden),
                "bundle must not contain {forbidden}"
            );
        }

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let result = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert_eq!(result.twins_imported, 1);
        assert_eq!(result.twin_kb_chunks_imported, 2);
        assert_eq!(result.pending_kb_reindex.len(), 1);

        let new_kb_id = &result.pending_kb_reindex[0];
        assert_ne!(new_kb_id, "kb-old");

        let uconn = target_user.get().unwrap();
        let (docs, chunks): (i64, i64) = uconn
            .query_row(
                "SELECT document_count, chunk_count FROM knowledge_bases WHERE id = ?1",
                [new_kb_id.as_str()],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!((docs, chunks), (1, 2));
        let contents: Vec<String> = uconn
            .prepare("SELECT content FROM kb_chunks WHERE kb_id = ?1 ORDER BY chunk_index")
            .unwrap()
            .query_map([new_kb_id.as_str()], |r| r.get::<_, String>(0))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(contents, vec!["first chunk", "second chunk"]);

        // The twin is rebound to the NEW kb, and a vault shell exists for it.
        let conn = target.get().unwrap();
        let bound: Option<String> = conn
            .query_row(
                "SELECT knowledge_base_id FROM twin_profiles WHERE name = 'Founder Twin'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(bound.as_deref(), Some(new_kb_id.as_str()));
        let shells: i32 = conn
            .query_row(
                "SELECT COUNT(*) FROM persona_credentials WHERE service_type = 'personas_vector_db'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(shells, 1);
    }

    /// An unreachable knowledge base never fails the export — the twin travels
    /// without it plus a warning.
    #[test]
    fn twin_with_unresolvable_kb_exports_with_a_warning() {
        let source = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", Some("kb-missing"));

        let mut warnings = Vec::new();
        let twins = collect_twin_exports(&source, Some(&user), None, &mut warnings).unwrap();
        assert_eq!(twins.len(), 1);
        assert!(twins[0].knowledge_base.is_none());
        assert!(warnings
            .iter()
            .any(|w| w.contains("kb-missing") && w.contains("no longer exists")));
    }

    /// Per-field length validation — NOT just count caps. A bundle with an
    /// oversize communication is rejected before it reaches the DB layer.
    #[test]
    fn validate_bundle_rejects_oversize_twin_text_and_bad_enums() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].communications[0].content = "x".repeat(MAX_MEMORY_CONTENT_LEN + 1);
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].pending_memories[0].reviewer_notes =
            Some("y".repeat(MAX_MEMORY_CONTENT_LEN + 1));
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].pending_memories[0].status = "bogus".into();
        assert!(validate_bundle(&bundle).is_err());

        let mut bundle = twin_bundle(&source, None);
        bundle.twins[0].communications[0].direction = "sideways".into();
        assert!(validate_bundle(&bundle).is_err());

        // The unmodified bundle still validates.
        assert!(validate_bundle(&twin_bundle(&source, None)).is_ok());
    }

    #[test]
    fn validate_bundle_rejects_too_many_twins() {
        let source = init_test_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        let mut bundle = twin_bundle(&source, None);
        while bundle.twins.len() <= MAX_TWINS {
            let tw = &bundle.twins[0];
            bundle.twins.push(TwinExport {
                id: uuid::Uuid::new_v4().to_string(),
                name: tw.name.clone(),
                bio: None,
                role: None,
                languages: None,
                pronouns: None,
                training_directives: None,
                created_at: tw.created_at.clone(),
                updated_at: tw.updated_at.clone(),
                tones: Vec::new(),
                communications: Vec::new(),
                pending_memories: Vec::new(),
                distilled_facts: Vec::new(),
                contacts: Vec::new(),
                reflections: Vec::new(),
                channels: Vec::new(),
                knowledge_base: None,
            });
        }
        assert!(validate_bundle(&bundle).is_err());
    }

    // ------------------------------------------------------------------
    // AC7 — dev-project conflict REGRESSION guard
    //
    // The project conflict path is shipped, working code that WP1 only
    // genericized (`ProjectConflict` → `ImportConflict`, flat `"kind:id"`
    // resolution keys). This test pins the behaviour end to end so the
    // refactor can be shown not to have changed it: same detection, same
    // matched_by, same replace/skip/duplicate outcomes, same counters —
    // with the project's `root_path` now surfacing through the generic
    // `detail` field.
    // ------------------------------------------------------------------

    #[test]
    fn dev_project_conflict_path_is_unchanged_by_genericization() {
        let bundle = source_bundle("/tmp/portability-regression-p1");
        let target = init_test_db().unwrap();

        // Pass 1, fresh target: imports cleanly, no conflicts.
        let first = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.projects_imported, 1);
        assert_eq!(first.projects_skipped, 0);
        assert!(first.import_conflicts.is_empty());

        // Pass 1, second run: conflict by root_path, project NOT imported.
        let second = import_bundle(&target, None, &bundle, &HashMap::new()).unwrap();
        assert_eq!(second.projects_imported, 0);
        assert_eq!(second.projects_skipped, 0);
        assert_eq!(second.import_conflicts.len(), 1);
        let c = &second.import_conflicts[0];
        assert_eq!(c.kind, "project");
        assert_eq!(c.bundle_id, "p1");
        assert_eq!(c.name, "Project p1");
        assert_eq!(c.existing_id, "p1");
        assert_eq!(c.matched_by, "root_path");
        // root_path moved from its own field into the generic `detail`.
        assert_eq!(c.detail.as_deref(), Some("/tmp/portability-regression-p1"));

        // A resolution keyed the OLD way (bare id) must not be honoured —
        // otherwise the two-pass flow would silently half-work.
        let mut legacy_key = HashMap::new();
        legacy_key.insert("p1".to_string(), "duplicate".to_string());
        let ignored = import_bundle(&target, None, &bundle, &legacy_key).unwrap();
        assert_eq!(ignored.projects_imported, 0);
        assert_eq!(ignored.projects_skipped, 0);

        // skip / replace / duplicate all behave exactly as before.
        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "skip".to_string());
        let skipped = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(skipped.projects_skipped, 1);
        assert_eq!(skipped.projects_imported, 0);

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "replace".to_string());
        let replaced = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(replaced.projects_imported, 1);
        assert!(replaced.import_conflicts.is_empty());
        {
            // Scoped to the BUNDLED project: the KPI phase also materializes a
            // dormant "Imported" placeholder project, which predates this work.
            let conn = target.get().unwrap();
            let n: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_projects WHERE root_path = ?1",
                    ["/tmp/portability-regression-p1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(
                n, 1,
                "replace keeps exactly one copy of the bundled project"
            );
            let id: String = conn
                .query_row(
                    "SELECT id FROM dev_projects WHERE root_path = ?1",
                    ["/tmp/portability-regression-p1"],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(id, "p1", "replace preserves the existing project id");
        }

        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "duplicate".to_string());
        let duplicated = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(duplicated.projects_imported, 1);
        {
            let conn = target.get().unwrap();
            let n: i32 = conn
                .query_row(
                    "SELECT COUNT(*) FROM dev_projects WHERE name LIKE 'Project p1%'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(n, 2, "duplicate lands alongside the original");
        }

        // Unknown resolution: warned, not imported (unchanged behaviour).
        let mut res = HashMap::new();
        res.insert("project:p1".to_string(), "nonsense".to_string());
        let bad = import_bundle(&target, None, &bundle, &res).unwrap();
        assert_eq!(bad.projects_imported, 0);
        assert!(bad
            .warnings
            .iter()
            .any(|w| w.contains("unknown resolution 'nonsense'")));
    }

    // ========================================================================
    // Athena memory (WP2)
    // ========================================================================

    /// A throwaway brain directory. `brain_root()` honours `PERSONAS_HOME`, so
    /// pointing it at a temp dir gives every Athena test a real filesystem to
    /// write markdown into without touching the developer's own brain.
    ///
    /// The guard restores the previous value on drop AND serialises every
    /// Athena test through one mutex: `PERSONAS_HOME` is process-global, and
    /// two tests running in parallel would each see the other's brain.
    struct BrainHome {
        dir: std::path::PathBuf,
        prev: Option<String>,
        _lock: std::sync::MutexGuard<'static, ()>,
    }

    static BRAIN_HOME_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    impl BrainHome {
        fn new() -> Self {
            let lock = BRAIN_HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let dir = std::env::temp_dir().join(format!("personas_brain_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("companion-brain")).unwrap();
            let prev = std::env::var("PERSONAS_HOME").ok();
            std::env::set_var("PERSONAS_HOME", &dir);
            Self {
                dir,
                prev,
                _lock: lock,
            }
        }

        fn root(&self) -> std::path::PathBuf {
            self.dir.join("companion-brain")
        }

        fn write(&self, rel: &str, body: &str) {
            let p = self.root().join(rel);
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(p, body).unwrap();
        }
    }

    impl Drop for BrainHome {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => std::env::set_var("PERSONAS_HOME", v),
                None => std::env::remove_var("PERSONAS_HOME"),
            }
        }
    }

    /// Re-point `PERSONAS_HOME` at a fresh directory so an import writes onto a
    /// machine that is not the one the bundle came from. Takes no lock — the
    /// caller already holds it through its own [`BrainHome`].
    struct BrainHomeSwap {
        dir: std::path::PathBuf,
        prev: Option<String>,
    }

    impl BrainHomeSwap {
        fn to_fresh() -> Self {
            let dir = std::env::temp_dir().join(format!("personas_brain_{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(dir.join("companion-brain")).unwrap();
            let prev = std::env::var("PERSONAS_HOME").ok();
            std::env::set_var("PERSONAS_HOME", &dir);
            Self { dir, prev }
        }

        fn root(&self) -> std::path::PathBuf {
            self.dir.join("companion-brain")
        }
    }

    impl Drop for BrainHomeSwap {
        fn drop(&mut self) {
            match self.prev.take() {
                Some(v) => std::env::set_var("PERSONAS_HOME", v),
                None => std::env::remove_var("PERSONAS_HOME"),
            }
        }
    }

    fn seed_node(user_db: &UserDbPool, id: &str, kind: &str, rel_path: &str, importance: i64) {
        let conn = user_db.get().unwrap();
        conn.execute(
            "INSERT INTO companion_node \
                (id, kind, file_path, content_hash, importance, embedding_model, embedding_dims, \
                 body_excerpt, created_at, updated_at) \
             VALUES (?1,?2,?3,'sha256:abc',?4,'AllMiniLML6V2Q',384,?5,\
                     '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            rusqlite::params![id, kind, rel_path, importance, format!("excerpt of {id}")],
        )
        .unwrap();
    }

    /// A brain with one of every learned kind, plus every excluded neighbour a
    /// real brain would have sitting next to them. Each excluded row carries a
    /// distinctive sentinel so a leak is visible rather than inferred.
    fn seed_athena_brain(home: &BrainHome, user_db: &UserDbPool) {
        let conn = user_db.get().unwrap();

        // --- core ---
        home.write("identity.md", "# Michal\n\n- Ships on Fridays\n");
        home.write("constitution.md", "SECRET-CONSTITUTION-BODY\n");
        home.write(
            "constitution.bak-20260101T000000.md",
            "SECRET-OLD-CONSTITUTION\n",
        );
        home.write("cockpit.md", "SECRET-COCKPIT\n");
        home.write("dashboard.md", "SECRET-DASHBOARD\n");
        home.write("reflections/2026-01-01_ref_1.md", "SECRET-REFLECTION\n");
        home.write(
            "episodes-archive-20260101T000000/old.md",
            "SECRET-ARCHIVE\n",
        );

        conn.execute(
            "INSERT INTO companion_session (id, claude_session_id, title, status, pinned, origin) \
             VALUES ('default','SECRET-RESUME-POINTER','Q3 planning','active',1,'user')",
            [],
        )
        .unwrap();

        // --- learned: facts, one superseding the other ---
        home.write("semantic/user/fact_old_editor.md", "Michal used vim.\n");
        home.write("semantic/user/fact_new_editor.md", "Michal uses Zed.\n");
        seed_node(
            user_db,
            "fact_old",
            "fact",
            "semantic/user/fact_old_editor.md",
            0,
        );
        seed_node(
            user_db,
            "fact_new",
            "fact",
            "semantic/user/fact_new_editor.md",
            5,
        );
        conn.execute(
            "INSERT INTO companion_fact \
                (id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, \
                 last_decayed_at) \
             VALUES ('fact_old','user','preferred_editor',0.6,NULL,NULL,\
                     '2026-01-01T00:00:00Z',NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_fact \
                (id, scope, fact_key, confidence, supersedes_id, contradicts_id, last_seen_at, \
                 last_decayed_at) \
             VALUES ('fact_new','user','editor_2026',0.93,'fact_old',NULL,\
                     '2026-02-01T00:00:00Z','2026-03-01T00:00:00Z')",
            [],
        )
        .unwrap();
        for ep in ["ep_gone_1", "ep_gone_2"] {
            conn.execute(
                "INSERT INTO companion_provenance (fact_id, episode_id) VALUES ('fact_new', ?1)",
                rusqlite::params![ep],
            )
            .unwrap();
        }

        // --- learned: procedural ---
        home.write("procedurals/chat/proc_brevity.md", "Answer in one line.\n");
        seed_node(
            user_db,
            "proc_1",
            "procedural",
            "procedurals/chat/proc_brevity.md",
            4,
        );
        conn.execute(
            "INSERT INTO companion_procedural \
                (id, scope, trigger_pattern, confidence, supersedes_id, last_used_at, \
                 last_decayed_at) \
             VALUES ('proc_1','chat','when he asks a yes/no question',0.77,NULL,\
                     '2026-02-02T00:00:00Z',NULL)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO companion_provenance (fact_id, episode_id) VALUES ('proc_1','ep_gone_3')",
            [],
        )
        .unwrap();

        // --- learned: goal / backlog / ritual ---
        home.write("goals/goal_ship.md", "Ship the thing.\n");
        seed_node(user_db, "goal_1", "goal", "goals/goal_ship.md", 4);
        conn.execute(
            "INSERT INTO companion_goal \
                (id, title, status, priority, target_date, sources_json, completed_at, \
                 created_at, updated_at) \
             VALUES ('goal_1','Ship v1','active',4,'2026-06-01','[\"ep_gone_1\"]',NULL,\
                     '2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            [],
        )
        .unwrap();

        home.write(
            "backlog/self_promise/blog_1.md",
            "I said I would check the logs.\n",
        );
        seed_node(
            user_db,
            "blog_1",
            "backlog",
            "backlog/self_promise/blog_1.md",
            3,
        );
        conn.execute(
            "INSERT INTO companion_backlog_item \
                (id, summary, kind, status, source_episode_id, reminded_count, created_at, \
                 resolved_at) \
             VALUES ('blog_1','Check the deploy logs','self_promise','pending','ep_gone_1',2,\
                     '2026-01-01T00:00:00Z',NULL)",
            [],
        )
        .unwrap();

        home.write("rituals/quiet_hours/ritual_1.md", "No pings after 20:00.\n");
        seed_node(
            user_db,
            "ritual_1",
            "ritual",
            "rituals/quiet_hours/ritual_1.md",
            2,
        );
        conn.execute(
            "INSERT INTO companion_ritual \
                (id, kind, description, schedule_json, active, sources_json, created_at, \
                 updated_at) \
             VALUES ('ritual_1','quiet_hours','No pings after 20:00','{\"from\":\"20:00\"}',1,\
                     '[]','2026-01-01T00:00:00Z','2026-01-02T00:00:00Z')",
            [],
        )
        .unwrap();

        // --- learned: design decision (no node, no file) ---
        conn.execute(
            "INSERT INTO companion_design_decision \
                (id, session_id, persona_context, label, choice, rationale, decision_timestamp, \
                 created_at) \
             VALUES ('dec_1','default','Research Analyst','Model','Sonnet',\
                     'Cheaper for summarisation','2026-01-05T00:00:00Z','2026-01-05T00:00:00Z')",
            [],
        )
        .unwrap();

        // --- everything that must NOT travel ---
        home.write("episodes/2026/01/01/ep_1_user.md", "SECRET-EPISODE-BODY\n");
        seed_node(
            user_db,
            "ep_1",
            "episode",
            "episodes/2026/01/01/ep_1_user.md",
            3,
        );
        seed_node(
            user_db,
            "doc_1",
            "doctrine",
            "features/personas/01-data-model.md#capabilities",
            3,
        );
        seed_node(
            user_db,
            "ref_1",
            "reflection",
            "reflections/2026-01-01_ref_1.md",
            2,
        );
        seed_node(user_db, "cockpit", "cockpit", "cockpit.md", 3);
        seed_node(user_db, "dashboard", "dashboard", "dashboard.md", 3);
        conn.execute(
            "INSERT INTO companion_known_project (id, name, path) \
             VALUES ('kp_1','x','C:\\SECRET-ABSOLUTE-PATH')",
            [],
        )
        .unwrap();
    }

    fn seed_athena_prefs(pool: &DbPool) {
        for (k, v) in [
            ("companion_autonomous_mode", "true"),
            ("companion_fleet_boldness", "bold"),
            ("companion_profile_synthesis", "false"),
            // Not portable — must be refused by the whitelist, never carried.
            ("companion_profile_synthesis_last", "SECRET-LOCAL-TIMESTAMP"),
        ] {
            settings_repo::set(pool, k, v).unwrap();
        }
    }

    fn athena_bundle(pool: &DbPool, user_db: &UserDbPool) -> PortabilityBundle {
        build_export_bundle(
            pool,
            Some(user_db),
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap()
    }

    /// AC1 — both tiers survive a round trip, sidecar fields included.
    #[test]
    fn athena_round_trips_both_tiers_with_every_sidecar_field() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&source);
        seed_athena_brain(&home, &source_user);

        let bundle = athena_bundle(&source, &source_user);
        let a = bundle.athena.as_ref().expect("Athena section travels");

        // Core.
        assert!(a
            .identity_md
            .as_deref()
            .unwrap()
            .contains("Ships on Fridays"));
        assert_eq!(a.prefs.len(), 3, "only the three portable prefs");
        assert_eq!(a.sessions.len(), 1);
        assert_eq!(a.sessions[0].title.as_deref(), Some("Q3 planning"));

        // Learned: five nodes, one per kind, and nothing else.
        assert_eq!(
            a.nodes.len(),
            6,
            "two facts (one superseded) plus one each of the other kinds — and no              doctrine, episode, reflection, cockpit or dashboard"
        );
        let mut kinds: Vec<&str> = a.nodes.iter().map(|n| n.kind.as_str()).collect();
        kinds.sort();
        assert_eq!(
            kinds,
            vec!["backlog", "fact", "fact", "goal", "procedural", "ritual"]
        );
        // Bodies, not just index rows.
        let fact_node = a.nodes.iter().find(|n| n.id == "fact_new").unwrap();
        assert_eq!(fact_node.body, "Michal uses Zed.\n");
        assert_eq!(fact_node.importance, 5);

        assert_eq!(a.facts.len(), 2, "the superseded fact is still a fact");
        assert_eq!(a.decisions.len(), 1);
        assert_eq!(a.provenance.len(), 3, "two for fact_new, one for proc_1");

        // Now import onto a clean machine with its own brain directory.
        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();
        let result = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();

        assert_eq!(
            result.athena_memory_imported, 7,
            "six nodes plus one design decision"
        );
        assert_eq!(result.reembed_queued, 6, "decisions are never embedded");

        let conn = target_user.get().unwrap();
        let (conf, sup, contra, decayed): (f64, Option<String>, Option<String>, Option<String>) =
            conn.query_row(
                "SELECT confidence, supersedes_id, contradicts_id, last_decayed_at \
                 FROM companion_fact WHERE id = 'fact_new'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .unwrap();
        assert!((conf - 0.93).abs() < 1e-9, "confidence survives");
        assert_eq!(sup.as_deref(), Some("fact_old"), "supersedes_id remaps");
        assert_eq!(contra, None);
        assert_eq!(decayed.as_deref(), Some("2026-03-01T00:00:00Z"));

        let importance: i64 = conn
            .query_row(
                "SELECT importance FROM companion_node WHERE id = 'fact_new'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(importance, 5, "importance survives");

        let (label, rationale): (String, String) = conn
            .query_row(
                "SELECT label, rationale FROM companion_design_decision WHERE id = 'dec_1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();
        assert_eq!(label, "Model");
        assert_eq!(rationale, "Cheaper for summarisation");

        // Procedural sidecar too — confidence is the field most likely to be
        // quietly dropped by a column-order mistake.
        let (scope, trigger, pconf): (String, String, f64) = conn
            .query_row(
                "SELECT scope, trigger_pattern, confidence FROM companion_procedural \
                 WHERE id = 'proc_1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        assert_eq!(scope, "chat");
        assert_eq!(trigger, "when he asks a yes/no question");
        assert!((pconf - 0.77).abs() < 1e-9);

        // The markdown landed on THIS machine's brain root, re-anchored.
        let body =
            std::fs::read_to_string(target_home.root().join("semantic/user/fact_new_editor.md"))
                .expect("markdown written before the row");
        assert_eq!(body, "Michal uses Zed.\n");

        // Prefs applied to the target's app database; the non-portable one not.
        assert_eq!(
            settings_repo::get(&target, "companion_fleet_boldness").unwrap(),
            Some("bold".to_string())
        );
        assert_eq!(
            settings_repo::get(&target, "companion_profile_synthesis_last").unwrap(),
            None,
            "a non-portable pref must never be written by an import"
        );
        drop(target_home);
        drop(home);
    }

    /// AC2 — importing the same bundle twice adds nothing the second time.
    /// Dedup is by CONTENT, not id, so this holds even after ids are reissued.
    #[test]
    fn athena_second_import_creates_no_duplicates() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&source);
        seed_athena_brain(&home, &source_user);
        let bundle = athena_bundle(&source, &source_user);

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();

        let first = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert_eq!(first.athena_memory_imported, 7);

        let second = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert_eq!(
            second.athena_memory_imported, 0,
            "second import of the same bundle adds nothing"
        );
        assert_eq!(second.reembed_queued, 0);
        assert!(second
            .warnings
            .iter()
            .any(|w| w.contains("already in her brain")));

        let conn = target_user.get().unwrap();
        for (table, expected) in [
            ("companion_fact", 2),
            ("companion_procedural", 1),
            ("companion_goal", 1),
            ("companion_backlog_item", 1),
            ("companion_ritual", 1),
            ("companion_design_decision", 1),
            ("companion_node", 6),
        ] {
            let n: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0))
                .unwrap();
            assert_eq!(n, expected, "{table} must not gain a duplicate");
        }
        drop(target_home);
        drop(home);
    }

    /// AC3 — identity.md is backed up before it is replaced.
    #[test]
    fn athena_import_backs_up_identity_before_replacing_it() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_brain(&home, &source_user);
        let bundle = athena_bundle(&source, &source_user);

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();
        // The target already knows someone. That file must not just vanish.
        std::fs::write(
            target_home.root().join("identity.md"),
            "# Someone else\n\n- Prior beliefs\n",
        )
        .unwrap();

        let result = import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();
        assert!(result.athena_identity_replaced);

        let replaced = std::fs::read_to_string(target_home.root().join("identity.md")).unwrap();
        assert!(replaced.contains("Ships on Fridays"));

        let backups: Vec<String> = std::fs::read_dir(target_home.root())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.starts_with("identity.bak-"))
            .collect();
        assert_eq!(backups.len(), 1, "exactly one backup, named by identity.rs");
        let prior = std::fs::read_to_string(target_home.root().join(&backups[0])).unwrap();
        assert!(
            prior.contains("Prior beliefs"),
            "the backup holds what was there before, not the incoming file"
        );
        drop(target_home);
        drop(home);
    }

    /// AC4 — nothing excluded reaches the bundle. Asserted three ways: by
    /// field NAME (no excluded table leaks in as a key), by VALUE (no excluded
    /// node kind or on-disk file appears), and by SENTINEL (each excluded row
    /// was seeded with a distinctive string that must be absent).
    #[test]
    fn athena_bundle_excludes_every_forbidden_name() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&source);
        seed_athena_brain(&home, &source_user);

        let bundle = athena_bundle(&source, &source_user);
        let athena = bundle.athena.as_ref().expect("section present");
        let value = serde_json::to_value(athena).unwrap();

        // 1. By name — no excluded table or column appears as a JSON key.
        fn keys(v: &serde_json::Value, out: &mut Vec<String>) {
            match v {
                serde_json::Value::Object(m) => {
                    for (k, child) in m {
                        out.push(k.clone());
                        keys(child, out);
                    }
                }
                serde_json::Value::Array(items) => items.iter().for_each(|c| keys(c, out)),
                _ => {}
            }
        }
        let mut all_keys = Vec::new();
        keys(&value, &mut all_keys);
        for forbidden in ATHENA_FORBIDDEN_NAMES {
            assert!(
                !all_keys.iter().any(|k| k.contains(forbidden)),
                "bundle must not carry a `{forbidden}` field"
            );
        }

        // 2. By value — no excluded node kind or on-disk file.
        for n in &athena.nodes {
            for forbidden in ATHENA_FORBIDDEN_CONTENT {
                assert_ne!(n.kind, forbidden, "node kind `{forbidden}` must not travel");
                assert!(
                    !n.file_path.contains(forbidden),
                    "file `{forbidden}` must not travel (saw {})",
                    n.file_path
                );
            }
        }

        // 3. By sentinel — every excluded row was seeded with a marker.
        let json = serde_json::to_string(&bundle).unwrap();
        for sentinel in [
            "SECRET-RESUME-POINTER", // companion_session.claude_session_id
            "SECRET-EPISODE-BODY",   // an episode's markdown
            "SECRET-CONSTITUTION-BODY",
            "SECRET-OLD-CONSTITUTION",
            "SECRET-COCKPIT",
            "SECRET-DASHBOARD",
            "SECRET-REFLECTION",
            "SECRET-ARCHIVE",
            "SECRET-ABSOLUTE-PATH",   // companion_known_project
            "SECRET-LOCAL-TIMESTAMP", // a non-portable app_setting
        ] {
            assert!(!json.contains(sentinel), "bundle leaked {sentinel}");
        }
        drop(home);
    }

    /// AC5 — provenance whose episode never travelled degrades to a plain
    /// dangling id: `load_sources` reads `companion_provenance` with no join,
    /// so the readers return it verbatim instead of erroring. Asserted through
    /// the public readers, on state an import actually produced, rather than
    /// by reading the SQL and trusting it.
    #[test]
    fn load_sources_tolerates_provenance_whose_episode_is_absent() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_athena_brain(&home, &source_user);
        let bundle = athena_bundle(&source, &source_user);

        let target = init_test_db().unwrap();
        let target_user = crate::db::init_test_user_db().unwrap();
        let target_home = BrainHomeSwap::to_fresh();
        import_bundle(&target, Some(&target_user), &bundle, &HashMap::new()).unwrap();

        // The episodes are definitely not here.
        {
            let conn = target_user.get().unwrap();
            let episodes: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM companion_node WHERE kind = 'episode'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(episodes, 0);
        }

        let facts = crate::companion::brain::semantic::list_facts(&target_user, None, true, 50)
            .expect("list_facts must not error on dangling provenance");
        let imported = facts.iter().find(|f| f.id == "fact_new").expect("fact");
        assert_eq!(
            imported.sources,
            vec!["ep_gone_1".to_string(), "ep_gone_2".to_string()],
            "the sourcing survives even though the conversations did not"
        );

        let rules = crate::companion::brain::procedural::list_rules(&target_user, None, true, 50)
            .expect("list_rules must not error on dangling provenance");
        let rule = rules.iter().find(|r| r.id == "proc_1").expect("rule");
        assert_eq!(rule.sources, vec!["ep_gone_3".to_string()]);

        // And a memory with NO provenance at all reads as an empty list.
        {
            let conn = target_user.get().unwrap();
            conn.execute("DELETE FROM companion_provenance", [])
                .unwrap();
        }
        let facts = crate::companion::brain::semantic::list_facts(&target_user, None, true, 50)
            .expect("no provenance is still not an error");
        assert!(facts.iter().all(|f| f.sources.is_empty()));
        drop(target_home);
        drop(home);
    }

    /// AC8 — both sections round-trip through their envelopes, the plaintext
    /// fields are empty on the wire, and `format_version` says 3.
    #[test]
    fn twins_and_athena_round_trip_encrypted_and_bump_the_format_version() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        seed_athena_brain(&home, &source_user);

        let mut bundle = athena_bundle(&source, &source_user);
        assert_eq!(bundle.format_version, 2, "an unsealed bundle is still v2");
        seal_sensitive_sections(&mut bundle, Some("correct horse battery")).unwrap();

        assert_eq!(bundle.format_version, 3);
        assert!(bundle.twins.is_empty(), "plaintext twins cleared");
        assert!(bundle.athena.is_none(), "plaintext athena cleared");
        assert!(bundle.encrypted_twins.is_some());
        assert!(bundle.encrypted_athena.is_some());

        // Nothing recognisable on the wire.
        let json = serde_json::to_string(&bundle).unwrap();
        for sentinel in ["Founder Twin", "Ships on Fridays", "Michal uses Zed"] {
            assert!(!json.contains(sentinel), "sealed bundle leaked {sentinel}");
        }

        // Wrong passphrase: a warning and empty sections, never a half-read.
        let mut wrong: PortabilityBundle = serde_json::from_str(&json).unwrap();
        let mut warnings = Vec::new();
        unseal_sensitive_sections(&mut wrong, Some("not the passphrase"), &mut warnings);
        assert!(wrong.twins.is_empty() && wrong.athena.is_none());
        assert_eq!(warnings.len(), 2, "one warning per undecryptable section");

        // No passphrase at all: same shape, different reason.
        let mut none: PortabilityBundle = serde_json::from_str(&json).unwrap();
        let mut warnings = Vec::new();
        unseal_sensitive_sections(&mut none, None, &mut warnings);
        assert_eq!(warnings.len(), 2);
        assert!(warnings.iter().all(|w| w.contains("No passphrase")));

        // Right passphrase: everything comes back, and each section decrypts
        // independently of the other.
        let mut good: PortabilityBundle = serde_json::from_str(&json).unwrap();
        let mut warnings = Vec::new();
        unseal_sensitive_sections(&mut good, Some("correct horse battery"), &mut warnings);
        assert!(warnings.is_empty());
        assert_eq!(good.twins.len(), 1);
        assert_eq!(good.twins[0].name, "Founder Twin");
        assert_eq!(good.athena.as_ref().unwrap().nodes.len(), 6);
        // And what came back is what validation will see.
        validate_bundle(&good).expect("decrypted bundle validates");
        drop(home);
    }

    /// AC8 — the backend refuses an EXPLICIT selection it cannot encrypt. The
    /// frontend gates this too, but the frontend is not the boundary.
    #[test]
    fn export_refuses_a_selected_sensitive_scope_without_a_passphrase() {
        assert!(require_passphrase_for_selection(&[], &[], None).is_ok());
        assert!(
            require_passphrase_for_selection(&["t1".into()], &[], None).is_err(),
            "selected twins with no passphrase must fail"
        );
        assert!(
            require_passphrase_for_selection(&[], &["learned".into()], None).is_err(),
            "a selected Athena tier with no passphrase must fail"
        );
        assert!(require_passphrase_for_selection(
            &["t1".into()],
            &["core".into()],
            Some("longenough")
        )
        .is_ok());
        // An unknown tier is its own error, not masked by the passphrase one.
        let err = require_passphrase_for_selection(&[], &["lerned".into()], Some("longenough"))
            .unwrap_err();
        assert!(format!("{err}").contains("unknown tier"));
    }

    /// A Full-scope export with no passphrase carries neither section — the
    /// same trade this command already makes with credential secrets — and
    /// says so rather than leaving the receiver to guess.
    #[test]
    fn full_export_without_a_passphrase_omits_both_sensitive_sections() {
        let home = BrainHome::new();
        let source = init_test_db().unwrap();
        let source_user = crate::db::init_test_user_db().unwrap();
        seed_twin(&source, "t1", "Founder Twin", None);
        seed_athena_brain(&home, &source_user);

        let bundle = build_export_bundle(
            &source,
            Some(&source_user),
            ExportScope::Full,
            true,
            true,
            SensitiveSections::Omit,
        )
        .unwrap();
        assert!(bundle.twins.is_empty());
        assert!(bundle.athena.is_none());
        assert!(bundle
            .export_warnings
            .iter()
            .any(|w| w.contains("without a passphrase")));
        // Sealing a bundle with nothing sensitive in it is a no-op, not an error.
        let mut bundle = bundle;
        seal_sensitive_sections(&mut bundle, None).expect("nothing to seal");
        assert_eq!(bundle.format_version, 2);
        drop(home);
    }

    /// The export preview drives which tiers the picker offers, so an empty
    /// tier has to read as 0 rather than as "some".
    #[test]
    fn export_stats_report_both_athena_tiers() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();

        let empty = compute_export_stats(&pool, Some(&user)).unwrap();
        assert_eq!(empty.athena_core_count, 0);
        assert_eq!(empty.athena_learned_count, 0);

        seed_athena_prefs(&pool);
        seed_athena_brain(&home, &user);
        let stats = compute_export_stats(&pool, Some(&user)).unwrap();
        // identity.md + 3 portable prefs + 1 conversation.
        assert_eq!(stats.athena_core_count, 5);
        // 6 learned nodes + 1 design decision; doctrine / episode / reflection /
        // cockpit / dashboard are not learned memory.
        assert_eq!(stats.athena_learned_count, 7);
        drop(home);
    }

    /// Selective scope picks Athena by tier, not by id.
    #[test]
    fn athena_tiers_select_only_what_was_asked_for() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&pool);
        seed_athena_brain(&home, &user);

        let scope_for = |tiers: Vec<String>| ExportScope::Selective {
            persona_ids: Vec::new(),
            team_ids: Vec::new(),
            credential_ids: Vec::new(),
            project_ids: Vec::new(),
            workspace_ids: Vec::new(),
            twin_ids: Vec::new(),
            athena_tiers: tiers,
        };

        let core_only = build_export_bundle(
            &pool,
            Some(&user),
            scope_for(vec!["core".into()]),
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        let a = core_only.athena.as_ref().unwrap();
        assert!(a.identity_md.is_some() && !a.sessions.is_empty());
        assert!(a.nodes.is_empty() && a.decisions.is_empty());

        let learned_only = build_export_bundle(
            &pool,
            Some(&user),
            scope_for(vec!["learned".into()]),
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        let a = learned_only.athena.as_ref().unwrap();
        assert!(a.identity_md.is_none() && a.sessions.is_empty() && a.prefs.is_empty());
        assert_eq!(a.nodes.len(), 6);

        let neither = build_export_bundle(
            &pool,
            Some(&user),
            scope_for(Vec::new()),
            true,
            true,
            SensitiveSections::Include,
        )
        .unwrap();
        assert!(neither.athena.is_none());
        drop(home);
    }

    /// Validation is the import boundary, so the rules that matter most there
    /// get their own test: an unknown enum (which would import fine and then
    /// break `list_facts` at read time), a non-portable pref key (which would
    /// let a bundle write arbitrary app settings), and a traversal path.
    #[test]
    fn validate_athena_rejects_bad_enums_foreign_pref_keys_and_traversal() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_athena_prefs(&pool);
        seed_athena_brain(&home, &user);

        let good = athena_bundle(&pool, &user);
        validate_bundle(&good).expect("a real bundle validates");

        let mut bad = athena_bundle(&pool, &user);
        bad.athena.as_mut().unwrap().facts[0].scope = "elsewhere".into();
        assert!(validate_bundle(&bad).is_err(), "unknown fact scope refused");

        let mut bad = athena_bundle(&pool, &user);
        bad.athena.as_mut().unwrap().prefs.push(AthenaPrefExport {
            key: "anthropic_api_key".into(),
            value: "sk-leak".into(),
        });
        let err = validate_bundle(&bad).unwrap_err();
        assert!(
            format!("{err}").contains("not a portable Athena preference"),
            "app_settings is not an open write surface for a bundle"
        );

        let mut bad = athena_bundle(&pool, &user);
        bad.athena.as_mut().unwrap().nodes[0].file_path = "../../../etc/passwd".into();
        assert!(
            validate_bundle(&bad).is_err(),
            "a traversal path would escape the brain directory on import"
        );
        drop(home);
    }

    /// A memory whose markdown is gone is dropped WITH its sidecar, by name.
    /// Half a memory — an index row pointing at a file that does not exist —
    /// is worse than none.
    #[test]
    fn athena_drops_a_node_whose_body_cannot_be_read_and_says_so() {
        let home = BrainHome::new();
        let pool = init_test_db().unwrap();
        let user = crate::db::init_test_user_db().unwrap();
        seed_athena_brain(&home, &user);
        // Delete one memory's markdown behind the index's back.
        std::fs::remove_file(home.root().join("semantic/user/fact_new_editor.md")).unwrap();

        let mut warnings = Vec::new();
        let a = collect_athena_export(&pool, Some(&user), AthenaTiers::both(), &mut warnings)
            .unwrap()
            .unwrap();

        assert!(a.nodes.iter().all(|n| n.id != "fact_new"));
        assert!(
            a.facts.iter().all(|f| f.id != "fact_new"),
            "the sidecar row must not survive its node"
        );
        assert!(
            a.provenance.iter().all(|p| p.fact_id != "fact_new"),
            "nor its provenance"
        );
        assert!(warnings
            .iter()
            .any(|w| w.contains("fact_new") && w.contains("no readable body")));
        drop(home);
    }
}
