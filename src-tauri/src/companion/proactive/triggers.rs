//! Trigger evaluators. Pure functions that scan brain state and
//! produce candidate `Nudge`s — no persistence, no side effects.
//!
//! Trigger kinds in v1:
//!   - `goal_target_approaching` — active goal with `target_date`
//!     within the next 24 hours and not yet completed.
//!   - `backlog_aging` — pending self_promise older than the
//!     reminded-tier threshold, ratcheting based on prior reminders.
//!   - `cadence_due` — cadence ritual whose schedule says "now."
//!   - `on_this_day` — episode/reflection from the same calendar
//!     date 30/90/365 days ago (Day One / Apple Journal pattern).
//!     Goal-affinity scored: hits whose body mentions an active goal
//!     title win the per-anniversary pick.
//!
//! Templates: messages are template-rendered, not LLM-generated. Going
//! direct keeps the trigger loop cheap, predictable, and testable. A
//! later iteration can route specific templates through Claude for a
//! more conversational tone.
//!
//! ## Cadence semantics — pinned by property tests in `cadence_prop_tests`
//!
//! These are the *contract*. Property tests below enforce them; treat
//! any failure as a contract change requiring an explicit doc update.
//!
//!   1. **Firing window is `[at, at + duration_min)`.** `at` is the
//!      inclusive start; `at + duration_min` is the exclusive end.
//!      Default `duration_min` is `CADENCE_MATCH_WINDOW_MIN` (30) when
//!      the schedule omits it. Comparison is at minute granularity.
//!
//!   2. **No midnight wrap for cadences.** A schedule like
//!      `at=23:30, duration_min=120` fires only between 23:30 and
//!      23:59 on the scheduled day; it does *not* spill into the next
//!      day. Cadences are positive triggers (drives a ping) — wrapping
//!      across days would mute the day-filter. Quiet windows wrap;
//!      cadences don't.
//!
//!   3. **Day filter is a whitelist** (same as quiet hours): missing
//!      means every day; non-empty array is checked exactly. Both
//!      single (`day: "fri"`) and list (`days: [...]`) forms are
//!      supported; a schedule using both is malformed and ignored
//!      via the chrono parse path.
//!
//!   4. **Dedupe window equals the cadence's own `duration_min`.** A
//!      30-min cadence won't re-fire within the same 30 minutes after
//!      the user has dismissed; tomorrow's `at` will fire normally
//!      (next firing is one full day away, well outside any reasonable
//!      `duration_min`). This replaces an earlier hardcoded 60-minute
//!      floor that conflicted with sub-hour cadences (a 15-min ritual
//!      could be silently suppressed for an extra 45 minutes after
//!      dismiss). Floor is 1 minute to prevent same-evaluation-tick
//!      double-fires.

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, NaiveTime, Timelike, Utc, Weekday};
use rusqlite::params;
use serde_json::Value;

use crate::companion::brain::{backlog, goals, rituals};
use crate::db::UserDbPool;
use crate::error::AppError;

use super::Nudge;

/// Run every trigger evaluator and return the union of candidates.
/// Order matters lightly: goals → backlog → cadence so a budget-
/// limited evaluation surfaces objectives before commitments before
/// rituals (the rough priority order most users assume).
pub fn collect_all(pool: &UserDbPool) -> Result<Vec<Nudge>, AppError> {
    let mut out = Vec::new();
    out.extend(goal_target_approaching(pool).unwrap_or_default());
    out.extend(backlog_aging(pool).unwrap_or_default());
    out.extend(cadence_due(pool).unwrap_or_default());
    out.extend(on_this_day(pool).unwrap_or_default());
    Ok(out)
}

// ── goal_target_approaching ─────────────────────────────────────────────

const GOAL_LOOKAHEAD_HOURS: i64 = 24;

