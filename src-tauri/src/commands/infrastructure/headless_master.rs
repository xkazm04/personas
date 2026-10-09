//! The headless App Master state door.
//!
//! `/appmaster` runs a project's App Master from a Claude Code session while the
//! app is closed or mid-development (`docs/architecture/headless-app-master.md`).
//! That chair never writes the app database, so without a door the app showed
//! the project's in-app master as idle or stale while the real work happened in
//! a terminal. This module is that door, kept as small as the problem:
//!
//! - **Storage** is one `app_settings` row per project,
//!   `headless_master:<project_id>` ([`HEADLESS_MASTER_PREFIX`]), holding a
//!   [`HeadlessMasterBeat`]. No table, no migration, and deliberately NOT a
//!   `persona_executions` row (it would take a concurrency slot and be swept
//!   as stale at startup), NOT an attention-ledger row, and NOT the charter's
//!   `spec.pacing` (it would distort the interval floor and the daily cap).
//! - **Write**: `POST /dev-tools/app-master/{project_id}/heartbeat`
//!   (`dev_tools_http.rs`) -> [`record_heartbeat`]. A beat is accepted for a
//!   project with no master persona yet; it displays once one exists.
//! - **Read**: [`read_heartbeat`] / [`headless_state`] for the App Master
//!   readout and the Orchestration preview, and [`fresh_beat_for_projects`]
//!   for the attention tick, which stands aside while a beat is fresh
//!   (`AttentionRefusal::HeadlessMaster`).

use chrono::{DateTime, Duration, SecondsFormat, Utc};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::db::repos::core::settings as settings_repo;
use crate::db::settings_keys::HEADLESS_MASTER_PREFIX;
use crate::db::DbPool;
use crate::error::AppError;

/// Grace added past the later of the beat and the master's own announced next
/// wake. A headless wake can be up to 240 minutes after the previous one (the
/// skill's `WAKE_MAX`), and the beat that follows a wake lands only after the
/// master decided and the Director dispatched or settled, which takes minutes.
/// Fifteen minutes covers that settle time without leaving the project
/// unattended for long once the Director has really stopped.
pub const HEADLESS_GRACE_MINUTES: i64 = 15;

/// Absolute ceiling on how long one beat can suppress the in-app tick,
/// whatever `nextWakeAt` it announced. A Director that died without posting
/// `ended` (a crashed terminal, a closed laptop) must not keep the in-app
/// master standing aside forever on the strength of a far-future wake time.
/// Six hours is longer than the longest legal headless sleep plus its grace.
pub const HEADLESS_HARD_CAP_HOURS: i64 = 6;

/// The stored note is cut to this many characters (server-side), so a chatty
/// wake note can never grow the settings row or the readout without bound.
pub const NOTE_MAX_CHARS: usize = 600;

/// A note longer than this AFTER trimming is refused (400) rather than
/// truncated: that is not a wake note, it is a caller sending the wrong field.
pub const NOTE_INPUT_MAX_CHARS: usize = 16_384;

/// Longest accepted run id. The skill sends an 8-character short id.
const RUN_ID_MAX_CHARS: usize = 100;

/// The one writer this door exists for.
const SOURCE_APPMASTER: &str = "appmaster";

/// The three states a headless chair reports.
pub const STATE_RUNNING: &str = "running";
pub const STATE_IDLE: &str = "idle";
pub const STATE_ENDED: &str = "ended";

/// The request body of `POST /dev-tools/app-master/{project_id}/heartbeat`.
#[derive(Debug, Clone, Deserialize, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessHeartbeatInput {
    /// `running` (a builder is in flight), `idle` (between wakes) or `ended`
    /// (the Director stopped; releases the in-app tick at once).
    pub state: String,
    /// The latest wake note. Trimmed; cut to [`NOTE_MAX_CHARS`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note: Option<String>,
    /// When the headless master next wakes, RFC 3339.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub next_wake_at: Option<String>,
    /// The active run's short id, when one is in flight.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub run_id: Option<String>,
}

