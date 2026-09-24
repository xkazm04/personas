//! Budgeted admission - the PURE half.
//!
//! The dispatch queue ([`super::queue`]) bounds the fleet by a session COUNT.
//! A count is shorthand for "N times the cost of one session", and fleet
//! sessions do not cost the same: a light charter and an `exclusive` build
//! differ by 8x on the machine, an `s` and an `xl` run by 8x on the Claude
//! plan. This module spells the bound in the two resources that actually run
//! out (registry technique `resource-denominated-bounds`):
//!
//! - **machine units** (`MachineLoad::units`, 1/2/4/8), budgeted from the
//!   measured free memory and gated by a RAM high-water mark with hysteresis;
//! - **plan units** (`EffortBand::units`, 1/2/4/8), budgeted from the static
//!   cap and scaled down while the seven-day window runs AHEAD of its pace.
//!
//! The static count cap survives as the secondary guard, enforced by the
//! caller. Nothing here touches the registry, the database, the clock or a
//! setting: every input arrives as a value, so every rule is unit-tested.
//!
//! The pressure gate defers PROMOTION only. Nothing in this module can pause,
//! throttle or end a session that is already live (`load-aware-admission`'s
//! prime directive).

use personas_core::models::{EffortBand, GpuClass, MachineLoad, ResourceProfile};

use super::queue::{BudgetHold, RamGate};

/// Close the promotion gate when used RAM reaches this percent. The same
/// figure as `engine::resource_governor::MEM_PAUSE_PCT` (85): memory is the
/// signal that does not heal on its own, so its bar sits high.
pub const RAM_GATE_CLOSE_PCT: f64 = 85.0;
/// Reopen only at or below this percent - `resource_governor::MEM_RESUME_PCT`
/// (70). The 15-point gap is the hysteresis: reopening must mean "room for
/// one more session", not "a rounding error under the line".
pub const RAM_GATE_REOPEN_PCT: f64 = 70.0;
/// Samples the gate must have seen before it may act. The first reading is
/// never acted on (`load-aware-admission`: "Warm-up ... Skip it, and say so").
pub const RAM_GATE_WARMUP_SAMPLES: u32 = 2;

/// `behind_pct` at which the plan budget reaches its floor. Between `0` and
/// this the pace factor falls linearly.
pub const PACE_FLOOR_BEHIND_PCT: f64 = -25.0;
/// The plan budget never shrinks below this while the five-hour window still
/// has room: one default (`m`) session always fits an empty plan budget.
pub const PLAN_BUDGET_FLOOR: u32 = 2;
/// Plan units one count slot is worth: the default profile's effort (`m`).
/// `plan_budget_max = cap x this`, which is what makes an all-default fleet
/// behave exactly like the count cap at pace factor 1.
pub const PLAN_UNITS_PER_SLOT: u32 = 2;
/// The heaviest single charge the closed vocabularies can produce
/// (`MachineLoad::Exclusive` / `EffortBand::Xl`). The empty-machine rule
/// admits a charge up to this size alone even when the static budget is
/// smaller; anything larger could never run and is refused at the door.
pub const MAX_VOCABULARY_UNITS: u32 = 8;

/// Backfill stops passing an unfit entry once it was skipped this many times.
pub const AGING_MAX_SKIPS: u32 = 5;
/// ... or once it has been unfit for this long, whichever comes first.
pub const AGING_MAX_WAIT_MS: i64 = 30 * 60 * 1000;

/// What one session costs: the two budgets plus the GPU class.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Charge {
    pub machine: u32,
    pub plan: u32,
    pub gpu: GpuClass,
}

impl Charge {
    /// The default profile's weight (light / none / m): one machine unit, two
    /// plan units. What a manual session, an untagged charter and a row
    /// written before the charge columns existed are all charged.
    pub const DEFAULT: Charge = Charge {
        machine: 1,
        plan: PLAN_UNITS_PER_SLOT,
        gpu: GpuClass::None,
    };

    /// The charge a dispatch's profile declares; `None` is the default.
    pub fn from_profile(profile: Option<&ResourceProfile>) -> Charge {
        match profile {
            None => Charge::DEFAULT,
            Some(p) => Charge {
                machine: p.machine.units(),
                plan: p.effort.units(),
                gpu: p.gpu,
            },
        }
    }

