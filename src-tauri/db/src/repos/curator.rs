//! `curator_project`, `curator_plan_run` and `curator_plan_item` - Curator's
//! allowlist and her projections.
//!
//! **This module never decides anything.** It stores what the projection
//! computed and what the operator answered; every rule about WHICH subject is
//! planned, which engine answers it and whether it is suppressed lives in the
//! projection, where the scan is in hand.
//!
//! Two properties are enforced here rather than at a caller, because both have
//! more than one possible writer:
//!
//! - **A projection supersedes in ONE transaction.** [`insert_plan`] marks the
//!   standing run superseded and writes the new run and its items under a
//!   single `Immediate` transaction. Split across two calls, a crash between
//!   them leaves either two current plans or none, and a decision cites a plan
//!   that does not read back.
//! - **The operator's two columns are never written by a seed.**
//!   [`upsert_seen`] touches `root_path` and `last_seen_at` and nothing else,
//!   so a checkout reappearing on disk cannot quietly re-permit itself.
//!
//! `curator_decision` and `curator_commit` have no functions here on purpose:
//! this package has no writer for either, and a repo function with no caller
//! is the dead surface the schema comments warn the next package about. Their
//! constraints are covered by the migration's own tests.

use std::collections::HashMap;

use rusqlite::{params, OptionalExtension, Row};

use crate::models::{
    CuratorConsentState, CuratorConsumers, CuratorCorpus, CuratorDemand, CuratorEngine,
    CuratorPlan, CuratorPlanItem, CuratorPlanItemState, CuratorPolicy, CuratorProject,
    CuratorReason, CuratorReasonCode, CURATOR_SATURATION_THRESHOLD,
};
use crate::DbPool;
use personas_core::error::AppError;

const PROJECT_COLUMNS: &str = "slug, root_path, enabled, consent_state, granted_at, \
                               last_seen_at, created_at, updated_at";
const RUN_COLUMNS: &str = "id, created_at, scan_generated_at, registry_head_sha, corpus_json, \
                           consumers_json, policy_json, item_count, superseded_by";
const ITEM_COLUMNS: &str = "id, plan_run_id, subject_id, domain, at, points, reasons_json, \
                            dominant_reason, engine, techniques, applications, stacks_json, \
                            demand_known, demand_json, last_swept, registry_dry_streak, \
                            suppressed_by_saturation, has_applied_row, state, declined_reason, \
                            dispatched_run_id, evidence_ref, updated_at";

// ---------------------------------------------------------------------------
// Row mapping
//
// Hand-written rather than `row_mapper!` for the reason `dev_registries` gives:
// several columns are not fields - four are JSON documents the model carries
// as structures, and four are closed sets the model carries as enums.
// ---------------------------------------------------------------------------

fn row_to_project(row: &Row) -> rusqlite::Result<CuratorProject> {
    let consent_raw: String = row.get("consent_state")?;
    Ok(CuratorProject {
        slug: row.get("slug")?,
        root_path: row.get("root_path")?,
        enabled: row.get::<_, i64>("enabled")? != 0,
        // A value outside the CHECK cannot be written through this app. If a
        // hand-edited row carries one, `NeverAsked` is the reading that claims
        // least - never `Granted`, which would be a permission nobody gave.
        consent_state: CuratorConsentState::parse(&consent_raw)
            .unwrap_or(CuratorConsentState::NeverAsked),
        granted_at: row.get("granted_at")?,
        last_seen_at: row.get("last_seen_at")?,
        created_at: row.get("created_at")?,
        updated_at: row.get("updated_at")?,
    })
}

/// A stored JSON document that will not parse reads as its DEFAULT, with a
/// warning - the same call `dev_registries` makes for its inventories. A plan
/// whose corpus summary is malformed must still be readable, because the panel
/// that would let the operator re-project it is the one that reads it.
fn parse_or_default<T: serde::de::DeserializeOwned + Default>(raw: &str, what: &str) -> T {
    match serde_json::from_str::<T>(raw) {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = %e, what, "curator: unreadable stored document - reporting default");
            T::default()
        }
    }
}

