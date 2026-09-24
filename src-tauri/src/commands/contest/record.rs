//! A seat's `runs/<seatKey>/record.json` + `final.md`, in the /contest skill's
//! record schema, built from what the fleet saw of the run.
//!
//! The outcome is a Rust port of the instrument's `classifyOutcome`
//! (`lib/participants.mjs`): a timeout is `timed-out`; any error that reads
//! as a usage / rate / quota / seat limit is `seat-limit`; any other error, or
//! a non-zero exit, is `errored`; else `completed`.

use crate::commands::fleet::contest_seat::SeatCapture;

use super::arena::SeatRecord;

pub const OUTCOME_COMPLETED: &str = "completed";
pub const OUTCOME_SEAT_LIMIT: &str = "seat-limit";
pub const OUTCOME_TIMED_OUT: &str = "timed-out";
pub const OUTCOME_ERRORED: &str = "errored";

/// The instrument's seat-limit vocabulary, verbatim from its
/// `/usage limit|rate limit|quota|out of (extra )?usage|seat/i`.
///
/// Deliberately NOT `personas_core::error_taxonomy`: this is the /contest
/// skill's own record contract — a seat the CLI runner files as `seat-limit`
/// must be filed the same way when the app runs it, or the two halves of one
/// ledger disagree. The app's retry/failover taxonomy answers a different
/// question and is not consulted here.
const INSTRUMENT_SEAT_LIMIT_WORDS: &[&str] = &[
    "usage limit",
    "rate limit",
    "quota",
    "out of usage",
    "out of extra usage",
    "seat",
];

fn reads_as_seat_limit(text: &str) -> bool {
    let t = text.to_lowercase();
    INSTRUMENT_SEAT_LIMIT_WORDS.iter().any(|w| t.contains(w))
}

/// The port of `classifyOutcome(parsed, { exit, timedOut })`. An unknown exit
/// (`None`) is not `0`, so it classifies like a non-zero one.
pub fn classify_outcome(errors: &[String], exit: Option<i32>, timed_out: bool) -> &'static str {
    if timed_out {
        return OUTCOME_TIMED_OUT;
    }
    if !errors.is_empty() {
        if reads_as_seat_limit(&errors.join(" ")) {
            return OUTCOME_SEAT_LIMIT;
        }
        return OUTCOME_ERRORED;
    }
    if exit != Some(0) {
        return OUTCOME_ERRORED;
    }
    OUTCOME_COMPLETED
}

/// Who the seat is (from the `plan` seat).
#[derive(Debug, Clone)]
pub struct SeatIdentity {
    pub id: String,
    pub spec: String,
    pub engine: String,
    pub model: String,
    pub effort: String,
}

/// What the driver knows about how the run ended.
#[derive(Debug, Clone, Default)]
pub struct RunEnd {
    pub capture: Option<SeatCapture>,
    /// The exit the record carries (`ContestSeatOutcome::effective_exit`).
    pub exit: Option<i32>,
    pub timed_out: bool,
    /// Measured from the seat's actual start (queue time excluded).
    pub wall_s: Option<f64>,
    /// Why there is no capture, stated in the record (an app restart, a
    /// session the registry no longer knows). `None` on a normal run.
    pub missing_capture_reason: Option<String>,
    /// The fleet's own reason for the row's final state, if any.
    pub state_reason: Option<String>,
    /// Treat a capture-less run as a clean finish: the fleet settled the row
    /// `finished` from its transcript after a restart (the turn had ended).
    pub finished_without_capture: bool,
}

/// `(record, final_text)` for one seat. `finished` is the ISO timestamp.
pub fn build_record(who: &SeatIdentity, end: &RunEnd, finished: String) -> (SeatRecord, String) {
    let cap = end.capture.as_ref();
    // What the ENGINE said. Only this is classified, exactly as the skill
    // classifies `parsed.errors`: the skill's seat-limit pattern matches the bare
    // word "seat", so a note the APP writes must never reach the classifier.
    let mut errors: Vec<String> = cap.map(|c| c.errors.clone()).unwrap_or_default();
    let mut exit = end.exit;
    // The app's own diagnosis, appended after classification.
    let mut app_note: Option<String> = None;
    match cap {
        None => {
            if end.finished_without_capture {
                // The fleet read the transcript and found the turn complete.
                exit = exit.or(Some(0));
            } else {
                let reason = end
                    .missing_capture_reason
                    .clone()
                    .unwrap_or_else(|| "the run produced no output the app could read".into());
                app_note = Some(match &end.state_reason {
                    Some(r) if !r.trim().is_empty() => format!("{reason} (fleet: {})", r.trim()),
                    _ => reason,
                });
            }
        }
        Some(c) => {
            // A run that died without saying why: its stderr is the evidence.
            if errors.is_empty() && exit != Some(0) && !end.timed_out {
                errors.extend(
                    c.stderr_tail
                        .iter()
                        .map(|l| l.trim())
                        .filter(|l| !l.is_empty())
                        .map(|l| l.chars().take(300).collect::<String>()),
                );
                if errors.is_empty() {
                    if let Some(r) = end.state_reason.as_deref().filter(|r| !r.trim().is_empty()) {
                        errors.push(r.trim().chars().take(300).collect());
                    }
                }
            }
        }
    }
    let outcome = match &app_note {
        // No capture and no transcript verdict: the run did not happen as far
        // as anything the app can read — errored (or timed out), never a score.
        Some(_) if end.timed_out => OUTCOME_TIMED_OUT,
        Some(_) => OUTCOME_ERRORED,
        None => classify_outcome(&errors, exit, end.timed_out),
    };
    errors.extend(app_note);
    let wall_s = end.wall_s.or_else(|| {
        cap.and_then(|c| c.duration_ms)
            .map(|ms| (ms as f64 / 10.0).round() / 100.0)
    });
    let record = SeatRecord {
        id: who.id.clone(),
        spec: who.spec.clone(),
        engine: who.engine.clone(),
        model: who.model.clone(),
        effort: who.effort.clone(),
        outcome: outcome.to_string(),
        exit,
        timed_out: end.timed_out,
        wall_s: wall_s.map(|w| (w * 100.0).round() / 100.0),
        turns: cap.and_then(|c| c.turns),
        cost_usd: cap.and_then(|c| c.cost_usd),
        usage: cap.and_then(|c| c.usage.clone()),
        model_usage: cap.and_then(|c| c.model_usage.clone()),
        errors,
        finished,
    };
    let final_text = cap.and_then(|c| c.final_text.clone()).unwrap_or_default();
    (record, final_text)
}

