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
    CuratorConsentState, CuratorConsumers, CuratorCorpus, CuratorDecisionLevel, CuratorDemand,
    CuratorEngine, CuratorPlan, CuratorPlanItem, CuratorPlanItemState, CuratorPolicy,
    CuratorProject, CuratorQuietBundle, CuratorReason, CuratorReasonCode, CuratorRequest,
    CuratorRequestState, CURATOR_SATURATION_THRESHOLD,
};
use crate::DbPool;
use personas_core::error::AppError;

const PROJECT_COLUMNS: &str = "slug, root_path, enabled, consent_state, granted_at, \
                               last_seen_at, created_at, updated_at";
const RUN_COLUMNS: &str = "id, created_at, scan_generated_at, registry_head_sha, corpus_json, \
                           consumers_json, policy_json, quiet_json, item_count, superseded_by";
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

/// The quiet tail stored beside the run.
///
/// It hangs off [`CuratorPlan`] rather than off `CuratorPlanRun` because it is
/// the OTHER half of `items` - the subjects the projection did not plan - and
/// reading it beside them is what lets a surface show the whole corpus. The
/// column is on the run row because that is where the projection's other two
/// summaries already live.
fn row_to_quiet(row: &Row) -> rusqlite::Result<Vec<CuratorQuietBundle>> {
    Ok(parse_or_default(
        &row.get::<_, String>("quiet_json")?,
        "quiet_json",
    ))
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
        let standing = conn
            .query_row(
                &format!(
                    "SELECT {RUN_COLUMNS} FROM curator_plan_run
                      WHERE superseded_by IS NULL
                      ORDER BY created_at DESC, id DESC
                      LIMIT 1"
                ),
                [],
                |row| Ok((row_to_run(row)?, row_to_quiet(row)?)),
            )
            .optional()?;
        let Some((run, quiet)) = standing else {
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
        Ok(Some(CuratorPlan { run, items, quiet }))
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
    /// The subjects the projection did NOT plan, per bundle. Written with the
    /// run so `sum(quiet.subjects) + item_count == corpus.subjects` holds for
    /// the stored row, which is what tells a measured empty tail from a run
    /// projected before the column existed (see the `e50` migration header).
    pub quiet: Vec<CuratorQuietBundle>,
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
        let quiet_json = serde_json::to_string(&run.quiet).map_err(|e| {
            AppError::Internal(format!("curator: quiet tail not serialisable: {e}"))
        })?;

        tx.execute(
            "INSERT INTO curator_plan_run
                (id, created_at, scan_generated_at, registry_head_sha, corpus_json,
                 consumers_json, policy_json, quiet_json, item_count)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                run_id,
                run.created_at,
                run.scan_generated_at,
                run.registry_head_sha,
                corpus_json,
                consumers_json,
                policy_json,
                quiet_json,
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
/// fire (see the `e49` header), while this one is computed from outcomes she
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

// ---------------------------------------------------------------------------
// The operator's lane
//
// `curator_request` is the other direction from `curator_decision`: a person
// writes here and Curator carries it out. Nothing in THIS package drains it -
// [`claim_next_queued`] and [`settle_request`] exist so the loop package cannot
// invent a second claiming rule, and both are tested here rather than trusted
// to a caller that does not exist yet.
// ---------------------------------------------------------------------------

/// The one read order the lane has: oldest `queued` first. Spelled once, used
/// by the list, by the claim and by the test that proves they agree.
const REQUEST_COLUMNS: &str = "id, skill, argument, note, state, created_at, started_at, \
                               settled_at, session_id, outcome, result_ref, failure_reason";

/// Hand-written for the reason this module's other three mappers give: `state`
/// is a closed set the model carries as an enum, which `row_mapper!` has no
/// arm for.
fn row_to_request(row: &Row) -> rusqlite::Result<CuratorRequest> {
    let state_raw: String = row.get("state")?;
    Ok(CuratorRequest {
        id: row.get("id")?,
        skill: row.get("skill")?,
        argument: row.get("argument")?,
        note: row.get("note")?,
        // A value outside the CHECK cannot be written through this app. If a
        // hand-edited row carries one, `Failed` is the reading that claims
        // least: it is settled, so nothing will dispatch it, and it is visible
        // rather than silently drained.
        state: CuratorRequestState::parse(&state_raw).unwrap_or(CuratorRequestState::Failed),
        created_at: row.get("created_at")?,
        started_at: row.get("started_at")?,
        settled_at: row.get("settled_at")?,
        session_id: row.get("session_id")?,
        outcome: row.get("outcome")?,
        result_ref: row.get("result_ref")?,
        failure_reason: row.get("failure_reason")?,
    })
}

/// The lane, oldest first.
///
/// Open rows (`queued`, `dispatched`) come before settled ones, and within each
/// half the order is the order they were written. That is the operator's
/// promise made visible: the request they wrote first runs first, and the two
/// they are waiting on do not sink under a week of landed ones.
pub fn list_requests(pool: &DbPool, limit: u32) -> Result<Vec<CuratorRequest>, AppError> {
    timed_query!("curator_request", "curator::list_requests", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {REQUEST_COLUMNS} FROM curator_request
              ORDER BY CASE WHEN state IN ('queued','dispatched') THEN 0 ELSE 1 END,
                       created_at ASC, id ASC
              LIMIT ?1"
        ))?;
        let rows = stmt.query_map(params![limit], row_to_request)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Put one request in the lane. It always arrives `queued`; there is no door
/// here for writing a row that is already in flight.
///
/// `skill` is stored as the caller gave it. This repo does not know which
/// skills exist - that is read off the registry's disk by the instrument, and a
/// repo that also held a list would be a second answer that goes stale the next
/// time the registry adds one.
pub fn create_request(
    pool: &DbPool,
    id: &str,
    skill: &str,
    argument: Option<&str>,
    note: Option<&str>,
    now: &str,
) -> Result<CuratorRequest, AppError> {
    timed_query!("curator_request", "curator::create_request", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO curator_request (id, skill, argument, note, state, created_at)
             VALUES (?1, ?2, ?3, ?4, 'queued', ?5)",
            params![id, skill, argument, note, now],
        )?;
        get_request(pool, id)?.ok_or_else(|| {
            AppError::NotFound(format!("curator request '{id}' vanished after insert"))
        })
    })
}

/// One request. `Ok(None)` is "no such row", never an error.
pub fn get_request(pool: &DbPool, id: &str) -> Result<Option<CuratorRequest>, AppError> {
    timed_query!("curator_request", "curator::get_request", {
        let conn = pool.get()?;
        conn.query_row(
            &format!("SELECT {REQUEST_COLUMNS} FROM curator_request WHERE id = ?1"),
            params![id],
            row_to_request,
        )
        .optional()
        .map_err(AppError::Database)
    })
}

/// The operator withdrawing a request.
///
/// Only a `queued` row can be cancelled, and the WHERE clause is what enforces
/// it rather than a read-then-write: a row that is already dispatched has a
/// terminal attached to it, and cancelling the row would leave the terminal
/// running against a request that says it was never started. A caller that
/// wants to stop a dispatched one stops the session, and the settle writes the
/// outcome.
pub fn cancel_request(pool: &DbPool, id: &str, now: &str) -> Result<CuratorRequest, AppError> {
    timed_query!("curator_request", "curator::cancel_request", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE curator_request
                SET state = 'cancelled', settled_at = ?2
              WHERE id = ?1 AND state = 'queued'",
            params![id, now],
        )?;
        if changed == 0 {
            // The two failures are told apart so the refusal names the real
            // one: there is no such row, or there is one and it has moved on.
            return match get_request(pool, id)? {
                Some(row) => Err(AppError::Validation(format!(
                    "curator request '{id}' is {} and can no longer be cancelled - only a \
                     queued request can be withdrawn",
                    row.state.as_str()
                ))),
                None => Err(AppError::NotFound(format!("no curator request '{id}'"))),
            };
        }
        get_request(pool, id)?
            .ok_or_else(|| AppError::NotFound(format!("no curator request '{id}'")))
    })
}