/// The stored row (`headless_master:<project_id>`).
#[derive(Debug, Clone, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessMasterBeat {
    pub state: String,
    pub note: String,
    pub next_wake_at: Option<String>,
    /// Server-stamped; the caller's clock is never trusted for freshness.
    pub beat_at: String,
    pub run_id: Option<String>,
    pub source: String,
}

/// The route's answer: the stored beat plus whether it currently makes the
/// in-app App Master stand aside.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessHeartbeatResult {
    #[serde(flatten)]
    pub beat: HeadlessMasterBeat,
    pub suppressing: bool,
}

/// What the app's read surfaces carry about a project's headless chair.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct HeadlessState {
    /// `running` | `idle` | `ended`.
    pub state: String,
    pub note: String,
    pub next_wake_at: Option<String>,
    pub beat_at: String,
    /// True while the beat suppresses the in-app tick (see [`is_fresh`]).
    pub fresh: bool,
}

fn key_for(project_id: &str) -> String {
    format!("{HEADLESS_MASTER_PREFIX}{project_id}")
}

/// An optional field, trimmed, with a blank value read as absent. Every
/// optional field of a beat may be omitted; none of them is required.
fn present(v: Option<&str>) -> Option<&str> {
    v.map(str::trim).filter(|s| !s.is_empty())
}

fn rfc3339(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn parse_ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim())
        .ok()
        .map(|t| t.with_timezone(&Utc))
}

/// Cut `note` to [`NOTE_MAX_CHARS`] characters, on a char boundary, marking the
/// cut with an ellipsis.
fn truncate_note(note: &str) -> String {
    if note.chars().count() <= NOTE_MAX_CHARS {
        return note.to_string();
    }
    let mut out: String = note.chars().take(NOTE_MAX_CHARS - 1).collect();
    out.push('\u{2026}');
    out
}

/// Validate and normalise a beat. Every refusal is a `Validation`, which the
/// route maps to 400.
pub fn build_beat(
    input: &HeadlessHeartbeatInput,
    now: DateTime<Utc>,
) -> Result<HeadlessMasterBeat, AppError> {
    let state = input.state.trim();
    if !matches!(state, STATE_RUNNING | STATE_IDLE | STATE_ENDED) {
        return Err(AppError::Validation(format!(
            "state must be one of running|idle|ended, got {:?}",
            input.state
        )));
    }
    let note = input.note.as_deref().unwrap_or("").trim();
    if note.chars().count() > NOTE_INPUT_MAX_CHARS {
        return Err(AppError::Validation(format!(
            "note is {} characters; a wake note is at most {NOTE_INPUT_MAX_CHARS} \
             (it is stored cut to {NOTE_MAX_CHARS})",
            note.chars().count()
        )));
    }
    let next_wake_at = match present(input.next_wake_at.as_deref()) {
        None => None,
        Some(raw) => Some(rfc3339(parse_ts(raw).ok_or_else(|| {
            AppError::Validation(format!("nextWakeAt is not an RFC 3339 timestamp: {raw:?}"))
        })?)),
    };
    let run_id = present(input.run_id.as_deref()).map(str::to_string);
    if let Some(r) = &run_id {
        if r.chars().count() > RUN_ID_MAX_CHARS {
            return Err(AppError::Validation(format!(
                "runId is longer than {RUN_ID_MAX_CHARS} characters"
            )));
        }
    }
    Ok(HeadlessMasterBeat {
        state: state.to_string(),
        note: truncate_note(note),
        next_wake_at,
        beat_at: rfc3339(now),
        run_id,
        source: SOURCE_APPMASTER.to_string(),
    })
}

