//! Pure sleep-cycle admission logic for the living-agent persona brain
//! (spark `living-agent-core`, WP4).
//!
//! The SHAPE is lifted from Athena's `companion::brain::sleep_cycle::admission`
//! (measure once → ordered verdict → guard → the admission carries the measured
//! window), with two deliberate upgrades over that prior art:
//!
//! * the reasons are TYPED (`AdmitReason` / `SkipReason`), not prose Strings —
//!   the attention ledger persists them serialized, so a refusal can be
//!   aggregated and asserted on, not just read;
//! * the single-flight guard the caller pairs this with is KEYED per persona
//!   (Athena's is a process-global unkeyed `AtomicBool`, correct for one brain,
//!   wrong for N personas).
//!
//! This module deliberately does NOT refactor Athena's `admission.rs` onto
//! itself — that convergence is a named follow-up: the companion admission
//! carries extra tiers (a `started_at` fallback boundary for pre-L1c cycle
//! rows, an episode-window hydration) that a shared core would have to grow
//! flags for. Converge once both sides are stable.
//!
//! Everything here is pure and unit-tested without a database; the caller
//! (`app_lib`'s `engine::persona_brain::sleep_cycle`) does the I/O and hands
//! this module a [`CycleReading`].

use serde::Serialize;

/// New-episode characters (ORIGINAL bodies, not excerpts) past the consumed
/// watermark that admit a consolidation on pressure alone.
pub const PRESSURE_CHARS: i64 = 20_000;
/// Minimum hours between COMPLETED consolidations — a floor, not the trigger.
/// Keyed on completion (never on the existence of an open ledger row): a
/// crashed pass must not suppress every future one.
pub const MIN_INTERVAL_HOURS: i64 = 6;
/// Hours after which a consolidation fires even under [`PRESSURE_CHARS`],
/// provided at least [`MIN_CHARS`] are waiting. One week: personas run less
/// densely than the operator's own conversation stream (Athena's is 72h).
pub const STALENESS_HOURS: i64 = 168;
/// Below this many new characters a cycle NEVER admits (except forced) — a
/// consolidation over a handful of lines spends a real LLM call on nothing.
pub const MIN_CHARS: i64 = 1_000;

/// The tunables one admission decision obeys. A struct (rather than reading
/// the consts directly) so tests — and a future per-persona cadence override —
/// can vary them without touching the decision logic.
#[derive(Debug, Clone, Copy)]
pub struct CycleLimits {
    pub pressure_chars: i64,
    pub min_interval_hours: i64,
    pub staleness_hours: i64,
    pub min_chars: i64,
}

impl Default for CycleLimits {
    fn default() -> Self {
        Self {
            pressure_chars: PRESSURE_CHARS,
            min_interval_hours: MIN_INTERVAL_HOURS,
            staleness_hours: STALENESS_HOURS,
            min_chars: MIN_CHARS,
        }
    }
}

/// The gauge at one instant — everything the verdict is derived from, measured
/// once by the caller (one ledger read + one indexed SUM).
#[derive(Debug, Clone, Copy)]
pub struct CycleReading {
    /// Characters of new episodes strictly after the consumed watermark.
    pub chars_waiting: i64,
    /// Whole hours since the last COMPLETED consolidation; `None` when no
    /// consolidation has ever completed (a new brain).
    pub hours_since_last: Option<i64>,
}

/// Why a cycle was admitted. Serialized into the ledger's `reason`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AdmitReason {
    /// Operator/command forced the run past every gate but the keyed guard.
    Forced { chars: i64 },
    /// Pressure threshold reached.
    PressureReached { chars: i64, threshold: i64 },
    /// Staleness release valve: under threshold but overdue, with min-work met.
    Stale {
        hours_since: i64,
        staleness_hours: i64,
        chars: i64,
    },
    /// No consolidation has EVER completed and material is waiting — at least
    /// as overdue as any staleness window.
    FirstCycle { chars: i64 },
}