/// Take the oldest queued request and mark it dispatched, atomically.
///
/// **Written for the loop package; called by nothing in this one.** It is here
/// rather than there because the claim is the one operation in this lane that
/// cannot be composed out of the others: a `list` followed by an `update` is
/// two statements, and two loop ticks - or a tick and a retry - would hand the
/// same request to two terminals.
///
/// `Immediate` because a read informs the write. A deferred transaction fails
/// `SQLITE_BUSY_SNAPSHOT` in 0 ms and ignores `busy_timeout`, which is exactly
/// the shape a second claimer produces.
///
/// `Ok(None)` means the lane is empty of queued work, which is the normal
/// answer and never an error.
pub fn claim_next_queued(
    pool: &DbPool,
    session_id: Option<&str>,
    now: &str,
) -> Result<Option<CuratorRequest>, AppError> {
    timed_query!("curator_request", "curator::claim_next_queued", {
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let next: Option<String> = tx
            .query_row(
                "SELECT id FROM curator_request
                  WHERE state = 'queued'
                  ORDER BY created_at ASC, id ASC
                  LIMIT 1",
                [],
                |r| r.get("id"),
            )
            .optional()?;
        let Some(id) = next else {
            tx.commit()?;
            return Ok(None);
        };
        // The `AND state = 'queued'` is a compare-and-set and the affected-row
        // count is the only evidence it held. Inside an `Immediate`
        // transaction a second claimer cannot have moved the row - so a zero
        // here is not a lost race, it is this function disagreeing with the
        // SELECT three lines above it, and dropping the count would make that
        // look exactly like a successful claim.
        let claimed_rows = tx.execute(
            "UPDATE curator_request
                SET state = 'dispatched', started_at = ?2, session_id = ?3
              WHERE id = ?1 AND state = 'queued'",
            params![id, now, session_id],
        )?;
        if claimed_rows != 1 {
            return Err(AppError::Internal(format!(
                "curator request '{id}' read as queued and then claimed {claimed_rows} rows - the lane's own transaction is not isolating"
            )));
        }
        let claimed = tx.query_row(
            &format!("SELECT {REQUEST_COLUMNS} FROM curator_request WHERE id = ?1"),
            params![id],
            row_to_request,
        )?;
        tx.commit()?;
        Ok(Some(claimed))
    })
}

/// Settle a request with what the worker produced.
///
/// **Written for the loop package; called by nothing in this one.** A settle is
/// refused for a state that is already settled - a landed request must not be
/// re-landed by a late worker, and a cancelled one must not be resurrected by
/// the terminal the operator stopped.
pub fn settle_request(
    pool: &DbPool,
    id: &str,
    state: CuratorRequestState,
    outcome: Option<&str>,
    result_ref: Option<&str>,
    failure_reason: Option<&str>,
    now: &str,
) -> Result<CuratorRequest, AppError> {
    timed_query!("curator_request", "curator::settle_request", {
        if !state.is_settled() {
            return Err(AppError::Validation(format!(
                "curator request '{id}': '{}' is not a settled state - a settle writes landed, \
                 declined, failed or cancelled",
                state.as_str()
            )));
        }
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE curator_request
                SET state = ?2, settled_at = ?3, outcome = ?4, result_ref = ?5,
                    failure_reason = ?6
              WHERE id = ?1 AND state IN ('queued','dispatched')",
            params![id, state.as_str(), now, outcome, result_ref, failure_reason],
        )?;
        if changed == 0 {
            return match get_request(pool, id)? {
                Some(row) => Err(AppError::Validation(format!(
                    "curator request '{id}' is already {} - a settled request is never settled \
                     twice",
                    row.state.as_str()
                ))),
                None => Err(AppError::NotFound(format!("no curator request '{id}'"))),
            };
        }
        get_request(pool, id)?
            .ok_or_else(|| AppError::NotFound(format!("no curator request '{id}'")))
    })
}

/// How many commits she landed today.
///
/// `curator_commit` has no writer in this tree yet, so this reads `0` - and
/// that zero is a MEASUREMENT, not a placeholder: the table exists, the query
/// runs, and the day the first writer lands a row the brake moves without
/// anything here changing. The commit cap it is read against is the operator's
/// hardest brake, which is why it is wired before the writer rather than after.
pub fn commits_today(pool: &DbPool) -> Result<u32, AppError> {
    timed_query!("curator_commit", "curator::commits_today", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(id) AS n FROM curator_commit WHERE date(created_at) = date('now')",
            [],
            |r| r.get("n"),
        )?;
        Ok(n.max(0) as u32)
    })
}