/// The instant a beat stops suppressing the in-app tick:
/// `min(max(beatAt, nextWakeAt) + grace, beatAt + hard cap)`.
/// `None` when `beatAt` does not parse (such a beat is never fresh).
pub fn fresh_until(beat: &HeadlessMasterBeat) -> Option<DateTime<Utc>> {
    let beat_at = parse_ts(&beat.beat_at)?;
    let anchor = beat
        .next_wake_at
        .as_deref()
        .and_then(parse_ts)
        .map_or(beat_at, |w| w.max(beat_at));
    let soft = anchor + Duration::minutes(HEADLESS_GRACE_MINUTES);
    let hard = beat_at + Duration::hours(HEADLESS_HARD_CAP_HOURS);
    Some(soft.min(hard))
}

/// A beat is fresh while `now` is before [`fresh_until`] and its state is not
/// `ended`. Only a fresh beat makes the in-app master stand aside.
pub fn is_fresh(beat: &HeadlessMasterBeat, now: DateTime<Utc>) -> bool {
    if beat.state == STATE_ENDED {
        return false;
    }
    fresh_until(beat).is_some_and(|until| now < until)
}

/// Store a beat for `project_id` (already resolved to the project's id), as of
/// `now`. Returns what was stored and whether it suppresses the in-app tick.
pub fn record_heartbeat_at(
    pool: &DbPool,
    project_id: &str,
    input: &HeadlessHeartbeatInput,
    now: DateTime<Utc>,
) -> Result<HeadlessHeartbeatResult, AppError> {
    let beat = build_beat(input, now)?;
    let json = serde_json::to_string(&beat)
        .map_err(|e| AppError::Internal(format!("headless beat: serialise failed: {e}")))?;
    settings_repo::set(pool, &key_for(project_id), &json)?;
    let suppressing = is_fresh(&beat, now);
    Ok(HeadlessHeartbeatResult { beat, suppressing })
}

/// The route's operation: resolve `project` (id, name or root path, like the
/// adopt door) and store the beat under the project's id.
pub fn record_heartbeat(
    pool: &DbPool,
    project: &str,
    input: &HeadlessHeartbeatInput,
) -> Result<HeadlessHeartbeatResult, AppError> {
    let project =
        crate::commands::infrastructure::app_master_adopt::resolve_project(pool, project)?;
    record_heartbeat_at(pool, &project.id, input, Utc::now())
}

/// The stored beat for a project. A row that does not parse reads as absent,
/// which lets the in-app tick run: the safe direction.
pub fn read_heartbeat(
    pool: &DbPool,
    project_id: &str,
) -> Result<Option<HeadlessMasterBeat>, AppError> {
    let Some(raw) = settings_repo::get(pool, &key_for(project_id))? else {
        return Ok(None);
    };
    Ok(parse_beat(project_id, &raw))
}

fn parse_beat(project_id: &str, raw: &str) -> Option<HeadlessMasterBeat> {
    match serde_json::from_str::<HeadlessMasterBeat>(raw) {
        Ok(b) => Some(b),
        Err(e) => {
            tracing::warn!(project_id, error = %e, "headless master beat does not parse; read as absent");
            None
        }
    }
}

/// The read-surface view of a beat, as of `now`.
pub fn state_of(beat: &HeadlessMasterBeat, now: DateTime<Utc>) -> HeadlessState {
    HeadlessState {
        state: beat.state.clone(),
        note: beat.note.clone(),
        next_wake_at: beat.next_wake_at.clone(),
        beat_at: beat.beat_at.clone(),
        fresh: is_fresh(beat, now),
    }
}

/// The read-surface view for one project, or `None` when no beat was ever
/// posted for it.
pub fn headless_state(
    pool: &DbPool,
    project_id: &str,
    now: DateTime<Utc>,
) -> Result<Option<HeadlessState>, AppError> {
    Ok(read_heartbeat(pool, project_id)?.map(|b| state_of(&b, now)))
}

