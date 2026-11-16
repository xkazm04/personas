//! Dead-spot detection and the admission backfill it feeds (spark app-standup,
//! WP2).
//!
//! A **dead spot** is the machine idling while armed standup work waits: for
//! every one of the last `standup.dead_spot_minutes` (3) finished minutes of
//! `host_utilization`, the minute's CPU max sat below
//! `standup.dead_spot_cpu_pct` (35%), its GPU max below
//! `standup.dead_spot_gpu_pct` (20%) - or there was no GPU reading at all -
//! and its RAM below the fleet's RAM gate ([`budgets::RAM_GATE_CLOSE_PCT`]).
//! [`detect`] is that rule, pure over the minutes.
//!
//! # Backfill
//!
//! When a dead spot holds and the armed plan has work
//! (`companion::standup::plan::backfill_candidates`), the highest-priority
//! candidate is dispatched EARLY - its `not_before_ms` lifted for that one
//! dispatch - provided the fleet's admission door would start it right now
//! under every existing guard, and at most once per dead-spot minute.
//! [`backfill_decision`] is that rule, pure over its inputs; [`backfill_tick`]
//! gathers the inputs and acts.
//!
//! ## Where it hooks, and why it cannot starve or jump the queue
//!
//! [`backfill_tick`] runs from `commands::fleet::queue::schedule_promotion`,
//! on the staleness ticker's 30 s budget tick only, AFTER that tick's
//! `refresh_budget_state` and `promote_head`. So:
//!
//! * every queued row that could start has already been promoted by the time
//!   backfill looks - backfill only ever sees capacity the queue left empty;
//! * the door is PROBED with its own verdict (`queue::backfill_probe`: count
//!   cap, machine and plan budgets, RAM gate, exclusive GPU token, the aging
//!   bound and strict order) and the backfill goes ahead only on a clean
//!   `Start`;
//! * a `Start` that would backfill PAST a waiting row ([`DoorProbe::StartsPast`])
//!   is declined, so a backfill never adds a skip to a queued row and cannot
//!   push it toward - or hold it in - the aging bound;
//! * the dispatch itself is the arm's (`arm::AppArmEffects::dispatch`): the
//!   cwd allowlist, the standup worker prompt and the ONE admission door,
//!   which re-decides with the same rules. Should a promotion take the slot
//!   between probe and start, the item queues at the tail like any arrival.
//!
//! The candidates are the frozen seam's, minus what the arm itself would not
//! send to the fleet: items an arm refused (`plan::refused_item_ids`), items
//! whose project a live headless App Master now holds, and items whose project
//! has an active App Master charter (the arm steers that charter's attention
//! loop instead).

use std::collections::HashSet;
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Manager};

use crate::commands::fleet::budgets;
use crate::commands::fleet::queue::{self, DispatchOrigin, DispatchRequest};
use crate::commands::fleet::types::FleetSessionMode;
use crate::companion::standup::model::{
    StandupEventKind, StandupItem, StandupItemKind, StandupItemState, StandupWindow,
};
use crate::companion::standup::{arm, plan, report};
use crate::db::models::HostUtilizationPoint;
use crate::db::repos::core::settings;
use crate::db::repos::resources::host_utilization::MINUTE_MS;
use crate::db::{settings_keys, DbPool};
use crate::error::AppError;
use crate::AppState;

use super::host_sampler::{self, minute_of};

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

/// The three `standup.dead_spot_*` settings, as shares and a minute count.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct DeadSpotSettings {
    /// CPU max below this share is idle (`standup.dead_spot_cpu_pct` / 100).
    pub cpu_share: f64,
    /// GPU max below this share is idle (`standup.dead_spot_gpu_pct` / 100).
    pub gpu_share: f64,
    /// How many consecutive finished minutes must be idle.
    pub minutes: u32,
}

impl Default for DeadSpotSettings {
    fn default() -> Self {
        Self::from_values(None, None, None)
    }
}