fn row_to_run(row: &Row) -> rusqlite::Result<crate::models::CuratorPlanRun> {
    Ok(crate::models::CuratorPlanRun {
        id: row.get("id")?,
        created_at: row.get("created_at")?,
        scan_generated_at: row.get("scan_generated_at")?,
        registry_head_sha: row.get("registry_head_sha")?,
        corpus: parse_or_default(&row.get::<_, String>("corpus_json")?, "corpus_json"),
        consumers: parse_or_default(&row.get::<_, String>("consumers_json")?, "consumers_json"),
        policy: parse_or_default(&row.get::<_, String>("policy_json")?, "policy_json"),
        item_count: row.get::<_, i64>("item_count")?.max(0) as u32,
        superseded_by: row.get("superseded_by")?,
    })
}

fn row_to_item(row: &Row) -> rusqlite::Result<CuratorPlanItem> {
    let dominant_raw: String = row.get("dominant_reason")?;
    let engine_raw: String = row.get("engine")?;
    let state_raw: String = row.get("state")?;
    let demand_raw: Option<String> = row.get("demand_json")?;
    Ok(CuratorPlanItem {
        id: row.get("id")?,
        plan_run_id: row.get("plan_run_id")?,
        subject_id: row.get("subject_id")?,
        domain: row.get("domain")?,
        at: row.get("at")?,
        points: row.get::<_, i64>("points")?.max(0) as u32,
        reasons: serde_json::from_str::<Vec<CuratorReason>>(&row.get::<_, String>("reasons_json")?)
            .unwrap_or_default(),
        // An unreadable closed set reads as `None`, which this package treats
        // as "the matcher did not recognise the clause" - a finding, never a
        // guess at which engine should run.
        dominant_reason: CuratorReasonCode::parse(&dominant_raw).unwrap_or(CuratorReasonCode::None),
        engine: CuratorEngine::parse(&engine_raw).unwrap_or(CuratorEngine::None),
        techniques: row.get::<_, i64>("techniques")?.max(0) as u32,
        applications: row.get::<_, i64>("applications")?.max(0) as u32,
        stacks: serde_json::from_str::<Vec<String>>(&row.get::<_, String>("stacks_json")?)
            .unwrap_or_default(),
        demand_known: row.get::<_, i64>("demand_known")? != 0,
        // NULL here is the whole point of the column: no consumer reports
        // demand, so demand is UNKNOWN. It is never coerced to an empty
        // `CuratorDemand`, which would read as "measured, and zero".
        demand: demand_raw
            .as_deref()
            .and_then(|raw| serde_json::from_str::<CuratorDemand>(raw).ok()),
        last_swept: row.get("last_swept")?,
        registry_dry_streak: row.get::<_, i64>("registry_dry_streak")?.max(0) as u32,
        suppressed_by_saturation: row.get::<_, i64>("suppressed_by_saturation")? != 0,
        has_applied_row: row
            .get::<_, Option<i64>>("has_applied_row")?
            .map(|v| v != 0),
        state: CuratorPlanItemState::parse(&state_raw).unwrap_or(CuratorPlanItemState::Planned),
        declined_reason: row.get("declined_reason")?,
        dispatched_run_id: row.get("dispatched_run_id")?,
        evidence_ref: row.get("evidence_ref")?,
        updated_at: row.get("updated_at")?,
    })
}

// ---------------------------------------------------------------------------
// The allowlist
// ---------------------------------------------------------------------------

/// Every checkout Curator knows about, in slug order.
pub fn list_projects(pool: &DbPool) -> Result<Vec<CuratorProject>, AppError> {
    timed_query!("curator_project", "curator::list_projects", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROJECT_COLUMNS} FROM curator_project ORDER BY slug"
        ))?;
        let rows = stmt.query_map([], row_to_project)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Record that the fleet resolver found `slug` at `root_path` just now.
///
/// **This never writes `enabled` or `consent_state`.** A checkout reappearing
/// on disk is not the operator changing their mind, and a seed that could
/// re-permit a refused project would make the allowlist advisory.
pub fn upsert_seen(
    pool: &DbPool,
    slug: &str,
    root_path: &str,
    now: &str,
) -> Result<CuratorProject, AppError> {
    timed_query!("curator_project", "curator::upsert_seen", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO curator_project
                (slug, root_path, last_seen_at, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?3, ?3)
             ON CONFLICT(slug) DO UPDATE SET
                root_path = excluded.root_path,
                last_seen_at = excluded.last_seen_at,
                updated_at = excluded.updated_at",
            params![slug, root_path, now],
        )?;
        get_project(pool, slug)?.ok_or_else(|| {
            AppError::NotFound(format!("curator project '{slug}' vanished after upsert"))
        })
    })
}