// ---------------------------------------------------------------------------
// The loop's own surface
//
// Everything below has exactly one caller - `commands::curator::tick` and the
// reconcile pass beside it - and every one of them exists for the reason
// `claim_next_queued` above gives: the operation cannot be composed out of a
// read plus a write without opening a window in which two terminals take the
// same work, or a brake counts the same commit twice.
// ---------------------------------------------------------------------------

/// Bind the fleet session a claimed request was dispatched as.
///
/// Split from [`claim_next_queued`] because the session id does not exist
/// until AFTER the claim: the fleet's admission door mints it. The claim is
/// what stops two terminals taking one request, and it has to happen first;
/// the binding is bookkeeping that follows. A request that is `dispatched`
/// with no `session_id` for a few milliseconds is honest - a request handed to
/// two workers would not be.
pub fn bind_request_session(pool: &DbPool, id: &str, session_id: &str) -> Result<(), AppError> {
    timed_query!("curator_request", "curator::bind_request_session", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE curator_request SET session_id = ?2 WHERE id = ?1 AND state = 'dispatched'",
            params![id, session_id],
        )?;
        Ok(())
    })
}

/// Every request she has dispatched and not settled.
pub fn dispatched_requests(pool: &DbPool) -> Result<Vec<CuratorRequest>, AppError> {
    timed_query!("curator_request", "curator::dispatched_requests", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {REQUEST_COLUMNS} FROM curator_request
              WHERE state = 'dispatched'
              ORDER BY created_at ASC, id ASC"
        ))?;
        let rows = stmt.query_map([], row_to_request)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Take the highest-scoring `planned` item of the STANDING run whose engine is
/// one she can actually invoke, and mark it dispatched - atomically.
///
/// `engines` is the caller's list of engines for which a documented invocation
/// can be derived from the item itself. It is a parameter rather than a rule
/// here because the derivation reads the registry's `SKILL.md` files, which
/// this crate cannot see; what this function owns is that the claim cannot
/// hand one item to two ticks.
///
/// An item `suppressed_by_saturation` is skipped: that is her own measured dry
/// streak, and re-running it is the thing the brake exists to stop. An empty
/// `engines` list claims NOTHING rather than everything - the arm that fires
/// when the registry documents no invocation she can use, which must read as
/// "no work she can take" and never as "take anything".
///
/// `Immediate` for [`claim_next_queued`]'s reason: a read informs the write.
pub fn claim_next_plan_item(
    pool: &DbPool,
    engines: &[CuratorEngine],
    now: &str,
) -> Result<Option<CuratorPlanItem>, AppError> {
    timed_query!("curator_plan_item", "curator::claim_next_plan_item", {
        if engines.is_empty() {
            return Ok(None);
        }
        let tokens: Vec<String> = engines.iter().map(|e| e.as_str().to_string()).collect();
        let placeholders = tokens
            .iter()
            .enumerate()
            .map(|(i, _)| format!("?{}", i + 1))
            .collect::<Vec<_>>()
            .join(", ");
        let mut conn = pool.get()?;
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        let next: Option<String> = {
            let sql = format!(
                "SELECT i.id FROM curator_plan_item i
                   JOIN curator_plan_run r ON r.id = i.plan_run_id
                  WHERE r.superseded_by IS NULL
                    AND i.state = 'planned'
                    AND i.suppressed_by_saturation = 0
                    AND i.engine IN ({placeholders})
                  ORDER BY i.points DESC, i.subject_id ASC
                  LIMIT 1"
            );
            let bound: Vec<&dyn rusqlite::ToSql> =
                tokens.iter().map(|t| t as &dyn rusqlite::ToSql).collect();
            tx.query_row(&sql, bound.as_slice(), |r| r.get("id"))
                .optional()?
        };
        let Some(id) = next else {
            tx.commit()?;
            return Ok(None);
        };
        // Compare-and-set, and the affected count is the only evidence it
        // held - the same reasoning `claim_next_queued` spells out above.
        let claimed = tx.execute(
            "UPDATE curator_plan_item SET state = 'dispatched', updated_at = ?2
              WHERE id = ?1 AND state = 'planned'",
            params![id, now],
        )?;
        if claimed != 1 {
            return Err(AppError::Internal(format!(
                "curator plan item '{id}' read as planned and then claimed {claimed} rows - the \
                 plan's own transaction is not isolating"
            )));
        }
        let item = tx.query_row(
            &format!("SELECT {ITEM_COLUMNS} FROM curator_plan_item WHERE id = ?1"),
            params![id],
            row_to_item,
        )?;
        tx.commit()?;
        Ok(Some(item))
    })
}

/// Bind the fleet session a claimed plan item was dispatched as.
pub fn bind_plan_item_session(pool: &DbPool, id: &str, session_id: &str) -> Result<(), AppError> {
    timed_query!("curator_plan_item", "curator::bind_plan_item_session", {
        let conn = pool.get()?;
        conn.execute(
            "UPDATE curator_plan_item SET dispatched_run_id = ?2
              WHERE id = ?1 AND state = 'dispatched'",
            params![id, session_id],
        )?;
        Ok(())
    })
}

/// Settle one plan item with the outcome and the evidence for it.
///
/// **`evidence` is not optional, and the signature says so.** A terminal state
/// on a plan item feeds the saturation streak, which decides whether she ever
/// looks at that subject again; a `landed` or an `idled` with no evidence is a
/// brake nobody can audit. The state must be terminal - a settle that wrote
/// `planned` back would erase a dispatch.
pub fn settle_plan_item(
    pool: &DbPool,
    id: &str,
    state: CuratorPlanItemState,
    evidence: &str,
    now: &str,
) -> Result<(), AppError> {
    timed_query!("curator_plan_item", "curator::settle_plan_item", {
        if !state.is_terminal() {
            return Err(AppError::Validation(format!(
                "curator plan item '{id}': '{}' is not a terminal state - a settle writes \
                 landed, declined, idled or blocked",
                state.as_str()
            )));
        }
        let conn = pool.get()?;
        conn.execute(
            "UPDATE curator_plan_item
                SET state = ?2, evidence_ref = ?3, updated_at = ?4
              WHERE id = ?1 AND state IN ('planned','dispatched')",
            params![id, state.as_str(), evidence, now],
        )?;
        Ok(())
    })
}

