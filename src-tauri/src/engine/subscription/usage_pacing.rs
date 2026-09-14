//! **Fleet Autopilot pacing** — how many personas the attention loop may
//! START this tick, from three gauges the operator watches anyway.
//!
//! # The problem the governor leaves open
//!
//! [`super::usage_governor`] is a STOP: it halts dispatch when the worst
//! subscription window reaches its threshold. It says nothing about the shape
//! of the spend before the wall, so an attention loop switched on at the start
//! of a subscription week burns the seven-day window in its first two days,
//! then idles for five. The operator's ruling (2026-09-14): *spend the week
//! linearly.* If the seven-day utilisation is BEHIND its linear pace to the
//! weekly target — the operator is "in debt" against the plan — and the
//! five-hour window has room, the loop may run `x` personas in parallel to do
//! the work they were designed for. Ahead of pace, it holds.
//!
//! # The three gauges, and what each converts into
//!
//! | Gauge | Source | Converts into |
//! |---|---|---|
//! | seven-day window | `fleet_claude_usage` (the OAuth usage endpoint) | **whether** to dispatch: `behind = linear_pace − actual` must be positive |
//! | five-hour window | same | **how many**: the headroom under the fleet line (`stop − margin`) scales the parallel cap down |
//! | physical memory | `system_metrics` (sysinfo) | **how many**: free memory below the stop line divided by what one worker takes |
//!
//! `slots = min(parallel_cap, usage_slots, memory_slots)`, and `0` while
//! ahead of pace. The attention tick takes the smaller of this and the
//! running-work headroom ([`super::attention::tick_dispatch_budget`]), so the
//! pacing can only ever REDUCE what the loop was already allowed.
//!
//! # Failing open, the same way the governor does
//!
//! An unreadable usage gauge is not evidence of an empty tank: with
//! `available == false` the usage half reports the full parallel cap and
//! names the reason, and the memory half still applies. Memory is always
//! readable (it is the local machine).
//!
//! # Pure by construction
//!
//! [`pacing_from`] takes the snapshot, the memory reading, the configuration
//! and the clock, and returns the verdict — no I/O, so every branch is a unit
//! test at the bottom of this file. [`verdict`] is the thin I/O wrapper the
//! tick and the status command share.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::commands::fleet::claude_usage::{cached_snapshot, ClaudeUsageSnapshot};
use crate::db::repos::core::settings;
use crate::db::settings_keys;
use crate::db::DbPool;

/// The five-hour headroom (points under the fleet line) at which every slot
/// of the parallel cap opens. Under it the cap scales down linearly, never
/// below one while any headroom remains: 25 points of headroom on a cap of
/// three opens two slots; 5 points opens one.
pub const FULL_SPEED_HEADROOM_PCT: f64 = 50.0;

/// Why the pacing held the loop at zero this tick — one code, so the board
/// can say it in the operator's language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "snake_case")]
pub enum AutopilotHold {
    /// The seven-day window is at or above its linear pace — nothing owed.
    AheadOfPace,
    /// The five-hour window is at or above the fleet line (`stop − margin`).
    FiveHourFull,
    /// Starting one more worker would push memory past its stop line.
    MemoryFull,
}