/// One allowlist row. `Ok(None)` is "not known", never an error.
pub fn get_project(pool: &DbPool, slug: &str) -> Result<Option<CuratorProject>, AppError> {
    timed_query!("curator_project", "curator::get_project", {
        let conn = pool.get()?;
        conn.query_row(
            &format!("SELECT {PROJECT_COLUMNS} FROM curator_project WHERE slug = ?1"),
            params![slug],
            row_to_project,
        )
        .optional()
        .map_err(AppError::Database)
    })
}

/// The operator's switch for one checkout.
pub fn set_enabled(
    pool: &DbPool,
    slug: &str,
    enabled: bool,
    now: &str,
) -> Result<CuratorProject, AppError> {
    timed_query!("curator_project", "curator::set_enabled", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE curator_project SET enabled = ?2, updated_at = ?3 WHERE slug = ?1",
            params![slug, enabled as i64, now],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("no curator project '{slug}'")));
        }
        get_project(pool, slug)?
            .ok_or_else(|| AppError::NotFound(format!("no curator project '{slug}'")))
    })
}

/// The operator's answer for one checkout.
///
/// `granted_at` is stamped when consent becomes `granted` and CLEARED when it
/// stops being - a grant timestamp that outlived its grant would be evidence
/// for a permission that no longer exists.
pub fn set_consent(
    pool: &DbPool,
    slug: &str,
    consent: CuratorConsentState,
    now: &str,
) -> Result<CuratorProject, AppError> {
    timed_query!("curator_project", "curator::set_consent", {
        let conn = pool.get()?;
        let granted_at = (consent == CuratorConsentState::Granted).then(|| now.to_string());
        let changed = conn.execute(
            "UPDATE curator_project
                SET consent_state = ?2, granted_at = ?3, updated_at = ?4
              WHERE slug = ?1",
            params![slug, consent.as_str(), granted_at, now],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("no curator project '{slug}'")));
        }
        get_project(pool, slug)?
            .ok_or_else(|| AppError::NotFound(format!("no curator project '{slug}'")))
    })
}

// ---------------------------------------------------------------------------
// The projections
// ---------------------------------------------------------------------------

/// The standing plan - the newest run nothing has superseded - with its items
/// in rank order. `Ok(None)` means no projection has ever been made.
pub fn current_plan(pool: &DbPool) -> Result<Option<CuratorPlan>, AppError> {
    timed_query!("curator_plan_run", "curator::current_plan", {
        let conn = pool.get()?;
        let run = conn
            .query_row(
                &format!(
                    "SELECT {RUN_COLUMNS} FROM curator_plan_run
                      WHERE superseded_by IS NULL
                      ORDER BY created_at DESC, id DESC
                      LIMIT 1"
                ),
                [],
                row_to_run,
            )
            .optional()?;
        let Some(run) = run else {
            return Ok(None);
        };
        let mut stmt = conn.prepare(&format!(
            "SELECT {ITEM_COLUMNS} FROM curator_plan_item
              WHERE plan_run_id = ?1
              ORDER BY points DESC, subject_id"
        ))?;
        let items = stmt
            .query_map(params![run.id], row_to_item)?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Some(CuratorPlan { run, items }))
    })
}

/// What [`insert_plan`] is given: a run without its id or supersession (both
/// are the store's to mint), and its items without their ids or run id.
pub struct PlanRunInput {
    pub created_at: String,
    pub scan_generated_at: String,
    pub registry_head_sha: Option<String>,
    pub corpus: CuratorCorpus,
    pub consumers: CuratorConsumers,
    pub policy: CuratorPolicy,
}

/// One item as the projection produced it. `state` is always `Planned` at this
/// point, so it is not a field: this package dispatches nothing.
pub struct PlanItemInput {
    pub subject_id: String,
    pub domain: String,
    pub at: String,
    pub points: u32,
    pub reasons: Vec<CuratorReason>,
    pub dominant_reason: CuratorReasonCode,
    pub engine: CuratorEngine,
    pub techniques: u32,
    pub applications: u32,
    pub stacks: Vec<String>,
    pub demand: Option<CuratorDemand>,
    pub last_swept: Option<String>,
    pub registry_dry_streak: u32,
    pub suppressed_by_saturation: bool,
    pub has_applied_row: Option<bool>,
}