    /// The charge persisted on a row. A `NULL` column reads as the default's
    /// half, so a pre-e39 row costs what a default session costs.
    pub fn from_columns(
        machine_units: Option<u32>,
        plan_units: Option<u32>,
        gpu: Option<GpuClass>,
    ) -> Charge {
        Charge {
            machine: machine_units.unwrap_or(Charge::DEFAULT.machine),
            plan: plan_units.unwrap_or(Charge::DEFAULT.plan),
            gpu: gpu.unwrap_or(Charge::DEFAULT.gpu),
        }
    }

    /// The profile a re-enqueue of the same work should carry. The inverse of
    /// [`Self::from_profile`] over the closed vocabularies (a unit count that
    /// is not one of 1/2/4/8 rounds UP to the next weight, so a re-enqueue is
    /// never charged less than the original). Difficulty is not part of the
    /// charge - it was spent on the model choice at dispatch - so it reads as
    /// the default.
    pub fn to_profile(self) -> ResourceProfile {
        ResourceProfile {
            machine: match self.machine {
                0 | 1 => MachineLoad::Light,
                2 => MachineLoad::Moderate,
                3 | 4 => MachineLoad::Heavy,
                _ => MachineLoad::Exclusive,
            },
            effort: match self.plan {
                0 | 1 => EffortBand::S,
                2 => EffortBand::M,
                3 | 4 => EffortBand::L,
                _ => EffortBand::Xl,
            },
            gpu: self.gpu,
            ..ResourceProfile::default()
        }
    }
}

/// The `gpu_class` column token - the same string `serde` writes for
/// [`GpuClass`] (`none` | `shared` | `exclusive`).
pub fn gpu_to_token(gpu: GpuClass) -> &'static str {
    match gpu {
        GpuClass::None => "none",
        GpuClass::Shared => "shared",
        GpuClass::Exclusive => "exclusive",
    }
}

/// Inverse of [`gpu_to_token`]; an unknown token reads as `None` (absent), so
/// a corrupt cell is charged the default rather than refused.
pub fn token_to_gpu(token: &str) -> Option<GpuClass> {
    match token {
        "none" => Some(GpuClass::None),
        "shared" => Some(GpuClass::Shared),
        "exclusive" => Some(GpuClass::Exclusive),
        _ => None,
    }
}

/// What the live set is charged right now. `machine == 0` means no session is
/// live: every live session costs at least one machine unit.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Used {
    pub machine: u32,
    pub plan: u32,
    /// A live `gpu = exclusive` session holds the single GPU token.
    pub gpu_held: bool,
}

impl Used {
    /// Add one live session's charge.
    pub fn add(&mut self, charge: Charge) {
        self.machine = self.machine.saturating_add(charge.machine);
        self.plan = self.plan.saturating_add(charge.plan);
    }

    /// Whether nothing is live.
    pub fn is_empty(&self) -> bool {
        self.machine == 0
    }
}

/// Everything the budgets are derived from, as plain values.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BudgetInputs {
    /// The static count cap (`fleet.max_parallel_sessions`).
    pub cap: u32,
    /// `fleet.dynamic_budgets`. Off = the caller never consults [`fits`].
    pub enabled: bool,
    /// `AutopilotPacing::behind_pct`; see [`pace_factor`] for the sign.
    pub behind_pct: Option<f64>,
    /// The five-hour window is at or above the fleet start line.
    pub five_hour_full: bool,
    /// The usage governor stopped dispatch (worst window at its stop line).
    pub governor_stop: bool,
    /// `AutopilotPacing::memory_slots`: how many MORE default workers the free
    /// memory below the stop line can hold. `None` = not measured (fail open).
    pub memory_slots: Option<u32>,
    pub ram_pct: Option<f64>,
    pub ram_gate: RamGate,
}

impl BudgetInputs {
    /// Inputs that bind nothing beyond the count cap: no pacing reading, no
    /// memory reading, gate open.
    #[cfg(test)]
    pub fn unmeasured(cap: u32, enabled: bool) -> Self {
        Self {
            cap,
            enabled,
            behind_pct: None,
            five_hour_full: false,
            governor_stop: false,
            memory_slots: None,
            ram_pct: None,
            ram_gate: RamGate::Open,
        }
    }
}

