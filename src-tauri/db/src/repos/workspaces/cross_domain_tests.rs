#[cfg(test)]
mod tests {
    use crate::repos::workspaces::adoption::*;
    use crate::repos::workspaces::knowledge::*;
    use crate::repos::workspaces::mining::*;
    use crate::repos::workspaces::org::*;
    use crate::repos::workspaces::practice_ideas::*;
    use crate::DbPool;
    use rusqlite::params;
    use std::collections::HashMap;

    #[test]
    fn abstraction_closes_the_zoom_axis() {
        // Exact hits and casing/whitespace noise.
        for canonical in KNOWLEDGE_ABSTRACTIONS {
            assert_eq!(
                normalize_abstraction(Some(canonical)).as_deref(),
                Some(canonical)
            );
        }
        assert_eq!(
            normalize_abstraction(Some("Macro")).as_deref(),
            Some("macro")
        );
        assert_eq!(
            normalize_abstraction(Some("  meso  ")).as_deref(),
            Some("meso")
        );
        // The real drift the divergence caller only half-guarded against: an
        // unrecognized value must NOT survive into the closed column, since the
        // roll-up gate does an exact `Some("macro")` check and the TS binding
        // casts this column straight to a 3-value union.
        assert_eq!(normalize_abstraction(Some("high-level")), None);
        assert_eq!(normalize_abstraction(Some("Macro-ish")), None);
        // Unset stays unset — "no altitude given" is not "altitude unknown".
        assert_eq!(normalize_abstraction(None), None);
        assert_eq!(normalize_abstraction(Some("   ")), None);
    }

    #[test]
    fn applicability_matching() {
        // No envelope / no filters → applies everywhere.
        assert!(applicability_matches(None, Some("React, TypeScript")));
        assert!(applicability_matches(Some("{}"), None));
        assert!(applicability_matches(
            Some("{\"layers\":[\"ui\"]}"),
            Some("Rust")
        ));
        // Filter hit (case-insensitive substring).
        assert!(applicability_matches(
            Some("{\"frameworks\":[\"react\"]}"),
            Some("React 19, Vite")
        ));
        assert!(applicability_matches(
            Some("{\"languages\":[\"TypeScript\"],\"frameworks\":[\"axum\"]}"),
            Some("typescript")
        ));
        // Filter miss.
        assert!(!applicability_matches(
            Some("{\"frameworks\":[\"react\"]}"),
            Some("Rust, Axum")
        ));
        assert!(!applicability_matches(
            Some("{\"languages\":[\"python\"]}"),
            None
        ));
        // Malformed JSON fails open (never hides a practice on bad data).
        assert!(applicability_matches(Some("not json"), Some("Rust")));
    }

    #[test]
    fn adoption_seed_state_is_applicability_only_never_kind() {
        // Kind must NOT decide the seed: the 12-territory scan showed 91.5% of
        // real harvested items are pitfall-or-pattern, so a kind-keyed queue
        // holds almost the whole library.
        for kind in KNOWLEDGE_KINDS {
            assert_eq!(
                initial_adoption_state(kind, None, Some("Rust")),
                "proposed",
                "{kind} must seed proposed — to_process is earned by evidence"
            );
            assert!(ADOPTION_STATES.contains(&initial_adoption_state(kind, None, None)));
        }
        // Applicability is still the one thing decidable without reading code.
        assert_eq!(
            initial_adoption_state(
                "pitfall",
                Some("{\"frameworks\":[\"react\"]}"),
                Some("Rust, Axum")
            ),
            "na"
        );
    }