/// The pacing verdict — every number the decision used, so the Activity
/// board renders the reasoning rather than a bare count.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct AutopilotPacing {
    /// `fleet_autopilot.pacing` — whether the seven-day pace gates dispatch.
    pub pacing_enabled: bool,
    /// `fleet_autopilot.max_parallel` — the ceiling every other number scales.
    pub parallel_cap: usize,
    /// **The answer**: personas the loop may start this tick.
    pub slots: usize,
    /// Set when `slots == 0` and a gauge (not the cap) is the reason.
    pub hold: Option<AutopilotHold>,
    /// `fleet_autopilot.weekly_target_pct`.
    pub weekly_target_pct: f64,
    /// How far into the seven-day window the clock is, 0–100.
    pub weekly_elapsed_pct: f64,
    /// `elapsed × target` — the utilisation the window "should" be at now.
    pub weekly_linear_pct: f64,
    /// The seven-day window's actual utilisation; `None` when the gauge could
    /// not be read.
    pub seven_day_pct: Option<f64>,
    /// `linear − actual`. Positive = behind pace = the debt the loop may
    /// spend; negative = ahead. `None` without a gauge.
    pub behind_pct: Option<f64>,
    /// The five-hour window's utilisation; `None` without a gauge.
    pub five_hour_pct: Option<f64>,
    /// `stop − margin`: the five-hour line a fleet worker may not start above.
    pub five_hour_line_pct: f64,
    /// Slots the five-hour headroom allows (before the memory cap).
    pub usage_slots: usize,
    /// The machine's memory utilisation, percent of physical RAM.
    pub memory_used_pct: f64,
    /// Megabytes — a machine has fewer than 2^53 of them.
    #[ts(type = "number")]
    pub memory_total_mb: u64,
    /// `fleet_autopilot.memory_stop_pct`.
    pub memory_stop_pct: f64,
    /// `fleet_autopilot.memory_per_agent_mb` — bounded to 8192.
    #[ts(type = "number")]
    pub memory_per_agent_mb: u64,
    /// Workers the free memory below the stop line can hold.
    pub memory_slots: usize,
    /// Whether the usage gauge was readable this tick.
    pub usage_available: bool,
    /// Why it was not, when it was not (the loop fails open on it).
    pub usage_reason: Option<String>,
}

impl AutopilotPacing {
    /// One line for the tick summary.
    pub fn summary(&self) -> String {
        let pace = match self.behind_pct {
            Some(b) if b >= 0.0 => format!("behind pace by {b:.0}pt"),
            Some(b) => format!("ahead of pace by {:.0}pt", -b),
            None => "pace unknown".to_string(),
        };
        let hold = match self.hold {
            Some(AutopilotHold::AheadOfPace) => " — HOLD (ahead of pace)",
            Some(AutopilotHold::FiveHourFull) => " — HOLD (five-hour window full)",
            Some(AutopilotHold::MemoryFull) => " — HOLD (memory full)",
            None => "",
        };
        format!(
            "{} of {} slots ({pace}; 5h {} vs line {:.0}%; mem {:.0}% of {:.0}% stop){hold}",
            self.slots,
            self.parallel_cap,
            self.five_hour_pct
                .map_or("n/a".to_string(), |p| format!("{p:.0}%")),
            self.five_hour_line_pct,
            self.memory_used_pct,
            self.memory_stop_pct,
        )
    }
}

/// The settings the pacing reads, resolved once per call.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PacingConfig {
    pub pacing_enabled: bool,
    pub parallel_cap: usize,
    pub weekly_target_pct: f64,
    /// The governor's stop line (`attention.usage_stop_pct`).
    pub stop_pct: f64,
    /// The fleet-worker margin under it (`attention.fleet_start_margin_pct`).
    pub fleet_margin_pct: f64,
    pub memory_stop_pct: f64,
    pub memory_per_agent_mb: u64,
}

impl Default for PacingConfig {
    fn default() -> Self {
        Self {
            pacing_enabled: settings_keys::FLEET_AUTOPILOT_PACING_DEFAULT,
            parallel_cap: settings_keys::FLEET_AUTOPILOT_MAX_PARALLEL_DEFAULT,
            weekly_target_pct: f64::from(settings_keys::FLEET_AUTOPILOT_WEEKLY_TARGET_PCT_DEFAULT),
            stop_pct: settings_keys::ATTENTION_USAGE_STOP_PCT_DEFAULT,
            fleet_margin_pct: settings_keys::ATTENTION_FLEET_START_MARGIN_PCT_DEFAULT,
            memory_stop_pct: f64::from(settings_keys::FLEET_AUTOPILOT_MEMORY_STOP_PCT_DEFAULT),
            memory_per_agent_mb: u64::from(
                settings_keys::FLEET_AUTOPILOT_MEMORY_PER_AGENT_MB_DEFAULT,
            ),
        }
    }
}