impl DeadSpotSettings {
    /// Parse the stored text values; an absent or unparsable value is the
    /// key's default, and every value is clamped to the range the settings
    /// validator enforces (percent 1-100, minutes 1-120).
    pub fn from_values(cpu: Option<&str>, gpu: Option<&str>, minutes: Option<&str>) -> Self {
        let num = |v: Option<&str>, default: u32, lo: u32, hi: u32| {
            v.and_then(|s| s.trim().parse::<u32>().ok())
                .unwrap_or(default)
                .clamp(lo, hi)
        };
        Self {
            cpu_share: f64::from(num(
                cpu,
                settings_keys::STANDUP_DEAD_SPOT_CPU_PCT_DEFAULT,
                1,
                100,
            )) / 100.0,
            gpu_share: f64::from(num(
                gpu,
                settings_keys::STANDUP_DEAD_SPOT_GPU_PCT_DEFAULT,
                1,
                100,
            )) / 100.0,
            minutes: num(
                minutes,
                settings_keys::STANDUP_DEAD_SPOT_MINUTES_DEFAULT,
                1,
                120,
            ),
        }
    }

    /// Read the three keys. A failed read is the key's default, logged.
    pub fn load(pool: &DbPool) -> Self {
        let read = |key: &str| match settings::get(pool, key) {
            Ok(v) => v,
            Err(e) => {
                tracing::warn!(key, error = %e, "dead spot: setting read failed - using the default");
                None
            }
        };
        let cpu = read(settings_keys::STANDUP_DEAD_SPOT_CPU_PCT);
        let gpu = read(settings_keys::STANDUP_DEAD_SPOT_GPU_PCT);
        let minutes = read(settings_keys::STANDUP_DEAD_SPOT_MINUTES);
        Self::from_values(cpu.as_deref(), gpu.as_deref(), minutes.as_deref())
    }
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/// Why there is no dead spot right now.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Blocker {
    /// No finished minute recent enough (the sampler is not running, or the
    /// app just started).
    NoRecentMinute,
    /// A minute inside the window has no row - "not measured" is not idle.
    MissingMinute {
        minute_ms: i64,
    },
    /// A minute had no CPU reading.
    NoCpuReading {
        minute_ms: i64,
    },
    /// A minute had no RAM reading.
    NoRamReading {
        minute_ms: i64,
    },
    CpuBusy {
        minute_ms: i64,
        cpu_max: f64,
    },
    GpuBusy {
        minute_ms: i64,
        gpu_max: f64,
    },
    RamHigh {
        minute_ms: i64,
        ram_avg: f64,
    },
}

/// [`detect`]'s verdict.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum DeadSpot {
    /// Every minute of the window was idle. `minute_ms` is the newest of them:
    /// the "dead-spot minute" one backfill is allowed per.
    Holds {
        minute_ms: i64,
        cpu_max: f64,
        gpu_max: Option<f64>,
    },
    No(Blocker),
}

/// The newest finished minute may lag `now` by up to this much (the sampler
/// writes a minute when the first sample of the NEXT one lands, up to 10 s in;
/// the queue tick is every 30 s).
const FRESHNESS_MINUTES: i64 = 2;

/// Is the machine in a dead spot? Pure.
///
/// The window is the `settings.minutes` consecutive minutes ending at the
/// newest finished minute (which must be at most [`FRESHNESS_MINUTES`] old).
/// Every one of them must exist and have `cpu_max < cpu_share`, `gpu_max`
/// absent or `< gpu_share`, and `ram_avg < ram_gate_share`. A missing CPU or
/// RAM reading blocks (the host always has those, so absence means a broken
/// minute); a missing GPU reading does NOT block (no GPU counters is an
/// ordinary machine, not a busy one).
pub fn detect(
    points: &[HostUtilizationPoint],
    now_ms: i64,
    settings: &DeadSpotSettings,
    ram_gate_share: f64,
) -> DeadSpot {
    let current = minute_of(now_ms);
    let Some(newest) = points
        .iter()
        .map(|p| p.minute_ms)
        .filter(|m| *m < current)
        .max()
    else {
        return DeadSpot::No(Blocker::NoRecentMinute);
    };
    if newest < current - FRESHNESS_MINUTES * MINUTE_MS {
        return DeadSpot::No(Blocker::NoRecentMinute);
    }
    let mut cpu_peak = 0.0f64;
    let mut gpu_peak: Option<f64> = None;
    for k in 0..i64::from(settings.minutes.max(1)) {
        let minute_ms = newest - k * MINUTE_MS;
        let Some(p) = points.iter().find(|p| p.minute_ms == minute_ms) else {
            return DeadSpot::No(Blocker::MissingMinute { minute_ms });
        };
        let Some(cpu_max) = p.cpu_max else {
            return DeadSpot::No(Blocker::NoCpuReading { minute_ms });
        };
        if cpu_max >= settings.cpu_share {
            return DeadSpot::No(Blocker::CpuBusy { minute_ms, cpu_max });
        }
        if let Some(gpu_max) = p.gpu_max {
            if gpu_max >= settings.gpu_share {
                return DeadSpot::No(Blocker::GpuBusy { minute_ms, gpu_max });
            }
            gpu_peak = Some(gpu_peak.map_or(gpu_max, |g| g.max(gpu_max)));
        }
        let Some(ram_avg) = p.ram_avg else {
            return DeadSpot::No(Blocker::NoRamReading { minute_ms });
        };
        if ram_avg >= ram_gate_share {
            return DeadSpot::No(Blocker::RamHigh { minute_ms, ram_avg });
        }
        cpu_peak = cpu_peak.max(cpu_max);
    }
    DeadSpot::Holds {
        minute_ms: newest,
        cpu_max: cpu_peak,
        gpu_max: gpu_peak,
    }
}

