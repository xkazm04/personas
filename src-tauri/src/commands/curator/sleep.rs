//! Her sleep, which is a **reconcile** and not a consolidation.
//!
//! Athena's sleep cycle compresses a conversation into memory. Curator has no
//! conversation: her memory IS the plan, and a plan goes wrong in one specific
//! way - the corpus moves underneath it. A subject she dispatched a worker at
//! yesterday may have been fixed by that worker, fixed by somebody else, or not
//! fixed at all, and **the plan cannot tell those apart by itself**. So the
//! pass here re-runs the instrument and asks the corpus.
//!
//! What it does, in order, and why the order is not arbitrary:
//!
//! 1. **Drop the read caches.** A five-minute TTL cannot promise that the read
//!    happened after her workers finished committing, and a projection computed
//!    from a pre-work read is a pass that looks like a pass and reconciles
//!    nothing.
//! 2. **Settle every `dispatched` plan item against the fresh reading**, with
//!    evidence naming the HEAD it was judged at. A finding that is gone is
//!    `landed`; a finding that survived her worker is `idled`, which is the
//!    registry's own word for a dry pass and is exactly what feeds the
//!    saturation streak.
//! 3. **Recompute the streaks**, which is a plain consequence of (2) - they are
//!    derived from the outcomes, so settling first is what makes the next
//!    projection's `suppressed_by_saturation` true.
//! 4. **Project and supersede.** `insert_plan` marks the standing run
//!    superseded and writes the new one in one transaction, so the plan a
//!    decision cites always reads back.
//!
//! ## What triggers it
//!
//! Athena's shape - an interval FLOOR plus a staleness valve
//! (`companion/brain/sleep_cycle/limits.rs`). The floor stops a busy afternoon
//! of landing workers from re-projecting every minute; the valve stops a quiet
//! week from leaving a month-old plan standing. In between, the trigger is
//! **the registry HEAD having moved** - which is the pressure signal here, the
//! way accumulated conversation characters are Athena's.

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};

use chrono::{DateTime, Duration as ChronoDuration, Utc};

use personas_core::models::{CuratorPlanItem, CuratorPlanItemState};

use crate::db::repos::curator as repo;
use crate::db::{settings_keys, DbPool};
use crate::error::AppError;

use super::{instrument, projection};

/// Minimum hours between completed passes. A floor, never the trigger.
///
/// One hour, against the memory cycle's six. The quantity being protected is
/// different: that floor exists so one heavy day cannot cycle twice and spend
/// twice; this one exists so a burst of landing workers cannot re-run an
/// eleven-second instrument read every minute. It costs node processes, not
/// tokens, which is why it is an order of magnitude shorter.
const MIN_INTERVAL_HOURS: i64 = 1;

/// Hours after which a pass runs even though the registry HEAD has not moved.
///
/// The release valve for a quiet week. Without it a plan whose corpus nobody
/// has touched would stand indefinitely - and the consumer side it also reads
/// (stale verdicts across twelve checkouts) moves without the registry's HEAD
/// moving at all, so "the corpus has not changed" is not the same claim as
/// "nothing this plan is about has changed".
const STALENESS_HOURS: i64 = 12;

/// One pass at a time.
///
/// The subscription runner is sequential, so two of HER ticks cannot overlap -
/// but `curator_plan_refresh` is an operator-facing command that runs the same
/// instrument, and a projection landing from each side would supersede the
/// other's. The instrument's own lock serialises the READ; this serialises the
/// whole pass, which is the unit that has to be atomic.
static SLEEPING: AtomicBool = AtomicBool::new(false);

/// Why a pass ran. Carried into the log line, because "it slept" without the
/// reason is the log entry nobody can act on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SleepTrigger {
    /// No pass has ever completed.
    Never,
    /// The registry checkout moved under the standing plan.
    HeadMoved,
    /// Nothing moved, but the plan is older than the staleness valve.
    Stale,
}