/// One memory reading, the two numbers the pacing needs.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct MemoryReading {
    pub used_pct: f64,
    pub total_mb: u64,
}

fn read_u32(pool: &DbPool, key: &str, min: u32, max: u32, default: u32) -> u32 {
    settings::get(pool, key)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<u32>().ok())
        .filter(|n| (min..=max).contains(n))
        .unwrap_or(default)
}

/// Read the pacing configuration. Every value is clamped by its
/// `settings_keys` bounds; an unset or unparseable row is its default.
pub fn read_config(pool: &DbPool) -> PacingConfig {
    // Decoded with `bool::from_str`, the same shape as the numeric readers
    // below: the registry validates the row to the literal `true`/`false`,
    // and anything else is the default rather than a silently-off pacing.
    let pacing_enabled = settings::get(pool, settings_keys::FLEET_AUTOPILOT_PACING)
        .ok()
        .flatten()
        .and_then(|v| v.trim().parse::<bool>().ok())
        .unwrap_or(settings_keys::FLEET_AUTOPILOT_PACING_DEFAULT);
    let parallel_cap = read_u32(
        pool,
        settings_keys::FLEET_AUTOPILOT_MAX_PARALLEL,
        settings_keys::FLEET_AUTOPILOT_MAX_PARALLEL_MIN as u32,
        settings_keys::FLEET_AUTOPILOT_MAX_PARALLEL_MAX as u32,
        settings_keys::FLEET_AUTOPILOT_MAX_PARALLEL_DEFAULT as u32,
    ) as usize;
    let weekly_target_pct = f64::from(read_u32(
        pool,
        settings_keys::FLEET_AUTOPILOT_WEEKLY_TARGET_PCT,
        settings_keys::FLEET_AUTOPILOT_WEEKLY_TARGET_PCT_MIN,
        settings_keys::FLEET_AUTOPILOT_WEEKLY_TARGET_PCT_MAX,
        settings_keys::FLEET_AUTOPILOT_WEEKLY_TARGET_PCT_DEFAULT,
    ));
    let memory_stop_pct = f64::from(read_u32(
        pool,
        settings_keys::FLEET_AUTOPILOT_MEMORY_STOP_PCT,
        settings_keys::FLEET_AUTOPILOT_MEMORY_STOP_PCT_MIN,
        settings_keys::FLEET_AUTOPILOT_MEMORY_STOP_PCT_MAX,
        settings_keys::FLEET_AUTOPILOT_MEMORY_STOP_PCT_DEFAULT,
    ));
    let memory_per_agent_mb = u64::from(read_u32(
        pool,
        settings_keys::FLEET_AUTOPILOT_MEMORY_PER_AGENT_MB,
        settings_keys::FLEET_AUTOPILOT_MEMORY_PER_AGENT_MB_MIN,
        settings_keys::FLEET_AUTOPILOT_MEMORY_PER_AGENT_MB_MAX,
        settings_keys::FLEET_AUTOPILOT_MEMORY_PER_AGENT_MB_DEFAULT,
    ));
    PacingConfig {
        pacing_enabled,
        parallel_cap,
        weekly_target_pct,
        stop_pct: super::usage_governor::stop_pct(pool),
        fleet_margin_pct: super::usage_governor::fleet_start_margin_pct(pool),
        memory_stop_pct,
        memory_per_agent_mb,
    }
}

/// Sample the machine's memory from the shared sampler. The `std::sync`
/// guard is held for the sample only and never across an await.
pub fn read_memory(state: &crate::AppState) -> MemoryReading {
    let mut sampler = state
        .system_metrics
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let m = sampler.sample();
    MemoryReading {
        used_pct: f64::from(m.mem_used_percent),
        total_mb: m.mem_total_mb,
    }
}

/// Read every gauge and decide. The cached usage snapshot is at most one HTTP
/// call per 45 s across the process, shared with the governor.
pub async fn verdict(pool: &DbPool, state: &crate::AppState) -> AutopilotPacing {
    let cfg = read_config(pool);
    let mem = read_memory(state);
    let snap = cached_snapshot().await;
    pacing_from(&snap, mem, &cfg, chrono::Utc::now().timestamp_millis())
}