/// The RAM gate as a share: the same close line the fleet queue's RAM gate
/// holds promotion at.
pub fn ram_gate_share() -> f64 {
    budgets::RAM_GATE_CLOSE_PCT / 100.0
}

// ---------------------------------------------------------------------------
// The backfill decision
// ---------------------------------------------------------------------------

/// What the fleet's admission door would do with a backfill dispatch right
/// now (`queue::backfill_probe`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DoorProbe {
    /// A clean start: under every guard, nobody waiting is passed.
    Starts,
    /// It would start, but only by backfilling past this many waiting rows.
    StartsPast(usize),
    /// The door would hold it (or never admit it); the door's own words.
    Waits(String),
}

/// [`backfill_decision`]'s verdict.
#[derive(Debug, Clone, PartialEq)]
pub enum BackfillDecision {
    /// No dead spot: nothing is read, nothing dispatched.
    NoDeadSpot(Blocker),
    /// This dead-spot minute already had its one backfill.
    AlreadyBackfilled { minute_ms: i64 },
    /// The armed plan has no dispatchable work.
    NoCandidates,
    /// The top candidate would only start past queued work, which keeps
    /// priority over a backfill.
    QueuedWorkWaits { item_id: String, waiting: usize },
    /// The door would not start the top candidate now.
    DoorWaits { item_id: String, reason: String },
    /// Dispatch `item_id` now, its `not_before_ms` lifted.
    Admit { item_id: String, minute_ms: i64 },
}

/// The item [`backfill_decision`] would take: the lowest `priority` (lower
/// runs first), the earlier position on a tie.
pub fn top_candidate(candidates: &[StandupItem]) -> Option<&StandupItem> {
    candidates
        .iter()
        .enumerate()
        .min_by_key(|(i, c)| (c.priority, *i))
        .map(|(_, c)| c)
}

/// Decide one backfill. Pure: `door` is asked about the top candidate only,
/// and only once every cheaper condition has passed. `candidates` should
/// already be filtered to dispatchable items ([`is_dispatchable`]).
pub fn backfill_decision(
    dead_spot: DeadSpot,
    last_backfill_minute: Option<i64>,
    candidates: &[StandupItem],
    door: impl FnOnce(&StandupItem) -> DoorProbe,
) -> BackfillDecision {
    let minute_ms = match dead_spot {
        DeadSpot::Holds { minute_ms, .. } => minute_ms,
        DeadSpot::No(blocker) => return BackfillDecision::NoDeadSpot(blocker),
    };
    if last_backfill_minute == Some(minute_ms) {
        return BackfillDecision::AlreadyBackfilled { minute_ms };
    }
    let Some(top) = top_candidate(candidates) else {
        return BackfillDecision::NoCandidates;
    };
    let item_id = top.id.clone();
    match door(top) {
        DoorProbe::Starts => BackfillDecision::Admit { item_id, minute_ms },
        DoorProbe::StartsPast(waiting) => BackfillDecision::QueuedWorkWaits { item_id, waiting },
        DoorProbe::Waits(reason) => BackfillDecision::DoorWaits { item_id, reason },
    }
}