/// Why a cycle was refused. Serialized into the ledger's refusal `reason`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SkipReason {
    /// The keyed single-flight guard is already held for this persona. Never
    /// produced by [`verdict`] itself (the guard lives at the caller); carried
    /// here so every refusal serializes through one type.
    AlreadyRunning,
    FloorNotElapsed {
        hours_since: i64,
        floor_hours: i64,
    },
    InsufficientPressure {
        chars: i64,
        threshold: i64,
    },
    NothingToConsume {
        chars: i64,
        min_chars: i64,
    },
}

/// The answer to "may a consolidation start right now".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "verdict", rename_all = "snake_case")]
pub enum CycleVerdict {
    Admit(AdmitReason),
    Skip(SkipReason),
}

impl CycleVerdict {
    pub fn is_admit(&self) -> bool {
        matches!(self, CycleVerdict::Admit(_))
    }

    /// Human-readable one-liner (the typed value is what gets persisted; this
    /// is for logs and command replies).
    pub fn describe(&self) -> String {
        match self {
            CycleVerdict::Admit(AdmitReason::Forced { chars }) => {
                format!("forced: running regardless of pressure ({chars} chars) and the floor")
            }
            CycleVerdict::Admit(AdmitReason::PressureReached { chars, threshold }) => {
                format!("pressure reached: {chars} of {threshold} chars")
            }
            CycleVerdict::Admit(AdmitReason::Stale {
                hours_since,
                staleness_hours,
                chars,
            }) => format!(
                "{hours_since}h since the last consolidation (staleness fires at \
                 {staleness_hours}h) with {chars} chars waiting"
            ),
            CycleVerdict::Admit(AdmitReason::FirstCycle { chars }) => {
                format!("no consolidation has ever completed and {chars} chars are waiting")
            }
            CycleVerdict::Skip(SkipReason::AlreadyRunning) => {
                "a consolidation is already running for this persona".to_string()
            }
            CycleVerdict::Skip(SkipReason::FloorNotElapsed {
                hours_since,
                floor_hours,
            }) => format!(
                "the last consolidation completed {hours_since}h ago and the {floor_hours}h \
                 floor has not elapsed"
            ),
            CycleVerdict::Skip(SkipReason::InsufficientPressure { chars, threshold }) => {
                format!("pressure {chars} of {threshold} chars and not yet stale")
            }
            CycleVerdict::Skip(SkipReason::NothingToConsume { chars, min_chars }) => format!(
                "only {chars} chars of new episodes are waiting, under the {min_chars} minimum"
            ),
        }
    }
}

// ── Attention-loop refusals (WP5) ──────────────────────────────────────────

/// Why an attention pass was refused before any lane was chosen — the typed
/// sibling of [`SkipReason`] for the attention scheduler
/// (`app_lib`'s `engine::subscription::attention`). Serialized (tagged, like
/// [`CycleVerdict`]) into the attention ledger's refusal `reason` column so a
/// refusal can be aggregated and asserted on, never prose-only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AttentionRefusal {
    /// An attention pass for this persona is still open (a `started` ledger
    /// row with no completion, younger than the in-flight window).
    InFlight { started_at: String },
    /// The last completed pass is closer than the charter interval floor.
    IntervalFloor {
        minutes_since: i64,
        interval_minutes: i64,
    },
    /// The local clock is inside a charter's quiet-hours window.
    QuietHours { window: String },
    /// Today's attention passes have reached the charter cap.
    DailyCapReached { runs_today: i64, cap: i64 },
    /// The persona's monthly budget is spent — refuse loudly here instead of
    /// spawning into the execution path's Validation error.
    BudgetExhausted { spent_usd: f64, limit_usd: f64 },
}