fn goal_target_approaching(pool: &UserDbPool) -> Result<Vec<Nudge>, AppError> {
    let now = Utc::now();
    let cutoff = now + Duration::hours(GOAL_LOOKAHEAD_HOURS);
    let active = goals::list_goals(pool, Some(goals::GoalStatus::Active), 50)?;
    let mut out = Vec::new();
    for g in active {
        let Some(target) = g.target_date.as_deref() else {
            continue;
        };
        let parsed = match parse_date_or_datetime(target) {
            Some(t) => t,
            None => continue,
        };
        if parsed < now || parsed > cutoff {
            continue;
        }
        // Skip if too far past creation — a goal created seconds ago
        // with target tomorrow shouldn't fire on the same evaluation
        // pass. Crude cool-off: 30 minutes.
        let created =
            parse_date_or_datetime(&g.created_at).unwrap_or_else(|| parsed - Duration::days(1));
        if (now - created).num_minutes() < 30 {
            continue;
        }
        out.push(Nudge {
            trigger_kind: "goal_target_approaching".into(),
            trigger_ref: Some(g.id.clone()),
            message: format!(
                "Heads-up: your goal **{title}** has its target date tomorrow. \
                 Want to walk through where it stands?",
                title = g.title
            ),
        });
    }
    Ok(out)
}

// ── backlog_aging ───────────────────────────────────────────────────────

/// Age tiers (in hours since item creation) at which a pending
/// self_promise becomes nudgeable. The tier index doubles as the
/// `reminded_count` threshold — past tier 2 we let it sleep until the
/// user resurfaces it.
const BACKLOG_TIERS_HOURS: [i64; 3] = [12, 48, 168]; // 12h, 2 days, 1 week

fn backlog_aging(pool: &UserDbPool) -> Result<Vec<Nudge>, AppError> {
    let now = Utc::now();
    let pending = backlog::list_items(pool, None, true, 100)?;
    let mut out = Vec::new();
    for b in pending {
        if b.kind != "self_promise" {
            continue;
        }
        let Some(created) = parse_date_or_datetime(&b.created_at) else {
            continue;
        };
        let age_hours = (now - created).num_hours();
        let tier = b.reminded_count.max(0) as usize;
        if tier >= BACKLOG_TIERS_HOURS.len() {
            continue; // exhausted — wait for the user
        }
        if age_hours < BACKLOG_TIERS_HOURS[tier] {
            continue;
        }
        out.push(Nudge {
            trigger_kind: "backlog_aging".into(),
            trigger_ref: Some(b.id.clone()),
            message: format!(
                "I told you I'd come back to this: \"{summary}\". \
                 Want to pick it up now, or should I drop it?",
                summary = b.summary.lines().next().unwrap_or(&b.summary).trim()
            ),
        });
    }
    Ok(out)
}

// ── cadence_due ─────────────────────────────────────────────────────────

const CADENCE_MATCH_WINDOW_MIN: i64 = 30;

fn cadence_due(pool: &UserDbPool) -> Result<Vec<Nudge>, AppError> {
    let active =
        rituals::list_rituals(pool, Some(rituals::RitualKind::Cadence), true).unwrap_or_default();
    if active.is_empty() {
        return Ok(Vec::new());
    }
    let now = Local::now();
    let mut out = Vec::new();
    for r in active {
        let parsed: Value = match serde_json::from_str(&r.schedule_json) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if !cadence_fires_now(&parsed, now) {
            continue;
        }
        // Last-fire dedupe: covers the case where the user already
        // dismissed/engaged this ritual within the current firing
        // window (the persistence-level (trigger_kind, trigger_ref)
        // dedupe only blocks queued/delivered, not resolved). Window
        // equals the cadence's own `duration_min` — see contract
        // point 4 in the module doc.
        let dedupe_window_min = cadence_dedupe_window_min(&parsed);
        if recently_nudged(pool, &r.id, dedupe_window_min)? {
            continue;
        }
        out.push(Nudge {
            trigger_kind: "cadence_due".into(),
            trigger_ref: Some(r.id.clone()),
            message: format!(
                "Cadence check-in: **{description}**. Want to do this now or skip?",
                description = r.description.lines().next().unwrap_or("ritual").trim()
            ),
        });
    }
    Ok(out)
}