impl SleepTrigger {
    fn as_str(self) -> &'static str {
        match self {
            Self::Never => "she has never reconciled",
            Self::HeadMoved => "the registry moved under the standing plan",
            Self::Stale => "the standing plan is older than the staleness valve",
        }
    }
}

/// Whether a pass is due.
///
/// Pure, so the three arms can be proven without a registry, a clock or a
/// database. `last_sleep_at` that will not parse reads as "never" - the safe
/// direction, because it makes her sleep rather than skip one.
pub(super) fn should_sleep(
    last_sleep_at: Option<&str>,
    standing_head: Option<&str>,
    live_head: Option<&str>,
    now: DateTime<Utc>,
) -> Option<SleepTrigger> {
    let Some(last) = last_sleep_at
        .and_then(|raw| DateTime::parse_from_rfc3339(raw.trim()).ok())
        .map(|dt| dt.with_timezone(&Utc))
    else {
        return Some(SleepTrigger::Never);
    };
    let since = now.signed_duration_since(last);
    if since < ChronoDuration::hours(MIN_INTERVAL_HOURS) {
        return None;
    }
    // A HEAD this app could not read is NOT a moved HEAD. Treating an
    // unreadable git as movement would re-project on every tick past the floor
    // in any checkout where git is unavailable.
    let moved = match (standing_head, live_head) {
        (Some(standing), Some(live)) => standing != live,
        _ => false,
    };
    if moved {
        return Some(SleepTrigger::HeadMoved);
    }
    (since >= ChronoDuration::hours(STALENESS_HOURS)).then_some(SleepTrigger::Stale)
}

/// What one dispatched item's outcome is, judged against the fresh reading -
/// with the evidence for it.
///
/// **The evidence is the point, not decoration.** A terminal state here feeds
/// the saturation streak, and the streak is what decides whether she ever looks
/// at that subject again; a brake that cannot say what it was measured against
/// is a brake nobody can audit or appeal. So the sentence carries the commit it
/// was judged at, the subject, and - for a dry pass - what the scan still says
/// about it.
///
/// Pure, so both arms and both sentences can be proven without a registry.
fn verdict(
    item: &CuratorPlanItem,
    still_scored: bool,
    head: &str,
) -> (CuratorPlanItemState, String) {
    if still_scored {
        (
            CuratorPlanItemState::Idled,
            format!(
                "at {head} the scan still scores {} ({} points, {}) after her worker ran - a dry \
                 pass",
                item.subject_id,
                item.points,
                item.dominant_reason.as_str()
            ),
        )
    } else {
        (
            CuratorPlanItemState::Landed,
            format!(
                "at {head} the scan no longer scores {} - the finding she dispatched a worker at \
                 is gone",
                item.subject_id
            ),
        )
    }
}

/// What one pass did, for the log and for the tests.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(super) struct SleepReport {
    /// Items whose finding is gone from the fresh reading.
    pub landed: usize,
    /// Items whose finding survived the worker she sent at it.
    pub idled: usize,
    /// Items in the new projection.
    pub planned: usize,
}

/// Whether a reconcile is running right now, for the runtime reading's `lane`.
pub(super) fn is_sleeping() -> bool {
    SLEEPING.load(Ordering::Acquire)
}

/// Run the pass if it is due. Called at the end of every tick.
pub(super) async fn maybe_reconcile(pool: &DbPool, root: &Path) {
    if SLEEPING
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return;
    }
    let outcome = reconcile_if_due(pool, root).await;
    SLEEPING.store(false, Ordering::Release);
    match outcome {
        Ok(Some((trigger, report))) => {
            // The one line a person reads to know it ran, with the three
            // numbers that say what it did. `info`, not `debug`: a reconcile
            // that supersedes somebody's standing plan is not a detail.
            tracing::info!(
                trigger = trigger.as_str(),
                landed = report.landed,
                idled = report.idled,
                planned = report.planned,
                "curator: reconciled her plan against the registry"
            );
        }
        Ok(None) => {}
        Err(err) => {
            tracing::warn!(error = %err, "curator: the reconcile pass did not complete");
        }
    }
}

