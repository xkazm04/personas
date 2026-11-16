//! Plan forecast: where each accepted item of a standup plan is expected to
//! run on the day/night timeline (spark app-standup, WP2).
//!
//! Two halves:
//!
//! * **Estimate** ([`estimate_item`], pure) - one item's release time, its
//!   duration and its cost. Release is the item's `notBeforeMs`, else its
//!   window (`day` / `any` = now, `night` = tonight's start as the arm
//!   computes it), never before now. Duration is the MEDIAN of the item's measured runs, from the most
//!   specific history that has any: its charter's finished runs
//!   (`run_resource_summaries`), then its persona's, then the persona's
//!   `persona_executions.duration_ms`; with none of those, the fleet's median
//!   ended-session duration at a lowered confidence; with nothing at all,
//!   [`DEFAULT_DURATION_MS`] at confidence 0. Cost (machine units, exclusive
//!   GPU) is the charter's MEASURED profile ([`item_profile`]), else its
//!   declared one.
//! * **Pack** ([`pack`], pure) - greedy, highest priority first: each item
//!   starts at the earliest instant at or after its release where the fleet's
//!   parallel cap, its machine budget (one unit per slot, as admission's
//!   static machine maximum) and the single exclusive-GPU token all still
//!   have room for its whole duration.
//!
//! The same inputs always give the same slots (a fixed clock is a parameter),
//! which is what the unit test pins.

use personas_core::models::{
    ForecastSlot, GpuClass, PersonaResponsibility, ResourceProfile, MEASURED_PROFILE_WINDOW,
};

use crate::db::repos::core::responsibilities;
use crate::db::repos::execution::executions;
use crate::db::repos::fleet_sessions;
use crate::db::repos::resources::run_resources;
use crate::db::{DbPool, UserDbPool};
use crate::error::AppError;

use super::model::{StandupItem, StandupItemKind, StandupItemState, StandupPlan, StandupWindow};

/// The duration an item with no history at all is drawn with: 45 minutes.
pub const DEFAULT_DURATION_MS: i64 = 45 * 60 * 1000;

/// The confidence a fleet-wide median is worth relative to the item's own
/// history (it says how long sessions run, not how long THIS work runs).
pub const FLEET_FALLBACK_WEIGHT: f64 = 0.25;

/// The confidence a declared (unmeasured) profile is worth relative to a
/// measured one.
pub const DECLARED_PROFILE_WEIGHT: f64 = 0.75;

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/// What an item costs the machine, and where that came from.
#[derive(Debug, Clone, PartialEq)]
pub struct ItemProfile {
    /// The profile a dispatch of the item should carry: the charter's declared
    /// profile with `machine` / `gpu` replaced by the measured tags when there
    /// are any. `None` when the item has no charter (a default charge).
    pub profile: Option<ResourceProfile>,
    /// Whether `machine` / `gpu` came from measured runs.
    pub measured: bool,
    /// The charter the item was resolved to.
    pub responsibility_id: Option<String>,
}

impl ItemProfile {
    fn none() -> Self {
        Self {
            profile: None,
            measured: false,
            responsibility_id: None,
        }
    }

    /// Machine units charged (1 / 2 / 4 / 8).
    pub fn machine_units(&self) -> i32 {
        let units = self.profile.as_ref().map_or(1, |p| p.machine.units());
        i32::try_from(units).unwrap_or(i32::MAX)
    }

    /// Whether the item takes the exclusive GPU token.
    pub fn gpu_exclusive(&self) -> bool {
        self.profile
            .as_ref()
            .is_some_and(|p| p.gpu == GpuClass::Exclusive)
    }
}

/// The item's charter: one of its persona's non-retired charters, preferring
/// an active one bound to the item's project, then any active one, then the
/// newest. Pure.
pub fn pick_charter<'a>(
    charters: &'a [PersonaResponsibility],
    project_id: Option<&str>,
) -> Option<&'a PersonaResponsibility> {
    let active = |c: &&PersonaResponsibility| c.status == "active";
    charters
        .iter()
        .filter(active)
        .find(|c| project_id.is_some() && c.project_id.as_deref() == project_id)
        .or_else(|| charters.iter().find(active))
        .or_else(|| charters.first())
}