/// Land a projection: supersede the standing run and write the new one with
/// its items, all under one `Immediate` transaction.
///
/// `Immediate` rather than deferred because a read (which run is standing)
/// informs a write (mark it superseded): a deferred transaction fails
/// `SQLITE_BUSY_SNAPSHOT` in 0 ms and ignores `busy_timeout`.
pub fn insert_plan(
    pool: &DbPool,
    run_id: &str,
    run: &PlanRunInput,
    items: &[PlanItemInput],
) -> Result<CuratorPlan, AppError> {
    timed_query!("curator_plan_run", "curator::insert_plan", {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;

        let corpus_json = serde_json::to_string(&run.corpus)
            .map_err(|e| AppError::Internal(format!("curator: corpus not serialisable: {e}")))?;
        let consumers_json = serde_json::to_string(&run.consumers)
            .map_err(|e| AppError::Internal(format!("curator: consumers not serialisable: {e}")))?;
        let policy_json = serde_json::to_string(&run.policy)
            .map_err(|e| AppError::Internal(format!("curator: policy not serialisable: {e}")))?;

        tx.execute(
            "INSERT INTO curator_plan_run
                (id, created_at, scan_generated_at, registry_head_sha, corpus_json,
                 consumers_json, policy_json, item_count)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                run_id,
                run.created_at,
                run.scan_generated_at,
                run.registry_head_sha,
                corpus_json,
                consumers_json,
                policy_json,
                items.len() as i64,
            ],
        )?;

        for (idx, item) in items.iter().enumerate() {
            let reasons_json = serde_json::to_string(&item.reasons).map_err(|e| {
                AppError::Internal(format!("curator: reasons not serialisable: {e}"))
            })?;
            let stacks_json = serde_json::to_string(&item.stacks).map_err(|e| {
                AppError::Internal(format!("curator: stacks not serialisable: {e}"))
            })?;
            let demand_json = item
                .demand
                .as_ref()
                .map(serde_json::to_string)
                .transpose()
                .map_err(|e| {
                    AppError::Internal(format!("curator: demand not serialisable: {e}"))
                })?;
            tx.execute(
                "INSERT INTO curator_plan_item
                    (id, plan_run_id, subject_id, domain, at, points, reasons_json,
                     dominant_reason, engine, techniques, applications, stacks_json,
                     demand_known, demand_json, last_swept, registry_dry_streak,
                     suppressed_by_saturation, has_applied_row, state, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,
                         'planned',?19)",
                params![
                    format!("{run_id}-{idx:04}"),
                    run_id,
                    item.subject_id,
                    item.domain,
                    item.at,
                    item.points as i64,
                    reasons_json,
                    item.dominant_reason.as_str(),
                    item.engine.as_str(),
                    item.techniques as i64,
                    item.applications as i64,
                    stacks_json,
                    item.demand.is_some() as i64,
                    demand_json,
                    item.last_swept,
                    item.registry_dry_streak as i64,
                    item.suppressed_by_saturation as i64,
                    item.has_applied_row.map(|v| v as i64),
                    // Items are stamped with the RUN's clock, not a second
                    // `now()`. Two rows of one projection carrying different
                    // instants would invite a reader to believe they were
                    // measured at different times.
                    run.created_at,
                ],
            )?;
        }

        // Supersede LAST, and only runs older than this one: the new row is
        // already present, so a crash before this point leaves two standing
        // plans (recoverable, and `current_plan` picks the newest) while a
        // crash after it leaves exactly one.
        tx.execute(
            "UPDATE curator_plan_run
                SET superseded_by = ?1
              WHERE id <> ?1 AND superseded_by IS NULL",
            params![run_id],
        )?;

        tx.commit()?;
        current_plan(pool)?.ok_or_else(|| {
            AppError::Internal("curator: the projection just written does not read back".into())
        })
    })
}