/// The derived budgets. Every number names its inputs
/// (`derivation-names-recomputation`): `machine_budget = min(cap, used +
/// memory_slots)`, `plan_budget = max(floor, round(cap x 2 x pace_factor))`
/// or `0` under a five-hour / governor stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Budgets {
    pub machine_budget: u32,
    /// The static machine maximum: the count cap, one unit per slot.
    pub machine_budget_max: u32,
    pub plan_budget: u32,
    /// The plan budget at pace factor 1 (`cap x 2`).
    pub plan_budget_max: u32,
    pub pace_factor: f64,
    /// The plan budget is zero because the five-hour window (or the usage
    /// governor's stop line) is full.
    pub plan_stopped: bool,
    pub ram_gate: RamGate,
}

/// How much of the plan budget the seven-day pace leaves.
///
/// SIGN CONVENTION, verified at `engine/subscription/usage_pacing.rs:326-332`:
/// `behind_pct = weekly_linear_pct - actual`. POSITIVE = behind pace (less was
/// spent than the linear line: there is debt to spend). NEGATIVE = AHEAD of
/// pace (burning faster than linear). So:
///
/// - `None` (gauge unreadable - fail open) or `>= 0` (behind / on pace) -> `1.0`;
/// - `0 -> -25` falls linearly `1.0 -> 0.0`;
/// - `<= -25` -> `0.0` (the budget's own floor, [`PLAN_BUDGET_FLOOR`], is what
///   keeps a default session admissible; see [`budgets_from`]).
pub fn pace_factor(behind_pct: Option<f64>) -> f64 {
    match behind_pct {
        None => 1.0,
        Some(b) if !b.is_finite() => 1.0,
        Some(b) if b >= 0.0 => 1.0,
        Some(b) => (1.0 - b / PACE_FLOOR_BEHIND_PCT).clamp(0.0, 1.0),
    }
}

/// Derive both budgets.
///
/// `used` is an input because `memory_slots` measures FREE room given what is
/// already running (`usage_pacing.rs:283-291` subtracts the machine's current
/// `used_mb`, live sessions included), not total capacity. The machine budget
/// is therefore "what is charged now + what the free memory can still hold",
/// clamped to the static cap.
pub fn budgets_from(inputs: &BudgetInputs, used: Used) -> Budgets {
    let cap = inputs.cap.max(1);
    let machine_budget_max = cap;
    let machine_budget = match inputs.memory_slots {
        None => machine_budget_max,
        Some(free) => used.machine.saturating_add(free).min(machine_budget_max),
    };
    let plan_budget_max = cap.saturating_mul(PLAN_UNITS_PER_SLOT);
    let factor = pace_factor(inputs.behind_pct);
    let plan_stopped = inputs.five_hour_full || inputs.governor_stop;
    let plan_budget = if plan_stopped {
        0
    } else {
        let scaled = (f64::from(plan_budget_max) * factor).round() as u32;
        scaled
            .max(PLAN_BUDGET_FLOOR)
            .min(plan_budget_max.max(PLAN_BUDGET_FLOOR))
    };
    Budgets {
        machine_budget,
        machine_budget_max,
        plan_budget,
        plan_budget_max,
        pace_factor: factor,
        plan_stopped,
        ram_gate: inputs.ram_gate,
    }
}

/// Why a charge does not fit right now.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Unfit {
    /// A named budget reason the Monitor can show.
    Held(BudgetHold),
    /// The budgets are simply occupied by live work - the ordinary "fleet is
    /// full" wait, with no pressure signal behind it.
    NoRoom,
}

impl Unfit {
    /// The wire hold, when there is one.
    pub fn hold(self) -> Option<BudgetHold> {
        match self {
            Unfit::Held(h) => Some(h),
            Unfit::NoRoom => None,
        }
    }
}

