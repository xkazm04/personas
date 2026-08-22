//! The sleep cycle — Athena's scheduled reconciliation pass over her own
//! memory (phase L1b of `docs/plans/athena-longevity.md`).
//!
//! Everything under `brain/` before this module was an organ without a
//! heartbeat: `consolidation`, `reflection`, `procedural`, `taxonomy` and
//! `sync_staging` are all real implementations that only ever ran when a human
//! pressed a button, and `companion_consolidation` held **0 rows in 77 days**.
//! This module is the heartbeat. It does not invent a memory model; it walks
//! the one that already exists.
//!
//! ## What one cycle does
//!
//! * **A · compress** — conversation episodes since the last completed cycle
//!   become candidate facts and procedurals, each citing the episode ids it was
//!   distilled from, each tagged from the [`taxonomy`] vocabulary. Applied
//!   through the existing writers ([`semantic::write_fact`],
//!   [`procedural::write_rule`]), so provenance, the supersede demotion and the
//!   FTS mirror all behave exactly as they do for a hand-reviewed fact.
//! * **B · reconcile** — consume whatever the paired device staged
//!   ([`sync_staging`]), then judge supersedes and contradictions across the
//!   active fact set, then run the lifecycle pass.
//!
//! ## What fires a cycle: sleep pressure, not the clock
//!
//! L1b fired on a 20-hour timer inside an approved night-plan window. Both are
//! gone (L1c). A cycle is triggered by **accumulated conversation volume** —
//! [`PRESSURE_THRESHOLD_CHARS`] of new non-machine conversation since the last
//! completed cycle's [`consumed_through`](CycleStats::consumed_through)
//! boundary — because that is the thing a cycle actually costs money to
//! process. Measured on a 790-message export: heavy days run 48k–100k
//! conversation chars, light days 1.5k–11k, so a heavy day cycles same-day and
//! two or three light ones accumulate into one. The clock survives only as a
//! **floor** ([`MIN_INTERVAL_HOURS`], so a burst cannot cycle twice in an hour)
//! and as a **staleness** release ([`STALENESS_HOURS`], so a slow week still
//! gets compressed) — neither is the trigger.
//!
//! The night-plan approval gate was removed with it: that gate guards
//! *autonomy-answering*, and memory maintenance is not that.
//!
//! ### One boundary, one predicate, one read
//!
//! Pressure and the compress window are not two measurements that agree — they
//! are the *same* measurement. [`measure`] resolves the boundary once, fetches
//! the window once, and sums its bodies; on admission that exact `Vec<Episode>`
//! travels inside the [`AdmittedCycle`] into compress. There is no second query
//! that could drift from the first.
//!
//! ### Draining forward
//!
//! Because the caps below can truncate a heavy window, compress consumes
//! **oldest-first** and records `consumed_through` = the `created_at` of the
//! newest episode it actually read. The next cycle's boundary is that value
//! (exclusive), so a truncated day's residue is the *next* cycle's oldest
//! material rather than orphaned material no cycle ever reaches. L1b took the
//! newest N of an over-long window, which had exactly that orphaning bug.
//!
//! ## v0 is deliberately conservative
//!
//! Three rules, each of which makes the cycle do *less* than it could:
//!
//! 1. **Forgetting is report-only.** The cycle computes what the size-cap
//!    policy would demote (through [`consolidation::low_value_prune_candidates`],
//!    the same selection the enforcing prune uses) and writes it into the
//!    report. It demotes nothing. The only rows this cycle ever retires are the
//!    ≤8 supersedes it explicitly judged — and even those go through the shared
//!    [`semantic::demote_superseded`], never a `DELETE`.
//! 2. **Taxonomy expansion is propose-only.** A new classification lands as
//!    `proposed` and classifies nothing until a human activates it. A cycle
//!    cannot widen its own vocabulary.
//! 3. **Caps bind, and what they drop is counted.** ≤12 facts and ≤6
//!    procedurals per cycle, ≤8 supersedes, ≤120 episodes / 30k chars of input.
//!    Every drop appears in `stats_json` and in the report. A cycle that does
//!    less but reports truthfully beats one that does more silently — which is
//!    the whole lesson of the 30 stale facts that were recited as current for
//!    70 days while no instrument noticed.
//!
//! ## Everything the model produces is untrusted
//!
//! Episode bodies and staged payloads are transcripts and cross-device
//! distillate: they are **evidence, not instruction**. Both prompts put them
//! inside a nonce-tagged `<untrusted_*>` boundary under an explicit banner, with
//! every rule stated *outside* the fence — the split the fix loop's correction
//! path made in `e732c4e65`, applied here because "summarise this conversation"
//! is exactly the shape of call where planted text most wants to be read as an
//! instruction. Structural containment is only half of it: the ids the model
//! hands back (`provenance`, `supersedes_id`, `winner_id`/`loser_id`) are
//! checked against the database before anything is written, so a hallucinated id
//! drops a candidate instead of demoting an arbitrary fact.
//!
//! ## Honest failure
//!
//! Any error finishes the cycle as `failed` with the reason in
//! `stats_json.error` and a partial report — never an abandoned `running` row
//! while this process is still alive. (A `running` row after a *crash* is
//! deliberate and stays: see `cycle_report`'s honesty contract.)

//!
//! ## Layout
//!
//! Split out of the former single-file `sleep_cycle.rs` (3,482 lines) along the
//! `// ── … ──` banners the file already carried, which mark the cycle's own
//! stages. No logic moved with it:
//!
//! - [`limits`] — every tunable in one place: admission thresholds, input caps,
//!   per-cycle write caps, the two leg timeouts.
//! - [`admission`] — *should a cycle run at all*: the one-read gauge, the
//!   admit/skip verdict, the one-at-a-time guard, and [`admit`] / [`trigger`].
//! - [`pressure`] — the same reading as a wire shape for the UI gauge, derived
//!   from `admission`'s `measure` + `verdict` rather than recomputed.
//! - [`run`] — orchestration: [`run_sleep_cycle`] / [`run_admitted`], the
//!   [`CycleLlm`] seam the legs call through, and the counters and notes a
//!   cycle accumulates as it walks.
//! - [`phases`] — the two legs (compress, reconcile) and the input bounding
//!   they do before a prompt is built.
//! - [`sync_inbox`] — draining the paired device's staged distillate through
//!   the same validate/apply path compress uses.
//! - [`apply`] — writing verdicts into the brain: supersedes, fact and
//!   procedural candidates, tags. Every id checked against live memory first.
//! - [`prompts`] — the two prompts and the nonce fence around untrusted text.
//! - [`report`] — the narrative the operator reads.
//! - [`parse`] — the small shared JSON/tag/timestamp helpers.
//!
//! Everything stays reachable as `crate::companion::brain::sleep_cycle::X`; the
//! re-exports below preserve the pre-split surface exactly.

mod admission;
mod apply;
mod limits;
mod parse;
mod phases;
mod pressure;
mod prompts;
mod report;
mod run;
mod sync_inbox;

#[cfg(test)]
mod tests;

pub use admission::*;
// The four public thresholds are read only from inside this module today, so
// the re-export has no in-crate consumer — but dropping it would silently move
// `sleep_cycle::PRESSURE_THRESHOLD_CHARS` and friends behind a private module.
#[allow(unused_imports)]
pub use limits::*;
pub use pressure::*;
pub use run::*;