/// Resolve an item's cost: its persona's charter ([`pick_charter`]), the
/// charter's measured tags when it has enough runs and the operator has not
/// pinned the profile, else the declared profile. Lookup failures read as "no
/// charter" (logged): a forecast with a default charge beats no forecast.
pub fn item_profile(pool: &DbPool, item: &StandupItem) -> ItemProfile {
    let Some(persona_id) = item.persona_id.as_deref() else {
        return ItemProfile::none();
    };
    let charters = match responsibilities::list_by_persona(pool, persona_id, false) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(persona_id, error = %e, "forecast: charter lookup failed");
            return ItemProfile::none();
        }
    };
    let Some(charter) = pick_charter(&charters, item.project_id.as_deref()) else {
        return ItemProfile::none();
    };
    let declared = charter.spec.resource_profile.clone().unwrap_or_default();
    let measured_tags = if declared.pinned {
        None
    } else {
        match run_resources::measure_for_responsibility(pool, &charter.id) {
            Ok(m) => m.and_then(|m| m.tags()),
            Err(e) => {
                tracing::warn!(responsibility_id = %charter.id, error = %e, "forecast: measurement read failed");
                None
            }
        }
    };
    let (profile, measured) = match measured_tags {
        Some((machine, gpu)) => (
            ResourceProfile {
                machine,
                gpu: gpu.unwrap_or(declared.gpu),
                ..declared
            },
            true,
        ),
        None => (declared, false),
    };
    ItemProfile {
        profile: Some(profile),
        measured,
        responsibility_id: Some(charter.id.clone()),
    }
}

/// The measured run durations an item's estimate draws from.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DurationHistory {
    /// The item's own history (charter, else persona runs, else persona
    /// executions), ms.
    pub own_ms: Vec<i64>,
    /// The fleet's ended-session durations, ms.
    pub fleet_ms: Vec<i64>,
}

/// Gather [`DurationHistory`] for an item (blocking; failures read as empty,
/// logged).
pub fn duration_history(
    pool: &DbPool,
    item: &StandupItem,
    charter_id: Option<&str>,
    fleet_ms: &[i64],
) -> DurationHistory {
    let mut own: Vec<i64> = Vec::new();
    if let Some(persona_id) = item.persona_id.as_deref() {
        match run_resources::list_for_persona(pool, persona_id, Some(MEASURED_PROFILE_WINDOW * 5)) {
            Ok(runs) => {
                let span = |r: &personas_core::models::RunResourceSummary| {
                    (r.ended_at_ms - r.started_at_ms).round() as i64
                };
                let charter_runs: Vec<i64> = runs
                    .iter()
                    .filter(|r| {
                        charter_id.is_some() && r.responsibility_id.as_deref() == charter_id
                    })
                    .map(span)
                    .collect();
                own = if charter_runs.is_empty() {
                    runs.iter().map(span).collect()
                } else {
                    charter_runs
                };
            }
            Err(e) => tracing::warn!(persona_id, error = %e, "forecast: run history read failed"),
        }
        if own.is_empty() {
            match executions::get_by_persona_id(
                pool,
                persona_id,
                Some(i64::from(MEASURED_PROFILE_WINDOW)),
            ) {
                Ok(execs) => own = execs.iter().filter_map(|e| e.duration_ms).collect(),
                Err(e) => {
                    tracing::warn!(persona_id, error = %e, "forecast: execution history read failed")
                }
            }
        }
    }
    own.retain(|d| *d > 0);
    own.truncate(MEASURED_PROFILE_WINDOW as usize);
    DurationHistory {
        own_ms: own,
        fleet_ms: fleet_ms.to_vec(),
    }
}

/// One item, ready to pack.
#[derive(Debug, Clone, PartialEq)]
pub struct ItemEstimate {
    pub item_id: String,
    pub priority: i32,
    /// Earliest start, epoch ms (never before now).
    pub release_ms: i64,
    pub duration_ms: i64,
    pub machine_units: i32,
    pub gpu_exclusive: bool,
    pub confidence: f64,
}

/// The median of a duration list; `None` when empty.
pub fn median_ms(values: &[i64]) -> Option<i64> {
    let mut v: Vec<f64> = values.iter().map(|d| *d as f64).collect();
    run_resources::median(&mut v).map(|m| m.round() as i64)
}