/// Whether `charge` may start now, given what is live and the budgets.
///
/// Precedence of the reasons (the first that applies is reported):
/// `five_hour_full` > `ram_high_water` > `gpu_token_held` > `ahead_of_pace`
/// > plain no-room.
///
/// **The empty-machine rule.** A charge larger than a budget is still
/// admitted when it would be the ONLY live charge (`used.is_empty()`), so an
/// `exclusive` (8) job runs on a cap-4 fleet and "a couple of heavy sessions
/// can own the machine". The rule never overrides a pressure signal: a closed
/// RAM gate and a stopped plan still hold it, and on the plan axis it applies
/// only while the budget is at its static maximum - an `xl` that is too big
/// for a SHRUNK plan budget waits for the pace to recover like anything else.
pub fn fits(charge: Charge, used: Used, budgets: &Budgets) -> Result<(), Unfit> {
    if budgets.plan_stopped {
        return Err(Unfit::Held(BudgetHold::FiveHourFull));
    }
    if budgets.ram_gate == RamGate::Closed {
        return Err(Unfit::Held(BudgetHold::RamHighWater));
    }
    if charge.gpu == GpuClass::Exclusive && used.gpu_held {
        return Err(Unfit::Held(BudgetHold::GpuTokenHeld));
    }
    let alone = used.is_empty();
    let plan_shrunk = budgets.plan_budget < budgets.plan_budget_max;
    let plan_fits =
        used.plan.saturating_add(charge.plan) <= budgets.plan_budget || (alone && !plan_shrunk);
    if !plan_fits {
        return Err(if plan_shrunk {
            Unfit::Held(BudgetHold::AheadOfPace)
        } else {
            Unfit::NoRoom
        });
    }
    let machine_fits =
        used.machine.saturating_add(charge.machine) <= budgets.machine_budget || alone;
    if !machine_fits {
        return Err(Unfit::NoRoom);
    }
    Ok(())
}

/// Whether `charge` could NEVER start, however empty the fleet becomes: it is
/// larger than both the static maximum and the largest weight the
/// empty-machine rule admits alone. Such an arrival is refused at the door
/// (`exceeds_budget`), never queued - a queued row would be a promise the gate
/// has already decided to break.
///
/// No profile in the closed vocabularies can trip this (their maximum IS
/// [`MAX_VOCABULARY_UNITS`]); it guards a charge that reached the door some
/// other way, e.g. a hand-written row or a future heavier weight.
pub fn never_fits(charge: Charge, budgets: &Budgets) -> bool {
    charge.machine > budgets.machine_budget_max.max(MAX_VOCABULARY_UNITS)
        || charge.plan > budgets.plan_budget_max.max(MAX_VOCABULARY_UNITS)
}

/// The hold that applies whatever the charge: the plan is stopped, or the RAM
/// gate is closed. What the Monitor shows when the queue is empty.
pub fn global_hold(budgets: &Budgets) -> Option<BudgetHold> {
    if budgets.plan_stopped {
        Some(BudgetHold::FiveHourFull)
    } else if budgets.ram_gate == RamGate::Closed {
        Some(BudgetHold::RamHighWater)
    } else {
        None
    }
}

/// The RAM gate's state machine. `samples_seen` counts readings INCLUDING this
/// one.
///
/// - fewer than [`RAM_GATE_WARMUP_SAMPLES`] readings -> `Warming` (never acts);
/// - an unreadable probe (`None`) -> `Open`: fail OPEN, by choice - a broken
///   probe must not halt all promotion (the caller logs it);
/// - closes at `>=` [`RAM_GATE_CLOSE_PCT`], and once closed reopens only at
///   `<=` [`RAM_GATE_REOPEN_PCT`] (the `resource_governor` thresholds).
pub fn next_ram_gate(prev: RamGate, ram_pct: Option<f64>, samples_seen: u32) -> RamGate {
    if samples_seen < RAM_GATE_WARMUP_SAMPLES {
        return RamGate::Warming;
    }
    let Some(pct) = ram_pct.filter(|p| p.is_finite()) else {
        return RamGate::Open;
    };
    match prev {
        RamGate::Closed => {
            if pct <= RAM_GATE_REOPEN_PCT {
                RamGate::Open
            } else {
                RamGate::Closed
            }
        }
        RamGate::Open | RamGate::Warming => {
            if pct >= RAM_GATE_CLOSE_PCT {
                RamGate::Closed
            } else {
                RamGate::Open
            }
        }
    }
}