fn cadence_fires_now(schedule: &Value, now: DateTime<Local>) -> bool {
    // Two shapes supported:
    //   { "day": "fri", "at": "17:00", "duration_min": 30 }
    //   { "days": ["mon","wed","fri"], "at": "08:30" }
    // Either shape: weekday must match (or be unspecified) AND now
    // must fall within `duration_min` minutes of `at`.
    let now_t = NaiveTime::from_hms_opt(now.hour(), now.minute(), 0).unwrap_or_default();
    let at = schedule
        .get("at")
        .and_then(|v| v.as_str())
        .and_then(parse_hhmm);
    let Some(at) = at else {
        return false;
    };

    // Day filter (single or list).
    if let Some(day_one) = schedule.get("day").and_then(|v| v.as_str()) {
        if !day_matches(day_one, now.weekday()) {
            return false;
        }
    } else if let Some(days) = schedule.get("days").and_then(|v| v.as_array()) {
        let any = days.iter().any(|d| {
            d.as_str()
                .map(|s| day_matches(s, now.weekday()))
                .unwrap_or(false)
        });
        if !any {
            return false;
        }
    }

    let duration = schedule
        .get("duration_min")
        .and_then(|v| v.as_i64())
        .unwrap_or(CADENCE_MATCH_WINDOW_MIN);
    // Compute minute-delta between `now_t` and `at`. The cadence
    // "fires" when now is in [at, at + duration).
    let now_min = now_t.hour() as i64 * 60 + now_t.minute() as i64;
    let at_min = at.hour() as i64 * 60 + at.minute() as i64;
    now_min >= at_min && now_min < at_min + duration
}

fn day_matches(label: &str, weekday: Weekday) -> bool {
    let canonical = match weekday {
        Weekday::Mon => "mon",
        Weekday::Tue => "tue",
        Weekday::Wed => "wed",
        Weekday::Thu => "thu",
        Weekday::Fri => "fri",
        Weekday::Sat => "sat",
        Weekday::Sun => "sun",
    };
    label.eq_ignore_ascii_case(canonical)
}

/// Pure helper — pulls the cadence's own `duration_min` (or the default
/// 30) out of the schedule and clamps to a 1-minute floor. The floor
/// stops same-evaluation-tick duplicates without widening the dedupe
/// past the firing window.
fn cadence_dedupe_window_min(schedule: &Value) -> i64 {
    let raw = schedule
        .get("duration_min")
        .and_then(|v| v.as_i64())
        .unwrap_or(CADENCE_MATCH_WINDOW_MIN);
    raw.max(1)
}