/// Estimate one item. Pure; `now_ms` and `night_start_ms` are the clock.
pub fn estimate_item(
    item: &StandupItem,
    profile: &ItemProfile,
    history: &DurationHistory,
    now_ms: i64,
    night_start_ms: i64,
) -> ItemEstimate {
    let window_start = match item.window {
        StandupWindow::Night => night_start_ms,
        StandupWindow::Day | StandupWindow::Any => now_ms,
    };
    let release_ms = item.not_before_ms.unwrap_or(window_start).max(now_ms);
    let window = f64::from(MEASURED_PROFILE_WINDOW);
    let (duration_ms, duration_conf) = if let Some(m) = median_ms(&history.own_ms) {
        (m, (history.own_ms.len() as f64 / window).min(1.0))
    } else if let Some(m) = median_ms(&history.fleet_ms) {
        (
            m,
            FLEET_FALLBACK_WEIGHT * (history.fleet_ms.len() as f64 / window).min(1.0),
        )
    } else {
        (DEFAULT_DURATION_MS, 0.0)
    };
    let profile_weight = if profile.measured {
        1.0
    } else {
        DECLARED_PROFILE_WEIGHT
    };
    ItemEstimate {
        item_id: item.id.clone(),
        priority: item.priority,
        release_ms,
        duration_ms: duration_ms.max(1),
        machine_units: profile.machine_units(),
        gpu_exclusive: profile.gpu_exclusive(),
        confidence: (duration_conf * profile_weight).clamp(0.0, 1.0),
    }
}

/// Is the item part of the forecast? Accepted or edited work items
/// (directions and filler); agent changes run through approvals, not the
/// fleet.
pub fn is_forecast(item: &StandupItem) -> bool {
    matches!(
        item.state,
        StandupItemState::Accepted | StandupItemState::Edited
    ) && matches!(
        item.kind,
        StandupItemKind::Direction | StandupItemKind::Filler
    )
}

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/// Whether `est` fits at `start` for its whole duration next to `placed`.
fn fits_at(est: &ItemEstimate, units: i32, start: i64, placed: &[ForecastSlot], cap: i32) -> bool {
    let end = start.saturating_add(est.duration_ms);
    // Load only rises at a slot's start, so checking `start` and every
    // placed start inside the interval covers every instant of it.
    let probes = std::iter::once(start).chain(
        placed
            .iter()
            .map(|s| s.start_ms)
            .filter(|s| *s > start && *s < end),
    );
    for at in probes {
        let live: Vec<&ForecastSlot> = placed
            .iter()
            .filter(|s| s.start_ms <= at && at < s.end_ms)
            .collect();
        let count = i32::try_from(live.len()).unwrap_or(i32::MAX);
        let used: i32 = live.iter().map(|s| s.machine_units.min(cap)).sum();
        if count >= cap || used + units > cap {
            return false;
        }
        if est.gpu_exclusive && live.iter().any(|s| s.gpu) {
            return false;
        }
    }
    true
}

/// Greedy packing under the parallel cap. Pure and deterministic: items are
/// placed highest priority first (lower `priority`, then earlier release, then
/// id); each takes the earliest start at or after its release - its release
/// itself or the end of an already placed slot - where it fits for its whole
/// duration. An item heavier than the whole machine budget is charged the
/// budget (it runs alone, as admission would let it once nothing else runs).
/// Slots come back ordered by start, then item id.
pub fn pack(estimates: &[ItemEstimate], cap: u32) -> Vec<ForecastSlot> {
    let cap = i32::try_from(cap.max(1)).unwrap_or(i32::MAX);
    let mut order: Vec<&ItemEstimate> = estimates.iter().collect();
    order.sort_by(|a, b| {
        (a.priority, a.release_ms, &a.item_id).cmp(&(b.priority, b.release_ms, &b.item_id))
    });
    let mut placed: Vec<ForecastSlot> = Vec::with_capacity(order.len());
    for est in order {
        let units = est.machine_units.clamp(1, cap);
        let mut candidates: Vec<i64> = std::iter::once(est.release_ms)
            .chain(
                placed
                    .iter()
                    .map(|s| s.end_ms)
                    .filter(|e| *e > est.release_ms),
            )
            .collect();
        candidates.sort_unstable();
        candidates.dedup();
        // The latest placed end always fits (everything has ended by then), so
        // a start is always found; the fallback is only for the type checker.
        let start = candidates
            .iter()
            .copied()
            .find(|t| fits_at(est, units, *t, &placed, cap))
            .unwrap_or_else(|| {
                placed
                    .iter()
                    .map(|s| s.end_ms)
                    .max()
                    .unwrap_or(est.release_ms)
                    .max(est.release_ms)
            });
        placed.push(ForecastSlot {
            item_id: est.item_id.clone(),
            start_ms: start,
            end_ms: start.saturating_add(est.duration_ms),
            machine_units: units,
            gpu: est.gpu_exclusive,
            confidence: est.confidence,
        });
    }
    placed.sort_by(|a, b| (a.start_ms, &a.item_id).cmp(&(b.start_ms, &b.item_id)));
    placed
}