impl AttentionRefusal {
    /// The serialized tag — the dedupe key for "same refusal, same day".
    pub fn kind(&self) -> &'static str {
        match self {
            Self::InFlight { .. } => "in_flight",
            Self::IntervalFloor { .. } => "interval_floor",
            Self::QuietHours { .. } => "quiet_hours",
            Self::DailyCapReached { .. } => "daily_cap_reached",
            Self::BudgetExhausted { .. } => "budget_exhausted",
        }
    }

    /// Human-readable one-liner for logs (the typed value is what persists).
    pub fn describe(&self) -> String {
        match self {
            Self::InFlight { started_at } => {
                format!("an attention pass started at {started_at} is still open")
            }
            Self::IntervalFloor {
                minutes_since,
                interval_minutes,
            } => format!(
                "the last pass completed {minutes_since}m ago and the {interval_minutes}m \
                 interval floor has not elapsed"
            ),
            Self::QuietHours { window } => {
                format!("inside the quiet-hours window {window}")
            }
            Self::DailyCapReached { runs_today, cap } => {
                format!("{runs_today} passes today have reached the cap of {cap}")
            }
            Self::BudgetExhausted {
                spent_usd,
                limit_usd,
            } => format!(
                "monthly budget exhausted: ${spent_usd:.2} spent of the ${limit_usd:.2} limit"
            ),
        }
    }
}