/// Can a backfill dispatch this item at all? Work kinds only (a direction or
/// filler - agent changes run through approvals, never the fleet), not
/// skipped, a direction only once accepted or edited, a project to run in and
/// a direction to run (`arm::direction_text`, the same text the arm
/// dispatches).
pub fn is_dispatchable(item: &StandupItem) -> bool {
    let kind_ok = match item.kind {
        StandupItemKind::Direction => matches!(
            item.state,
            StandupItemState::Accepted | StandupItemState::Edited
        ),
        StandupItemKind::Filler => item.state != StandupItemState::Skipped,
        StandupItemKind::CreateAgent | StandupItemKind::RetuneAgent => false,
    };
    kind_ok && item.project_id.is_some() && arm::direction_text(item).is_some()
}

/// The request the door is PROBED with: the same shape and charge as the
/// dispatch `arm::AppArmEffects::dispatch` makes (interactive, the window's
/// origin, `profile: None` = the default charge), with NO `not_before_ms` -
/// that gate is what the backfill lifts. The probe only needs what the door
/// reads (charge, gate, engine marker); the real prompt is built by the arm's
/// dispatcher.
pub fn probe_request(item: &StandupItem, project_root: &str) -> Option<DispatchRequest> {
    let direction = arm::direction_text(item)?;
    Some(DispatchRequest {
        cwd: project_root.to_string(),
        name: None,
        title: Some(direction.chars().take(80).collect()),
        args: vec![direction],
        mode: FleetSessionMode::Interactive,
        run_label: None,
        origin: match item.window {
            StandupWindow::Night => DispatchOrigin::NightShift,
            StandupWindow::Day | StandupWindow::Any => DispatchOrigin::Athena,
        },
        persona_id: item.persona_id.clone(),
        goal_id: None,
        cycle_index: None,
        not_before_ms: None,
        profile: None,
    })
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

/// The dead-spot minute the last backfill used; `i64::MIN` = none yet.
static LAST_BACKFILL_MINUTE: AtomicI64 = AtomicI64::new(i64::MIN);

/// Items this process already backfilled. A backstop beside the seam's own
/// "not yet dispatched" filter (which reads the `backfill` events this
/// writes): a candidate is never dispatched twice by backfill, even when the
/// event write failed.
static BACKFILLED: Mutex<Option<HashSet<String>>> = Mutex::new(None);

fn already_backfilled(item_id: &str) -> bool {
    BACKFILLED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .is_some_and(|s| s.contains(item_id))
}

fn note_backfilled(item_id: &str) {
    BACKFILLED
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get_or_insert_with(HashSet::new)
        .insert(item_id.to_string());
}

/// One backfill pass: called by the fleet queue's budget tick (see the module
/// doc for where and why). Cheap when the machine is busy: three settings
/// reads and the in-memory minutes, nothing else.
pub async fn backfill_tick(app: &AppHandle) {
    let Some(state) = app.try_state::<Arc<AppState>>() else {
        return;
    };
    let state: Arc<AppState> = state.inner().clone();
    let app = app.clone();
    let outcome = tokio::task::spawn_blocking(move || backfill_pass(&app, &state)).await;
    match outcome {
        Ok(Ok(decision)) => match &decision {
            BackfillDecision::Admit { .. } => {
                tracing::info!(?decision, "dead spot: backfilled")
            }
            BackfillDecision::NoDeadSpot(_) | BackfillDecision::AlreadyBackfilled { .. } => {}
            _ => tracing::debug!(?decision, "dead spot: no backfill"),
        },
        Ok(Err(e)) => tracing::warn!(error = %e, "dead spot: backfill pass failed"),
        Err(e) if e.is_panic() => tracing::error!(
            panic = %crate::utils::extract_panic_message(e.into_panic()),
            "dead spot: backfill pass panicked"
        ),
        Err(e) => tracing::warn!(error = %e, "dead spot: backfill pass cancelled"),
    }
}

/// The blocking body of [`backfill_tick`].
fn backfill_pass(app: &AppHandle, state: &AppState) -> Result<BackfillDecision, AppError> {
    let settings = DeadSpotSettings::load(&state.db);
    let now = personas_core::utils::now_ms();
    let dead_spot = detect(
        &host_sampler::recent_minutes(),
        now,
        &settings,
        ram_gate_share(),
    );
    let last = Some(LAST_BACKFILL_MINUTE.load(Ordering::Acquire)).filter(|m| *m != i64::MIN);
    // The cheap verdicts first: no plan read while the machine is busy.
    if let d @ (BackfillDecision::NoDeadSpot(_) | BackfillDecision::AlreadyBackfilled { .. }) =
        backfill_decision(dead_spot, last, &[], |_| DoorProbe::Waits(String::new()))
    {
        return Ok(d);
    }
    let Some(head) = report::armed(&state.user_db)? else {
        return Ok(BackfillDecision::NoCandidates);
    };
    let Some(standup) = plan::get(&state.user_db, &head.id)? else {
        return Ok(BackfillDecision::NoCandidates);
    };
    let fx = arm::AppArmEffects {
        app,
        db: &state.db,
        user_db: &state.user_db,
        standup: &standup,
    };
    let refused = plan::refused_item_ids(&state.user_db, &standup.id)?;
    let candidates: Vec<StandupItem> = plan::backfill_candidates(&state.user_db)?
        .into_iter()
        .filter(|c| is_dispatchable(c) && !already_backfilled(&c.id) && !refused.contains(&c.id))
        .filter(|c| routes_to_fleet(&fx, c))
        .collect();

    let decision = backfill_decision(dead_spot, last, &candidates, |item| {
        let root = item
            .project_id
            .as_deref()
            .map(|p| crate::db::repos::dev_tools::get_project_by_id(&state.db, p));
        match root {
            Some(Ok(project)) => match probe_request(item, &project.root_path) {
                Some(req) => queue::backfill_probe(app, &req),
                None => DoorProbe::Waits("the item has no direction to run".into()),
            },
            Some(Err(e)) => DoorProbe::Waits(format!("its project could not be resolved: {e}")),
            None => DoorProbe::Waits("the item names no project".into()),
        }
    });
    let BackfillDecision::Admit { item_id, minute_ms } = &decision else {
        return Ok(decision);
    };
    let Some(item) = candidates.iter().find(|c| &c.id == item_id) else {
        return Ok(decision);
    };
    let (Some(project_id), Some(direction)) =
        (item.project_id.as_deref(), arm::direction_text(item))
    else {
        return Ok(decision);
    };
    // The arm's own dispatcher: the cwd allowlist check, the standup worker
    // prompt (branch-only, never push, approvals for destructive acts) and the
    // ONE admission door. The door re-decides with the rules the probe just
    // passed; should a promotion take the slot in between, the item queues at
    // the tail like any arrival rather than being lost.
    let session_id = arm::ArmEffects::dispatch(&fx, project_id, item, &direction, None)?;
    LAST_BACKFILL_MINUTE.store(*minute_ms, Ordering::Release);
    note_backfilled(item_id);
    let started = crate::commands::fleet::registry::registry()
        .session_state(&session_id)
        .is_some_and(|s| s != crate::commands::fleet::types::FleetSessionState::Queued);
    record_event(&fx, item, &direction, &session_id, started, dead_spot, now);
    Ok(decision)
}

/// Whether the arm would have sent this item to the fleet: no live headless
/// App Master holds its project (the arm refuses those), and the project has
/// no active App Master charter (the arm steers that charter's attention loop
/// instead of starting a session beside it). A failed check reads as "no".
fn routes_to_fleet(fx: &arm::AppArmEffects<'_>, item: &StandupItem) -> bool {
    use arm::ArmEffects;
    let Some(project_id) = item.project_id.as_deref() else {
        return false;
    };
    let held = fx.headless_hold(project_id);
    let charter = fx.active_charter(project_id);
    match (held, charter) {
        (Ok(None), Ok(None)) => true,
        (Ok(Some(reason)), _) => {
            tracing::debug!(item_id = %item.id, %reason, "dead spot: a headless App Master holds the project");
            false
        }
        (Ok(None), Ok(Some(_))) => false,
        (Err(e), _) | (_, Err(e)) => {
            tracing::warn!(item_id = %item.id, error = %e, "dead spot: routing check failed; skipped");
            false
        }
    }
}

/// Write the one `backfill` event for a dispatch. `detail.itemId` is what
/// `plan::dispatched_item_ids` reads, so the item never comes back as a
/// candidate.
fn record_event(
    fx: &arm::AppArmEffects<'_>,
    item: &StandupItem,
    direction: &str,
    session_id: &str,
    started: bool,
    dead_spot: DeadSpot,
    now: i64,
) {
    let (minute_ms, cpu_max, gpu_max) = match dead_spot {
        DeadSpot::Holds {
            minute_ms,
            cpu_max,
            gpu_max,
        } => (minute_ms, cpu_max, gpu_max),
        DeadSpot::No(_) => (0, 0.0, None),
    };
    let gpu_words = gpu_max.map_or_else(
        || "no GPU reading".to_string(),
        |g| format!("GPU max {:.0}%", g * 100.0),
    );
    let verb = if started {
        "Backfilled"
    } else {
        "Backfill queued"
    };
    let event = arm::event(
        &fx.standup.id,
        now,
        StandupEventKind::Backfill,
        item.project_id.as_deref(),
        format!(
            "{verb} into a dead spot (CPU max {:.0}%, {gpu_words}): {direction}",
            cpu_max * 100.0
        ),
        serde_json::json!({
            "itemId": item.id,
            "sessionId": session_id,
            "started": started,
            "minuteMs": minute_ms,
            "cpuMax": cpu_max,
            "gpuMax": gpu_max,
            "liftedNotBeforeMs": item.not_before_ms,
        }),
    );
    arm::ArmEffects::record(fx, &event);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::companion::standup::model::DirectionProposal;

    const M: i64 = MINUTE_MS;
    const RAM_GATE: f64 = 0.90;

    fn pt(
        minute: i64,
        cpu: Option<f64>,
        gpu: Option<f64>,
        ram: Option<f64>,
    ) -> HostUtilizationPoint {
        HostUtilizationPoint {
            minute_ms: minute * M,
            cpu_avg: cpu.map(|c| c / 2.0),
            cpu_max: cpu,
            ram_avg: ram,
            gpu_avg: gpu.map(|g| g / 2.0),
            gpu_max: gpu,
            fleet_running: 0,
            fleet_queued: 1,
        }
    }

    fn idle(minute: i64) -> HostUtilizationPoint {
        pt(minute, Some(0.10), Some(0.05), Some(0.60))
    }

    /// `now` inside minute 100, so the newest finished minute is 99.
    const NOW: i64 = 100 * M + 20_000;

    fn defaults() -> DeadSpotSettings {
        DeadSpotSettings::default()
    }

    #[test]
    fn settings_default_and_clamp_like_the_validator() {
        let d = defaults();
        assert!((d.cpu_share - 0.35).abs() < 1e-9);
        assert!((d.gpu_share - 0.20).abs() < 1e-9);
        assert_eq!(d.minutes, 3);
        let s = DeadSpotSettings::from_values(Some(" 50 "), Some("0"), Some("999"));
        assert!((s.cpu_share - 0.50).abs() < 1e-9);
        assert!((s.gpu_share - 0.01).abs() < 1e-9, "clamped up to 1%");
        assert_eq!(s.minutes, 120, "clamped down to 120");
        assert_eq!(
            DeadSpotSettings::from_values(Some("x"), None, Some("")),
            defaults()
        );
    }

    #[test]
    fn three_idle_minutes_hold_and_name_the_newest() {
        let pts = [idle(96), idle(97), idle(98), idle(99)];
        match detect(&pts, NOW, &defaults(), RAM_GATE) {
            DeadSpot::Holds {
                minute_ms,
                cpu_max,
                gpu_max,
            } => {
                assert_eq!(minute_ms, 99 * M);
                assert!((cpu_max - 0.10).abs() < 1e-9);
                assert_eq!(gpu_max, Some(0.05));
            }
            other => panic!("expected a dead spot: {other:?}"),
        }
    }

    #[test]
    fn gpu_missing_is_not_idle_blocking() {
        let pts = [
            pt(97, Some(0.1), None, Some(0.5)),
            pt(98, Some(0.1), None, Some(0.5)),
            pt(99, Some(0.1), None, Some(0.5)),
        ];
        assert!(matches!(
            detect(&pts, NOW, &defaults(), RAM_GATE),
            DeadSpot::Holds { gpu_max: None, .. }
        ));
    }

    #[test]
    fn one_busy_minute_breaks_it() {
        // CPU at exactly the threshold is not below it.
        let pts = [idle(97), pt(98, Some(0.35), Some(0.0), Some(0.5)), idle(99)];
        assert_eq!(
            detect(&pts, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::CpuBusy {
                minute_ms: 98 * M,
                cpu_max: 0.35
            })
        );
        let pts = [idle(97), idle(98), pt(99, Some(0.1), Some(0.25), Some(0.5))];
        assert_eq!(
            detect(&pts, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::GpuBusy {
                minute_ms: 99 * M,
                gpu_max: 0.25
            })
        );
        let pts = [pt(97, Some(0.1), None, Some(0.93)), idle(98), idle(99)];
        assert_eq!(
            detect(&pts, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::RamHigh {
                minute_ms: 97 * M,
                ram_avg: 0.93
            })
        );
    }

    #[test]
    fn a_busy_minute_outside_the_window_does_not_count() {
        let pts = [
            pt(96, Some(0.99), Some(0.99), Some(0.5)),
            idle(97),
            idle(98),
            idle(99),
        ];
        assert!(matches!(
            detect(&pts, NOW, &defaults(), RAM_GATE),
            DeadSpot::Holds { .. }
        ));
    }

    #[test]
    fn missing_or_unmeasured_minutes_are_not_idle() {
        let gap = [idle(97), idle(99)];
        assert_eq!(
            detect(&gap, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::MissingMinute { minute_ms: 98 * M })
        );
        let no_cpu = [idle(97), pt(98, None, None, Some(0.5)), idle(99)];
        assert_eq!(
            detect(&no_cpu, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::NoCpuReading { minute_ms: 98 * M })
        );
        let no_ram = [idle(97), idle(98), pt(99, Some(0.1), None, None)];
        assert_eq!(
            detect(&no_ram, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::NoRamReading { minute_ms: 99 * M })
        );
        assert_eq!(
            detect(&[], NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::NoRecentMinute)
        );
        // The newest minute is stale (the sampler stopped).
        let stale = [idle(90), idle(91), idle(92)];
        assert_eq!(
            detect(&stale, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::NoRecentMinute)
        );
        // The in-progress minute is never part of the window.
        let only_current = [idle(100)];
        assert_eq!(
            detect(&only_current, NOW, &defaults(), RAM_GATE),
            DeadSpot::No(Blocker::NoRecentMinute)
        );
    }

    #[test]
    fn a_one_minute_lag_in_the_flush_is_tolerated() {
        // Minute 99 not written yet: the window ends at 98.
        let pts = [idle(96), idle(97), idle(98)];
        assert!(matches!(
            detect(&pts, NOW, &defaults(), RAM_GATE),
            DeadSpot::Holds { minute_ms, .. } if minute_ms == 98 * M
        ));
    }

    #[test]
    fn the_window_length_is_the_setting() {
        let five = DeadSpotSettings::from_values(None, None, Some("5"));
        let pts = [idle(97), idle(98), idle(99)];
        assert_eq!(
            detect(&pts, NOW, &five, RAM_GATE),
            DeadSpot::No(Blocker::MissingMinute { minute_ms: 96 * M })
        );
    }

    fn item(
        id: &str,
        kind: StandupItemKind,
        state: StandupItemState,
        priority: i32,
    ) -> StandupItem {
        StandupItem {
            id: id.into(),
            kind,
            project_id: Some("proj".into()),
            device_id: "dev".into(),
            state,
            proposals: vec![DirectionProposal {
                id: "p1".into(),
                text: "Ship the thing".into(),
                rationale: "because".into(),
                recommended: true,
            }],
            chosen: Some(format!("work on {id}")),
            persona_id: Some("persona".into()),
            create_spec: None,
            retune_spec: None,
            window: StandupWindow::Night,
            not_before_ms: Some(i64::MAX / 2),
            priority,
            evidence: String::new(),
        }
    }

    fn holds(minute: i64) -> DeadSpot {
        DeadSpot::Holds {
            minute_ms: minute * M,
            cpu_max: 0.1,
            gpu_max: None,
        }
    }

    fn work() -> Vec<StandupItem> {
        vec![
            item("b", StandupItemKind::Filler, StandupItemState::Proposed, 5),
            item(
                "a",
                StandupItemKind::Direction,
                StandupItemState::Accepted,
                1,
            ),
            item("c", StandupItemKind::Direction, StandupItemState::Edited, 1),
        ]
    }

    #[test]
    fn a_dead_spot_with_a_free_door_admits_the_highest_priority_item() {
        let mut asked = None;
        let d = backfill_decision(holds(99), None, &work(), |it| {
            asked = Some(it.id.clone());
            DoorProbe::Starts
        });
        assert_eq!(
            d,
            BackfillDecision::Admit {
                item_id: "a".into(),
                minute_ms: 99 * M
            },
            "lowest priority value first, earlier position on a tie"
        );
        assert_eq!(
            asked.as_deref(),
            Some("a"),
            "the door is asked about the top item only"
        );
    }

    #[test]
    fn no_dead_spot_never_asks_the_door() {
        let d = backfill_decision(DeadSpot::No(Blocker::NoRecentMinute), None, &work(), |_| {
            panic!("the door must not be asked")
        });
        assert_eq!(d, BackfillDecision::NoDeadSpot(Blocker::NoRecentMinute));
    }

    #[test]
    fn at_most_one_backfill_per_dead_spot_minute() {
        let d = backfill_decision(holds(99), Some(99 * M), &work(), |_| {
            panic!("the door must not be asked twice in one minute")
        });
        assert_eq!(d, BackfillDecision::AlreadyBackfilled { minute_ms: 99 * M });
        // The next minute is a new dead-spot minute.
        assert!(matches!(
            backfill_decision(holds(100), Some(99 * M), &work(), |_| DoorProbe::Starts),
            BackfillDecision::Admit { .. }
        ));
    }

    #[test]
    fn a_dead_spot_fires_only_with_work_queued() {
        let d = backfill_decision(holds(99), None, &[], |_| panic!("no candidate, no door"));
        assert_eq!(d, BackfillDecision::NoCandidates);
    }

    #[test]
    fn the_door_keeps_every_guard_and_queued_work_keeps_priority() {
        assert_eq!(
            backfill_decision(holds(99), None, &work(), |_| {
                DoorProbe::Waits("held by the GPU token".into())
            }),
            BackfillDecision::DoorWaits {
                item_id: "a".into(),
                reason: "held by the GPU token".into()
            }
        );
        assert_eq!(
            backfill_decision(holds(99), None, &work(), |_| DoorProbe::StartsPast(2)),
            BackfillDecision::QueuedWorkWaits {
                item_id: "a".into(),
                waiting: 2
            }
        );
    }

    #[test]
    fn only_runnable_work_is_dispatchable() {
        use StandupItemKind as K;
        use StandupItemState as S;
        assert!(is_dispatchable(&item("x", K::Direction, S::Accepted, 0)));
        assert!(is_dispatchable(&item("x", K::Direction, S::Edited, 0)));
        assert!(!is_dispatchable(&item("x", K::Direction, S::Proposed, 0)));
        assert!(!is_dispatchable(&item("x", K::Direction, S::Skipped, 0)));
        assert!(is_dispatchable(&item("x", K::Filler, S::Proposed, 0)));
        assert!(!is_dispatchable(&item("x", K::Filler, S::Skipped, 0)));
        assert!(!is_dispatchable(&item("x", K::CreateAgent, S::Accepted, 0)));
        assert!(!is_dispatchable(&item("x", K::RetuneAgent, S::Accepted, 0)));
        let mut no_project = item("x", K::Filler, S::Accepted, 0);
        no_project.project_id = None;
        assert!(!is_dispatchable(&no_project));
        let mut no_task = item("x", K::Filler, S::Accepted, 0);
        no_task.chosen = Some("  ".into());
        no_task.proposals.clear();
        assert!(!is_dispatchable(&no_task));
    }

    #[test]
    fn the_probe_request_lifts_the_gate_and_matches_the_arm_dispatch_shape() {
        let it = item("x", StandupItemKind::Filler, StandupItemState::Accepted, 0);
        let req = probe_request(&it, "C:/code/proj").unwrap();
        assert_eq!(
            req.not_before_ms, None,
            "the gate is lifted for this dispatch"
        );
        assert_eq!(req.cwd, "C:/code/proj");
        assert_eq!(req.mode, FleetSessionMode::Interactive);
        assert_eq!(
            req.origin,
            DispatchOrigin::NightShift,
            "a night item keeps the night lane"
        );
        assert_eq!(
            req.profile, None,
            "the arm dispatch carries the default charge"
        );
        assert_eq!(req.persona_id.as_deref(), Some("persona"));
        assert_eq!(req.args, vec!["work on x".to_string()]);
        let mut day = it.clone();
        day.window = StandupWindow::Day;
        assert_eq!(
            probe_request(&day, "C:/p").unwrap().origin,
            DispatchOrigin::Athena
        );
        let mut none = it;
        none.chosen = None;
        none.proposals.clear();
        assert!(probe_request(&none, "C:/p").is_none());
    }

    #[test]
    fn a_backfilled_item_is_remembered() {
        assert!(!already_backfilled("dead-spot-test-item"));
        note_backfilled("dead-spot-test-item");
        assert!(already_backfilled("dead-spot-test-item"));
    }
}