    #[test]
    fn verdict_meaning_depends_on_the_prior_state() {
        // Drift: canon this repo had applied stopped holding.
        assert_eq!(
            adoption_state_after_verdict("adopted", false, true),
            "diverged"
        );
        // Work owed: never applied here, and the code does not comply.
        assert_eq!(
            adoption_state_after_verdict("proposed", false, true),
            "to_process"
        );
        // Still owed after a previous pass said so.
        assert_eq!(
            adoption_state_after_verdict("to_process", false, true),
            "to_process"
        );
        // Compliance is compliance, however the cell got here — a repo that
        // already follows the practice must not sit at `proposed` forever.
        for prior in ["proposed", "to_process", "adopted", "diverged"] {
            assert_eq!(adoption_state_after_verdict(prior, true, true), "adopted");
        }
        // `na` is a stack judgement; a code verdict does not resurrect it.
        assert_eq!(adoption_state_after_verdict("na", false, true), "na");
        // "does not apply here" is not "work owed" — the failure mode the first
        // real run exposed: 7 Next.js practices queued against a Tauri app.
        for prior in ["proposed", "to_process", "adopted"] {
            for holds in [true, false] {
                assert_eq!(adoption_state_after_verdict(prior, holds, false), "na");
            }
        }
        for prior in ADOPTION_STATES {
            for holds in [true, false] {
                for applies in [true, false] {
                    assert!(ADOPTION_STATES
                        .contains(&adoption_state_after_verdict(prior, holds, applies)));
                }
            }
        }
    }

    #[test]
    fn project_agnostic_key_classification() {
        assert!(is_project_agnostic_key("standards:no-unwrap"));
        assert!(is_project_agnostic_key("kpi_sim:finding:k1:slug"));
        assert!(is_project_agnostic_key(
            "scan:security:all:sql-injection-risk"
        ));
        // Repo-local keys must NOT be treated as globally equal.
        assert!(!is_project_agnostic_key("sentry:AB12CD"));
        assert!(!is_project_agnostic_key(
            "scan:security:ctx-uuid-123:sql-injection"
        ));
    }

    fn finding(project: &str, origin: &str, dedup: Option<&str>, title: &str) -> MinedFinding {
        MinedFinding {
            project_id: project.into(),
            origin: origin.into(),
            dedup_key: dedup.map(|s| s.into()),
            title: title.into(),
        }
    }