/// How many of her decisions are waiting for a person.
///
/// `curator_decision` has no writer in this tree yet, so this reads `0` - and
/// that zero is a MEASUREMENT for [`commits_today`]'s reason: the table
/// exists, the query runs, and the day the first decision is raised the
/// backpressure brake moves without anything here changing.
pub fn awaiting_decisions(pool: &DbPool) -> Result<u32, AppError> {
    timed_query!("curator_decision", "curator::awaiting_decisions", {
        let conn = pool.get()?;
        let n: i64 = conn.query_row(
            "SELECT COUNT(id) AS n FROM curator_decision WHERE status = 'awaiting'",
            [],
            |r| r.get("n"),
        )?;
        Ok(n.max(0) as u32)
    })
}

// ---------------------------------------------------------------------------
// The dispatch ledger (`e52`)
// ---------------------------------------------------------------------------

/// One worker she started: which lane asked for it, what it was told to run,
/// which level authorised it, and the registry HEAD it started from.
///
/// The HEAD is why this row exists at all - see the `e52` header. Without it
/// the commit ledger can only be written from a time window, and a time window
/// attributes a human's commit to her.
pub struct CuratorDispatchInput<'a> {
    pub lane: &'a str,
    pub request_id: Option<&'a str>,
    pub plan_item_id: Option<&'a str>,
    pub session_id: &'a str,
    pub skill: &'a str,
    pub argument: Option<&'a str>,
    pub level_that_authorised: CuratorDecisionLevel,
    pub repo_path: &'a str,
    pub head_at_dispatch: Option<&'a str>,
    pub created_at: &'a str,
}

/// One row of the ledger, as the tick reads it back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CuratorDispatchRow {
    pub id: String,
    pub lane: String,
    pub request_id: Option<String>,
    pub plan_item_id: Option<String>,
    pub session_id: String,
    pub skill: String,
    pub argument: Option<String>,
    pub level_that_authorised: CuratorDecisionLevel,
    pub repo_path: String,
    pub head_at_dispatch: Option<String>,
    pub created_at: String,
}

const DISPATCH_COLUMNS: &str = "id, lane, request_id, plan_item_id, session_id, skill, argument, \
                                level_that_authorised, repo_path, head_at_dispatch, created_at";

fn row_to_dispatch(row: &Row) -> rusqlite::Result<CuratorDispatchRow> {
    let level_raw: String = row.get("level_that_authorised")?;
    Ok(CuratorDispatchRow {
        id: row.get("id")?,
        lane: row.get("lane")?,
        request_id: row.get("request_id")?,
        plan_item_id: row.get("plan_item_id")?,
        session_id: row.get("session_id")?,
        skill: row.get("skill")?,
        argument: row.get("argument")?,
        // A level outside the CHECK cannot be written through this app. `L0`
        // is the reading that claims least, exactly as `load_policy` decides.
        level_that_authorised: CuratorDecisionLevel::parse(&level_raw)
            .unwrap_or(CuratorDecisionLevel::L0),
        repo_path: row.get("repo_path")?,
        head_at_dispatch: row.get("head_at_dispatch")?,
        created_at: row.get("created_at")?,
    })
}

/// Record a dispatch. Called immediately after the fleet's door returns.
pub fn record_dispatch(
    pool: &DbPool,
    id: &str,
    input: &CuratorDispatchInput<'_>,
) -> Result<(), AppError> {
    timed_query!("curator_dispatch", "curator::record_dispatch", {
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO curator_dispatch
                (id, lane, request_id, plan_item_id, session_id, skill, argument,
                 level_that_authorised, repo_path, head_at_dispatch, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                input.lane,
                input.request_id,
                input.plan_item_id,
                input.session_id,
                input.skill,
                input.argument,
                input.level_that_authorised.as_str(),
                input.repo_path,
                input.head_at_dispatch,
                input.created_at,
            ],
        )?;
        Ok(())
    })
}

/// Every dispatch nothing has settled yet, oldest first.
pub fn open_dispatches(pool: &DbPool) -> Result<Vec<CuratorDispatchRow>, AppError> {
    timed_query!("curator_dispatch", "curator::open_dispatches", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {DISPATCH_COLUMNS} FROM curator_dispatch
              WHERE settled_at IS NULL
              ORDER BY created_at ASC, id ASC"
        ))?;
        let rows = stmt.query_map([], row_to_dispatch)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Close a dispatch. Returns whether THIS call closed it: a row already
/// settled stays as it was, which is what keeps a second sweep over the same
/// ended session from writing its commits a second time.
pub fn settle_dispatch(pool: &DbPool, id: &str, now: &str) -> Result<bool, AppError> {
    timed_query!("curator_dispatch", "curator::settle_dispatch", {
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE curator_dispatch SET settled_at = ?2 WHERE id = ?1 AND settled_at IS NULL",
            params![id, now],
        )?;
        Ok(changed == 1)
    })
}

/// One commit she caused, with the level that authorised it.
pub struct CuratorCommitInput<'a> {
    pub project_slug: &'a str,
    pub repo_path: &'a str,
    pub branch: &'a str,
    pub sha: &'a str,
    /// The files the commit touched, as a JSON array. `[]` when git could not
    /// list them - an empty inventory, never an absent one.
    pub files_json: &'a str,
    pub level_that_authorised: CuratorDecisionLevel,
    /// The fleet session whose worker made it.
    pub run_id: Option<&'a str>,
    pub created_at: &'a str,
}