fn window<'a>(
    snap: &'a ClaudeUsageSnapshot,
    key: &str,
) -> Option<&'a crate::commands::fleet::claude_usage::ClaudeUsageWindow> {
    snap.windows.iter().find(|w| w.key == key)
}

/// The pure decision. See the module docs for the three conversions.
pub fn pacing_from(
    snap: &ClaudeUsageSnapshot,
    mem: MemoryReading,
    cfg: &PacingConfig,
    now_ms: i64,
) -> AutopilotPacing {
    let parallel_cap = cfg.parallel_cap.max(1);
    let five_hour_line_pct = cfg.stop_pct - cfg.fleet_margin_pct;

    // ── Memory: free room below the stop line, in workers ──────────────
    let used_mb = mem.total_mb as f64 * (mem.used_pct / 100.0);
    let room_mb = (mem.total_mb as f64 * (cfg.memory_stop_pct / 100.0) - used_mb).max(0.0);
    let memory_slots = if cfg.memory_per_agent_mb == 0 {
        parallel_cap
    } else {
        (room_mb / cfg.memory_per_agent_mb as f64).floor() as usize
    };

    // ── Usage: the seven-day pace and the five-hour headroom ───────────
    let usage_available = snap.available && !snap.windows.is_empty();
    let usage_reason = if usage_available {
        None
    } else {
        Some(snap.reason.clone().unwrap_or_else(|| "no windows".into()))
    };

    let seven = window(snap, "seven_day");
    let five = window(snap, "five_hour");

    // Elapsed fraction of the seven-day window: `resets_at` is when it
    // empties, so `1 − remaining/length`. An untouched window (no reset
    // stated) has not started — elapsed 0, and the whole target is owed.
    let weekly_elapsed_pct = seven
        .and_then(|w| w.resets_at_ms.map(|r| (r, w.window_ms)))
        .map(|(resets_at, len)| {
            if len <= 0 {
                return 0.0;
            }
            let remaining = (resets_at - now_ms).clamp(0, len) as f64;
            (1.0 - remaining / len as f64) * 100.0
        })
        .unwrap_or(0.0);
    let weekly_linear_pct = weekly_elapsed_pct / 100.0 * cfg.weekly_target_pct;
    let seven_day_pct = if usage_available {
        Some(seven.map_or(0.0, |w| w.utilization_pct))
    } else {
        None
    };
    // An untouched window states no reset: nothing was spent in seven days,
    // so the whole target is owed rather than "0 % of it so far".
    let week_started = seven.is_some_and(|w| w.resets_at_ms.is_some());
    let behind_pct = seven_day_pct.map(|actual| {
        if week_started {
            weekly_linear_pct - actual
        } else {
            cfg.weekly_target_pct - actual
        }
    });
    let five_hour_pct = if usage_available {
        Some(five.map_or(0.0, |w| w.utilization_pct))
    } else {
        None
    };

    let (usage_slots, usage_hold) = match five_hour_pct {
        // Unreadable gauge: fail open on the usage half, as the governor does.
        None => (parallel_cap, None),
        Some(pct) => {
            let headroom = five_hour_line_pct - pct;
            if headroom <= 0.0 {
                (0, Some(AutopilotHold::FiveHourFull))
            } else {
                let fraction = (headroom / FULL_SPEED_HEADROOM_PCT).min(1.0);
                (
                    ((parallel_cap as f64) * fraction).ceil().max(1.0) as usize,
                    None,
                )
            }
        }
    };

    // ── Compose ────────────────────────────────────────────────────────
    let ahead = cfg.pacing_enabled && behind_pct.is_some_and(|b| b <= 0.0);
    let mut slots = parallel_cap.min(usage_slots).min(memory_slots);
    let mut hold = None;
    if ahead {
        slots = 0;
        hold = Some(AutopilotHold::AheadOfPace);
    } else if slots == 0 {
        hold = usage_hold.or(if memory_slots == 0 {
            Some(AutopilotHold::MemoryFull)
        } else {
            None
        });
    }

    AutopilotPacing {
        pacing_enabled: cfg.pacing_enabled,
        parallel_cap,
        slots,
        hold,
        weekly_target_pct: cfg.weekly_target_pct,
        weekly_elapsed_pct,
        weekly_linear_pct,
        seven_day_pct,
        behind_pct,
        five_hour_pct,
        five_hour_line_pct,
        usage_slots,
        memory_used_pct: mem.used_pct,
        memory_total_mb: mem.total_mb,
        memory_stop_pct: cfg.memory_stop_pct,
        memory_per_agent_mb: cfg.memory_per_agent_mb,
        memory_slots,
        usage_available,
        usage_reason,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::fleet::claude_usage::ClaudeUsageWindow;

    const WEEK_MS: i64 = 7 * 24 * 3_600_000;
    const FIVE_H_MS: i64 = 5 * 3_600_000;
    const NOW: i64 = 1_800_000_000_000;

    /// A snapshot with the seven-day window `elapsed` of the way through at
    /// `seven_pct`, and the five-hour window at `five_pct`.
    fn snap(elapsed: f64, seven_pct: f64, five_pct: f64) -> ClaudeUsageSnapshot {
        let resets_at = NOW + ((1.0 - elapsed) * WEEK_MS as f64) as i64;
        ClaudeUsageSnapshot {
            available: true,
            reason: None,
            subscription_type: Some("max".into()),
            rate_limit_tier: None,
            windows: vec![
                ClaudeUsageWindow {
                    key: "seven_day".into(),
                    utilization_pct: seven_pct,
                    resets_at_ms: Some(resets_at),
                    window_ms: WEEK_MS,
                },
                ClaudeUsageWindow {
                    key: "five_hour".into(),
                    utilization_pct: five_pct,
                    resets_at_ms: Some(NOW + FIVE_H_MS / 2),
                    window_ms: FIVE_H_MS,
                },
            ],
            fetched_at_ms: NOW,
        }
    }

    /// 32 GB machine, `used_pct` used.
    fn mem(used_pct: f64) -> MemoryReading {
        MemoryReading {
            used_pct,
            total_mb: 32 * 1024,
        }
    }

    #[test]
    fn behind_pace_with_room_everywhere_opens_the_whole_cap() {
        // Half-way through the week at 20 % against a 90 % target: the linear
        // pace is 45 %, so the loop is 25 points behind.
        let v = pacing_from(
            &snap(0.5, 20.0, 10.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.slots, 3);
        assert_eq!(v.hold, None);
        assert!((v.weekly_linear_pct - 45.0).abs() < 0.01);
        assert!((v.behind_pct.unwrap() - 25.0).abs() < 0.01);
    }

    #[test]
    fn ahead_of_pace_holds_at_zero() {
        // Half-way through at 60 %: 15 points ahead of the 45 % line.
        let v = pacing_from(
            &snap(0.5, 60.0, 10.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.slots, 0);
        assert_eq!(v.hold, Some(AutopilotHold::AheadOfPace));
        assert!(v.behind_pct.unwrap() < 0.0);
    }

    #[test]
    fn pacing_off_ignores_the_weekly_line() {
        let cfg = PacingConfig {
            pacing_enabled: false,
            ..PacingConfig::default()
        };
        let v = pacing_from(&snap(0.5, 60.0, 10.0), mem(40.0), &cfg, NOW);
        assert_eq!(v.slots, 3, "ahead of pace no longer matters");
        assert_eq!(v.hold, None);
    }

    #[test]
    fn an_untouched_week_owes_the_whole_target() {
        let mut s = snap(0.5, 0.0, 0.0);
        s.windows[0].resets_at_ms = None;
        let v = pacing_from(&s, mem(40.0), &PacingConfig::default(), NOW);
        assert_eq!(v.weekly_elapsed_pct, 0.0);
        assert!(
            (v.behind_pct.unwrap() - 90.0).abs() < 0.01,
            "the whole target is owed"
        );
        assert_eq!(v.slots, 3);
    }

    #[test]
    fn exactly_on_pace_holds() {
        // Half-way at 45 %: on the line, nothing owed.
        let v = pacing_from(
            &snap(0.5, 45.0, 10.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.slots, 0);
        assert_eq!(v.hold, Some(AutopilotHold::AheadOfPace));
    }

    #[test]
    fn the_five_hour_headroom_scales_the_cap() {
        // Line = 97 − 10 = 87. At 62 % the headroom is 25 points = half of
        // FULL_SPEED: ceil(3 × 0.5) = 2 slots.
        let v = pacing_from(
            &snap(0.5, 20.0, 62.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.usage_slots, 2);
        assert_eq!(v.slots, 2);
        // At 85 % the headroom is 2 points: still one slot, never zero.
        let v = pacing_from(
            &snap(0.5, 20.0, 85.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.slots, 1);
        // At the line: full.
        let v = pacing_from(
            &snap(0.5, 20.0, 87.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.slots, 0);
        assert_eq!(v.hold, Some(AutopilotHold::FiveHourFull));
    }

    #[test]
    fn memory_converts_free_room_into_workers() {
        // 32 GB, stop at 75 % = 24 GB line. At 70 % used, 1.6 GB of room:
        // one 1500 MB worker.
        let v = pacing_from(
            &snap(0.5, 20.0, 10.0),
            mem(70.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.memory_slots, 1);
        assert_eq!(v.slots, 1);
        // At 74 %: 328 MB of room, no worker fits.
        let v = pacing_from(
            &snap(0.5, 20.0, 10.0),
            mem(74.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.memory_slots, 0);
        assert_eq!(v.slots, 0);
        assert_eq!(v.hold, Some(AutopilotHold::MemoryFull));
        // Past the line: still zero, never negative.
        let v = pacing_from(
            &snap(0.5, 20.0, 10.0),
            mem(90.0),
            &PacingConfig::default(),
            NOW,
        );
        assert_eq!(v.memory_slots, 0);
    }

    #[test]
    fn an_unreadable_gauge_fails_open_on_usage_and_keeps_the_memory_cap() {
        let s = ClaudeUsageSnapshot {
            available: false,
            reason: Some("no oauth login".into()),
            subscription_type: None,
            rate_limit_tier: None,
            windows: vec![],
            fetched_at_ms: NOW,
        };
        let v = pacing_from(&s, mem(40.0), &PacingConfig::default(), NOW);
        assert!(!v.usage_available);
        assert_eq!(v.usage_reason.as_deref(), Some("no oauth login"));
        assert_eq!(v.behind_pct, None);
        assert_eq!(
            v.slots, 3,
            "the usage half does not block on an unread gauge"
        );
        let v = pacing_from(&s, mem(74.0), &PacingConfig::default(), NOW);
        assert_eq!(v.slots, 0, "memory still counts");
    }

    #[test]
    fn the_parallel_cap_is_the_ceiling() {
        let cfg = PacingConfig {
            parallel_cap: 1,
            ..PacingConfig::default()
        };
        let v = pacing_from(&snap(0.5, 20.0, 10.0), mem(10.0), &cfg, NOW);
        assert_eq!(v.slots, 1);
        let cfg = PacingConfig {
            parallel_cap: 10,
            ..PacingConfig::default()
        };
        let v = pacing_from(&snap(0.5, 20.0, 10.0), mem(10.0), &cfg, NOW);
        assert_eq!(v.slots, 10);
    }

    #[test]
    fn the_summary_names_the_hold() {
        let v = pacing_from(
            &snap(0.5, 60.0, 10.0),
            mem(40.0),
            &PacingConfig::default(),
            NOW,
        );
        let s = v.summary();
        assert!(s.contains("ahead of pace by 15pt"), "{s}");
        assert!(s.contains("HOLD (ahead of pace)"), "{s}");
    }
}
