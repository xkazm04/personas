//! Every tunable the cycle obeys, in one place: the admission thresholds, the
//! input caps, the per-cycle write caps, and the two leg timeouts.
//!
//! Moved verbatim out of the former single-file `sleep_cycle.rs`.

use std::time::Duration;

// ── Bounds ─────────────────────────────────────────────────────────────────

/// **The trigger.** Characters of new non-machine conversation, accumulated
/// since the last completed cycle's `consumed_through` boundary, that admit a
/// cycle.
///
/// 40,000 comes from measurement, not taste: over a 790-message export the
/// operator's heavy days ran 48,325 / 51,735 / 60,808 / 63,550 / 100,389
/// conversation chars and his light days 1,464–11,154, averaging ≈38.4k across
/// nine active days. At this threshold a heavy day cycles the same day and two
/// or three light days accumulate into one — cadence shaped by usage, which is
/// the whole point. Expect to rebalance it from real cycle stats.
pub const PRESSURE_THRESHOLD_CHARS: usize = 40_000;

/// Minimum hours between COMPLETED cycles. A **floor, not the trigger** — it
/// exists so a single very heavy afternoon cannot cycle twice, and it is the
/// only clock left in the admission's fast path.
///
/// Keyed on completion, never on the existence of a `running` row: a crashed
/// cycle stays `running` forever by `cycle_report`'s design, and a floor that
/// respected it would let one dead process suppress every future cycle in
/// silence.
pub const MIN_INTERVAL_HOURS: i64 = 6;

/// Hours after which a cycle fires even under [`PRESSURE_THRESHOLD_CHARS`],
/// provided at least [`MIN_STALENESS_CHARS`] are waiting.
///
/// The release valve for a quiet week: pressure alone would let a slow stretch
/// sit uncompressed indefinitely, and memory that is never reconciled is the
/// failure this whole project exists to end.
pub const STALENESS_HOURS: i64 = 72;

/// Below this many new characters a cycle NEVER admits — not on pressure, not
/// on staleness. Two thousand characters is a handful of turns; compressing it
/// would spend a real LLM call to distil nothing, and write a report saying so.
/// Only [`force`](trigger) crosses this line.
pub const MIN_STALENESS_CHARS: usize = 2_000;

/// How far back the FIRST cycle ever reads, having no predecessor to start
/// from. A week is the same slice `consolidation`'s 80-episode window
/// approximates, and it bounds the one cycle that would otherwise face the
/// whole archive.
pub(super) const FIRST_CYCLE_LOOKBACK_DAYS: i64 = 7;

/// Hard cap on episodes fed to compress.
pub(super) const MAX_EPISODES_IN: u32 = 120;
/// Rows pulled from the window before the caps are applied. Wider than
/// [`MAX_EPISODES_IN`] so the character cap has short episodes to fall back on
/// when the newest ones are long, but still bounded — the true window size is
/// reported from a separate COUNT, so this limit never has to double as the
/// honest denominator.
pub(super) const EPISODE_FETCH_LIMIT: u32 = MAX_EPISODES_IN * 4;
/// Hard cap on total episode characters fed to compress.
pub(super) const MAX_CHARS_IN: usize = 30_000;
/// Per-episode excerpt cap, so one pasted wall of text cannot eat the whole
/// character budget and starve the other 119 episodes of a hearing.
pub(super) const MAX_EPISODE_CHARS: usize = 2_000;

/// Facts applied per cycle, across compress AND the sync inbox. One shared
/// budget on purpose: a large staged batch must not be able to write 40 facts
/// just because it arrived through a different door.
pub(super) const MAX_FACTS_PER_CYCLE: usize = 12;
/// Procedurals applied per cycle, same shared budget.
pub(super) const MAX_PROCEDURALS_PER_CYCLE: usize = 6;
/// Supersedes applied per cycle. Every one of these retires a live memory, so
/// this is the tightest cap in the module.
pub(super) const MAX_SUPERSEDES_PER_CYCLE: usize = 8;
/// Staged deltas drained per cycle.
pub(super) const MAX_STAGED_PER_CYCLE: u32 = 200;
/// Active facts summarised into the reconcile prompt.
pub(super) const MAX_FACTS_TO_RECONCILE: u32 = 200;
/// Characters of a fact value shown to the reconcile leg. Summaries, never
/// bodies — the reconcile judgement is "are these two the same claim", which
/// does not need the full paragraph and would otherwise reintroduce the
/// unbounded prompt this whole project exists to kill.
pub(super) const RECONCILE_VALUE_CHARS: usize = 200;

/// Importance a cycle-written memory starts at: mid-scale. A pass that ran
/// unattended does not get to declare its own output core identity.
pub(super) const CYCLE_IMPORTANCE: i32 = 3;
/// Confidence assumed when a candidate omits one.
pub(super) const DEFAULT_CONFIDENCE: f32 = 0.7;

pub(super) const COMPRESS_TIMEOUT: Duration = Duration::from_secs(300);
pub(super) const RECONCILE_TIMEOUT: Duration = Duration::from_secs(180);

pub(super) const PHASE_COMPRESS: &str = "compress";
pub(super) const PHASE_RECONCILE: &str = "reconcile";