/// How many consecutive most-recent plan runs ended with each subject `idled`.
///
/// This is Curator's OWN saturation measurement, and it is the reason
/// `registry_dry_streak` is carried but never read: the registry's field cannot
/// fire (see the `e48` header), while this one is computed from outcomes she
/// recorded herself.
///
/// The walk, per subject, newest run first:
/// - `idled` -> the streak grows;
/// - any other TERMINAL state (`landed` / `declined` / `blocked`) -> stop;
/// - `planned` / `dispatched` -> step over it. A run that was never finished
///   is not evidence in either direction;
/// - a run that never named the subject -> step over it for the same reason.
///
/// A subject with no history at all returns nothing, which is NOT a streak of
/// zero being suppressed - an absent history is not a dry one, and [`suppressed`]
/// is what turns a streak into a verdict.
pub fn idle_streaks(pool: &DbPool) -> Result<HashMap<String, u32>, AppError> {
    timed_query!("curator_plan_item", "curator::idle_streaks", {
        let conn = pool.get()?;
        // Newest run first. `created_at DESC, id DESC` is `current_plan`'s
        // ordering, so "most recent" means the same thing in both places.
        let mut stmt = conn.prepare(
            "SELECT i.subject_id AS subject_id, i.state AS state
               FROM curator_plan_item i
               JOIN curator_plan_run r ON r.id = i.plan_run_id
              ORDER BY r.created_at DESC, r.id DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>("subject_id")?,
                    row.get::<_, String>("state")?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut streaks: HashMap<String, u32> = HashMap::new();
        let mut settled: std::collections::HashSet<String> = std::collections::HashSet::new();
        for (subject_id, state_raw) in rows {
            if settled.contains(&subject_id) {
                continue;
            }
            let Some(state) = CuratorPlanItemState::parse(&state_raw) else {
                continue;
            };
            match state {
                CuratorPlanItemState::Idled => {
                    *streaks.entry(subject_id).or_insert(0) += 1;
                }
                s if s.is_terminal() => {
                    settled.insert(subject_id);
                }
                // `planned` / `dispatched`: neither counts nor breaks.
                _ => {}
            }
        }
        Ok(streaks)
    })
}

/// Whether a measured streak suppresses the subject. A subject absent from the
/// map is NOT suppressed: an absent history is not a dry one.
pub fn suppressed(streaks: &HashMap<String, u32>, subject_id: &str) -> bool {
    streaks
        .get(subject_id)
        .is_some_and(|n| *n >= CURATOR_SATURATION_THRESHOLD)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::init_test_db;

    fn policy() -> CuratorPolicy {
        CuratorPolicy::default()
    }

    fn corpus() -> CuratorCorpus {
        CuratorCorpus {
            generated_at: "2026-09-22T22:39:52.343Z".into(),
            today: "2026-09-22".into(),
            subjects: 471,
            techniques: 3274,
            applications: 1825,
            domains: 10,
            demand_known_for_any_bundle: true,
            applied_subjects: Some(12),
            expired_applications: 0,
            at_risk_applications: 4,
            drift_unknown: 505,
            drift: 77,
        }
    }

    fn consumers() -> CuratorConsumers {
        CuratorConsumers {
            generated_at: "2026-09-23T08:45:22Z".into(),
            maps_stale: true,
            projects: vec![],
            totals: crate::models::CuratorConsumerTotals {
                projects: 12,
                pairs: 8847,
                evaluated: 319,
                weak: 63,
                stale_verdicts: 216,
                stale_projects: 12,
                orphaned: 10,
            },
            problems: vec![],
        }
    }

    fn run_input(created_at: &str) -> PlanRunInput {
        PlanRunInput {
            created_at: created_at.into(),
            scan_generated_at: "2026-09-22T22:39:52.343Z".into(),
            registry_head_sha: Some("abc1234".into()),
            corpus: corpus(),
            consumers: consumers(),
            policy: policy(),
        }
    }

    fn item(subject_id: &str) -> PlanItemInput {
        PlanItemInput {
            subject_id: subject_id.into(),
            domain: "software-engineering".into(),
            at: "ui-surfaces/data-display/table".into(),
            points: 6,
            reasons: vec![CuratorReason {
                code: CuratorReasonCode::NoApplication,
                weight: 6,
                detail: "no application".into(),
            }],
            dominant_reason: CuratorReasonCode::NoApplication,
            engine: CuratorEngine::Apply,
            techniques: 4,
            applications: 0,
            stacks: vec![],
            demand: None,
            last_swept: None,
            registry_dry_streak: 0,
            suppressed_by_saturation: false,
            has_applied_row: None,
        }
    }

    /// The seed may move a checkout's path and its last-seen clock, and may
    /// touch NOTHING else. This is the allowlist's whole value: a project
    /// reappearing on disk is not the operator changing their mind.
    #[test]
    fn a_reseed_never_re_permits_a_refused_project() {
        let pool = init_test_db().unwrap();
        upsert_seen(&pool, "ascent", "C:/old/ascent", "2026-09-20T00:00:00Z").unwrap();
        set_enabled(&pool, "ascent", true, "2026-09-21T00:00:00Z").unwrap();
        set_consent(
            &pool,
            "ascent",
            CuratorConsentState::Refused,
            "2026-09-21T00:00:00Z",
        )
        .unwrap();

        let after = upsert_seen(&pool, "ascent", "C:/new/ascent", "2026-09-23T00:00:00Z").unwrap();
        assert_eq!(after.root_path, "C:/new/ascent");
        assert_eq!(after.last_seen_at.as_deref(), Some("2026-09-23T00:00:00Z"));
        assert!(after.enabled, "the operator's switch must survive a reseed");
        assert_eq!(after.consent_state, CuratorConsentState::Refused);
    }

    /// Consent arrives refusing and every transition is recorded honestly: a
    /// grant stamps its instant, and losing the grant clears it rather than
    /// leaving evidence for a permission that no longer exists.
    #[test]
    fn consent_starts_never_asked_and_granted_at_follows_the_grant() {
        let pool = init_test_db().unwrap();
        let fresh = upsert_seen(&pool, "kp", "C:/kp", "2026-09-23T00:00:00Z").unwrap();
        assert_eq!(fresh.consent_state, CuratorConsentState::NeverAsked);
        assert_eq!(fresh.granted_at, None);
        assert!(!fresh.enabled);

        let granted = set_consent(
            &pool,
            "kp",
            CuratorConsentState::Granted,
            "2026-09-23T10:00:00Z",
        )
        .unwrap();
        assert_eq!(granted.consent_state, CuratorConsentState::Granted);
        assert_eq!(granted.granted_at.as_deref(), Some("2026-09-23T10:00:00Z"));

        let withdrawn = set_consent(
            &pool,
            "kp",
            CuratorConsentState::Refused,
            "2026-09-23T11:00:00Z",
        )
        .unwrap();
        assert_eq!(withdrawn.consent_state, CuratorConsentState::Refused);
        assert_eq!(withdrawn.granted_at, None);
    }

    #[test]
    fn writing_to_an_unknown_project_is_not_found_rather_than_a_silent_no_op() {
        let pool = init_test_db().unwrap();
        assert!(matches!(
            set_enabled(&pool, "ghost", true, "2026-09-23T00:00:00Z"),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            set_consent(
                &pool,
                "ghost",
                CuratorConsentState::Granted,
                "2026-09-23T00:00:00Z"
            ),
            Err(AppError::NotFound(_))
        ));
    }

    /// A second projection supersedes the first, and the first keeps its items
    /// so the plan a person saw can still be read whole.
    #[test]
    fn a_second_projection_supersedes_the_first_without_erasing_it() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[item("software-engineering/table")],
        )
        .unwrap();
        insert_plan(
            &pool,
            "run-2",
            &run_input("2026-09-23T10:00:00Z"),
            &[
                item("software-engineering/table"),
                item("software-engineering/i18n"),
            ],
        )
        .unwrap();

        let current = current_plan(&pool).unwrap().expect("a standing plan");
        assert_eq!(current.run.id, "run-2");
        assert_eq!(current.run.item_count, 2);
        assert_eq!(current.items.len(), 2);
        assert_eq!(current.run.superseded_by, None);

        let conn = pool.get()?;
        let (superseded, old_items): (Option<String>, i64) = conn.query_row(
            "SELECT (SELECT superseded_by FROM curator_plan_run WHERE id = 'run-1')
                        AS superseded,
                    (SELECT COUNT(*) FROM curator_plan_item WHERE plan_run_id = 'run-1')
                        AS old_items",
            [],
            |r| Ok((r.get("superseded")?, r.get("old_items")?)),
        )?;
        assert_eq!(superseded.as_deref(), Some("run-2"));
        assert_eq!(old_items, 1, "the superseded plan keeps what it showed");
        Ok(())
    }

    #[test]
    fn no_projection_reads_back_as_none_rather_than_an_empty_plan() {
        let pool = init_test_db().unwrap();
        assert!(current_plan(&pool).unwrap().is_none());
    }

    /// Everything a plan item carries must survive the round trip, and the
    /// three unknowns must come back as `None` rather than as zeros.
    #[test]
    fn an_unknown_round_trips_as_none_not_as_zero() {
        let pool = init_test_db().unwrap();
        let mut known = item("software-engineering/agent-memory");
        known.demand = Some(CuratorDemand {
            consults: 1,
            deviations: 14,
            deviations_summed: 28,
            gone: 0,
            gone_summed: 0,
            contributors: 2,
        });
        known.last_swept = Some("2026-09-22".into());
        known.has_applied_row = Some(true);
        known.stacks = vec!["rust".into(), "node".into()];

        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[known, item("software-engineering/table")],
        )
        .unwrap();

        let plan = current_plan(&pool).unwrap().unwrap();
        let by_id = |id: &str| {
            plan.items
                .iter()
                .find(|i| i.subject_id == id)
                .expect("item")
                .clone()
        };

        let measured = by_id("software-engineering/agent-memory");
        assert!(measured.demand_known);
        assert_eq!(measured.demand.as_ref().unwrap().deviations, 14);
        assert_eq!(measured.demand.as_ref().unwrap().deviations_summed, 28);
        assert_eq!(measured.last_swept.as_deref(), Some("2026-09-22"));
        assert_eq!(measured.has_applied_row, Some(true));
        assert_eq!(measured.stacks, vec!["rust", "node"]);

        let unknown = by_id("software-engineering/table");
        assert!(!unknown.demand_known);
        assert_eq!(
            unknown.demand, None,
            "unknown demand must not become a measured zero"
        );
        assert_eq!(unknown.last_swept, None);
        assert_eq!(
            unknown.has_applied_row, None,
            "an unreadable ledger must not become `never applied`"
        );
        assert!(unknown.stacks.is_empty());

        // And the run's own unknowns survive too.
        assert_eq!(plan.run.corpus.applied_subjects, Some(12));
        assert!(plan.run.consumers.maps_stale);
        assert_eq!(plan.run.policy.daily_budget_usd, None);
        assert_eq!(plan.run.policy.level_research, plan.run.policy.level_sweep);
    }

    /// Items come back ranked, which is what the index exists for.
    #[test]
    fn items_read_back_in_rank_order() {
        let pool = init_test_db().unwrap();
        let mut low = item("a/low");
        low.points = 3;
        let mut high = item("a/high");
        high.points = 56;
        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[low, high],
        )
        .unwrap();
        let plan = current_plan(&pool).unwrap().unwrap();
        assert_eq!(plan.items[0].subject_id, "a/high");
        assert_eq!(plan.items[1].subject_id, "a/low");
    }

    // -----------------------------------------------------------------------
    // Saturation - hers, measured from her own outcomes
    // -----------------------------------------------------------------------

    /// Land a projection and then settle each subject's outcome, so the
    /// saturation walk below has a history to read.
    ///
    /// The seam is split in two because a pool checkout is the one operation a
    /// persistence layer EXPECTS to fail under load, and a fixture that panics
    /// on it hides exactly the saturation the product would hit. The inner
    /// function propagates; the wrapper is where a seed failure becomes a test
    /// failure, with a message.
    fn land_run(pool: &DbPool, run_id: &str, created_at: &str, states: &[(&str, &str)]) {
        land_run_inner(pool, run_id, created_at, states).expect("seed a settled plan run");
    }

    fn land_run_inner(
        pool: &DbPool,
        run_id: &str,
        created_at: &str,
        states: &[(&str, &str)],
    ) -> Result<(), AppError> {
        let items: Vec<PlanItemInput> = states.iter().map(|(s, _)| item(s)).collect();
        insert_plan(pool, run_id, &run_input(created_at), &items)?;
        let conn = pool.get()?;
        for (subject, state) in states {
            conn.execute(
                "UPDATE curator_plan_item SET state = ?3
                  WHERE plan_run_id = ?1 AND subject_id = ?2",
                params![run_id, subject, state],
            )?;
        }
        Ok(())
    }

    /// A subject she has never dispatched is NOT suppressed. An absent history
    /// is not a dry one - the same unknown-is-not-zero rule as everything else
    /// here, and the one the registry's own `dry_streak` gets wrong.
    #[test]
    fn a_never_dispatched_subject_is_not_suppressed() {
        let pool = init_test_db().unwrap();
        let streaks = idle_streaks(&pool).unwrap();
        assert!(streaks.is_empty());
        assert!(!suppressed(&streaks, "software-engineering/table"));

        // Even after being PLANNED twice and never resolved.
        land_run(
            &pool,
            "run-1",
            "2026-09-21T00:00:00Z",
            &[("software-engineering/table", "planned")],
        );
        land_run(
            &pool,
            "run-2",
            "2026-09-22T00:00:00Z",
            &[("software-engineering/table", "planned")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("software-engineering/table"), None);
        assert!(!suppressed(&streaks, "software-engineering/table"));
    }

    /// One idle is not saturation; two consecutive ones are.
    #[test]
    fn two_consecutive_idles_suppress_and_one_does_not() {
        let pool = init_test_db().unwrap();
        land_run(
            &pool,
            "run-1",
            "2026-09-21T00:00:00Z",
            &[("a/dry", "idled")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("a/dry"), Some(&1));
        assert!(!suppressed(&streaks, "a/dry"));

        land_run(
            &pool,
            "run-2",
            "2026-09-22T00:00:00Z",
            &[("a/dry", "idled")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("a/dry"), Some(&2));
        assert!(suppressed(&streaks, "a/dry"));
    }

    /// An intervening `landed` RESETS the streak - the subject produced work,
    /// so the ground is not settled any more.
    #[test]
    fn an_intervening_landing_resets_the_streak() {
        let pool = init_test_db().unwrap();
        land_run(
            &pool,
            "run-1",
            "2026-09-20T00:00:00Z",
            &[("a/dry", "idled")],
        );
        land_run(
            &pool,
            "run-2",
            "2026-09-21T00:00:00Z",
            &[("a/dry", "idled")],
        );
        land_run(
            &pool,
            "run-3",
            "2026-09-22T00:00:00Z",
            &[("a/dry", "landed")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(
            streaks.get("a/dry"),
            None,
            "a landing must break the walk before it reaches the older idles"
        );
        assert!(!suppressed(&streaks, "a/dry"));

        // And a single idle AFTER the landing is one, not three.
        land_run(
            &pool,
            "run-4",
            "2026-09-23T00:00:00Z",
            &[("a/dry", "idled")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("a/dry"), Some(&1));
        assert!(!suppressed(&streaks, "a/dry"));
    }

    /// A run that was never finished is not evidence either way: the walk
    /// steps OVER `planned` / `dispatched` instead of treating them as a break.
    #[test]
    fn an_unfinished_run_neither_counts_nor_breaks() {
        let pool = init_test_db().unwrap();
        land_run(
            &pool,
            "run-1",
            "2026-09-20T00:00:00Z",
            &[("a/dry", "idled")],
        );
        land_run(
            &pool,
            "run-2",
            "2026-09-21T00:00:00Z",
            &[("a/dry", "dispatched")],
        );
        land_run(
            &pool,
            "run-3",
            "2026-09-22T00:00:00Z",
            &[("a/dry", "idled")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("a/dry"), Some(&2));
        assert!(suppressed(&streaks, "a/dry"));
    }

    /// `blocked` and `declined` break the walk too - only `idled` means the
    /// engine ran and found nothing.
    #[test]
    fn every_other_terminal_state_breaks_the_walk() {
        for breaker in ["declined", "blocked"] {
            let pool = init_test_db().unwrap();
            land_run(
                &pool,
                "run-1",
                "2026-09-20T00:00:00Z",
                &[("a/dry", "idled")],
            );
            land_run(
                &pool,
                "run-2",
                "2026-09-21T00:00:00Z",
                &[("a/dry", "idled")],
            );
            land_run(
                &pool,
                "run-3",
                "2026-09-22T00:00:00Z",
                &[("a/dry", breaker)],
            );
            let streaks = idle_streaks(&pool).unwrap();
            assert_eq!(streaks.get("a/dry"), None, "{breaker} must break the walk");
        }
    }

    /// Two subjects' streaks are independent.
    #[test]
    fn streaks_are_per_subject() {
        let pool = init_test_db().unwrap();
        land_run(
            &pool,
            "run-1",
            "2026-09-21T00:00:00Z",
            &[("a/dry", "idled"), ("b/busy", "landed")],
        );
        land_run(
            &pool,
            "run-2",
            "2026-09-22T00:00:00Z",
            &[("a/dry", "idled"), ("b/busy", "idled")],
        );
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("a/dry"), Some(&2));
        assert_eq!(streaks.get("b/busy"), Some(&1));
        assert!(suppressed(&streaks, "a/dry"));
        assert!(!suppressed(&streaks, "b/busy"));
    }
}