    #[test]
    fn shared_findings_cluster_across_two_projects_by_agnostic_key() {
        let findings = vec![
            finding(
                "p1",
                "standards_finding",
                Some("standards:no-unwrap"),
                "Avoid unwrap",
            ),
            finding(
                "p2",
                "standards_finding",
                Some("standards:no-unwrap"),
                "Avoid .unwrap()",
            ),
        ];
        let out = cluster_shared_findings(&findings);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "pitfall");
        assert_eq!(
            out[0].dedup_key.as_deref(),
            Some("miner:findings:standards_finding|standards:no-unwrap")
        );
        assert_eq!(out[0].topic.as_deref(), Some("process/enforcement"));
    }

    #[test]
    fn single_project_finding_is_not_shared() {
        let findings = vec![
            finding(
                "p1",
                "standards_finding",
                Some("standards:no-unwrap"),
                "Avoid unwrap",
            ),
            finding(
                "p1",
                "standards_finding",
                Some("standards:no-unwrap"),
                "Avoid unwrap again",
            ),
        ];
        assert!(cluster_shared_findings(&findings).is_empty());
    }

    #[test]
    fn repo_local_keys_cluster_on_normalized_title() {
        // Different sentry ids per repo, but the same normalized title → shared.
        let findings = vec![
            finding(
                "p1",
                "sentry_spike",
                Some("sentry:AA11"),
                "Null pointer in checkout flow",
            ),
            finding(
                "p2",
                "sentry_spike",
                Some("sentry:BB22"),
                "Null pointer in checkout flow!",
            ),
        ];
        let out = cluster_shared_findings(&findings);
        assert_eq!(
            out.len(),
            1,
            "repo-local keys should fall back to title matching"
        );
        assert_eq!(out[0].topic.as_deref(), Some("observability/diagnostics"));
    }

    #[test]
    fn confidence_grows_with_project_count() {
        let two = cluster_shared_findings(&[
            finding("p1", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
            finding("p2", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
        ]);
        let three = cluster_shared_findings(&[
            finding("p1", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
            finding("p2", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
            finding("p3", "llm_cost", Some("kpi_sim:cost:x"), "High spend"),
        ]);
        assert!(three[0].confidence.unwrap() > two[0].confidence.unwrap());
    }

    fn members(ids: &[&str]) -> std::collections::BTreeSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn skill_adoption_flags_heavy_use_absent_in_sibling() {
        let mem = members(&["p1", "p2", "p3"]);
        let mut present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
        present.insert("kpi-sim".into(), members(&["p1"])); // only p1 has it
        let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
        usage.insert(
            "kpi-sim".into(),
            vec![MinedSkillUse {
                project_id: "p1".into(),
                invokes_30d: 9,
            }],
        );
        let out = cluster_skill_adoption(&mem, &present, &usage);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].kind, "howto");
        assert_eq!(
            out[0].dedup_key.as_deref(),
            Some("miner:skill-adopt:kpi-sim")
        );
    }

    #[test]
    fn skill_present_everywhere_is_not_proposed() {
        let mem = members(&["p1", "p2"]);
        let mut present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
        present.insert("shared".into(), members(&["p1", "p2"]));
        let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
        usage.insert(
            "shared".into(),
            vec![MinedSkillUse {
                project_id: "p1".into(),
                invokes_30d: 20,
            }],
        );
        assert!(cluster_skill_adoption(&mem, &present, &usage).is_empty());
    }

    #[test]
    fn lightly_used_skill_is_not_proposed() {
        let mem = members(&["p1", "p2"]);
        let present: HashMap<String, std::collections::BTreeSet<String>> = HashMap::new();
        let mut usage: HashMap<String, Vec<MinedSkillUse>> = HashMap::new();
        // below MIN_SKILL_INVOKES_30D
        usage.insert(
            "rare".into(),
            vec![MinedSkillUse {
                project_id: "p1".into(),
                invokes_30d: 1,
            }],
        );
        assert!(cluster_skill_adoption(&mem, &present, &usage).is_empty());
    }

    // ------------------------------------------------------------------
    // Loop prevention (plan 1C) — the non-negotiable guard
    // ------------------------------------------------------------------

    /// THE loop this feature could have created: adopting one practice writes a
    /// `workspace_practice` idea into every member repo. If the finding miner
    /// then read those back, two repos carrying the SAME practice would look
    /// exactly like a "shared finding" and be re-proposed as a new workspace
    /// practice — which, adopted, fans out again. Each miner run would inflate
    /// the library with echoes of itself.
    ///
    /// So: a workspace_practice finding present in ≥2 projects — the exact
    /// shape that clusters for every other origin — must yield NO candidate.
    #[test]
    fn workspace_practice_findings_never_cluster_into_a_candidate() {
        let key = practice_dedup_key("prac-1");
        let echo = vec![
            finding(
                "p1",
                PRACTICE_ORIGIN,
                Some(key.as_str()),
                "Adopt workspace practice: Use design tokens",
            ),
            finding(
                "p2",
                PRACTICE_ORIGIN,
                Some(key.as_str()),
                "Adopt workspace practice: Use design tokens",
            ),
            finding(
                "p3",
                PRACTICE_ORIGIN,
                Some(key.as_str()),
                "Adopt workspace practice: Use design tokens",
            ),
        ];
        assert!(
            cluster_shared_findings(&echo).is_empty(),
            "materialized practices must never be mined back into the library"
        );

        // Control: the identical shape from a real sensor DOES cluster, proving
        // the guard is origin-specific and not just a broken clusterer.
        let real = vec![
            finding(
                "p1",
                "standards_finding",
                Some("standards:no-unwrap"),
                "Avoid unwrap",
            ),
            finding(
                "p2",
                "standards_finding",
                Some("standards:no-unwrap"),
                "Avoid unwrap",
            ),
        ];
        assert_eq!(cluster_shared_findings(&real).len(), 1);

        // And a mixed batch keeps the real signal while dropping the echo.
        let mut mixed = echo;
        mixed.extend(real);
        let out = cluster_shared_findings(&mixed);
        assert_eq!(out.len(), 1);
        assert!(!out[0]
            .dedup_key
            .as_deref()
            .unwrap()
            .contains(PRACTICE_ORIGIN));
    }

    #[test]
    fn practice_dedup_key_is_project_agnostic_and_not_miner_matchable() {
        assert_eq!(practice_dedup_key("abc"), "workspace_practice:abc");
        // Must NOT be classified project-agnostic: even with the SQL + cluster
        // guards removed, key-equality matching should never be the thing that
        // saves us.
        assert!(!is_project_agnostic_key(&practice_dedup_key("abc")));
    }

    #[test]
    fn practice_id_is_recovered_only_from_our_own_ideas() {
        let ev = r#"{"practice_id":"prac-9","workspace_id":"ws-1","kind":"pattern"}"#;
        assert_eq!(
            practice_id_from_evidence(Some(PRACTICE_ORIGIN), Some(ev)).as_deref(),
            Some("prac-9")
        );
        // Another sensor's evidence is never ours, whatever it contains.
        assert!(practice_id_from_evidence(Some("sentry_spike"), Some(ev)).is_none());
        assert!(practice_id_from_evidence(None, Some(ev)).is_none());
        // Missing / malformed / empty evidence degrades to None, never a panic.
        assert!(practice_id_from_evidence(Some(PRACTICE_ORIGIN), None).is_none());
        assert!(practice_id_from_evidence(Some(PRACTICE_ORIGIN), Some("not json")).is_none());
        assert!(
            practice_id_from_evidence(Some(PRACTICE_ORIGIN), Some(r#"{"practice_id":""}"#))
                .is_none()
        );
    }

    #[test]
    fn detail_truncation_respects_char_boundaries() {
        assert_eq!(truncate_chars("abc", 10), "abc");
        assert_eq!(truncate_chars("abcdef", 3), "abc…");
        // Multi-byte input must not panic or split a code point.
        assert_eq!(truncate_chars("héllo wörld", 4), "héll…");
    }

    // ------------------------------------------------------------------
    // Materialization + lifecycle (DB-backed)
    // ------------------------------------------------------------------

    /// Delegates to the crate fixture, which copies a once-built,
    /// fully-migrated template instead of re-running the migration chain
    /// (~436 statements) per test. This fixture used to run the chain
    /// itself against a shared-cache in-memory DB; correct, but it paid
    /// the full setup cost on every one of these tests.
    fn test_pool() -> DbPool {
        crate::init_test_db().expect("test db")
    }

    /// A workspace with `n` member projects and one proposed actionable
    /// practice. Returns (workspace_id, practice_id, project_ids).
    fn seeded(pool: &DbPool, n: usize, kind: &str) -> (String, String, Vec<String>) {
        let ws = create_workspace(pool, "WS", None, None, false).unwrap();
        let mut projects = Vec::new();
        for i in 0..n {
            let p = crate::repos::dev_tools::create_project(
                pool,
                &format!("Proj {i}"),
                &format!("/tmp/proj{i}"),
                None,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            assign_project(pool, &p.id, Some(&ws.id)).unwrap();
            projects.push(p.id);
        }
        let k = create_knowledge(
            pool,
            &ws.id,
            kind,
            "Use design tokens",
            "Raw Tailwind colours drift; use the semantic tokens.",
            Some("Long detail here."),
            Some("ui/tokens"),
            None,
            None,
        )
        .unwrap();
        (ws.id, k.id, projects)
    }

    fn practice_ideas(pool: &DbPool, practice_id: &str) -> Vec<crate::models::DevIdea> {
        let conn = pool.get().unwrap();
        let mut stmt = conn
            .prepare("SELECT * FROM dev_ideas WHERE dedup_key = ?1 ORDER BY project_id")
            .unwrap();
        let rows = stmt
            .query_map(
                params![practice_dedup_key(practice_id)],
                crate::repos::dev_tools::row_to_idea,
            )
            .unwrap();
        rows.collect::<Result<Vec<_>, _>>().unwrap()
    }

    fn cell(pool: &DbPool, practice_id: &str, project_id: &str) -> String {
        pool.get()
            .unwrap()
            .query_row(
                "SELECT state FROM workspace_practice_adoption WHERE practice_id = ?1 AND project_id = ?2",
                params![practice_id, project_id],
                |r| r.get::<_, String>(0),
            )
            .unwrap()
    }

    /// Adopt, then run the evidence step that actually earns `to_process`.
    ///
    /// Adoption alone no longer queues work (see `initial_adoption_state`): a
    /// cell reaches `to_process` only when a verdict says THIS repo does not
    /// comply. These tests exercise the materialization layer, so they need a
    /// queue — this is the verdict path in miniature, not a shortcut around it.
    fn adopt_and_find_gaps(pool: &DbPool, practice: &str, projects: &[String]) {
        decide_knowledge(pool, practice, "adopt", None).unwrap();
        for project in projects {
            let prior = cell(pool, practice, project);
            let next = adoption_state_after_verdict(&prior, false, true);
            set_adoption(pool, practice, project, next, None, None).unwrap();
        }
    }

    #[test]
    fn adopting_an_actionable_practice_materializes_one_idea_per_project_exactly_once() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        adopt_and_find_gaps(&pool, &practice, &projects);

        assert_eq!(
            materialize_pending_for_practice(&pool, &practice).unwrap(),
            2
        );
        let ideas = practice_ideas(&pool, &practice);
        assert_eq!(ideas.len(), 2);
        assert!(ideas
            .iter()
            .all(|i| i.origin.as_deref() == Some(PRACTICE_ORIGIN)));
        assert!(ideas.iter().all(|i| i.status == "pending"));
        assert_eq!(
            ideas[0].title,
            "Adopt workspace practice: Use design tokens"
        );
        // Statement AND detail reach the description — this text seeds the task prompt.
        let desc = ideas[0].description.clone().unwrap();
        assert!(desc.contains("semantic tokens"));
        assert!(desc.contains("Long detail here."));
        // Evidence round-trips the practice id, which is how every later
        // lifecycle write finds its way back to the adoption cell.
        assert_eq!(
            practice_id_from_evidence(ideas[0].origin.as_deref(), ideas[0].evidence.as_deref()),
            Some(practice.clone())
        );

        // IDEMPOTENCY: re-adopting (or a second backfill) inserts nothing new.
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        assert_eq!(
            materialize_pending_for_practice(&pool, &practice).unwrap(),
            0
        );
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);
        assert_eq!(practice_ideas(&pool, &practice).len(), 2);

        // Every project got exactly one.
        let mut seen: Vec<String> = practice_ideas(&pool, &practice)
            .into_iter()
            .filter_map(|i| i.project_id)
            .collect();
        seen.sort();
        let mut expected = projects.clone();
        expected.sort();
        assert_eq!(seen, expected);
    }

    #[test]
    fn pitfall_titles_read_as_removal_work() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 1, "pitfall");
        adopt_and_find_gaps(&pool, &practice, &projects);
        materialize_pending_for_practice(&pool, &practice).unwrap();
        assert_eq!(
            practice_ideas(&pool, &practice)[0].title,
            "Fix workspace pitfall: Use design tokens"
        );
    }

    #[test]
    fn reference_kinds_never_reach_the_backlog() {
        // `fact` / `decision` / `howto` are carried as knowledge, not executed.
        // Stronger than the old seeding-based version: even when a verdict
        // pushes their cells all the way to `to_process`, materialization
        // refuses on kind — the backlog guard does not depend on how the queue
        // was filled.
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "fact");
        adopt_and_find_gaps(&pool, &practice, &projects);
        assert_eq!(cell(&pool, &practice, &projects[0]), "to_process");
        assert_eq!(
            materialize_pending_for_practice(&pool, &practice).unwrap(),
            0
        );
        assert!(practice_ideas(&pool, &practice).is_empty());
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);
    }

    #[test]
    fn backfill_materializes_a_queue_seeded_before_the_feature_existed() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        adopt_and_find_gaps(&pool, &practice, &projects);
        // Cells exist at `to_process` but no ideas — the pre-P6 world.
        assert!(practice_ideas(&pool, &practice).is_empty());

        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 2);
        assert_eq!(practice_ideas(&pool, &practice).len(), 2);
        // Second run is a no-op — safe to call on every boot.
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);

        // A cell that has moved on is not re-materialized either.
        set_adoption(&pool, &practice, &projects[0], "diverged", None, None).unwrap();
        assert_eq!(backfill_practice_ideas(&pool).unwrap(), 0);
    }

    #[test]
    fn deprecating_a_practice_archives_only_its_undecided_ideas() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        adopt_and_find_gaps(&pool, &practice, &projects);
        materialize_pending_for_practice(&pool, &practice).unwrap();

        // One project already accepted the work: that verdict is a human's and
        // survives the practice being retired.
        let accepted = practice_ideas(&pool, &practice)
            .into_iter()
            .find(|i| i.project_id.as_deref() == Some(projects[0].as_str()))
            .unwrap();
        crate::repos::dev_tools::update_idea(
            &pool,
            &accepted.id,
            None,
            None,
            Some("accepted"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        assert_eq!(archive_practice_ideas(&pool, &practice).unwrap(), 1);
        let after = practice_ideas(&pool, &practice);
        assert_eq!(after.iter().filter(|i| i.status == "archived").count(), 1);
        assert_eq!(after.iter().filter(|i| i.status == "accepted").count(), 1);

        // The archived row keeps the dedup key, so re-adoption cannot stack a
        // second copy (documented trade-off, plan §Open questions).
        assert_eq!(
            materialize_pending_for_practice(&pool, &practice).unwrap(),
            0
        );
    }

    #[test]
    fn adoption_cell_follows_the_idea_and_its_task() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        adopt_and_find_gaps(&pool, &practice, &projects);
        materialize_pending_for_practice(&pool, &practice).unwrap();
        let ideas = practice_ideas(&pool, &practice);
        let for_project = |pid: &str| {
            ideas
                .iter()
                .find(|i| i.project_id.as_deref() == Some(pid))
                .unwrap()
                .clone()
        };

        // Reject → the repo has explicitly opted out. `diverged` (not `na`) is
        // the state that stays visible as a reviewable exception.
        let mut rejected = for_project(&projects[0]);
        rejected.status = "rejected".into();
        rejected.rejection_reason = Some("we use CSS modules".into());
        sync_practice_adoption(&pool, &rejected);
        assert_eq!(cell(&pool, &practice, &projects[0]), "diverged");
        let note: Option<String> = pool
            .get()
            .unwrap()
            .query_row(
                "SELECT note FROM workspace_practice_adoption WHERE practice_id = ?1 AND project_id = ?2",
                params![practice, projects[0]],
                |r| r.get(0),
            )
            .unwrap();
        assert!(note.unwrap().contains("we use CSS modules"));

        // Accepting alone changes nothing — intent is not shipped work.
        let mut accepted = for_project(&projects[1]);
        accepted.status = "accepted".into();
        sync_practice_adoption(&pool, &accepted);
        assert_eq!(cell(&pool, &practice, &projects[1]), "to_process");

        // Task created → dispatched; task failed → back in the queue; task
        // succeeded → adopted. Failure must never leave the matrix claiming a
        // practice is adopted.
        sync_practice_adoption_for_task(&pool, &accepted, "dispatched", "task:t1");
        assert_eq!(cell(&pool, &practice, &projects[1]), "dispatched");
        sync_practice_adoption_for_task(&pool, &accepted, "to_process", "task:t1 failed: boom");
        assert_eq!(cell(&pool, &practice, &projects[1]), "to_process");
        sync_practice_adoption_for_task(&pool, &accepted, "adopted", "task:t2 completed");
        assert_eq!(cell(&pool, &practice, &projects[1]), "adopted");
    }

    #[test]
    fn lifecycle_sync_ignores_ideas_that_are_not_materialized_practices() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 1, "pattern");
        adopt_and_find_gaps(&pool, &practice, &projects);
        materialize_pending_for_practice(&pool, &practice).unwrap();

        let mut foreign = practice_ideas(&pool, &practice)[0].clone();
        foreign.origin = Some("sentry_spike".into());
        foreign.status = "rejected".into();
        sync_practice_adoption(&pool, &foreign);
        // Untouched — a sensor finding's rejection says nothing about a practice.
        assert_eq!(cell(&pool, &practice, &projects[0]), "to_process");
    }

    #[test]
    fn mining_skips_materialized_practices_end_to_end() {
        let pool = test_pool();
        let (ws, practice, _projects) = seeded(&pool, 2, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        materialize_pending_for_practice(&pool, &practice).unwrap();
        // Two member projects now hold the same practice idea — the miner must
        // read past them and find nothing.
        assert!(mine_shared_findings(&pool, &ws).unwrap().is_empty());
    }

    // ------------------------------------------------------------------
    // Compare-and-swap on the governance gate
    // ------------------------------------------------------------------

    fn status_of(pool: &DbPool, practice: &str) -> String {
        get_knowledge_by_id(pool, practice).unwrap().status
    }

    #[test]
    fn a_verdict_written_against_a_stale_status_loses_the_swap() {
        let pool = test_pool();
        let (_ws, practice, _projects) = seeded(&pool, 2, "pattern");

        // Surface A rejects the row. `create_knowledge` seeds `proposed`.
        decide_knowledge_cas(&pool, &practice, "reject", None, Some("proposed")).unwrap();

        // Surface B was still rendering it as `proposed` and adopts. Before the
        // swap this silently flipped the row to `adopted` AND fanned an adoption
        // cell into every member repo.
        let err =
            decide_knowledge_cas(&pool, &practice, "adopt", None, Some("proposed")).unwrap_err();
        assert!(
            err.to_string().contains("already decided"),
            "expected a concurrency conflict, got: {err}"
        );
        assert_eq!(status_of(&pool, &practice), "rejected");
    }

    #[test]
    fn a_lost_swap_fans_out_no_adoption_cells() {
        let pool = test_pool();
        let (_ws, practice, projects) = seeded(&pool, 2, "pattern");
        decide_knowledge_cas(&pool, &practice, "reject", None, Some("proposed")).unwrap();

        assert!(decide_knowledge_cas(&pool, &practice, "adopt", None, Some("proposed")).is_err());

        // The adoption fan-out is the expensive half of `adopt`; a rolled-back
        // decision must not leave a single cell behind.
        for project in &projects {
            let count: i64 = pool
                .get()
                .unwrap()
                .query_row(
                    "SELECT COUNT(*) FROM workspace_practice_adoption
                     WHERE practice_id = ?1 AND project_id = ?2",
                    params![practice, project],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "a losing adopt seeded an adoption cell");
        }
    }

    #[test]
    fn a_verdict_against_the_status_the_reviewer_sees_still_lands() {
        // Reversing a decision you can SEE is a decision; only a verdict written
        // against a status the row no longer holds is data loss.
        let pool = test_pool();
        let (_ws, practice, _projects) = seeded(&pool, 1, "pattern");
        decide_knowledge_cas(&pool, &practice, "reject", None, Some("proposed")).unwrap();
        decide_knowledge_cas(&pool, &practice, "adopt", None, Some("rejected")).unwrap();
        assert_eq!(status_of(&pool, &practice), "adopted");
    }

    #[test]
    fn re_applying_the_status_a_practice_already_holds_is_a_no_op_success() {
        // Keeps a replayed bulk decision from reporting failures it did not cause.
        let pool = test_pool();
        let (_ws, practice, _projects) = seeded(&pool, 1, "pattern");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        let again = decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        assert_eq!(again.status, "adopted");
    }

    #[test]
    fn callers_with_no_rendered_row_still_decide_normally() {
        let pool = test_pool();
        let (_ws, practice, _projects) = seeded(&pool, 1, "pattern");
        decide_knowledge(&pool, &practice, "propose", None).unwrap();
        assert_eq!(status_of(&pool, &practice), "proposed");
        decide_knowledge(&pool, &practice, "adopt", None).unwrap();
        assert_eq!(status_of(&pool, &practice), "adopted");
    }
}
