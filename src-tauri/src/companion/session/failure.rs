//! How a turn fails: the low-cardinality reason token, and the wrapper that
//! guarantees exactly one `is_error` ledger row per genuinely failed turn.
//!
//! Moved verbatim out of the former single-file `session.rs`.

use super::cli::is_stale_session_error;
use super::locks::ledger_origin_of;
use super::model::companion_turn_model;
use super::origin::TurnOrigin;
use crate::companion::turn_ledger::CliUsage;
use crate::db::UserDbPool;
use crate::error::AppError;

/// Why a turn failed, as a low-cardinality token so `GROUP BY error_reason`
/// stays useful. The raw message is kept separately (in `outcome_json.error`)
/// for diagnosis — this is the groupable axis, not the detail.
///
/// `pub(crate)` because the headless decision legs (`athena_reaction`) classify
/// their failures through this same function: one taxonomy across every origin,
/// so `GROUP BY error_reason` means the same thing whichever path produced the
/// row.
pub(crate) fn classify_failure(e: &AppError) -> &'static str {
    let m = e.to_string().to_ascii_lowercase();
    // Order matters: the stale-`--resume` retry's own timeout is a distinct
    // failure from a plain 25-minute timeout — it means the self-heal path ran
    // and still didn't land, which is the more interesting signal.
    if m.contains("after session reset") {
        "timeout_after_stale_resume"
    } else if m.contains("timeout") || m.contains("timed out") {
        "timeout"
    } else if is_stale_session_error(e) {
        // Reached only when there was no session id to retry with; otherwise
        // `send_turn` self-heals and this never surfaces as the turn's error.
        "stale_resume"
    } else if m.contains("spawn claude")        // run_cli
        || m.contains("failed to spawn")        // athena_reaction::cli_text_inner
        || m.contains("cli not found")
    // ditto, when the binary is absent
    {
        // Matched on several phrasings deliberately: the two modules word the
        // same failure differently, and a taxonomy that silently degrades one
        // of them to `other` is worse than no taxonomy — it looks precise while
        // hiding the most actionable cause.
        "spawn_failed"
    } else if m.contains("exited with status")   // run_cli
        || m.contains("exited")
    // brain::oneshot: "claude {leg} exited {code}: {stderr}"
    {
        // Third phrasing of the same failure, third module. `brain::oneshot`
        // says "claude consolidation exited 1: …" — which matches NONE of the
        // patterns below either, so before this it degraded to `other` and the
        // ledger could not tell a crashed maintenance leg from a failed DB
        // write. Pinned by `classifies_the_oneshot_leg_failure_exits`.
        "cli_nonzero_exit"
    } else if m.contains("produced no assistant text") {
        "empty_reply"
    } else if m.contains("stdout")
        || m.contains("stderr")
        || m.contains("stdin")
        || m.contains("wait claude")
    {
        // Covers "read claude stdout: …", "claude stdout missing" (run_cli),
        // "Missing stdout pipe" (athena_reaction) and oneshot's
        // "read stdout (leg): …" / "write stdin (leg): …" / "await claude
        // (leg): …" (the last matches on the "wait claude" substring inside
        // "await claude" — deliberate, and pinned by the oneshot test).
        "cli_io"
    } else {
        // DB writes, prompt assembly, embedding — the `?` exits in the turn
        // body. Rare, but they were equally invisible before.
        "other"
    }
}

/// Records the `is_error = 1` ledger row for a turn that never reached the
/// success ledger write at the end of `send_turn_inner`.
///
/// Every error exit in the turn body returns early, so before this the ledger
/// only ever saw turns that finished: `is_error` was 0 on all 1,734 rows of
/// the reference install, and `companion_get_health` reported a flawless error
/// rate *by construction* — the operator opened Observability, saw zero
/// errors, and believed it. The wrapper in `send_turn` now converts any `Err`
/// — a `?` on a DB/prompt failure, a CLI spawn failure, the 25-minute timeout,
/// or the stale-`--resume` retry giving up — into exactly one row.
///
/// `armed` is what keeps the number honest in the *other* direction, and keeps
/// it to exactly one row per turn:
///   * It starts **false**, so the two turn-lock SKIP returns (a background
///     `try_lock` self-skip, a full fleet queue) record nothing. Those are
///     backpressure, not failures, and counting them would swamp the error rate
///     with normal behaviour.
///   * [`arm`](Self::arm) flips it once the lock is held — strictly after both
///     skip returns, so everything past that point is a genuine turn.
///   * [`disarm`](Self::disarm) flips it back the moment the turn writes its own
///     success row, so a later error can never add a second row for the same
///     turn. (No `?` currently follows that write, but the invariant should not
///     depend on nobody ever adding one.)
pub(super) struct FailedTurnCtx {
    origin: &'static str,
    trigger_kind: Option<String>,
    voice: bool,
    armed: std::sync::atomic::AtomicBool,
}

impl FailedTurnCtx {
    pub(super) fn new(origin: &TurnOrigin, voice: bool) -> Self {
        let (origin, trigger_kind) = ledger_origin_of(origin);
        Self {
            origin,
            trigger_kind,
            voice,
            armed: std::sync::atomic::AtomicBool::new(false),
        }
    }

    /// The turn holds the lock and is really running — from here on, an `Err`
    /// is a failure worth recording rather than a skip.
    pub(super) fn arm(&self) {
        self.armed.store(true, std::sync::atomic::Ordering::SeqCst);
    }

    /// The turn recorded its own row; this one must not add another.
    pub(super) fn disarm(&self) {
        self.armed.store(false, std::sync::atomic::Ordering::SeqCst);
    }

    /// Best-effort failure row. `usage` is whatever the CLI managed to report
    /// before dying — commonly `None` (spawn failure, timeout), commonly real
    /// (a non-zero exit still emits a `result` event with cost). A missing
    /// usage block must never swallow the row: a failed turn with unknown cost
    /// is still a recorded failed turn.
    pub(super) fn record(&self, pool: &UserDbPool, e: &AppError, usage: Option<CliUsage>) {
        if !self.armed.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        let reason = classify_failure(e);
        let raw = e.to_string();
        tracing::warn!(
            origin = self.origin,
            reason,
            error = %raw,
            "companion: turn failed — recording ledger row"
        );
        let mut rec = crate::companion::turn_ledger::failed_turn_record(
            self.origin,
            self.trigger_kind.clone(),
            Some(companion_turn_model()),
            reason,
            &raw,
            usage,
        );
        rec.voice = self.voice;
        crate::companion::turn_ledger::record_turn(pool, &rec);
    }
}