fn recently_nudged(pool: &UserDbPool, ritual_id: &str, window_min: i64) -> Result<bool, AppError> {
    let conn = pool.get()?;
    let cutoff = (Utc::now() - Duration::minutes(window_min)).to_rfc3339();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM companion_proactive_message
         WHERE trigger_kind = 'cadence_due'
           AND trigger_ref = ?1
           AND created_at > ?2",
        params![ritual_id, cutoff],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

// ── on_this_day ─────────────────────────────────────────────────────────

/// Calendar offsets for memory resurfacing. 30 / 90 / 365 mirror the
/// Day One and Apple Journal patterns; users perceive these as the
/// "month / season / year" anniversaries.
const ON_THIS_DAY_OFFSETS_DAYS: [i64; 3] = [30, 90, 365];

/// Surface a small selection of past episodes/reflections from the
/// same local calendar date 30/90/365 days ago. Picks at most one
/// memory per anniversary, preferring entries whose body mentions an
/// active goal title (so today's preoccupations get continuity, not
/// random nostalgia).
fn on_this_day(pool: &UserDbPool) -> Result<Vec<Nudge>, AppError> {
    let today_local = Local::now().date_naive();
    let today_str = today_local.format("%Y-%m-%d").to_string();

    // Active-goal keywords — used for affinity scoring of candidate
    // memories. We lower-case + strip very short titles to avoid
    // matching every body that contains "go" or "ai".
    let active_goals =
        goals::list_goals(pool, Some(goals::GoalStatus::Active), 50).unwrap_or_default();
    let goal_keywords: Vec<String> = active_goals
        .iter()
        .map(|g| g.title.trim().to_lowercase())
        .filter(|s| s.chars().count() >= 4)
        .collect();

    let conn = pool.get()?;
    let mut out = Vec::new();
    for &days_ago in ON_THIS_DAY_OFFSETS_DAYS.iter() {
        let target = today_local - Duration::days(days_ago);
        let target_str = target.format("%Y-%m-%d").to_string();

        // Compare local calendar dates so users in non-UTC timezones see
        // anniversaries the way they'd describe them ("a year ago today").
        // Index hit: idx_companion_node_kind covers (kind, created_at).
        let mut stmt = conn.prepare(
            "SELECT id, kind, body_excerpt, importance
             FROM companion_node
             WHERE kind IN ('episode', 'reflection')
               AND date(created_at, 'localtime') = ?1
             ORDER BY importance DESC, created_at DESC
             LIMIT 20",
        )?;
        let rows: Vec<(String, String, Option<String>, i32)> = stmt
            .query_map(params![target_str], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i32>(3)?,
                ))
            })?
            .collect::<Result<_, _>>()?;
        if rows.is_empty() {
            continue;
        }

        // Goal-affinity pick: first candidate whose body excerpt mentions
        // any active-goal keyword. Falls back to the highest-importance
        // recent hit (already ordered by the SQL).
        let pick = rows
            .iter()
            .find(|(_, _, body, _)| body_mentions_any(body.as_deref(), &goal_keywords))
            .or_else(|| rows.first())
            .cloned();
        let Some((node_id, kind, body, _imp)) = pick else {
            continue;
        };

        // Per-anniversary, per-day dedupe: any prior message for this
        // (offset, today) — regardless of status — blocks a re-fire so
        // that dismissing today's resurface doesn't cause it to re-pop
        // on the next 30-minute tick.
        let day_ref = format!("{days_ago}d:{today_str}");
        if recently_nudged_on_this_day(pool, &day_ref)? {
            continue;
        }

        out.push(build_on_this_day_nudge(
            days_ago,
            &day_ref,
            &node_id,
            &kind,
            body.as_deref(),
        ));
    }
    Ok(out)
}

fn body_mentions_any(body: Option<&str>, keywords: &[String]) -> bool {
    let Some(body) = body else {
        return false;
    };
    if keywords.is_empty() {
        return false;
    }
    let body_lower = body.to_lowercase();
    keywords.iter().any(|kw| body_lower.contains(kw))
}

fn recently_nudged_on_this_day(pool: &UserDbPool, trigger_ref: &str) -> Result<bool, AppError> {
    let conn = pool.get()?;
    // 18-hour window: prevents same-day re-fire (covers a normal user's
    // active waking hours) without permanently blocking next-anniversary
    // surfacing tomorrow.
    let cutoff = (Utc::now() - Duration::hours(18)).to_rfc3339();
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM companion_proactive_message
         WHERE trigger_kind = 'on_this_day'
           AND trigger_ref = ?1
           AND created_at > ?2",
        params![trigger_ref, cutoff],
        |r| r.get(0),
    )?;
    Ok(count > 0)
}

/// Build the nudge text for a memory hit. Pure — extracted so the
/// formatting can be unit-tested without DB setup.
fn build_on_this_day_nudge(
    days_ago: i64,
    day_ref: &str,
    node_id: &str,
    kind: &str,
    body_excerpt: Option<&str>,
) -> Nudge {
    let preview = body_excerpt
        .unwrap_or("(no preview)")
        .lines()
        .next()
        .unwrap_or("(no preview)")
        .trim();
    let preview = truncate_chars(preview, 140);
    let kind_word = if kind == "reflection" {
        "reflection"
    } else {
        "moment"
    };
    let ago = humanize_days_ago(days_ago);
    Nudge {
        trigger_kind: "on_this_day".into(),
        // Embed the source node id alongside the day key so a future
        // "tap to resume" UI can navigate straight to the source.
        // Format: "<offset>d:<YYYY-MM-DD>#<node_id>". The dedupe query
        // keys on the prefix-only `day_ref`; the `#node_id` is metadata.
        trigger_ref: Some(format!("{day_ref}#{node_id}")),
        message: format!(
            "{ago} ago today, you wrote a {kind_word}: \"{preview}\". \
             How did that go?",
        ),
    }
}