/// Record a commit she caused, **once**.
///
/// `INSERT OR IGNORE` against the `(project_slug, sha)` unique index `e52`
/// adds: two of her terminals can be open on one checkout, so two settles can
/// see overlapping `<head>..HEAD` ranges. A double-counted commit moves the
/// daily commit cap, which is the operator's hardest brake.
///
/// Returns whether a row was actually written, so a caller logs what it landed
/// rather than what it attempted.
pub fn record_commit(
    pool: &DbPool,
    id: &str,
    input: &CuratorCommitInput<'_>,
) -> Result<bool, AppError> {
    timed_query!("curator_commit", "curator::record_commit", {
        let conn = pool.get()?;
        let written = conn.execute(
            "INSERT OR IGNORE INTO curator_commit
                (id, project_slug, repo_path, branch, sha, files_json, decision_id,
                 level_that_authorised, run_id, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?8, ?9)",
            params![
                id,
                input.project_slug,
                input.repo_path,
                input.branch,
                input.sha,
                input.files_json,
                input.level_that_authorised.as_str(),
                input.run_id,
                input.created_at,
            ],
        )?;
        Ok(written == 1)
    })
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
            no_clock_applications: 301,
            demand_known_domains: vec!["software-engineering".into(), "recruiting".into()],
        }
    }

    /// Two of the ten bundles, one of each demand answer. `agent-operations`
    /// carries a MEASURED zero tail, which must survive the round trip as a
    /// row rather than be dropped into indistinguishability from "never
    /// measured".
    fn quiet() -> Vec<CuratorQuietBundle> {
        vec![
            CuratorQuietBundle {
                domain: "software-engineering".into(),
                subjects: 65,
                demand_known: true,
            },
            CuratorQuietBundle {
                domain: "localization".into(),
                subjects: 14,
                demand_known: false,
            },
            CuratorQuietBundle {
                domain: "agent-operations".into(),
                subjects: 0,
                demand_known: false,
            },
        ]
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
            quiet: quiet(),
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

    /// A second projection brings its OWN quiet tail. The tail is a measurement
    /// of one corpus reading, so it supersedes with its run rather than
    /// surviving into the next one - and the superseded run keeps the tail it
    /// was shown with, for the same reason it keeps its items.
    #[test]
    fn a_second_projection_supersedes_with_its_own_quiet_tail() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[item("software-engineering/table")],
        )
        .unwrap();

        let mut second = run_input("2026-09-23T10:00:00Z");
        second.quiet = vec![CuratorQuietBundle {
            domain: "software-engineering".into(),
            subjects: 64,
            demand_known: true,
        }];
        insert_plan(
            &pool,
            "run-2",
            &second,
            &[
                item("software-engineering/table"),
                item("software-engineering/i18n"),
            ],
        )
        .unwrap();

        let current = current_plan(&pool).unwrap().expect("a standing plan");
        assert_eq!(current.run.id, "run-2");
        assert_eq!(current.quiet.len(), 1);
        assert_eq!(
            current.quiet[0].subjects, 64,
            "the NEW reading, not the old"
        );

        // The superseded run kept its own three-bundle tail.
        let conn = pool.get()?;
        let stored: String = conn.query_row(
            "SELECT quiet_json FROM curator_plan_run WHERE id = 'run-1'",
            [],
            |r| r.get("quiet_json"),
        )?;
        let old: Vec<CuratorQuietBundle> = serde_json::from_str(&stored).unwrap();
        assert_eq!(old.len(), 3);
        assert_eq!(old[0].subjects, 65);
        Ok(())
    }

    /// The tail round-trips whole: the domain names, the counts, and - the one
    /// that matters - a MEASURED zero and an unread bundle staying distinct
    /// from each other and from a missing row.
    #[test]
    fn the_quiet_tail_round_trips_with_its_measured_zero() {
        let pool = init_test_db().unwrap();
        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[item("software-engineering/table")],
        )
        .unwrap();

        let plan = current_plan(&pool).unwrap().unwrap();
        assert_eq!(plan.quiet, quiet(), "the tail survives the store unchanged");

        let measured_zero = plan
            .quiet
            .iter()
            .find(|b| b.domain == "agent-operations")
            .expect("a bundle with an empty tail keeps its row");
        assert_eq!(measured_zero.subjects, 0);
        assert!(!measured_zero.demand_known);

        // And the corpus's own two new fields survive with it.
        assert_eq!(plan.run.corpus.no_clock_applications, 301);
        assert_eq!(
            plan.run.corpus.demand_known_domains,
            vec!["software-engineering", "recruiting"]
        );
    }

    /// A plan with no tail at all is readable rather than an error - which is
    /// exactly the shape a run projected before `e50` has. The column's
    /// `DEFAULT '[]'` makes it an empty list, and the arithmetic in the `e50`
    /// header (`sum(quiet) + item_count == corpus.subjects`) is what tells that
    /// apart from a corpus whose every subject scores.
    #[test]
    fn a_run_written_before_the_column_reads_back_as_an_empty_tail() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[item("software-engineering/table")],
        )
        .unwrap();

        // Exactly what an `ALTER TABLE ... DEFAULT '[]'` leaves on an older row.
        let conn = pool.get()?;
        conn.execute(
            "UPDATE curator_plan_run SET quiet_json = '[]' WHERE id = 'run-1'",
            [],
        )?;
        drop(conn);

        let plan = current_plan(&pool).unwrap().unwrap();
        assert!(plan.quiet.is_empty());
        let quiet: u32 = plan.quiet.iter().map(|b| b.subjects).sum();
        assert_ne!(
            quiet + plan.run.item_count,
            plan.run.corpus.subjects,
            "0 + 1 != 471: the run says for itself that its tail was never measured"
        );
        Ok(())
    }

    /// An unreadable tail reports as an empty list with a warning, the same
    /// call the three other stored documents make: a plan whose tail is
    /// malformed must still be readable, because the panel that would let the
    /// operator re-project it is the one that reads it.
    #[test]
    fn a_malformed_tail_does_not_make_the_plan_unreadable() -> Result<(), AppError> {
        let pool = init_test_db().unwrap();
        insert_plan(
            &pool,
            "run-1",
            &run_input("2026-09-23T09:00:00Z"),
            &[item("software-engineering/table")],
        )
        .unwrap();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE curator_plan_run SET quiet_json = '{not a list' WHERE id = 'run-1'",
            [],
        )?;
        drop(conn);

        let plan = current_plan(&pool).unwrap().expect("still readable");
        assert!(plan.quiet.is_empty());
        assert_eq!(plan.items.len(), 1, "the rest of the plan is untouched");
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

    // -----------------------------------------------------------------------
    // The operator's lane
    // -----------------------------------------------------------------------

    /// Three requests written in a known order, returned in that order.
    fn seed_lane(pool: &DbPool) {
        create_request(
            pool,
            "r1",
            "hygiene",
            None,
            Some("first"),
            "2026-09-24T09:00:00Z",
        )
        .unwrap();
        create_request(
            pool,
            "r2",
            "intake",
            Some("https://example.test/a"),
            None,
            "2026-09-24T10:00:00Z",
        )
        .unwrap();
        create_request(pool, "r3", "librarian", None, None, "2026-09-24T11:00:00Z").unwrap();
    }

    /// A request arrives queued, with the operator's own words intact and
    /// nothing invented for the argument they did not give.
    #[test]
    fn a_new_request_is_queued_and_keeps_what_the_operator_wrote() {
        let pool = init_test_db().unwrap();
        let row = create_request(
            &pool,
            "r1",
            "intake",
            Some("https://example.test/a"),
            Some("this one first"),
            "2026-09-24T09:00:00Z",
        )
        .unwrap();
        assert_eq!(row.state, CuratorRequestState::Queued);
        assert_eq!(row.skill, "intake");
        assert_eq!(row.argument.as_deref(), Some("https://example.test/a"));
        assert_eq!(row.note.as_deref(), Some("this one first"));
        assert_eq!(row.session_id, None);
        assert_eq!(row.started_at, None);
        assert_eq!(row.settled_at, None);

        // A bare-runnable skill takes no argument, and NULL is the answer -
        // never an empty string that a brief would then carry as a token.
        let bare =
            create_request(&pool, "r2", "hygiene", None, None, "2026-09-24T09:01:00Z").unwrap();
        assert_eq!(bare.argument, None);
        assert_eq!(bare.note, None);
    }

    /// **The lane drains oldest-first.** That ordering is the operator's
    /// promise, not an implementation detail: the request they wrote first runs
    /// first, whatever order the ids sort in.
    #[test]
    fn the_lane_drains_oldest_first() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        let first = claim_next_queued(&pool, Some("sess-1"), "2026-09-24T12:00:00Z")
            .unwrap()
            .unwrap();
        assert_eq!(first.id, "r1");
        assert_eq!(first.state, CuratorRequestState::Dispatched);
        assert_eq!(first.session_id.as_deref(), Some("sess-1"));
        assert_eq!(first.started_at.as_deref(), Some("2026-09-24T12:00:00Z"));

        let second = claim_next_queued(&pool, None, "2026-09-24T12:05:00Z")
            .unwrap()
            .unwrap();
        assert_eq!(second.id, "r2");

        let third = claim_next_queued(&pool, None, "2026-09-24T12:10:00Z")
            .unwrap()
            .unwrap();
        assert_eq!(third.id, "r3");

        // An empty lane is `Ok(None)`, which is the normal answer.
        assert!(claim_next_queued(&pool, None, "2026-09-24T12:15:00Z")
            .unwrap()
            .is_none());
    }

    /// A claim never hands the same row out twice: the second call skips the
    /// one it already dispatched rather than re-reading it as queued.
    #[test]
    fn a_claimed_request_is_never_claimed_again() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        let a = claim_next_queued(&pool, Some("s1"), "2026-09-24T12:00:00Z")
            .unwrap()
            .unwrap();
        let b = claim_next_queued(&pool, Some("s2"), "2026-09-24T12:00:01Z")
            .unwrap()
            .unwrap();
        assert_ne!(a.id, b.id);
    }

    /// **A cancelled request is not claimable.** The operator withdrew it; a
    /// loop that picked it up anyway would run work somebody had said no to.
    #[test]
    fn a_cancelled_request_is_not_claimable() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        let cancelled = cancel_request(&pool, "r1", "2026-09-24T11:30:00Z").unwrap();
        assert_eq!(cancelled.state, CuratorRequestState::Cancelled);
        assert_eq!(
            cancelled.settled_at.as_deref(),
            Some("2026-09-24T11:30:00Z")
        );

        let claimed = claim_next_queued(&pool, None, "2026-09-24T12:00:00Z")
            .unwrap()
            .unwrap();
        assert_eq!(claimed.id, "r2", "the withdrawn head is skipped, not taken");
    }

    /// Only a queued request can be withdrawn, and the two ways a cancel fails
    /// are told apart: no such row, or a row that has moved on.
    #[test]
    fn a_dispatched_request_can_no_longer_be_cancelled() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        claim_next_queued(&pool, Some("s1"), "2026-09-24T12:00:00Z").unwrap();

        let err = cancel_request(&pool, "r1", "2026-09-24T12:01:00Z").unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
        let missing = cancel_request(&pool, "nope", "2026-09-24T12:01:00Z").unwrap_err();
        assert!(matches!(missing, AppError::NotFound(_)), "{missing:?}");

        // The row is untouched by the refusal.
        let row = get_request(&pool, "r1").unwrap().unwrap();
        assert_eq!(row.state, CuratorRequestState::Dispatched);
    }

    /// A settle writes the outcome and the evidence, and a settled row is never
    /// settled twice - a late worker must not re-land what the operator already
    /// cancelled.
    #[test]
    fn a_settled_request_is_never_settled_twice() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        claim_next_queued(&pool, Some("s1"), "2026-09-24T12:00:00Z").unwrap();
        let landed = settle_request(
            &pool,
            "r1",
            CuratorRequestState::Landed,
            Some("ok"),
            Some("C:/runs/r1/result.json"),
            None,
            "2026-09-24T12:30:00Z",
        )
        .unwrap();
        assert_eq!(landed.state, CuratorRequestState::Landed);
        assert_eq!(landed.outcome.as_deref(), Some("ok"));
        assert_eq!(landed.result_ref.as_deref(), Some("C:/runs/r1/result.json"));
        assert_eq!(landed.settled_at.as_deref(), Some("2026-09-24T12:30:00Z"));

        let again = settle_request(
            &pool,
            "r1",
            CuratorRequestState::Failed,
            None,
            None,
            Some("late worker"),
            "2026-09-24T13:00:00Z",
        )
        .unwrap_err();
        assert!(matches!(again, AppError::Validation(_)), "{again:?}");
    }

    /// A settle may only write a settled state. `dispatched` is what a claim
    /// writes, and letting a settle write it would make "in flight" reachable
    /// from a door that means "finished".
    #[test]
    fn a_settle_refuses_an_unsettled_state() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        for state in [CuratorRequestState::Queued, CuratorRequestState::Dispatched] {
            let err = settle_request(&pool, "r1", state, None, None, None, "2026-09-24T12:00:00Z")
                .unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "{err:?}");
        }
    }

    /// The daily commit brake reads `0` on a fresh database - a measurement,
    /// because the table is there and the query runs - and counts a row landed
    /// today.
    ///
    /// The row is stamped with the app's own `chrono::Utc::now().to_rfc3339()`
    /// rather than a hand-written literal, which is the whole point: the
    /// `date(created_at) = date('now')` shape has to work against the timestamp
    /// format this app actually writes, fractional seconds and offset included.
    /// Seeds two commit rows. An inner `Result` fn so the pooled checkout
    /// propagates rather than panicking - the shape `land_run_inner` above
    /// already uses, and the one `pool-get-unwrapped` exists to keep.
    /// Seed commit rows. **Each row gets its own sha, derived from its id** -
    /// it used to share one, which stopped working when `e52` made
    /// `(project_slug, sha)` unique. That is the index doing its job: two rows
    /// for one commit is the shape that would double-count against the daily
    /// commit cap, and a fixture that modelled two commits as one sha was
    /// describing a state the store must refuse.
    fn land_commits_inner(pool: &DbPool, at: &[(&str, &str)]) -> Result<(), AppError> {
        let conn = pool.get()?;
        for (id, created_at) in at {
            conn.execute(
                "INSERT INTO curator_commit
                    (id, project_slug, repo_path, branch, sha, files_json,
                     level_that_authorised, created_at)
                 VALUES (?1, 'personas', 'C:/checkouts/personas', 'master', ?3,
                         '[]', 'L1', ?2)",
                params![id, created_at, format!("sha-{id}")],
            )?;
        }
        Ok(())
    }

    #[test]
    fn the_commit_brake_counts_todays_rows_and_ignores_older_ones() {
        let pool = init_test_db().unwrap();
        assert_eq!(commits_today(&pool).unwrap(), 0);

        let now = chrono::Utc::now().to_rfc3339();
        land_commits_inner(&pool, &[("c1", &now), ("c2", "2026-01-01T00:00:00Z")])
            .expect("seed two commit rows");

        assert_eq!(
            commits_today(&pool).unwrap(),
            1,
            "only today's row counts against today's cap"
        );
    }

    /// The list puts the open half first and orders each half oldest-first, so
    /// the two rows the operator is waiting on never sink under a week of
    /// landed ones.
    #[test]
    fn the_list_puts_open_rows_first_and_each_half_oldest_first() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);
        // r1 lands, r2 is claimed, r3 stays queued.
        claim_next_queued(&pool, Some("s1"), "2026-09-24T12:00:00Z").unwrap();
        settle_request(
            &pool,
            "r1",
            CuratorRequestState::Landed,
            Some("ok"),
            None,
            None,
            "2026-09-24T12:30:00Z",
        )
        .unwrap();
        claim_next_queued(&pool, Some("s2"), "2026-09-24T12:35:00Z").unwrap();

        let ids: Vec<String> = list_requests(&pool, 50)
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["r2", "r3", "r1"]);

        // The limit is a limit, not a suggestion.
        assert_eq!(list_requests(&pool, 2).unwrap().len(), 2);
    }

    // -----------------------------------------------------------------------
    // The loop's own surface
    // -----------------------------------------------------------------------

    /// A plan whose one item routes to `engine`, with the item's score.
    fn seed_plan_item(pool: &DbPool, engine: CuratorEngine, suppressed: bool) -> String {
        let run_id = uuid::Uuid::new_v4().to_string();
        let mut only = item("localization/czech");
        only.engine = engine;
        only.domain = "localization".into();
        only.suppressed_by_saturation = suppressed;
        let plan = insert_plan(pool, &run_id, &run_input("2026-09-24T12:00:00Z"), &[only]).unwrap();
        plan.items[0].id.clone()
    }

    /// The claim is what stops two ticks taking one item, so it must be a
    /// compare-and-set: the second call sees nothing, not the same row again.
    #[test]
    fn a_plan_item_is_claimed_once_and_only_for_an_engine_she_can_run() {
        let pool = init_test_db().unwrap();
        let item_id = seed_plan_item(&pool, CuratorEngine::Reconcile, false);

        // An engine she cannot invoke is not claimed - and an EMPTY list claims
        // nothing rather than everything, which is the arm that fires when the
        // registry documents no invocation she can use.
        assert!(claim_next_plan_item(&pool, &[], "2026-09-24T13:00:00Z")
            .unwrap()
            .is_none());
        assert!(
            claim_next_plan_item(&pool, &[CuratorEngine::Deepen], "2026-09-24T13:00:00Z")
                .unwrap()
                .is_none()
        );

        let claimed =
            claim_next_plan_item(&pool, &[CuratorEngine::Reconcile], "2026-09-24T13:00:00Z")
                .unwrap()
                .expect("the item routes to an engine she can run");
        assert_eq!(claimed.id, item_id);
        assert_eq!(claimed.state, CuratorPlanItemState::Dispatched);

        // The second tick finds nothing: the row is no longer `planned`.
        assert!(
            claim_next_plan_item(&pool, &[CuratorEngine::Reconcile], "2026-09-24T13:01:00Z")
                .unwrap()
                .is_none(),
            "two ticks must never hand one subject to two terminals"
        );
    }

    /// Her own measured dry streak is a brake at the CLAIM, because anything
    /// later is already a dispatch.
    #[test]
    fn a_saturated_item_is_never_claimed() {
        let pool = init_test_db().unwrap();
        seed_plan_item(&pool, CuratorEngine::Reconcile, true);
        assert!(
            claim_next_plan_item(&pool, &[CuratorEngine::Reconcile], "2026-09-24T13:00:00Z")
                .unwrap()
                .is_none(),
            "settled ground is not re-run"
        );
    }

    /// A superseded run's items are not work any more, whatever state they are
    /// in: the claim joins on the STANDING run.
    #[test]
    fn only_the_standing_runs_items_are_claimable() {
        let pool = init_test_db().unwrap();
        seed_plan_item(&pool, CuratorEngine::Reconcile, false);
        // A second projection supersedes the first - and carries no claimable
        // item of its own.
        let mut quiet_item = item("localization/czech");
        quiet_item.engine = CuratorEngine::Deepen;
        insert_plan(
            &pool,
            "run-2",
            &run_input("2026-09-24T14:00:00Z"),
            &[quiet_item],
        )
        .unwrap();

        assert!(
            claim_next_plan_item(&pool, &[CuratorEngine::Reconcile], "2026-09-24T15:00:00Z")
                .unwrap()
                .is_none(),
            "a superseded plan is a record, not a worklist"
        );
    }

    /// The settle writes the outcome AND the evidence, refuses a non-terminal
    /// state, and is what the saturation streak is then computed from.
    #[test]
    fn a_settle_carries_its_evidence_and_feeds_the_streak() {
        let pool = init_test_db().unwrap();
        let item_id = seed_plan_item(&pool, CuratorEngine::Reconcile, false);
        claim_next_plan_item(&pool, &[CuratorEngine::Reconcile], "2026-09-24T13:00:00Z").unwrap();
        bind_plan_item_session(&pool, &item_id, "session-1").unwrap();

        // A state that is not terminal is refused: it would erase a dispatch.
        let refused = settle_plan_item(
            &pool,
            &item_id,
            CuratorPlanItemState::Planned,
            "nothing",
            "2026-09-24T14:00:00Z",
        )
        .unwrap_err();
        assert!(matches!(refused, AppError::Validation(_)), "{refused:?}");

        settle_plan_item(
            &pool,
            &item_id,
            CuratorPlanItemState::Idled,
            "at def5678 the scan still scores localization/czech - a dry pass",
            "2026-09-24T14:00:00Z",
        )
        .unwrap();

        let settled = current_plan(&pool).unwrap().unwrap();
        assert_eq!(settled.items[0].state, CuratorPlanItemState::Idled);
        assert_eq!(
            settled.items[0].dispatched_run_id.as_deref(),
            Some("session-1")
        );
        assert!(settled.items[0]
            .evidence_ref
            .as_deref()
            .is_some_and(|e| e.contains("def5678")));

        // One `idled` is one dry pass. The streak is measured from the rows,
        // which is the whole reason the settle is not optional.
        let streaks = idle_streaks(&pool).unwrap();
        assert_eq!(streaks.get("localization/czech"), Some(&1));
        assert!(
            !suppressed(&streaks, "localization/czech"),
            "one dry pass is not saturation; the threshold is two"
        );
    }

    /// The lane claim hands a request out once, the binding attaches the
    /// session the fleet minted, and the open list is what the tick walks.
    #[test]
    fn a_request_is_claimed_then_bound_then_settled() {
        let pool = init_test_db().unwrap();
        seed_lane(&pool);

        let claimed = claim_next_queued(&pool, None, "2026-09-24T12:00:00Z")
            .unwrap()
            .expect("the oldest queued request");
        assert_eq!(claimed.id, "r1");
        assert_eq!(claimed.state, CuratorRequestState::Dispatched);
        assert_eq!(
            claimed.session_id, None,
            "the fleet has not minted a session id yet, and claiming first is what \
             stops two terminals taking one request"
        );

        bind_request_session(&pool, "r1", "session-1").unwrap();
        let open = dispatched_requests(&pool).unwrap();
        assert_eq!(open.len(), 1);
        assert_eq!(open[0].session_id.as_deref(), Some("session-1"));

        settle_request(
            &pool,
            "r1",
            CuratorRequestState::Landed,
            Some("session session-1"),
            None,
            None,
            "2026-09-24T12:30:00Z",
        )
        .unwrap();
        assert!(dispatched_requests(&pool).unwrap().is_empty());
    }

    /// The backpressure brake reads `0` today because nothing raises a
    /// decision yet - and that zero is a MEASUREMENT, the same call
    /// `commits_today` makes: the table exists and the query runs.
    #[test]
    fn the_backpressure_brake_reads_the_table_that_has_no_writer_yet() {
        let pool = init_test_db().unwrap();
        assert_eq!(awaiting_decisions(&pool).unwrap(), 0);
    }

    fn dispatch_input<'a>(session: &'a str, head: Option<&'a str>) -> CuratorDispatchInput<'a> {
        CuratorDispatchInput {
            lane: "refill",
            request_id: None,
            plan_item_id: None,
            session_id: session,
            skill: "harvest",
            argument: Some("research"),
            level_that_authorised: CuratorDecisionLevel::L2,
            repo_path: "C:/checkouts/ai-registry",
            head_at_dispatch: head,
            created_at: "2026-09-24T12:00:00Z",
        }
    }

    /// The ledger records the HEAD a worker started from - which is the only
    /// reason it exists - and the settle is a claim, so a second sweep over the
    /// same ended session writes nothing.
    #[test]
    fn the_dispatch_ledger_records_the_head_and_settles_once() {
        let pool = init_test_db().unwrap();
        record_dispatch(&pool, "d1", &dispatch_input("session-1", Some("abc1234"))).unwrap();
        record_dispatch(&pool, "d2", &dispatch_input("session-2", None)).unwrap();

        let open = open_dispatches(&pool).unwrap();
        assert_eq!(open.len(), 2);
        assert_eq!(open[0].head_at_dispatch.as_deref(), Some("abc1234"));
        assert_eq!(
            open[1].head_at_dispatch, None,
            "a HEAD git could not answer is absent, never a guessed one"
        );
        assert_eq!(open[0].level_that_authorised, CuratorDecisionLevel::L2);

        assert!(settle_dispatch(&pool, "d1", "2026-09-24T13:00:00Z").unwrap());
        assert!(
            !settle_dispatch(&pool, "d1", "2026-09-24T13:05:00Z").unwrap(),
            "a second settle must not re-open a closed dispatch - its commits would be \
             written twice and counted twice against the daily cap"
        );
        assert_eq!(open_dispatches(&pool).unwrap().len(), 1);
    }

    /// **One commit is one row.** Two of her terminals can be open on one
    /// checkout, so two settles can see overlapping ranges; a double-counted
    /// commit moves the operator's hardest brake.
    #[test]
    fn a_commit_seen_twice_is_counted_once() {
        let pool = init_test_db().unwrap();
        let now = chrono::Utc::now().to_rfc3339();
        let commit = |sha: &'static str| CuratorCommitInput {
            project_slug: "ai-registry",
            repo_path: "C:/checkouts/ai-registry",
            branch: "master",
            sha,
            files_json: "[]",
            level_that_authorised: CuratorDecisionLevel::L2,
            run_id: Some("session-1"),
            created_at: &now,
        };

        assert!(record_commit(&pool, "c1", &commit("abc1234")).unwrap());
        assert!(
            !record_commit(&pool, "c2", &commit("abc1234")).unwrap(),
            "the store refuses the second row rather than trusting both writers to dedupe"
        );
        assert!(record_commit(&pool, "c3", &commit("def5678")).unwrap());

        assert_eq!(
            commits_today(&pool).unwrap(),
            2,
            "two commits, three attempts - the brake counts commits, not writes"
        );
    }
}