async fn reconcile_if_due(
    pool: &DbPool,
    root: &Path,
) -> Result<Option<(SleepTrigger, SleepReport)>, AppError> {
    let last = crate::db::repos::core::settings::get(pool, settings_keys::CURATOR_LAST_SLEEP_AT)
        .ok()
        .flatten();
    let standing_head = repo::current_plan(pool)?.and_then(|p| p.run.registry_head_sha);
    let live_head = instrument::git_head_short(root).await;
    let Some(trigger) = should_sleep(
        last.as_deref(),
        standing_head.as_deref(),
        live_head.as_deref(),
        Utc::now(),
    ) else {
        return Ok(None);
    };

    // (1) The caches go first, so the reading below is taken after whatever
    // her workers have just committed.
    instrument::invalidate();
    let reading = instrument::read(root).await?;

    let db = pool.clone();
    let now = Utc::now().to_rfc3339();
    let head_for_evidence = live_head.clone();
    let report = tokio::task::spawn_blocking(move || -> Result<SleepReport, AppError> {
        let policy = super::load_policy(&db);
        let head = head_for_evidence.as_deref().unwrap_or("an unreadable HEAD");

        // (2) Settle what she dispatched, against what the corpus now says.
        let mut report = SleepReport::default();
        if let Some(standing) = repo::current_plan(&db)? {
            let still_scored: std::collections::HashSet<&str> = reading
                .scan
                .subjects
                .iter()
                .filter(|s| !s.reasons.is_empty())
                .map(|s| s.id.as_str())
                .collect();
            for item in standing
                .items
                .iter()
                .filter(|i| i.state == CuratorPlanItemState::Dispatched)
            {
                let (state, evidence) =
                    verdict(item, still_scored.contains(item.subject_id.as_str()), head);
                match state {
                    CuratorPlanItemState::Landed => report.landed += 1,
                    _ => report.idled += 1,
                }
                repo::settle_plan_item(&db, &item.id, state, &evidence, &now)?;
            }
        }

        // (3) The streaks are derived from the outcomes just written, which is
        // the whole reason (2) runs before this line and not after it.
        let streaks = repo::idle_streaks(&db)?;

        // (4) Project and supersede, in one transaction.
        let projected = projection::project(&reading, &policy, &streaks, &now);
        for miss in &projected.unmatched {
            tracing::warn!(
                subject = %miss.subject_id,
                clause = %miss.sentence,
                "curator sleep: the registry wrote a clause this app does not recognise"
            );
        }
        let run_id = uuid::Uuid::new_v4().to_string();
        let plan = repo::insert_plan(&db, &run_id, &projected.run, &projected.items)?;
        report.planned = plan.items.len();

        crate::db::repos::core::settings::set(&db, settings_keys::CURATOR_LAST_SLEEP_AT, &now)?;
        Ok(report)
    })
    .await
    .map_err(|e| AppError::Internal(format!("curator sleep: task failed: {e}")))??;

    Ok(Some((trigger, report)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(hours_ago: i64) -> String {
        (Utc::now() - ChronoDuration::hours(hours_ago)).to_rfc3339()
    }

    /// The floor holds, the HEAD is the pressure signal, and the valve is what
    /// stops a quiet week leaving a stale plan standing.
    #[test]
    fn the_floor_the_pressure_and_the_valve() {
        let now = Utc::now();

        // Never slept: it runs, whatever the heads say.
        assert_eq!(
            should_sleep(None, Some("aaa"), Some("aaa"), now),
            Some(SleepTrigger::Never)
        );
        assert_eq!(
            should_sleep(Some("not a timestamp"), None, None, now),
            Some(SleepTrigger::Never),
            "an unreadable stamp reads as never, which makes her sleep rather than skip one"
        );

        // Inside the floor: nothing runs, even though the registry moved.
        assert_eq!(
            should_sleep(Some(&at(0)), Some("aaa"), Some("bbb"), now),
            None
        );

        // Past the floor with a moved HEAD: that is the trigger.
        assert_eq!(
            should_sleep(Some(&at(2)), Some("aaa"), Some("bbb"), now),
            Some(SleepTrigger::HeadMoved)
        );

        // Past the floor, nothing moved, inside the valve: still nothing.
        assert_eq!(
            should_sleep(Some(&at(2)), Some("aaa"), Some("aaa"), now),
            None
        );

        // Past the valve: it runs anyway.
        assert_eq!(
            should_sleep(
                Some(&at(STALENESS_HOURS + 1)),
                Some("aaa"),
                Some("aaa"),
                now
            ),
            Some(SleepTrigger::Stale)
        );
    }

    /// A HEAD nobody could read is not a moved HEAD. Otherwise every tick past
    /// the floor would re-project in any checkout where git is unavailable.
    #[test]
    fn an_unreadable_head_is_not_movement() {
        let now = Utc::now();
        assert_eq!(should_sleep(Some(&at(2)), None, Some("bbb"), now), None);
        assert_eq!(should_sleep(Some(&at(2)), Some("aaa"), None, now), None);
        assert_eq!(should_sleep(Some(&at(2)), None, None, now), None);
        // ... and the valve still fires for it, so an unreadable git degrades
        // the cadence rather than stopping the pass.
        assert_eq!(
            should_sleep(Some(&at(STALENESS_HOURS + 1)), None, None, now),
            Some(SleepTrigger::Stale)
        );
    }

    /// The floor is shorter than the memory cycle's on purpose, and the valve
    /// is longer than the floor. Both would be easy to invert in an edit.
    #[test]
    fn the_two_clocks_are_ordered() {
        assert!(MIN_INTERVAL_HOURS >= 1);
        assert!(
            STALENESS_HOURS > MIN_INTERVAL_HOURS,
            "a valve inside the floor would never fire"
        );
    }

    fn dispatched(subject: &str) -> CuratorPlanItem {
        CuratorPlanItem {
            id: "i1".into(),
            plan_run_id: "r1".into(),
            subject_id: subject.into(),
            domain: "localization".into(),
            at: "european/czech".into(),
            points: 11,
            reasons: Vec::new(),
            dominant_reason: personas_core::models::CuratorReasonCode::ExpiredApplication,
            engine: personas_core::models::CuratorEngine::Reconcile,
            techniques: 4,
            applications: 2,
            stacks: Vec::new(),
            demand_known: false,
            demand: None,
            last_swept: None,
            registry_dry_streak: 0,
            suppressed_by_saturation: false,
            has_applied_row: None,
            state: CuratorPlanItemState::Dispatched,
            declined_reason: None,
            dispatched_run_id: Some("s1".into()),
            evidence_ref: None,
            updated_at: "2026-09-24T00:00:00Z".into(),
        }
    }

    /// **A finding that is gone is landed; a finding that survived is idled**,
    /// and each carries the commit it was judged at. The second is what her
    /// saturation brake counts, so writing it without evidence would be a brake
    /// nobody can appeal.
    #[test]
    fn the_verdict_names_the_commit_it_was_judged_at() {
        let item = dispatched("localization/czech");

        let (state, evidence) = verdict(&item, false, "def5678");
        assert_eq!(state, CuratorPlanItemState::Landed);
        assert!(evidence.contains("def5678"), "{evidence}");
        assert!(evidence.contains("localization/czech"), "{evidence}");
        assert!(evidence.contains("no longer scores"), "{evidence}");

        let (state, evidence) = verdict(&item, true, "def5678");
        assert_eq!(
            state,
            CuratorPlanItemState::Idled,
            "a finding her worker did not clear is a dry pass, which is what the streak counts"
        );
        assert!(evidence.contains("def5678"), "{evidence}");
        assert!(evidence.contains("11 points"), "{evidence}");
        assert!(evidence.contains("expired_application"), "{evidence}");

        // Both are terminal, which is what makes them reach the streak walk at
        // all - and `landed` BREAKS a streak while `idled` grows one.
        assert!(CuratorPlanItemState::Landed.is_terminal());
        assert!(CuratorPlanItemState::Idled.is_terminal());
    }
}