// ---------------------------------------------------------------------------
// Clock + the whole forecast
// ---------------------------------------------------------------------------

/// The forecast of one standup revision's plan. Blocking.
///
/// `night` items are released at tonight's start as the arm computes it
/// (`arm::night_start_ms`: Athena's quiet-hours ritual, else 22:00-07:00), so
/// the forecast and the dispatch agree on when the night lane opens.
pub fn forecast_for_standup(
    pool: &DbPool,
    user_db: &UserDbPool,
    standup_id: &str,
) -> Result<Vec<ForecastSlot>, AppError> {
    let standup = super::plan::require(user_db, standup_id)?;
    let now_ms = personas_core::utils::now_ms();
    let night = super::arm::night_start_ms(user_db);
    let fleet_ms = fleet_sessions::recent_ended_durations_ms(pool, MEASURED_PROFILE_WINDOW)
        .unwrap_or_else(|e| {
            tracing::warn!(error = %e, "forecast: fleet duration read failed");
            Vec::new()
        });
    Ok(forecast_plan(
        pool,
        &standup.plan,
        &fleet_ms,
        crate::commands::fleet::queue::cap(pool),
        now_ms,
        night,
    ))
}

/// [`forecast_for_standup`] over a loaded plan and an explicit clock.
/// Blocking (reads charters and run history per item).
pub fn forecast_plan(
    pool: &DbPool,
    plan: &StandupPlan,
    fleet_ms: &[i64],
    cap: u32,
    now_ms: i64,
    night_start_ms: i64,
) -> Vec<ForecastSlot> {
    let estimates: Vec<ItemEstimate> = plan
        .items
        .iter()
        .filter(|i| is_forecast(i))
        .map(|item| {
            let profile = item_profile(pool, item);
            let history =
                duration_history(pool, item, profile.responsibility_id.as_deref(), fleet_ms);
            estimate_item(item, &profile, &history, now_ms, night_start_ms)
        })
        .collect();
    pack(&estimates, cap)
}

#[cfg(test)]
mod tests {
    use super::*;

    const MIN: i64 = 60_000;
    /// The fixed clock: 2026-11-06 14:00:00 UTC.
    const NOW: i64 = 1_793_973_600_000;
    const NIGHT: i64 = NOW + 8 * 60 * MIN;

    fn item(id: &str, priority: i32, window: StandupWindow) -> StandupItem {
        StandupItem {
            id: id.into(),
            kind: StandupItemKind::Direction,
            project_id: Some("proj".into()),
            device_id: "dev".into(),
            state: StandupItemState::Accepted,
            proposals: Vec::new(),
            chosen: Some("do it".into()),
            persona_id: Some("persona".into()),
            create_spec: None,
            retune_spec: None,
            window,
            not_before_ms: None,
            priority,
            evidence: String::new(),
        }
    }

    fn profile(
        machine: personas_core::models::MachineLoad,
        gpu: GpuClass,
        measured: bool,
    ) -> ItemProfile {
        ItemProfile {
            profile: Some(ResourceProfile {
                machine,
                gpu,
                ..ResourceProfile::default()
            }),
            measured,
            responsibility_id: Some("c1".into()),
        }
    }

