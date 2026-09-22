//! The Features page's ONE read.
//!
//! A project carries 50-100 features over 200+ contexts, so the shape of this
//! module is its whole argument: **every table is read once, in bulk, and
//! joined in memory.** There is no per-feature query anywhere below. A
//! per-feature round trip would be a hundred statements to paint one screen,
//! and the one that is easy to miss is the per-feature CONTEXT read - the
//! slice hydration - which is why the links come back in a single join over
//! the project rather than through [`super::use_cases::list_use_cases`].
//!
//! The one exception is deliberate and named: council subject states come from
//! [`super::council::list_subject_states`], which walks its own subjects. That
//! function is the single derivation of the nine council states, and a second
//! copy here would be a second answer. A project has one subject per
//! COUNCILLED feature, which is a small fraction of its features.
//!
//! Two absences are facts rather than gaps:
//!
//! - `council: None` means no council has ever judged this feature. That is not
//!   a zero score and the page must not draw it as one.
//! - `spend30d_usd: None` everywhere: `dev_llm_spend` carries source, trigger,
//!   persona and project, and no use-case dimension at all. A join invented
//!   here would put a number on the page with nothing behind it.

use std::collections::{BTreeMap, BTreeSet};

use crate::models::{
    BoardContext, BoardEnvelope, BoardFeature, BoardGroup, BoardRound, BoardScenario,
    BoardScenarioResult, BoardVerdict, CouncilSubjectState, FeatureBoard, FeatureBoardTotals,
    FeatureScenario,
};
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::models::{
    aggregate_scenarios, rubric_for, ContextRoleInputs, ScenarioDeclaration, ScenarioReport,
};
use rusqlite::params;

/// One context row, before it knows its role.
struct RawContext {
    id: String,
    name: String,
    group_id: Option<String>,
    category: Option<String>,
}

/// One group row, before its counts.
struct RawGroup {
    id: String,
    name: String,
    domain: Option<String>,
}

/// One feature row, before its council.
struct RawFeature {
    id: String,
    slug: String,
    name: String,
    description: Option<String>,
    kind: String,
    tier: String,
    primary_context_id: Option<String>,
}