/// `Date.prototype.toISOString()`'s shape, which the skill writes.
pub fn iso_now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn who() -> SeatIdentity {
        SeatIdentity {
            id: "claude-opus_high".into(),
            spec: "claude:opus@high".into(),
            engine: "claude".into(),
            model: "opus".into(),
            effort: "high".into(),
        }
    }

    #[test]
    fn classify_outcome_is_the_instruments() {
        let e = |s: &str| vec![s.to_string()];
        assert_eq!(classify_outcome(&[], Some(0), true), OUTCOME_TIMED_OUT);
        assert_eq!(
            classify_outcome(&e("error: You've hit your usage limit"), Some(1), false),
            OUTCOME_SEAT_LIMIT
        );
        assert_eq!(
            classify_outcome(&e("Rate Limit exceeded"), Some(0), false),
            OUTCOME_SEAT_LIMIT
        );
        assert_eq!(
            classify_outcome(&e("out of extra usage"), None, false),
            OUTCOME_SEAT_LIMIT
        );
        assert_eq!(
            classify_outcome(&e("QUOTA"), None, false),
            OUTCOME_SEAT_LIMIT
        );
        assert_eq!(
            classify_outcome(&e("no seat available"), None, false),
            OUTCOME_SEAT_LIMIT
        );
        assert_eq!(
            classify_outcome(&e("model not found"), Some(0), false),
            OUTCOME_ERRORED
        );
        assert_eq!(classify_outcome(&[], Some(2), false), OUTCOME_ERRORED);
        assert_eq!(classify_outcome(&[], None, false), OUTCOME_ERRORED);
        assert_eq!(classify_outcome(&[], Some(0), false), OUTCOME_COMPLETED);
    }

    #[test]
    fn record_json_carries_exactly_the_skill_keys() {
        let end = RunEnd {
            capture: Some({
                let mut c = SeatCapture::default();
                c.engine = "claude".into();
                c.final_text = Some("done".into());
                c.turns = Some(7);
                c.cost_usd = Some(1.25);
                c.usage = Some(serde_json::json!({"input_tokens": 3}));
                c.result_seen = true;
                c
            }),
            exit: Some(0),
            wall_s: Some(61.234),
            ..RunEnd::default()
        };
        let (rec, final_text) = build_record(&who(), &end, "2026-09-24T10:00:00.000Z".into());
        assert_eq!(final_text, "done");
        assert_eq!(rec.outcome, OUTCOME_COMPLETED);
        let v = serde_json::to_value(&rec).unwrap();
        let mut keys: Vec<&str> = v.as_object().unwrap().keys().map(String::as_str).collect();
        keys.sort_unstable();
        let mut want = vec![
            "id",
            "spec",
            "engine",
            "model",
            "effort",
            "outcome",
            "exit",
            "timed_out",
            "wall_s",
            "turns",
            "cost_usd",
            "usage",
            "model_usage",
            "errors",
            "finished",
        ];
        want.sort_unstable();
        assert_eq!(keys, want);
        assert_eq!(v["wall_s"], 61.23);
        assert_eq!(v["turns"], 7);
        assert!(v["model_usage"].is_null(), "unknown is null, never {{}}");
    }

    #[test]
    fn a_run_with_no_capture_is_errored_with_its_reason_stated() {
        let end = RunEnd {
            missing_capture_reason: Some("the app restarted while this seat ran".into()), // "seat" must not read as seat-limit
            state_reason: Some("Restored after restart".into()),
            ..RunEnd::default()
        };
        let (rec, final_text) = build_record(&who(), &end, "t".into());
        assert_eq!(rec.outcome, OUTCOME_ERRORED);
        assert_eq!(final_text, "");
        assert!(rec.errors[0].contains("app restarted"));
        assert!(rec.errors[0].contains("Restored after restart"));
        assert!(rec.cost_usd.is_none() && rec.turns.is_none());
    }

    #[test]
    fn a_transcript_settled_finish_without_capture_completes() {
        let end = RunEnd {
            finished_without_capture: true,
            ..RunEnd::default()
        };
        let (rec, _) = build_record(&who(), &end, "t".into());
        assert_eq!(rec.outcome, OUTCOME_COMPLETED);
        assert_eq!(rec.exit, Some(0));
    }

    #[test]
    fn a_silent_nonzero_exit_carries_its_stderr_tail() {
        let end = RunEnd {
            capture: Some({
                let mut c = SeatCapture::default();
                c.engine = "grok".into();
                c.stderr_tail = vec!["".into(), "fatal: boom".into()];
                c
            }),
            exit: Some(1),
            ..RunEnd::default()
        };
        let (rec, _) = build_record(&who(), &end, "t".into());
        assert_eq!(rec.errors, vec!["fatal: boom".to_string()]);
        assert_eq!(rec.outcome, OUTCOME_ERRORED);
    }
}