    fn est(
        id: &str,
        priority: i32,
        release: i64,
        dur_min: i64,
        units: i32,
        gpu: bool,
    ) -> ItemEstimate {
        ItemEstimate {
            item_id: id.into(),
            priority,
            release_ms: release,
            duration_ms: dur_min * MIN,
            machine_units: units,
            gpu_exclusive: gpu,
            confidence: 1.0,
        }
    }

    #[test]
    fn duration_is_the_median_of_own_runs_with_confidence_by_count() {
        use personas_core::models::MachineLoad as L;
        let h = DurationHistory {
            own_ms: vec![10 * MIN, 30 * MIN, 20 * MIN, 40 * MIN, 1000 * MIN],
            fleet_ms: vec![5 * MIN],
        };
        let e = estimate_item(
            &item("a", 1, StandupWindow::Day),
            &profile(L::Heavy, GpuClass::Exclusive, true),
            &h,
            NOW,
            NIGHT,
        );
        assert_eq!(
            e.duration_ms,
            30 * MIN,
            "median, not mean - the outlier is ignored"
        );
        assert_eq!(e.machine_units, 4);
        assert!(e.gpu_exclusive);
        assert!((e.confidence - 5.0 / 20.0).abs() < 1e-9);
        assert_eq!(e.release_ms, NOW, "a day item is released now");
    }

    #[test]
    fn the_fleet_fallback_lowers_confidence_and_nothing_at_all_is_zero() {
        use personas_core::models::MachineLoad as L;
        let declared = profile(L::Light, GpuClass::None, false);
        let fleet = DurationHistory {
            own_ms: Vec::new(),
            fleet_ms: vec![10 * MIN; 20],
        };
        let e = estimate_item(
            &item("a", 1, StandupWindow::Any),
            &declared,
            &fleet,
            NOW,
            NIGHT,
        );
        assert_eq!(e.duration_ms, 10 * MIN);
        assert!(
            (e.confidence - FLEET_FALLBACK_WEIGHT * DECLARED_PROFILE_WEIGHT).abs() < 1e-9,
            "{}",
            e.confidence
        );
        let none = estimate_item(
            &item("a", 1, StandupWindow::Any),
            &declared,
            &DurationHistory::default(),
            NOW,
            NIGHT,
        );
        assert_eq!(none.duration_ms, DEFAULT_DURATION_MS);
        assert_eq!(none.confidence, 0.0, "declared profile, no runs measured");
        let no_charter = estimate_item(
            &item("a", 1, StandupWindow::Any),
            &ItemProfile::none(),
            &DurationHistory::default(),
            NOW,
            NIGHT,
        );
        assert_eq!(
            no_charter.machine_units, 1,
            "no charter is the default charge"
        );
        assert!(!no_charter.gpu_exclusive);
    }

    #[test]
    fn release_follows_not_before_then_window_and_never_precedes_now() {
        let p = ItemProfile::none();
        let h = DurationHistory::default();
        let night = estimate_item(&item("n", 1, StandupWindow::Night), &p, &h, NOW, NIGHT);
        assert_eq!(night.release_ms, NIGHT);
        let mut gated = item("g", 1, StandupWindow::Night);
        gated.not_before_ms = Some(NOW + 90 * MIN);
        assert_eq!(
            estimate_item(&gated, &p, &h, NOW, NIGHT).release_ms,
            NOW + 90 * MIN
        );
        gated.not_before_ms = Some(NOW - 90 * MIN);
        assert_eq!(
            estimate_item(&gated, &p, &h, NOW, NIGHT).release_ms,
            NOW,
            "a past gate is now"
        );
    }