/// Every stored beat, keyed by project id. One prefix read for the preview.
pub fn all_heartbeats(pool: &DbPool) -> Result<Vec<(String, HeadlessMasterBeat)>, AppError> {
    Ok(settings_repo::get_by_prefix(pool, HEADLESS_MASTER_PREFIX)?
        .into_iter()
        .filter_map(|(key, raw)| {
            let project_id = key.strip_prefix(HEADLESS_MASTER_PREFIX)?.to_string();
            let beat = parse_beat(&project_id, &raw)?;
            Some((project_id, beat))
        })
        .collect())
}

/// The first of `project_ids` whose beat is fresh at `now`, with that beat.
/// The attention tick's question: does a headless chair own this persona's
/// project right now?
pub fn fresh_beat_for_projects<'a>(
    pool: &DbPool,
    project_ids: impl IntoIterator<Item = &'a str>,
    now: DateTime<Utc>,
) -> Result<Option<(String, HeadlessMasterBeat)>, AppError> {
    let mut seen: Vec<&str> = Vec::new();
    for pid in project_ids {
        let pid = pid.trim();
        if pid.is_empty() || seen.contains(&pid) {
            continue;
        }
        seen.push(pid);
        if let Some(beat) = read_heartbeat(pool, pid)? {
            if is_fresh(&beat, now) {
                return Ok(Some((pid.to_string(), beat)));
            }
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::dev::projects as projects_repo;
    use personas_db::init_test_db;

    fn t(s: &str) -> DateTime<Utc> {
        parse_ts(s).expect("test timestamp")
    }

    fn input(state: &str) -> HeadlessHeartbeatInput {
        HeadlessHeartbeatInput {
            state: state.to_string(),
            note: None,
            next_wake_at: None,
            run_id: None,
        }
    }

    fn beat(state: &str, beat_at: &str, next: Option<&str>) -> HeadlessMasterBeat {
        HeadlessMasterBeat {
            state: state.to_string(),
            note: String::new(),
            next_wake_at: next.map(str::to_string),
            beat_at: beat_at.to_string(),
            run_id: None,
            source: SOURCE_APPMASTER.to_string(),
        }
    }

    #[test]
    fn beat_round_trips_through_the_settings_row() {
        let pool = init_test_db().expect("test db");
        let p = projects_repo::create_project(&pool, "kp", "/tmp/kp", None, None, None, None, None)
            .expect("project");
        let now = t("2026-10-06T12:00:00Z");
        let mut i = input("running");
        i.note = Some("  Wake 7. Dispatched the salvage builder.  ".into());
        i.next_wake_at = Some("2026-10-06T14:00:00+02:00".into());
        i.run_id = Some("5f1d9ccf".into());
        let out = record_heartbeat_at(&pool, &p.id, &i, now).expect("record");
        assert!(out.suppressing);
        assert_eq!(out.beat.note, "Wake 7. Dispatched the salvage builder.");
        // Normalised to UTC.
        assert_eq!(
            out.beat.next_wake_at.as_deref(),
            Some("2026-10-06T12:00:00Z")
        );
        assert_eq!(out.beat.beat_at, "2026-10-06T12:00:00Z");
        assert_eq!(out.beat.source, "appmaster");

        let back = read_heartbeat(&pool, &p.id)
            .expect("read")
            .expect("present");
        assert_eq!(back, out.beat);
        let st = headless_state(&pool, &p.id, now)
            .expect("state")
            .expect("some");
        assert!(st.fresh);
        assert_eq!(st.state, "running");

        // The route's resolver: a project NAME stores under the project's id.
        record_heartbeat(&pool, "kp", &input("idle")).expect("by name");
        assert_eq!(read_heartbeat(&pool, &p.id).unwrap().unwrap().state, "idle");
        // An unregistered project is the caller's mistake.
        assert!(matches!(
            record_heartbeat(&pool, "nope", &input("idle")),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn ended_releases_at_once() {
        let pool = init_test_db().expect("test db");
        let now = t("2026-10-06T12:00:00Z");
        let mut i = input("ended");
        i.next_wake_at = Some("2026-10-06T13:00:00Z".into());
        let out = record_heartbeat_at(&pool, "proj-1", &i, now).expect("record");
        assert!(!out.suppressing);
        assert!(fresh_beat_for_projects(&pool, ["proj-1"], now)
            .expect("read")
            .is_none());
    }

    #[test]
    fn freshness_holds_to_the_grace_past_the_announced_wake() {
        // Next wake an hour out: fresh until 13:15, not at 13:15.
        let b = beat("idle", "2026-10-06T12:00:00Z", Some("2026-10-06T13:00:00Z"));
        assert!(is_fresh(&b, t("2026-10-06T13:14:59Z")));
        assert!(!is_fresh(&b, t("2026-10-06T13:15:00Z")));
        // No wake announced: the grace runs from the beat itself.
        let b = beat("running", "2026-10-06T12:00:00Z", None);
        assert!(is_fresh(&b, t("2026-10-06T12:14:59Z")));
        assert!(!is_fresh(&b, t("2026-10-06T12:15:00Z")));
        // A wake in the past never shortens the window below the beat's own.
        let b = beat("idle", "2026-10-06T12:00:00Z", Some("2026-10-06T11:00:00Z"));
        assert!(is_fresh(&b, t("2026-10-06T12:14:59Z")));
    }

    #[test]
    fn freshness_is_capped_six_hours_after_the_beat() {
        // A dead Director announcing a wake two days out still releases at +6h.
        let b = beat("idle", "2026-10-06T12:00:00Z", Some("2026-10-08T12:00:00Z"));
        assert!(is_fresh(&b, t("2026-10-06T17:59:59Z")));
        assert!(!is_fresh(&b, t("2026-10-06T18:00:00Z")));
        // An unparseable beatAt is never fresh.
        let b = beat("idle", "yesterday", None);
        assert!(!is_fresh(&b, t("2026-10-06T12:00:00Z")));
    }

    #[test]
    fn an_over_long_note_is_cut_to_the_stored_limit() {
        let now = t("2026-10-06T12:00:00Z");
        let mut i = input("idle");
        i.note = Some("\u{e9}".repeat(NOTE_MAX_CHARS + 50));
        let b = build_beat(&i, now).expect("accepted, cut");
        assert_eq!(b.note.chars().count(), NOTE_MAX_CHARS);
        assert!(b.note.ends_with('\u{2026}'));
        // Exactly at the limit is untouched.
        i.note = Some("x".repeat(NOTE_MAX_CHARS));
        assert_eq!(
            build_beat(&i, now).unwrap().note,
            "x".repeat(NOTE_MAX_CHARS)
        );
        // Absurdly long is a 400, not a silent cut.
        i.note = Some("x".repeat(NOTE_INPUT_MAX_CHARS + 1));
        assert!(matches!(build_beat(&i, now), Err(AppError::Validation(_))));
    }

    #[test]
    fn a_bad_state_or_wake_time_is_refused() {
        let now = t("2026-10-06T12:00:00Z");
        assert!(matches!(
            build_beat(&input("sleeping"), now),
            Err(AppError::Validation(_))
        ));
        let mut i = input("idle");
        i.next_wake_at = Some("in two hours".into());
        assert!(matches!(build_beat(&i, now), Err(AppError::Validation(_))));
        let mut i = input("idle");
        i.run_id = Some("r".repeat(RUN_ID_MAX_CHARS + 1));
        assert!(matches!(build_beat(&i, now), Err(AppError::Validation(_))));
        // Nothing was stored by a refused beat.
        let pool = init_test_db().expect("test db");
        assert!(record_heartbeat_at(&pool, "proj-1", &input("nope"), now).is_err());
        assert!(read_heartbeat(&pool, "proj-1").unwrap().is_none());
    }
}