/// The admission decision, in the companion admission's proven order:
/// force → interval floor (keyed on last COMPLETION) → min-work → pressure →
/// staleness. Pure; the caller owns the keyed guard and every read.
pub fn verdict(reading: CycleReading, force: bool, limits: CycleLimits) -> CycleVerdict {
    let chars = reading.chars_waiting;

    if force {
        return CycleVerdict::Admit(AdmitReason::Forced { chars });
    }

    if let Some(hours_since) = reading.hours_since_last {
        if hours_since < limits.min_interval_hours {
            return CycleVerdict::Skip(SkipReason::FloorNotElapsed {
                hours_since,
                floor_hours: limits.min_interval_hours,
            });
        }
    }

    // Min-work gate before both release paths: a staleness that fired on an
    // empty window would spend a real LLM call to distil nothing.
    if chars < limits.min_chars {
        return CycleVerdict::Skip(SkipReason::NothingToConsume {
            chars,
            min_chars: limits.min_chars,
        });
    }

    if chars >= limits.pressure_chars {
        return CycleVerdict::Admit(AdmitReason::PressureReached {
            chars,
            threshold: limits.pressure_chars,
        });
    }

    match reading.hours_since_last {
        // Never completed: at least as overdue as any staleness window.
        None => CycleVerdict::Admit(AdmitReason::FirstCycle { chars }),
        Some(hours_since) if hours_since >= limits.staleness_hours => {
            CycleVerdict::Admit(AdmitReason::Stale {
                hours_since,
                staleness_hours: limits.staleness_hours,
                chars,
            })
        }
        Some(_) => CycleVerdict::Skip(SkipReason::InsufficientPressure {
            chars,
            threshold: limits.pressure_chars,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(chars: i64, hours: Option<i64>) -> CycleReading {
        CycleReading {
            chars_waiting: chars,
            hours_since_last: hours,
        }
    }

    #[test]
    fn force_admits_past_floor_and_pressure_but_stays_typed() {
        let v = verdict(reading(0, Some(0)), true, CycleLimits::default());
        assert_eq!(v, CycleVerdict::Admit(AdmitReason::Forced { chars: 0 }));
    }

    #[test]
    fn floor_blocks_before_everything_but_force() {
        // Even a pressure-exceeding window is refused inside the floor.
        let v = verdict(
            reading(PRESSURE_CHARS * 2, Some(2)),
            false,
            CycleLimits::default(),
        );
        assert_eq!(
            v,
            CycleVerdict::Skip(SkipReason::FloorNotElapsed {
                hours_since: 2,
                floor_hours: MIN_INTERVAL_HOURS
            })
        );
    }

    #[test]
    fn min_work_blocks_even_a_stale_brain() {
        let v = verdict(
            reading(MIN_CHARS - 1, Some(STALENESS_HOURS + 24)),
            false,
            CycleLimits::default(),
        );
        assert_eq!(
            v,
            CycleVerdict::Skip(SkipReason::NothingToConsume {
                chars: MIN_CHARS - 1,
                min_chars: MIN_CHARS
            })
        );
    }

    #[test]
    fn pressure_admits_once_floor_elapsed() {
        let v = verdict(
            reading(PRESSURE_CHARS, Some(MIN_INTERVAL_HOURS)),
            false,
            CycleLimits::default(),
        );
        assert_eq!(
            v,
            CycleVerdict::Admit(AdmitReason::PressureReached {
                chars: PRESSURE_CHARS,
                threshold: PRESSURE_CHARS
            })
        );
    }

    #[test]
    fn staleness_admits_under_threshold_with_min_work() {
        let v = verdict(
            reading(MIN_CHARS, Some(STALENESS_HOURS)),
            false,
            CycleLimits::default(),
        );
        assert_eq!(
            v,
            CycleVerdict::Admit(AdmitReason::Stale {
                hours_since: STALENESS_HOURS,
                staleness_hours: STALENESS_HOURS,
                chars: MIN_CHARS
            })
        );
    }

    #[test]
    fn under_threshold_and_not_stale_skips_with_figures() {
        let v = verdict(
            reading(MIN_CHARS, Some(MIN_INTERVAL_HOURS)),
            false,
            CycleLimits::default(),
        );
        assert_eq!(
            v,
            CycleVerdict::Skip(SkipReason::InsufficientPressure {
                chars: MIN_CHARS,
                threshold: PRESSURE_CHARS
            })
        );
    }

    #[test]
    fn first_cycle_ever_admits_with_min_work() {
        let v = verdict(reading(MIN_CHARS, None), false, CycleLimits::default());
        assert_eq!(
            v,
            CycleVerdict::Admit(AdmitReason::FirstCycle { chars: MIN_CHARS })
        );
        // ... but not on an empty brain.
        let v = verdict(reading(0, None), false, CycleLimits::default());
        assert!(matches!(
            v,
            CycleVerdict::Skip(SkipReason::NothingToConsume { .. })
        ));
    }

    #[test]
    fn attention_refusals_serialize_tagged_with_a_stable_kind() {
        let r = AttentionRefusal::IntervalFloor {
            minutes_since: 12,
            interval_minutes: 30,
        };
        let json = serde_json::to_string(&r).unwrap();
        assert!(json.contains(r#""kind":"interval_floor"#), "{json}");
        assert!(json.contains(r#""minutes_since":12"#), "{json}");
        // The tag and the kind() accessor must never drift apart — the
        // refusal-dedupe compares kind() against the persisted tag.
        for r in [
            AttentionRefusal::InFlight {
                started_at: "t".into(),
            },
            AttentionRefusal::IntervalFloor {
                minutes_since: 1,
                interval_minutes: 2,
            },
            AttentionRefusal::QuietHours { window: "w".into() },
            AttentionRefusal::DailyCapReached {
                runs_today: 3,
                cap: 3,
            },
            AttentionRefusal::BudgetExhausted {
                spent_usd: 1.0,
                limit_usd: 1.0,
            },
        ] {
            let v: serde_json::Value =
                serde_json::from_str(&serde_json::to_string(&r).unwrap()).unwrap();
            assert_eq!(v["kind"], r.kind(), "{r:?}");
            assert!(!r.describe().is_empty());
        }
    }

    #[test]
    fn reasons_serialize_tagged_for_the_ledger() {
        let v = CycleVerdict::Skip(SkipReason::FloorNotElapsed {
            hours_since: 2,
            floor_hours: 6,
        });
        let json = serde_json::to_string(&v).unwrap();
        assert!(json.contains(r#""verdict":"skip"#), "{json}");
        assert!(json.contains(r#""kind":"floor_not_elapsed"#), "{json}");
        assert!(json.contains(r#""hours_since":2"#), "{json}");
    }
}