/// The whole Features page for one project.
pub fn feature_board(pool: &DbPool, project_id: &str) -> Result<FeatureBoard, AppError> {
    timed_query!("dev_use_cases", "feature_board::read", {
        let conn = pool.get()?;

        let project_name: String = conn
            .query_row(
                "SELECT name FROM dev_projects WHERE id = ?1",
                params![project_id],
                |r| r.get("name"),
            )
            .map_err(|_| AppError::NotFound(format!("Project {project_id} not found")))?;

        let groups: Vec<RawGroup> = {
            let mut stmt = conn.prepare(
                "SELECT id, name, domain FROM dev_context_groups
                  WHERE project_id = ?1 ORDER BY position ASC, name COLLATE NOCASE ASC",
            )?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok(RawGroup {
                    id: r.get("id")?,
                    name: r.get("name")?,
                    domain: r.get("domain")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        let contexts: Vec<RawContext> = {
            let mut stmt = conn.prepare(
                "SELECT id, name, group_id, category FROM dev_contexts
                  WHERE project_id = ?1 ORDER BY name COLLATE NOCASE ASC",
            )?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok(RawContext {
                    id: r.get("id")?,
                    name: r.get("name")?,
                    group_id: r.get("group_id")?,
                    category: r.get("category")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        // Archived features are excluded: the board is what the product claims
        // to do NOW, and a retired feature's slice must not keep a context
        // looking claimed.
        let features: Vec<RawFeature> = {
            let mut stmt = conn.prepare(
                "SELECT id, slug, name, description, kind, tier, primary_context_id
                   FROM dev_use_cases
                  WHERE project_id = ?1 AND status != 'archived'
                  ORDER BY name COLLATE NOCASE ASC",
            )?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok(RawFeature {
                    id: r.get("id")?,
                    slug: r.get("slug")?,
                    name: r.get("name")?,
                    description: r.get("description")?,
                    kind: r.get("kind")?,
                    tier: r.get("tier")?,
                    primary_context_id: r.get("primary_context_id")?,
                })
            })?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        // The slice, for every feature of the project, in ONE statement.
        // `never_scanned` is measured over ALL links (archived included): a
        // project whose only scan produced links that were then archived HAS
        // been scanned, and telling its operator to scan again would be wrong.
        let mut links: Vec<(String, String)> = Vec::new();
        let mut any_link = false;
        {
            let mut stmt = conn.prepare(
                "SELECT ucc.use_case_id AS use_case_id, ucc.context_id AS context_id,
                        u.status AS status
                   FROM dev_use_case_contexts ucc
                   JOIN dev_use_cases u ON u.id = ucc.use_case_id
                  WHERE u.project_id = ?1",
            )?;
            let rows = stmt.query_map(params![project_id], |r| {
                Ok((
                    r.get::<_, String>("use_case_id")?,
                    r.get::<_, String>("context_id")?,
                    r.get::<_, String>("status")?,
                ))
            })?;
            for row in rows {
                let (uc, ctx, status) = row?;
                any_link = true;
                if status != "archived" {
                    links.push((uc, ctx));
                }
            }
        }
        drop(conn);

        let scenarios = super::scenarios::list_scenarios_for_project(pool, project_id)?;
        let subjects = super::council::list_subject_states(pool, Some(project_id))?;
        build_board(
            project_id,
            &project_name,
            groups,
            contexts,
            features,
            &links,
            any_link,
            subjects,
            scenarios,
            pool,
        )
    })
}

/// Assemble the payload. Split out so the joining - which is where a board
/// gets its arithmetic wrong - is one function with every input in front of it.
#[allow(clippy::too_many_arguments)]
fn build_board(
    project_id: &str,
    project_name: &str,
    groups: Vec<RawGroup>,
    contexts: Vec<RawContext>,
    features: Vec<RawFeature>,
    links: &[(String, String)],
    any_link: bool,
    subjects: Vec<CouncilSubjectState>,
    scenarios: Vec<FeatureScenario>,
    pool: &DbPool,
) -> Result<FeatureBoard, AppError> {
    let feature_slug: BTreeMap<&str, &str> = features
        .iter()
        .map(|f| (f.id.as_str(), f.slug.as_str()))
        .collect();
    let group_domain: BTreeMap<&str, Option<&str>> = groups
        .iter()
        .map(|g| (g.id.as_str(), g.domain.as_deref()))
        .collect();

    let mut contexts_of_feature: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let mut features_of_context: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for (uc, ctx) in links {
        let Some(slug) = feature_slug.get(uc.as_str()) else {
            continue;
        };
        contexts_of_feature
            .entry(uc.as_str())
            .or_default()
            .push(ctx.clone());
        features_of_context
            .entry(ctx.as_str())
            .or_default()
            .insert(slug);
    }

    // --- contexts and their roles ------------------------------------------
    let mut board_contexts: Vec<BoardContext> = Vec::with_capacity(contexts.len());
    let mut core_groups: BTreeSet<&str> = BTreeSet::new();
    let mut totals = FeatureBoardTotals {
        contexts: contexts.len() as i32,
        groups: groups.len() as i32,
        features: features.len() as i32,
        ..Default::default()
    };
    for c in &contexts {
        let claimed = features_of_context.get(c.id.as_str());
        let role = personas_core::models::derive_context_role(&ContextRoleInputs {
            in_active_feature: claimed.is_some_and(|s| !s.is_empty()),
            name: &c.name,
            category: c.category.as_deref(),
            group_domain: c
                .group_id
                .as_deref()
                .and_then(|g| group_domain.get(g))
                .copied()
                .flatten(),
        });
        match role {
            "core" => {
                totals.core += 1;
                if let Some(g) = c.group_id.as_deref() {
                    core_groups.insert(g);
                }
            }
            "tests" => totals.tests += 1,
            "platform" => totals.platform += 1,
            _ => totals.unclaimed += 1,
        }
        board_contexts.push(BoardContext {
            id: c.id.clone(),
            name: c.name.clone(),
            group_id: c.group_id.clone(),
            category: c.category.clone(),
            role: role.to_string(),
            feature_slugs: claimed
                .map(|s| s.iter().map(|x| (*x).to_string()).collect())
                .unwrap_or_default(),
        });
    }

    // --- groups -------------------------------------------------------------
    let mut board_groups: Vec<BoardGroup> = Vec::with_capacity(groups.len());
    for g in &groups {
        let members: Vec<&RawContext> = contexts
            .iter()
            .filter(|c| c.group_id.as_deref() == Some(g.id.as_str()))
            .collect();
        let mut feature_ids: BTreeSet<&str> = BTreeSet::new();
        for c in &members {
            if let Some(slugs) = features_of_context.get(c.id.as_str()) {
                feature_ids.extend(slugs.iter().copied());
            }
        }
        board_groups.push(BoardGroup {
            id: g.id.clone(),
            name: g.name.clone(),
            domain: g.domain.clone(),
            context_count: members.len() as i32,
            feature_count: feature_ids.len() as i32,
            // Not one CORE context. A group whose every context is platform or
            // tests is a group no feature reaches, which is the finding.
            untouched: !core_groups.contains(g.id.as_str()),
        });
    }

    // --- council, verdicts, history, scenarios ------------------------------
    let council_of_feature: BTreeMap<String, CouncilSubjectState> = subjects
        .into_iter()
        .filter_map(|s| s.use_case_id.clone().map(|uc| (uc, s)))
        .collect();

    let subject_ids: Vec<String> = council_of_feature.values().map(|s| s.id.clone()).collect();
    let latest_run_ids: Vec<String> = council_of_feature
        .values()
        .filter_map(|s| s.latest_run_id.clone())
        .collect();

    let history = rounds_for_subjects(pool, &subject_ids)?;
    let verdicts = verdicts_for_runs(pool, &latest_run_ids)?;
    let results = super::scenarios::list_results_for_runs(pool, &latest_run_ids)?;
    let mut result_of_scenario: BTreeMap<String, crate::models::CouncilScenarioResult> =
        BTreeMap::new();
    for r in results {
        result_of_scenario.insert(r.scenario_id.clone(), r);
    }

    // Grouped in DECLARATION order, which `list_scenarios_for_project` already
    // returns - the fold's S2 depends on it, and so does the envelope this
    // must agree with.
    let mut declared_of_feature: BTreeMap<String, Vec<FeatureScenario>> = BTreeMap::new();
    for s in scenarios {
        declared_of_feature
            .entry(s.use_case_id.clone())
            .or_default()
            .push(s);
    }

    // --- features -----------------------------------------------------------
    let mut board_features: Vec<BoardFeature> = Vec::with_capacity(features.len());
    for f in &features {
        if f.tier == "major" {
            totals.majors += 1;
        }
        let council = council_of_feature.get(&f.id).cloned();
        if let Some(c) = council.as_ref() {
            if c.state == "ready" && f.tier == "major" {
                totals.waiting_on_you += 1;
            }
            if matches!(
                c.state.as_str(),
                "fail" | "stalled" | "rejected" | "approved_drifted"
            ) {
                totals.in_trouble += 1;
            }
        }
        let context_ids = contexts_of_feature
            .get(f.id.as_str())
            .cloned()
            .unwrap_or_default();
        let mut group_ids: Vec<String> = context_ids
            .iter()
            .filter_map(|c| {
                contexts
                    .iter()
                    .find(|x| &x.id == c)
                    .and_then(|x| x.group_id.clone())
            })
            .collect();
        group_ids.sort();
        group_ids.dedup();

        let run_verdicts = council
            .as_ref()
            .and_then(|c| c.latest_run_id.as_deref())
            .and_then(|id| verdicts.get(id))
            .cloned()
            .unwrap_or_default();

        let declared = declared_of_feature.remove(&f.id).unwrap_or_default();
        let trust_state = council
            .as_ref()
            .and_then(|c| c.trust_state.as_deref())
            .unwrap_or("uncalibrated");
        let (board_scenarios, envelope) =
            fold_scenarios(&declared, &result_of_scenario, trust_state);

        board_features.push(BoardFeature {
            id: f.id.clone(),
            slug: f.slug.clone(),
            name: f.name.clone(),
            description: f.description.clone(),
            kind: f.kind.clone(),
            tier: f.tier.clone(),
            context_ids,
            group_ids,
            primary_context_id: f.primary_context_id.clone(),
            history: council
                .as_ref()
                .and_then(|c| history.get(c.id.as_str()))
                .cloned()
                .unwrap_or_default(),
            verdicts: run_verdicts,
            scenarios: board_scenarios,
            envelope,
            council,
            // See the module header: there is no use-case dimension on the
            // spend ledger, so there is no honest number to put here.
            spend30d_usd: None,
        });
    }

    Ok(FeatureBoard {
        project_id: project_id.to_string(),
        project_name: project_name.to_string(),
        never_scanned: !features.is_empty() && !any_link,
        totals,
        groups: board_groups,
        contexts: board_contexts,
        features: board_features,
    })
}

/// One feature's scenarios and its standing envelope.
///
/// Through `personas_core::models::aggregate_scenarios` - the SAME function
/// the ingest door recomputes an incoming result with. The board is not
/// allowed a second opinion about where an approval holds: if this computed
/// the buckets itself, the page and the run it came from could disagree and
/// nothing would catch it.
///
/// `None` when the feature declares no scenarios: that is not an empty
/// envelope, it is no envelope, and the page must be able to tell the two
/// apart. A stored result can only exist against a declared row (the foreign
/// key says so), so an absent declaration means an absent everything.
fn fold_scenarios(
    declared: &[FeatureScenario],
    results: &BTreeMap<String, crate::models::CouncilScenarioResult>,
    trust_state: &str,
) -> (Vec<BoardScenario>, Option<BoardEnvelope>) {
    if declared.is_empty() {
        return (Vec::new(), None);
    }
    let declarations: Vec<ScenarioDeclaration> = declared
        .iter()
        .map(super::scenarios::declaration_of)
        .collect();
    let reported: Vec<ScenarioReport> = declared
        .iter()
        .filter_map(|s| results.get(&s.id).map(|r| (s, r)))
        .map(|(s, r)| ScenarioReport {
            slug: s.slug.clone(),
            title: None,
            axes: None,
            state: r.state.clone(),
            score: r.score,
            confidence: r.confidence.clone(),
            n: r.n,
            proof: r.proof.clone(),
            summary: r.summary.clone(),
        })
        .collect();

    let agg = aggregate_scenarios(&declarations, &reported, trust_state);
    let folded: BTreeMap<&str, &personas_core::models::ScenarioFold> =
        agg.scenarios.iter().map(|f| (f.slug.as_str(), f)).collect();

    let scenarios = declared
        .iter()
        .map(|s| {
            let fold = folded.get(s.slug.as_str());
            BoardScenario {
                id: s.id.clone(),
                slug: s.slug.clone(),
                title: s.title.clone(),
                axes: s.axes.clone(),
                scope: s.scope.clone(),
                source: s.source.clone(),
                floor: fold.map_or_else(
                    || personas_core::models::resolve_scenario_floor(s.floor),
                    |f| f.floor,
                ),
                // The result is shown as the FOLD read it, not as the row
                // stores it: `floor_hit` and `advisory` are recomputed from the
                // scenario's current scope and the run's trust state, so
                // promoting a scenario to `must_hold` makes an old weak score
                // read as a hit without rewriting the ledger.
                latest: results.get(&s.id).map(|r| BoardScenarioResult {
                    run_id: r.run_id.clone(),
                    state: fold.map_or_else(|| r.state.clone(), |f| f.state.clone()),
                    score: fold.map_or(r.score, |f| f.score),
                    confidence: r.confidence.clone(),
                    n: r.n,
                    proof: r.proof.clone(),
                    floor_hit: fold.is_some_and(|f| f.floor_hit),
                    advisory: fold.is_some_and(|f| f.advisory),
                    summary: r.summary.clone(),
                }),
            }
        })
        .collect();
    (scenarios, Some(agg.envelope))
}

/// Every round of every named subject, oldest first, in one query.
fn rounds_for_subjects(
    pool: &DbPool,
    subject_ids: &[String],
) -> Result<BTreeMap<String, Vec<BoardRound>>, AppError> {
    let mut out: BTreeMap<String, Vec<BoardRound>> = BTreeMap::new();
    if subject_ids.is_empty() {
        return Ok(out);
    }
    let conn = pool.get()?;
    let placeholders = vec!["?"; subject_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT subject_id, round_no, overall, outcome, finished_at, ingested_at
           FROM dev_council_runs
          WHERE subject_id IN ({placeholders})
          ORDER BY subject_id, round_no ASC"
    ))?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(subject_ids.iter().map(String::as_str)),
        |r| {
            Ok((
                r.get::<_, String>("subject_id")?,
                BoardRound {
                    round_no: r.get("round_no")?,
                    overall: r.get("overall")?,
                    outcome: r.get("outcome")?,
                    // A run that never recorded a finish still HAPPENED, and
                    // the moment it entered the ledger is the honest stand-in.
                    // Never a blank: the timeline is ordered by this field.
                    finished_at: r
                        .get::<_, Option<String>>("finished_at")?
                        .unwrap_or(r.get::<_, String>("ingested_at")?),
                },
            ))
        },
    )?;
    for row in rows {
        let (subject_id, round) = row?;
        out.entry(subject_id).or_default().push(round);
    }
    Ok(out)
}

/// The latest runs' verdicts, in one query, with the WEIGHT taken from the
/// pinned rubric rather than from the row - the weight is what this app
/// believes, and a stored copy would drift from it in silence.
fn verdicts_for_runs(
    pool: &DbPool,
    run_ids: &[String],
) -> Result<BTreeMap<String, Vec<BoardVerdict>>, AppError> {
    let mut out: BTreeMap<String, Vec<BoardVerdict>> = BTreeMap::new();
    if run_ids.is_empty() {
        return Ok(out);
    }
    let conn = pool.get()?;
    let placeholders = vec!["?"; run_ids.len()].join(",");
    let mut stmt = conn.prepare(&format!(
        "SELECT v.run_id AS run_id, v.dimension AS dimension, v.kind AS kind,
                v.state AS state, v.score AS score, v.floor AS floor,
                v.floor_hit AS floor_hit, v.advisory AS advisory,
                r.rubric_version AS rubric_version
           FROM dev_council_verdicts v
           JOIN dev_council_runs r ON r.id = v.run_id
          WHERE v.run_id IN ({placeholders})
          ORDER BY v.run_id, v.dimension ASC"
    ))?;
    let rows = stmt.query_map(
        rusqlite::params_from_iter(run_ids.iter().map(String::as_str)),
        |r| {
            let dimension: String = r.get("dimension")?;
            let rubric_version: String = r.get("rubric_version")?;
            let weight = rubric_for(&rubric_version)
                .and_then(|rb| rb.iter().find(|e| e.dimension == dimension))
                .map(|e| e.weight)
                // A dimension this app's rubric does not carry weighs nothing
                // in a recomputation, which is the only honest answer: the
                // alternative is inventing a weight for a member we cannot
                // place. The ingest door refuses such a row, so reaching this
                // means the rubric vocabulary moved under an old run.
                .unwrap_or(0.0);
            Ok((
                r.get::<_, String>("run_id")?,
                BoardVerdict {
                    dimension,
                    kind: r.get("kind")?,
                    state: r.get("state")?,
                    score: r.get("score")?,
                    weight,
                    floor: r.get("floor")?,
                    floor_hit: r.get::<_, i64>("floor_hit")? != 0,
                    advisory: r.get::<_, i64>("advisory")? != 0,
                },
            ))
        },
    )?;
    for row in rows {
        let (run_id, verdict) = row?;
        out.entry(run_id).or_default().push(verdict);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::UpsertScenarioInput;
    use crate::repos::dev::council::{upsert_subject, NewRun, NewVerdict};
    use crate::repos::dev::projects::create_project;
    use crate::repos::dev::scenarios::upsert_scenario;
    use crate::repos::dev::use_cases::{create_use_case, set_use_case_tier};

    /// A project with two groups and four contexts, spanning every role the
    /// board can derive.
    fn seeded() -> (DbPool, String) {
        let pool = crate::init_test_db().unwrap();
        let project = create_project(&pool, "P", "/tmp/p", None, None, None, None, None).unwrap();
        seed_map(&pool, &project.id).unwrap();
        (pool, project.id)
    }

    /// The context map the board reads. The checkout PROPAGATES rather than
    /// panicking: a fixture that panics on acquire hides the same pool
    /// saturation the product would (census `pool-get-unwrapped`).
    fn seed_map(pool: &DbPool, project_id: &str) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_context_groups (id, project_id, name, domain, position)
             VALUES ('g-feat',?1,'Interviewing','feature',0),
                    ('g-infra',?1,'Platform','infrastructure',1)",
            params![project_id],
        )?;
        conn.execute(
            "INSERT INTO dev_contexts (id, project_id, group_id, name, category)
             VALUES ('c-api',?1,'g-feat','interview-api','api'),
                    ('c-ui',?1,'g-feat','interview-ui','ui'),
                    ('c-tests',?1,'g-feat','tests-interview',NULL),
                    ('c-vault',?1,'g-infra','vault-crypto','api')",
            params![project_id],
        )?;
        Ok(())
    }

    /// Retire a feature without going through the use-case repo's full update
    /// surface - and, again, without turning a pool checkout into a panic.
    fn archive(pool: &DbPool, use_case_id: &str) -> Result<(), AppError> {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_use_cases SET status = 'archived' WHERE id = ?1",
            params![use_case_id],
        )?;
        Ok(())
    }

    fn feature(pool: &DbPool, project_id: &str, name: &str, contexts: &[&str]) -> String {
        let ids: Vec<String> = contexts.iter().map(|c| (*c).to_string()).collect();
        create_use_case(
            pool,
            project_id,
            name,
            None,
            "capability",
            None,
            &ids,
            Some("active"),
            "scan",
            None,
        )
        .unwrap()
        .id
    }

    fn a_run(subject_id: &str, round: i32, outcome: &str, dir: &str) -> NewRun {
        NewRun {
            subject_id: subject_id.to_string(),
            round_no: round,
            supersedes_run_id: None,
            rubric_version: "feature-v1".into(),
            trust_state: "uncalibrated".into(),
            outcome: outcome.into(),
            overall: Some(0.685),
            coverage: 1.0,
            head_sha: "abc".into(),
            span_digest: "d".into(),
            spanned_paths_json: "[]".into(),
            hard_failures_json: "[]".into(),
            must_address_json: "[]".into(),
            summary: "s".into(),
            run_dir: dir.into(),
            started_at: None,
            finished_at: Some(format!("2026-09-2{round}T00:00:00Z")),
        }
    }

    fn a_verdict(dim: &str, score: f64) -> NewVerdict {
        NewVerdict {
            dimension: dim.into(),
            kind: "judged".into(),
            state: "measured".into(),
            score: Some(score),
            confidence: "med".into(),
            floor: Some(0.4),
            floor_hit: score < 0.4,
            advisory: true,
            payload_json: "{}".into(),
        }
    }

    /// The whole board over three features: one councilled across two rounds,
    /// one `ready` major waiting on a human, one never councilled.
    #[test]
    fn the_board_reads_three_features_in_one_go() {
        let (pool, project_id) = seeded();
        let interview = feature(&pool, &project_id, "AI Voice Interview", &["c-api", "c-ui"]);
        let scoring = feature(&pool, &project_id, "Scoring", &["c-api"]);
        let _fresh = feature(&pool, &project_id, "Drafts", &[]);
        set_use_case_tier(&pool, &interview, "major").unwrap();
        set_use_case_tier(&pool, &scoring, "major").unwrap();

        // Two rounds on the interview, the second one a fail.
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "ai-voice-interview",
            "AI Voice Interview",
            Some(&interview),
        )
        .unwrap();
        crate::repos::dev::council::insert_run(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/i1"),
            &[a_verdict("value", 0.8)],
        )
        .unwrap();
        crate::repos::dev::council::insert_run(
            &pool,
            &a_run(&subject.id, 2, "fail", "/runs/i2"),
            &[a_verdict("value", 0.2), a_verdict("craft", 0.6)],
        )
        .unwrap();

        // One ready round on the scoring feature.
        let (scoring_subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "scoring",
            "Scoring",
            Some(&scoring),
        )
        .unwrap();
        crate::repos::dev::council::insert_run(
            &pool,
            &a_run(&scoring_subject.id, 1, "ready", "/runs/s1"),
            &[a_verdict("value", 0.9)],
        )
        .unwrap();

        let board = feature_board(&pool, &project_id).unwrap();
        assert_eq!(board.project_name, "P");
        assert!(!board.never_scanned, "two features carry a slice");
        assert_eq!(board.totals.features, 3);
        assert_eq!(board.totals.majors, 2);
        assert_eq!(board.totals.contexts, 4);
        assert_eq!(board.totals.groups, 2);
        // c-api + c-ui are claimed; tests-interview is tests; vault-crypto is
        // platform by its group's infrastructure domain.
        assert_eq!(board.totals.core, 2);
        assert_eq!(board.totals.tests, 1);
        assert_eq!(board.totals.platform, 1);
        assert_eq!(board.totals.unclaimed, 0);
        assert_eq!(
            board.totals.waiting_on_you, 1,
            "only Scoring is ready+major"
        );
        assert_eq!(board.totals.in_trouble, 1, "the interview's round 2 failed");

        let interview_row = board
            .features
            .iter()
            .find(|f| f.id == interview)
            .expect("the interview is on the board");
        assert_eq!(interview_row.history.len(), 2);
        assert_eq!(
            interview_row
                .history
                .iter()
                .map(|h| h.round_no)
                .collect::<Vec<_>>(),
            vec![1, 2],
            "history is oldest first"
        );
        // The LATEST run's verdicts, and their weights come from the rubric.
        assert_eq!(interview_row.verdicts.len(), 2);
        let value = interview_row
            .verdicts
            .iter()
            .find(|v| v.dimension == "value")
            .unwrap();
        assert!((value.weight - 0.30).abs() < 1e-9, "{}", value.weight);
        assert!(value.floor_hit);
        let craft = interview_row
            .verdicts
            .iter()
            .find(|v| v.dimension == "craft")
            .unwrap();
        assert!((craft.weight - 0.25).abs() < 1e-9);
        assert_eq!(interview_row.council.as_ref().unwrap().state, "fail");
        assert_eq!(interview_row.group_ids, vec!["g-feat".to_string()]);
        assert_eq!(interview_row.spend30d_usd, None);

        let fresh_row = board.features.iter().find(|f| f.name == "Drafts").unwrap();
        assert!(
            fresh_row.council.is_none(),
            "never councilled is None, never a zero"
        );
        assert!(fresh_row.history.is_empty());
        assert!(fresh_row.verdicts.is_empty());
    }

    /// A group with no core context at all is a different finding from a
    /// single unclaimed context, so it carries its own flag.
    #[test]
    fn a_group_no_feature_reaches_is_untouched() {
        let (pool, project_id) = seeded();
        feature(&pool, &project_id, "AI Voice Interview", &["c-api"]);

        let board = feature_board(&pool, &project_id).unwrap();
        let feat = board.groups.iter().find(|g| g.id == "g-feat").unwrap();
        let infra = board.groups.iter().find(|g| g.id == "g-infra").unwrap();
        assert!(!feat.untouched, "a feature reaches c-api");
        assert!(infra.untouched, "nothing reaches the platform group");
        assert_eq!(feat.context_count, 3);
        assert_eq!(feat.feature_count, 1);
        assert_eq!(infra.feature_count, 0);
    }

    /// Features but NOT ONE link: the page must say "not scanned" rather than
    /// drawing every context as unclaimed and implying an abandoned codebase.
    #[test]
    fn a_project_that_was_never_scanned_says_so() {
        let (pool, project_id) = seeded();
        feature(&pool, &project_id, "AI Voice Interview", &[]);
        let board = feature_board(&pool, &project_id).unwrap();
        assert!(board.never_scanned);
        assert_eq!(board.totals.core, 0);
        assert_eq!(board.totals.unclaimed, 2, "the two ungrouped-role contexts");

        // One link, and the claim is gone.
        let with_slice = feature(&pool, &project_id, "Scoring", &["c-api"]);
        assert!(!feature_board(&pool, &project_id).unwrap().never_scanned);
        assert!(!with_slice.is_empty());
    }

    /// An archived feature must not keep a context looking claimed.
    #[test]
    fn an_archived_feature_leaves_the_board_and_releases_its_contexts() {
        let (pool, project_id) = seeded();
        let id = feature(&pool, &project_id, "Retired", &["c-api"]);
        assert_eq!(feature_board(&pool, &project_id).unwrap().totals.core, 1);

        archive(&pool, &id).unwrap();
        let board = feature_board(&pool, &project_id).unwrap();
        assert_eq!(board.totals.features, 0);
        assert_eq!(board.totals.core, 0);
        assert!(
            !board.never_scanned,
            "this project HAS been scanned - the link exists, on an archived row"
        );
    }

    /// A scenario reaches the board with its floor resolved and the latest
    /// run's result attached.
    #[test]
    fn scenarios_ride_along_with_their_latest_result() {
        let (pool, project_id) = seeded();
        let interview = feature(&pool, &project_id, "AI Voice Interview", &["c-api"]);
        let marketing = upsert_scenario(
            &pool,
            &UpsertScenarioInput {
                id: None,
                use_case_id: interview.clone(),
                slug: None,
                title: "Marketing candidates".into(),
                axes: [("candidate_family".to_string(), "marketing".to_string())]
                    .into_iter()
                    .collect(),
                scope: "must_hold".into(),
                floor: None,
            },
            "marketing",
        )
        .unwrap();

        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "ai-voice-interview",
            "AI Voice Interview",
            Some(&interview),
        )
        .unwrap();
        crate::repos::dev::council::insert_run_full(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/i1"),
            &[a_verdict("value", 0.8)],
            &[crate::repos::dev::scenarios::NewScenarioResult {
                scenario_id: marketing.id.clone(),
                state: "measured".into(),
                score: Some(0.3),
                confidence: "low".into(),
                n: Some(4),
                proof: "simulated".into(),
                floor_hit: true,
                advisory: true,
                summary: "the question bank is engineering-shaped".into(),
            }],
        )
        .unwrap();

        let board = feature_board(&pool, &project_id).unwrap();
        let row = board.features.iter().find(|f| f.id == interview).unwrap();
        assert_eq!(row.scenarios.len(), 1);
        let s = &row.scenarios[0];
        assert_eq!(s.slug, "marketing");
        assert_eq!(s.floor, 0.5, "resolved, never stored");
        let latest = s.latest.as_ref().expect("the run measured it");
        assert_eq!(latest.score, Some(0.3));
        assert_eq!(latest.n, Some(4));
        assert!(latest.floor_hit && latest.advisory);

        // The envelope comes off the SAME fold the door checks a result with.
        let envelope = row
            .envelope
            .as_ref()
            .expect("a feature with scenarios has one");
        assert_eq!(envelope.weak, vec!["marketing".to_string()]);
        assert!(envelope.holds.is_empty() && envelope.proposed.is_empty());

        // A feature that declares nothing has NO envelope - which is not an
        // empty one, and the page must be able to tell them apart.
        let scoring = board
            .features
            .iter()
            .find(|f| f.name != "AI Voice Interview");
        assert!(scoring.is_none_or(|f| f.envelope.is_none()));
    }

    /// Promoting a scenario re-reads an OLD result through the new scope: the
    /// ledger is not rewritten, and the board stops calling a branch fine.
    #[test]
    fn promoting_a_scenario_re_reads_the_result_that_already_landed() {
        let (pool, project_id) = seeded();
        let interview = feature(&pool, &project_id, "AI Voice Interview", &["c-api"]);
        let tracked = upsert_scenario(
            &pool,
            &UpsertScenarioInput {
                id: None,
                use_case_id: interview.clone(),
                slug: None,
                title: "Marketing candidates".into(),
                axes: BTreeMap::new(),
                scope: "tracked".into(),
                floor: None,
            },
            "marketing",
        )
        .unwrap();
        let (subject, _) = upsert_subject(
            &pool,
            &project_id,
            "use_case",
            "ai-voice-interview",
            "AI Voice Interview",
            Some(&interview),
        )
        .unwrap();
        crate::repos::dev::council::insert_run_full(
            &pool,
            &a_run(&subject.id, 1, "ready", "/runs/i1"),
            &[a_verdict("value", 0.8)],
            &[crate::repos::dev::scenarios::NewScenarioResult {
                scenario_id: tracked.id.clone(),
                state: "measured".into(),
                score: Some(0.3),
                confidence: "low".into(),
                n: Some(4),
                proof: "simulated".into(),
                // As the door resolved it at the time: tracked never hits.
                floor_hit: false,
                advisory: false,
                summary: "engineering-shaped question bank".into(),
            }],
        )
        .unwrap();

        let before = feature_board(&pool, &project_id).unwrap();
        let s = &before
            .features
            .iter()
            .find(|f| f.id == interview)
            .unwrap()
            .scenarios[0];
        assert!(!s.latest.as_ref().unwrap().floor_hit, "tracked never gates");
        assert_eq!(
            before
                .features
                .iter()
                .find(|f| f.id == interview)
                .unwrap()
                .envelope
                .as_ref()
                .unwrap()
                .weak,
            vec!["marketing".to_string()],
            "0.3 is under the flat 0.5 bucket floor even while tracked"
        );

        upsert_scenario(
            &pool,
            &UpsertScenarioInput {
                id: Some(tracked.id.clone()),
                use_case_id: interview.clone(),
                slug: Some("marketing".into()),
                title: "Marketing candidates".into(),
                axes: BTreeMap::new(),
                scope: "must_hold".into(),
                floor: None,
            },
            "marketing",
        )
        .unwrap();

        let after = feature_board(&pool, &project_id).unwrap();
        let s = &after
            .features
            .iter()
            .find(|f| f.id == interview)
            .unwrap()
            .scenarios[0];
        let latest = s.latest.as_ref().unwrap();
        assert!(latest.floor_hit, "must_hold reads the same 0.3 as a hit");
        assert!(latest.advisory, "and it is advisory while uncalibrated");
    }

    #[test]
    fn an_unknown_project_is_not_an_empty_board() {
        let (pool, _project_id) = seeded();
        assert!(matches!(
            feature_board(&pool, "no-such-project"),
            Err(AppError::NotFound(_))
        ));
    }
}