/// Whether backfill must stop at this unfit entry: it has been passed
/// [`AGING_MAX_SKIPS`] times, or has been unfit for [`AGING_MAX_WAIT_MS`].
/// From then on promotion drains until the entry fits (`priority-and-fairness`:
/// aging turns "may never run" into "runs later").
pub fn is_aged(skip_count: u32, first_unfit_at_ms: Option<i64>, now_ms: i64) -> bool {
    skip_count >= AGING_MAX_SKIPS
        || first_unfit_at_ms.is_some_and(|t| now_ms.saturating_sub(t) >= AGING_MAX_WAIT_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn charge(machine: u32, plan: u32) -> Charge {
        Charge {
            machine,
            plan,
            gpu: GpuClass::None,
        }
    }

    fn used(machine: u32, plan: u32) -> Used {
        Used {
            machine,
            plan,
            gpu_held: false,
        }
    }

    #[test]
    fn pace_factor_is_one_behind_and_falls_linearly_ahead() {
        assert_eq!(pace_factor(None), 1.0, "an unread gauge fails open");
        assert_eq!(pace_factor(Some(12.0)), 1.0, "behind pace: debt to spend");
        assert_eq!(pace_factor(Some(0.0)), 1.0, "on pace");
        assert!((pace_factor(Some(-5.0)) - 0.8).abs() < 1e-9);
        assert!((pace_factor(Some(-12.5)) - 0.5).abs() < 1e-9);
        assert_eq!(pace_factor(Some(-25.0)), 0.0);
        assert_eq!(pace_factor(Some(-80.0)), 0.0, "clamped at the floor");
        assert_eq!(pace_factor(Some(f64::NAN)), 1.0);
    }

    #[test]
    fn plan_budget_scales_with_pace_and_stops_on_the_five_hour_window() {
        let mut i = BudgetInputs::unmeasured(10, true);
        let b = budgets_from(&i, Used::default());
        assert_eq!((b.plan_budget, b.plan_budget_max), (20, 20));
        assert_eq!((b.machine_budget, b.machine_budget_max), (10, 10));
        i.behind_pct = Some(-12.5);
        assert_eq!(budgets_from(&i, Used::default()).plan_budget, 10);
        i.behind_pct = Some(-25.0);
        assert_eq!(
            budgets_from(&i, Used::default()).plan_budget,
            PLAN_BUDGET_FLOOR,
            "the floor keeps one default session admissible"
        );
        i.five_hour_full = true;
        let stopped = budgets_from(&i, Used::default());
        assert_eq!(stopped.plan_budget, 0);
        assert!(stopped.plan_stopped);
        i.five_hour_full = false;
        i.governor_stop = true;
        assert_eq!(budgets_from(&i, Used::default()).plan_budget, 0);
    }

    #[test]
    fn machine_budget_is_what_is_charged_plus_the_free_memory_clamped_to_the_cap() {
        let mut i = BudgetInputs::unmeasured(10, true);
        i.memory_slots = Some(3);
        assert_eq!(budgets_from(&i, used(4, 8)).machine_budget, 7);
        assert_eq!(budgets_from(&i, used(9, 18)).machine_budget, 10, "clamped");
        i.memory_slots = Some(0);
        assert_eq!(
            budgets_from(&i, used(4, 8)).machine_budget,
            4,
            "no free memory: the budget is exactly what is already running"
        );
        // A cap of 1 still derives a usable pair.
        let one = budgets_from(&BudgetInputs::unmeasured(1, true), Used::default());
        assert_eq!((one.machine_budget, one.plan_budget), (1, 2));
    }

    #[test]
    fn ahead_of_pace_defers_an_xl_light_and_admits_an_s_heavy() {
        let mut i = BudgetInputs::unmeasured(10, true);
        i.behind_pct = Some(-20.0); // factor 0.2 -> plan budget 4
        let live = used(2, 2);
        let b = budgets_from(&i, live);
        assert_eq!(b.plan_budget, 4);
        let xl_light = charge(1, 8);
        let s_heavy = charge(4, 1);
        assert_eq!(
            fits(xl_light, live, &b),
            Err(Unfit::Held(BudgetHold::AheadOfPace))
        );
        assert_eq!(fits(s_heavy, live, &b), Ok(()));
        // Even alone, an xl does not slip past a SHRUNK plan budget.
        assert_eq!(
            fits(xl_light, Used::default(), &b),
            Err(Unfit::Held(BudgetHold::AheadOfPace))
        );
    }

    #[test]
    fn hold_precedence_is_five_hour_then_ram_then_gpu_then_pace() {
        let mut i = BudgetInputs::unmeasured(10, true);
        i.behind_pct = Some(-25.0);
        i.five_hour_full = true;
        i.ram_gate = RamGate::Closed;
        let live = Used {
            machine: 2,
            plan: 2,
            gpu_held: true,
        };
        let gpu_xl = Charge {
            machine: 1,
            plan: 8,
            gpu: GpuClass::Exclusive,
        };
        let hold = |i: &BudgetInputs| fits(gpu_xl, live, &budgets_from(i, live)).unwrap_err();
        assert_eq!(hold(&i), Unfit::Held(BudgetHold::FiveHourFull));
        i.five_hour_full = false;
        assert_eq!(hold(&i), Unfit::Held(BudgetHold::RamHighWater));
        i.ram_gate = RamGate::Open;
        assert_eq!(hold(&i), Unfit::Held(BudgetHold::GpuTokenHeld));
        let cpu_xl = Charge {
            gpu: GpuClass::Shared,
            ..gpu_xl
        };
        let b = budgets_from(&i, live);
        assert_eq!(
            fits(cpu_xl, live, &b),
            Err(Unfit::Held(BudgetHold::AheadOfPace)),
            "`shared` is informational: it never waits on the token"
        );
        // A warming gate never holds.
        i.ram_gate = RamGate::Warming;
        i.behind_pct = None;
        assert_eq!(fits(Charge::DEFAULT, live, &budgets_from(&i, live)), Ok(()));
    }

    #[test]
    fn a_short_machine_budget_is_plain_no_room_unless_the_gate_is_closed() {
        let mut i = BudgetInputs::unmeasured(10, true);
        i.memory_slots = Some(1);
        let live = used(4, 8);
        let b = budgets_from(&i, live);
        assert_eq!(fits(charge(2, 1), live, &b), Err(Unfit::NoRoom));
        assert_eq!(Unfit::NoRoom.hold(), None);
        assert_eq!(fits(charge(1, 1), live, &b), Ok(()));
        i.ram_gate = RamGate::Closed;
        assert_eq!(
            fits(charge(2, 1), live, &budgets_from(&i, live)),
            Err(Unfit::Held(BudgetHold::RamHighWater))
        );
        // A full plan budget at pace 1 is also plain no-room.
        let full = used(2, 20);
        let b = budgets_from(&BudgetInputs::unmeasured(10, true), full);
        assert_eq!(fits(Charge::DEFAULT, full, &b), Err(Unfit::NoRoom));
    }

    #[test]
    fn the_empty_machine_rule_admits_an_exclusive_job_alone() {
        // cap 4: machine budget 4, plan budget 8 - an exclusive/xl is 8/8.
        let mut i = BudgetInputs::unmeasured(4, true);
        let b = budgets_from(&i, Used::default());
        let exclusive = Charge {
            machine: 8,
            plan: 8,
            gpu: GpuClass::Exclusive,
        };
        assert_eq!(fits(exclusive, Used::default(), &b), Ok(()));
        // cap 1 (plan max 2): still admitted alone at pace 1.
        let tiny = budgets_from(&BudgetInputs::unmeasured(1, true), Used::default());
        assert_eq!(fits(exclusive, Used::default(), &tiny), Ok(()));
        // Not alone: it waits.
        assert_eq!(fits(exclusive, used(1, 2), &b), Err(Unfit::NoRoom));
        // Once it is live, it owns the machine: nothing else fits.
        let mut owning = Used::default();
        owning.add(exclusive);
        let b = budgets_from(&i, owning);
        assert_eq!(fits(Charge::DEFAULT, owning, &b), Err(Unfit::NoRoom));
        // Zero free memory does not stop the alone rule, a closed gate does.
        i.memory_slots = Some(0);
        assert_eq!(
            fits(
                exclusive,
                Used::default(),
                &budgets_from(&i, Used::default())
            ),
            Ok(())
        );
        i.ram_gate = RamGate::Closed;
        assert_eq!(
            fits(
                exclusive,
                Used::default(),
                &budgets_from(&i, Used::default())
            ),
            Err(Unfit::Held(BudgetHold::RamHighWater))
        );
    }

    #[test]
    fn only_a_charge_beyond_the_vocabulary_and_the_static_max_never_fits() {
        let b = budgets_from(&BudgetInputs::unmeasured(1, true), Used::default());
        // Every weight the closed vocabularies produce is admissible alone.
        for m in [1, 2, 4, 8] {
            for p in [1, 2, 4, 8] {
                assert!(!never_fits(charge(m, p), &b), "{m}/{p}");
            }
        }
        assert!(never_fits(charge(9, 1), &b));
        assert!(never_fits(charge(1, 9), &b));
        // A large cap raises the static max past the vocabulary.
        let big = budgets_from(&BudgetInputs::unmeasured(30, true), Used::default());
        assert!(!never_fits(charge(30, 60), &big));
        assert!(never_fits(charge(31, 1), &big));
        assert!(never_fits(charge(1, 61), &big));
    }

    #[test]
    fn the_ram_gate_warms_up_closes_at_85_and_reopens_only_at_70() {
        // The first sample is never acted on, whatever it reads.
        assert_eq!(
            next_ram_gate(RamGate::Open, Some(99.0), 1),
            RamGate::Warming
        );
        assert_eq!(
            next_ram_gate(RamGate::Warming, Some(84.9), 2),
            RamGate::Open
        );
        assert_eq!(
            next_ram_gate(RamGate::Warming, Some(99.0), 2),
            RamGate::Closed
        );
        assert_eq!(next_ram_gate(RamGate::Open, Some(85.0), 3), RamGate::Closed);
        // Hysteresis: between the marks the gate keeps its state.
        assert_eq!(
            next_ram_gate(RamGate::Closed, Some(84.0), 4),
            RamGate::Closed
        );
        assert_eq!(
            next_ram_gate(RamGate::Closed, Some(70.1), 5),
            RamGate::Closed
        );
        assert_eq!(next_ram_gate(RamGate::Closed, Some(70.0), 6), RamGate::Open);
        assert_eq!(next_ram_gate(RamGate::Open, Some(84.0), 7), RamGate::Open);
        // An unreadable probe fails open, out loud at the call site.
        assert_eq!(next_ram_gate(RamGate::Closed, None, 8), RamGate::Open);
        assert_eq!(
            next_ram_gate(RamGate::Closed, Some(f64::NAN), 8),
            RamGate::Open
        );
    }

    #[test]
    fn aging_trips_on_five_skips_or_thirty_minutes() {
        assert!(!is_aged(4, Some(0), AGING_MAX_WAIT_MS - 1));
        assert!(is_aged(5, None, 0));
        assert!(is_aged(0, Some(1_000), 1_000 + AGING_MAX_WAIT_MS));
        assert!(!is_aged(0, None, i64::MAX));
    }

    #[test]
    fn gpu_tokens_match_serde_and_parse_back() {
        for g in [GpuClass::None, GpuClass::Shared, GpuClass::Exclusive] {
            let wire = serde_json::to_value(g).unwrap();
            assert_eq!(wire, serde_json::Value::String(gpu_to_token(g).to_string()));
            assert_eq!(token_to_gpu(gpu_to_token(g)), Some(g));
        }
        assert_eq!(token_to_gpu("cuda"), None);
    }

    #[test]
    fn charges_round_trip_the_profile_and_default_the_nulls() {
        assert_eq!(Charge::from_profile(None), Charge::DEFAULT);
        let default_profile = ResourceProfile::default();
        assert_eq!(
            Charge::from_profile(Some(&default_profile)),
            Charge::DEFAULT,
            "the default PROFILE and an absent profile cost the same"
        );
        let heavy = ResourceProfile {
            machine: MachineLoad::Heavy,
            effort: EffortBand::S,
            gpu: GpuClass::Exclusive,
            ..ResourceProfile::default()
        };
        let c = Charge::from_profile(Some(&heavy));
        assert_eq!((c.machine, c.plan, c.gpu), (4, 1, GpuClass::Exclusive));
        assert_eq!(Charge::from_profile(Some(&c.to_profile())), c);
        assert_eq!(Charge::from_columns(None, None, None), Charge::DEFAULT);
        assert_eq!(
            Charge::from_columns(Some(8), None, Some(GpuClass::Shared)),
            Charge {
                machine: 8,
                plan: 2,
                gpu: GpuClass::Shared
            }
        );
        // An off-vocabulary unit count rounds UP on the way back.
        assert_eq!(charge(3, 5).to_profile().machine, MachineLoad::Heavy);
        assert_eq!(charge(3, 5).to_profile().effort, EffortBand::Xl);
    }
}