    /// The deterministic forecast the AC names: a fixed clock, a cap of 2,
    /// one GPU-exclusive pair and a heavy item.
    #[test]
    fn packing_is_greedy_under_the_cap_and_deterministic() {
        let estimates = vec![
            est("night", 0, NIGHT, 60, 1, false),
            est("a", 1, NOW, 60, 1, true),
            est("b", 1, NOW, 30, 1, true),
            est("c", 2, NOW, 45, 1, false),
            est("heavy", 3, NOW, 20, 8, false),
            est("d", 4, NOW, 10, 1, false),
        ];
        let slots = pack(&estimates, 2);
        let got: Vec<(&str, i64, i64, i32)> = slots
            .iter()
            .map(|s| {
                (
                    s.item_id.as_str(),
                    (s.start_ms - NOW) / MIN,
                    (s.end_ms - NOW) / MIN,
                    s.machine_units,
                )
            })
            .collect();
        assert_eq!(
            got,
            vec![
                // a and c start together; b waits for a's GPU token.
                ("a", 0, 60, 1),
                ("c", 0, 45, 1),
                // d (lower priority) fits into c's freed slot at 45 before b...
                ("d", 45, 55, 1),
                // ...b takes the token when a ends at 60.
                ("b", 60, 90, 1),
                // heavy (8 units, clamped to the budget of 2) runs alone.
                ("heavy", 90, 110, 2),
                ("night", 480, 540, 1),
            ]
        );
        assert_eq!(pack(&estimates, 2), slots, "same inputs, same slots");
        let mut shuffled = estimates.clone();
        shuffled.reverse();
        assert_eq!(pack(&shuffled, 2), slots, "input order does not matter");
    }

    #[test]
    fn a_cap_of_one_runs_everything_in_sequence() {
        let slots = pack(
            &[
                est("x", 1, NOW, 10, 1, false),
                est("y", 2, NOW, 10, 1, false),
            ],
            1,
        );
        assert_eq!(slots[0].start_ms, NOW);
        assert_eq!(slots[1].start_ms, NOW + 10 * MIN);
        assert!(pack(&[], 4).is_empty());
    }

    fn charter(id: &str, status: &str, project: Option<&str>) -> PersonaResponsibility {
        PersonaResponsibility {
            id: id.into(),
            status: status.into(),
            project_id: project.map(str::to_string),
            ..PersonaResponsibility::default()
        }
    }

    #[test]
    fn the_charter_is_the_active_one_on_the_items_project() {
        let cs = vec![
            charter("old", "suspended", Some("proj")),
            charter("other", "active", Some("elsewhere")),
            charter("mine", "active", Some("proj")),
        ];
        assert_eq!(pick_charter(&cs, Some("proj")).unwrap().id, "mine");
        assert_eq!(pick_charter(&cs, Some("nope")).unwrap().id, "other");
        assert_eq!(pick_charter(&cs[..1], Some("proj")).unwrap().id, "old");
        assert!(pick_charter(&[], Some("proj")).is_none());
    }

    #[test]
    fn only_accepted_work_items_are_forecast() {
        let mut it = item("x", 1, StandupWindow::Day);
        assert!(is_forecast(&it));
        it.state = StandupItemState::Proposed;
        assert!(!is_forecast(&it));
        it.state = StandupItemState::Edited;
        it.kind = StandupItemKind::CreateAgent;
        assert!(!is_forecast(&it));
        it.kind = StandupItemKind::Filler;
        assert!(is_forecast(&it));
    }

    #[test]
    fn a_plan_forecasts_against_the_real_schema_with_default_charges() {
        // No persona rows, no runs: every item is the default charge and the
        // fleet history decides the duration.
        let pool = crate::db::init_test_db().unwrap();
        let mut skipped = item("skip", 0, StandupWindow::Day);
        skipped.state = StandupItemState::Skipped;
        let plan = StandupPlan {
            items: vec![
                item("a", 1, StandupWindow::Day),
                item("n", 2, StandupWindow::Night),
                skipped,
            ],
        };
        let slots = forecast_plan(&pool, &plan, &[20 * MIN, 40 * MIN], 4, NOW, NIGHT);
        assert_eq!(slots.len(), 2, "the skipped item is not forecast");
        assert_eq!(slots[0].item_id, "a");
        assert_eq!(slots[0].start_ms, NOW);
        assert_eq!(slots[0].end_ms, NOW + 30 * MIN, "fleet median of 20 and 40");
        assert_eq!(slots[0].machine_units, 1);
        assert!(!slots[0].gpu);
        assert_eq!(slots[1].item_id, "n");
        assert_eq!(slots[1].start_ms, NIGHT);
    }

    #[test]
    fn a_missing_standup_is_not_found() {
        let pool = crate::db::init_test_db().unwrap();
        let user_db = crate::db::init_test_user_db().unwrap();
        assert!(matches!(
            forecast_for_standup(&pool, &user_db, "nope"),
            Err(AppError::NotFound(_))
        ));
    }
}