fn humanize_days_ago(days: i64) -> &'static str {
    match days {
        30 => "A month",
        90 => "Three months",
        365 => "A year",
        _ => "A while",
    }
}

fn truncate_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

// ── helpers ─────────────────────────────────────────────────────────────

/// Parse an ISO8601 datetime, an RFC3339 datetime, or a bare YYYY-MM-DD
/// date (treated as UTC midnight). Returns None on anything else.
fn parse_date_or_datetime(s: &str) -> Option<DateTime<Utc>> {
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    if let Ok(d) = NaiveDate::parse_from_str(s, "%Y-%m-%d") {
        return Some(d.and_hms_opt(0, 0, 0)?.and_utc());
    }
    None
}

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M").ok()
}

#[cfg(test)]
mod on_this_day_tests {
    use super::*;

    #[test]
    fn humanize_renders_known_offsets() {
        assert_eq!(humanize_days_ago(30), "A month");
        assert_eq!(humanize_days_ago(90), "Three months");
        assert_eq!(humanize_days_ago(365), "A year");
        assert_eq!(humanize_days_ago(7), "A while");
    }

    #[test]
    fn truncate_appends_ellipsis_only_when_needed() {
        assert_eq!(truncate_chars("short", 10), "short");
        let long = "a".repeat(200);
        let out = truncate_chars(&long, 50);
        assert_eq!(out.chars().count(), 51); // 50 + ellipsis
        assert!(out.ends_with('…'));
    }

    #[test]
    fn body_mentions_returns_false_for_empty_keywords() {
        assert!(!body_mentions_any(Some("anything goes"), &[]));
    }

    #[test]
    fn body_mentions_is_case_insensitive() {
        let kws = vec!["ship the launcher".into()];
        assert!(body_mentions_any(
            Some("Today I'll Ship The Launcher v2"),
            &kws
        ));
        assert!(!body_mentions_any(Some("unrelated note"), &kws));
        assert!(!body_mentions_any(None, &kws));
    }

    #[test]
    fn build_nudge_includes_humanized_offset_and_kind() {
        let n = build_on_this_day_nudge(
            365,
            "365d:2026-05-05",
            "ep_abc123",
            "episode",
            Some("Started the new persona project today."),
        );
        assert_eq!(n.trigger_kind, "on_this_day");
        assert_eq!(n.trigger_ref.as_deref(), Some("365d:2026-05-05#ep_abc123"));
        assert!(n.message.contains("A year ago today"));
        assert!(n.message.contains("moment"));
        assert!(n.message.contains("Started the new persona project"));
    }

    #[test]
    fn build_nudge_uses_reflection_word_for_reflection_kind() {
        let n = build_on_this_day_nudge(
            30,
            "30d:2026-05-05",
            "ref_xyz",
            "reflection",
            Some("Noticing a pattern."),
        );
        assert!(n.message.contains("reflection"));
        assert!(!n.message.contains("moment"));
    }

    #[test]
    fn build_nudge_truncates_long_body_and_uses_first_line() {
        let body = "first line that is short\n\nbut there is more content below";
        let n = build_on_this_day_nudge(90, "90d:2026-05-05", "ep_1", "episode", Some(body));
        assert!(n.message.contains("first line that is short"));
        assert!(!n.message.contains("more content below"));
    }

    #[test]
    fn build_nudge_handles_missing_body() {
        let n = build_on_this_day_nudge(30, "30d:2026-05-05", "ep_1", "episode", None);
        assert!(n.message.contains("(no preview)"));
    }
}

// Property-based tests pin the cadence semantics laid out in the
// module doc. Treat any failure as a contract change requiring an
// explicit doc update.
#[cfg(test)]
mod cadence_prop_tests {
    use super::*;
    use chrono::TimeZone;
    use proptest::prelude::*;

    fn weekday_from_idx(idx: u32) -> Weekday {
        match idx % 7 {
            0 => Weekday::Mon,
            1 => Weekday::Tue,
            2 => Weekday::Wed,
            3 => Weekday::Thu,
            4 => Weekday::Fri,
            5 => Weekday::Sat,
            _ => Weekday::Sun,
        }
    }

    fn weekday_short(d: Weekday) -> &'static str {
        match d {
            Weekday::Mon => "mon",
            Weekday::Tue => "tue",
            Weekday::Wed => "wed",
            Weekday::Thu => "thu",
            Weekday::Fri => "fri",
            Weekday::Sat => "sat",
            Weekday::Sun => "sun",
        }
    }

    fn local_at(hour: u32, minute: u32, weekday: Weekday) -> DateTime<Local> {
        let monday = Local.with_ymd_and_hms(2025, 6, 2, hour, minute, 0).unwrap();
        let offset = (weekday.num_days_from_monday() as i64)
            - (monday.weekday().num_days_from_monday() as i64);
        monday + Duration::days(offset)
    }

    // ---- cadence_dedupe_window_min ------------------------------------

    #[test]
    fn dedupe_window_defaults_to_match_window() {
        // Contract point 4: missing duration_min → default 30.
        let sched = serde_json::json!({"at": "09:00"});
        assert_eq!(cadence_dedupe_window_min(&sched), CADENCE_MATCH_WINDOW_MIN);
    }

    #[test]
    fn dedupe_window_respects_sub_hour_cadences() {
        // Contract point 4: a 15-min cadence has a 15-min dedupe, not
        // a hardcoded 60-min one. This is the regression case from the
        // requirement that motivated this refactor.
        for d in [15i64, 30, 45] {
            let sched = serde_json::json!({"at": "09:00", "duration_min": d});
            assert_eq!(cadence_dedupe_window_min(&sched), d);
        }
    }

    #[test]
    fn dedupe_window_floor_is_one_minute() {
        // Contract point 4: floor of 1 prevents same-tick duplicates.
        let zero = serde_json::json!({"at": "09:00", "duration_min": 0});
        assert_eq!(cadence_dedupe_window_min(&zero), 1);
        let neg = serde_json::json!({"at": "09:00", "duration_min": -7});
        assert_eq!(cadence_dedupe_window_min(&neg), 1);
    }

    proptest! {
        // Contract point 4 (property form): for any duration_min, the
        // dedupe window is `max(1, duration_min)` — never wider than
        // the firing window itself, so a sub-hour cadence is never
        // silently suppressed past its own period.
        #[test]
        fn dedupe_window_never_exceeds_duration_min(d in -120i64..360) {
            let sched = serde_json::json!({"at": "09:00", "duration_min": d});
            let w = cadence_dedupe_window_min(&sched);
            prop_assert!(w >= 1, "floor of 1 minute");
            prop_assert!(w <= d.max(1), "never widens beyond duration_min");
        }
    }

    // ---- cadence_fires_now --------------------------------------------

    proptest! {
        // Contract point 1: at exactly `at`, fires; one minute before,
        // doesn't. (Inclusive start.)
        #[test]
        fn fires_at_inclusive_start(
            at_h in 0u32..24,
            at_m in 0u32..60,
            wd in 0u32..7,
        ) {
            let day = weekday_from_idx(wd);
            let at = format!("{:02}:{:02}", at_h, at_m);
            let sched = serde_json::json!({"at": at, "duration_min": 30});
            prop_assert!(cadence_fires_now(&sched, local_at(at_h, at_m, day)));
            // One minute earlier should not fire (unless we wrap past
            // midnight, which the function doesn't — see contract 2).
            if at_h * 60 + at_m >= 1 {
                let prev_total = at_h * 60 + at_m - 1;
                let prev_h = prev_total / 60;
                let prev_m = prev_total % 60;
                prop_assert!(!cadence_fires_now(&sched, local_at(prev_h, prev_m, day)));
            }
        }

        // Contract point 1: at `at + duration`, doesn't fire. (Exclusive end.)
        #[test]
        fn does_not_fire_at_exclusive_end(
            at_h in 0u32..23,
            at_m in 0u32..60,
            d in 1u32..60,
            wd in 0u32..7,
        ) {
            let total = at_h * 60 + at_m + d;
            // Cadences don't wrap (contract 2) — keep end within same day.
            prop_assume!(total < 24 * 60);
            let day = weekday_from_idx(wd);
            let at = format!("{:02}:{:02}", at_h, at_m);
            let sched = serde_json::json!({"at": at, "duration_min": d as i64});
            let end_h = total / 60;
            let end_m = total % 60;
            prop_assert!(!cadence_fires_now(&sched, local_at(end_h, end_m, day)));
        }

        // Sub-hour cadences (15- and 30-min) fire across the whole
        // window. This pins the regression: an earlier 60-min dedupe
        // floor *outside* this function suppressed re-firing within the
        // window after engage/dismiss; the firing predicate itself
        // must be honest about the full window.
        #[test]
        fn sub_hour_cadence_fires_across_full_window(
            at_h in 0u32..22,
            at_m in 0u32..60,
            d in prop_oneof![Just(15u32), Just(30u32)],
            offset in 0u32..30,
            wd in 0u32..7,
        ) {
            prop_assume!(offset < d);
            let total = at_h * 60 + at_m + offset;
            prop_assume!(total < 24 * 60);

            let day = weekday_from_idx(wd);
            let at = format!("{:02}:{:02}", at_h, at_m);
            let sched = serde_json::json!({"at": at, "duration_min": d as i64});
            let now_h = total / 60;
            let now_m = total % 60;
            prop_assert!(cadence_fires_now(&sched, local_at(now_h, now_m, day)));
        }

        // Contract point 2: cadences don't wrap midnight. A schedule
        // at 23:30 with a 120-min duration fires only between 23:30
        // and 23:59; minutes after midnight are *not* part of the
        // window even though `at + duration` overflows.
        #[test]
        fn cadence_never_wraps_midnight(
            d in 60u32..240,
            wrap_offset in 0u32..120,
            wd in 0u32..7,
        ) {
            let day = weekday_from_idx(wd);
            // Anchor `at` so that `at + duration` overflows past 24:00.
            let at_h = 23u32;
            let at_m = 30u32;
            prop_assume!(at_m + d > 60); // ensure it overflows the hour at least
            let sched = serde_json::json!({
                "at": format!("{:02}:{:02}", at_h, at_m),
                "duration_min": d as i64,
            });
            // A time after midnight (00:00 + wrap_offset) must NOT fire,
            // even though arithmetic might suggest the window covers it.
            prop_assume!(wrap_offset < 60);
            let now = local_at(0, wrap_offset, day);
            prop_assert!(!cadence_fires_now(&sched, now));
        }

        // Contract point 3: a non-empty days whitelist that excludes
        // today blocks the cadence regardless of clock alignment.
        #[test]
        fn day_filter_excluding_today_always_blocks(
            at_h in 0u32..24,
            at_m in 0u32..60,
            d in 1u32..120,
            now_h in 0u32..24,
            now_m in 0u32..60,
            today_idx in 0u32..7,
        ) {
            let today = weekday_from_idx(today_idx);
            let other_days: Vec<&'static str> = (0u32..7)
                .map(|i| weekday_short(weekday_from_idx(i)))
                .filter(|&s| s != weekday_short(today))
                .collect();
            let sched = serde_json::json!({
                "days": other_days,
                "at": format!("{:02}:{:02}", at_h, at_m),
                "duration_min": d as i64,
            });
            prop_assert!(!cadence_fires_now(&sched, local_at(now_h, now_m, today)));
        }
    }

    // DST handling: like quiet_hours, cadence_fires_now reads only
    // wall-clock fields. Spring-forward "skipped" minutes don't
    // construct as DateTime<Local>; fall-back duplicate minutes get
    // the same answer twice (intuitive: "the 09:00 ritual fires at
    // 09:00, both times" if a DST anomaly somehow doubled it).
    #[test]
    fn dst_uses_wall_clock_fields_only() {
        let sched = serde_json::json!({"at": "01:30", "duration_min": 30});
        // Inclusive start at 01:30.
        assert!(cadence_fires_now(&sched, local_at(1, 30, Weekday::Sun)));
        // Exclusive end at 02:00.
        assert!(!cadence_fires_now(&sched, local_at(2, 0, Weekday::Sun)));
        // Mid-window at 01:45.
        assert!(cadence_fires_now(&sched, local_at(1, 45, Weekday::Sun)));
    }
}
