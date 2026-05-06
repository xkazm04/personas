//! Quiet-hours / focus-window check. Reads active rituals and decides
//! if the current local time falls inside any window where Athena
//! shouldn't reach out.
//!
//! Schedule DSL (interpreted here, opaque elsewhere):
//!   - `quiet_hours` and `focus_window`:
//!       { "days": ["mon","tue",...], "from": "22:00", "to": "07:00" }
//!     `days` is optional (defaults to all). `to < from` means the
//!     window crosses midnight (the canonical sleep case).
//!   - `cadence`: not a quiet window — ignored here (it's a *trigger*
//!     in `triggers.rs`, not a guardrail).
//!
//! Times are local. We use the system's local timezone via chrono
//! `Local` rather than UTC because "evenings" mean different things in
//! different timezones, and the user is in one place.
//!
//! ## Window semantics — pinned by property tests in `prop_tests`
//!
//! These are the *contract*. Property tests in this file enforce them;
//! changing one means updating both the comment and the test.
//!
//!   1. **`from` is inclusive, `to` is exclusive.** A window
//!      `09:00 → 17:00` matches the minute that begins at 09:00 but
//!      not the minute that begins at 17:00. The comparison is at
//!      minute granularity (seconds are zeroed).
//!
//!   2. **`from == to` is a zero-length window — never quiet.** It is
//!      *not* interpreted as "all day." A user who wants a whole-day
//!      quiet block should use `00:00 → 23:59` (plus a `days` filter
//!      if needed) so the meaning of equal endpoints stays unambiguous.
//!      The alternative ("equal endpoints means everything") was
//!      rejected because the most common cause of equal endpoints is
//!      a UI bug or partially-edited config — silently turning that
//!      into 24-hour silence would be a worse failure mode than
//!      silently turning it into no-op.
//!
//!   3. **`from > to` crosses midnight.** Window is
//!      `[from, 24:00) ∪ [00:00, to)` — i.e. the complement of
//!      the same-day interpretation, with the same inclusive/exclusive
//!      rule preserved.
//!
//!   4. **Days filter (`days: [...]`) is a whitelist.** When present,
//!      the current weekday must appear; when absent, every weekday
//!      qualifies. An empty array → never matches, by the same logic
//!      as point 2 (don't silently turn malformed config into "always").
//!
//!   5. **DST is wall-clock only.** The function reads `weekday`,
//!      `hour`, `minute` from the supplied `DateTime<Local>` and
//!      ignores the underlying instant. On spring-forward days, the
//!      "skipped" wall-clock minutes (e.g. 02:30 in US Eastern)
//!      simply never reach the function — they correspond to no
//!      `DateTime<Local>`. On fall-back days, the duplicated minutes
//!      (e.g. 01:30 occurring twice) match the window twice, which
//!      is the intuitive answer ("01:30 is quiet, both times").

use chrono::{Datelike, Local, NaiveTime, Timelike, Weekday};
use serde_json::Value;

use crate::companion::brain::rituals;
use crate::db::UserDbPool;
use crate::error::AppError;

pub fn is_quiet_now(pool: &UserDbPool) -> Result<bool, AppError> {
    let active = rituals::list_rituals(pool, None, true).unwrap_or_default();
    let now = Local::now();
    for r in active {
        if r.kind != "quiet_hours" && r.kind != "focus_window" {
            continue;
        }
        let parsed: Value = match serde_json::from_str(&r.schedule_json) {
            Ok(v) => v,
            Err(_) => continue, // ignore malformed schedules
        };
        if window_contains(&parsed, now) {
            return Ok(true);
        }
    }
    Ok(false)
}

fn window_contains(schedule: &Value, now: chrono::DateTime<Local>) -> bool {
    let from = match schedule
        .get("from")
        .and_then(|v| v.as_str())
        .and_then(parse_hhmm)
    {
        Some(t) => t,
        None => return false,
    };
    let to = match schedule
        .get("to")
        .and_then(|v| v.as_str())
        .and_then(parse_hhmm)
    {
        Some(t) => t,
        None => return false,
    };

    // `days` is optional. When present, current weekday must match.
    if let Some(days) = schedule.get("days").and_then(|v| v.as_array()) {
        let today = weekday_short(now.weekday());
        let matches = days.iter().any(|d| {
            d.as_str()
                .map(|s| s.eq_ignore_ascii_case(today))
                .unwrap_or(false)
        });
        if !matches {
            return false;
        }
    }

    let now_t = NaiveTime::from_hms_opt(now.hour(), now.minute(), 0).unwrap_or_default();
    if from <= to {
        // Same-day window: 09:00 → 17:00.
        now_t >= from && now_t < to
    } else {
        // Crosses midnight: 22:00 → 07:00.
        now_t >= from || now_t < to
    }
}

fn parse_hhmm(s: &str) -> Option<NaiveTime> {
    NaiveTime::parse_from_str(s, "%H:%M").ok()
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn local_at(hour: u32, minute: u32, weekday: Weekday) -> chrono::DateTime<Local> {
        // Build a Local datetime at the specified weekday + time.
        // We anchor on a known Monday and add days; this avoids using
        // Local::now() which would couple the test to wall-clock state.
        let monday = Local.with_ymd_and_hms(2025, 6, 2, hour, minute, 0).unwrap();
        let offset = (weekday.num_days_from_monday() as i64)
            - (monday.weekday().num_days_from_monday() as i64);
        monday + chrono::Duration::days(offset)
    }

    #[test]
    fn matches_simple_evening_window() {
        let sched = serde_json::json!({"from": "18:00", "to": "23:00"});
        assert!(window_contains(&sched, local_at(20, 0, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(17, 0, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(23, 30, Weekday::Wed)));
    }

    #[test]
    fn matches_midnight_crossing_window() {
        let sched = serde_json::json!({"from": "22:00", "to": "07:00"});
        assert!(window_contains(&sched, local_at(23, 0, Weekday::Wed)));
        assert!(window_contains(&sched, local_at(2, 0, Weekday::Wed)));
        assert!(window_contains(&sched, local_at(6, 30, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(7, 30, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(20, 0, Weekday::Wed)));
    }

    #[test]
    fn respects_days_filter() {
        let sched = serde_json::json!({
            "days": ["mon","tue","wed","thu","fri"],
            "from": "22:00", "to": "07:00"
        });
        assert!(window_contains(&sched, local_at(23, 0, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(23, 0, Weekday::Sat)));
    }

    #[test]
    fn from_eq_to_is_zero_length() {
        // Contract point 2: `from == to` is never inside the window.
        let sched = serde_json::json!({"from": "09:00", "to": "09:00"});
        assert!(!window_contains(&sched, local_at(8, 59, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(9, 0, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(9, 1, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(0, 0, Weekday::Wed)));
        assert!(!window_contains(&sched, local_at(23, 59, Weekday::Wed)));
    }

    #[test]
    fn empty_days_array_blocks_all_days() {
        // Contract point 4: empty whitelist → never matches.
        let sched = serde_json::json!({
            "days": [],
            "from": "00:00", "to": "23:59",
        });
        for w in [
            Weekday::Mon,
            Weekday::Tue,
            Weekday::Wed,
            Weekday::Thu,
            Weekday::Fri,
            Weekday::Sat,
            Weekday::Sun,
        ] {
            assert!(!window_contains(&sched, local_at(12, 0, w)));
        }
    }

    #[test]
    fn dst_uses_wall_clock_fields_only() {
        // Contract point 5: only weekday/hour/minute are read.
        // 02:30 sits at the DST boundary in many timezones, but the
        // function neither knows nor cares — it just reads the field.
        let sched = serde_json::json!({"from": "00:30", "to": "02:30"});
        assert!(window_contains(&sched, local_at(0, 30, Weekday::Sun))); // inclusive start
        assert!(window_contains(&sched, local_at(1, 30, Weekday::Sun))); // mid-window
        assert!(!window_contains(&sched, local_at(2, 30, Weekday::Sun))); // exclusive end
    }
}

// Property-based tests pin the contract laid out in the module doc
// comment. Treat any failure here as a contract change requiring an
// explicit update to both the doc and the test — these are the only
// place the semantics are written down once and checked everywhere.
#[cfg(test)]
mod prop_tests {
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

    fn local_at(hour: u32, minute: u32, weekday: Weekday) -> chrono::DateTime<Local> {
        let monday = Local.with_ymd_and_hms(2025, 6, 2, hour, minute, 0).unwrap();
        let offset = (weekday.num_days_from_monday() as i64)
            - (monday.weekday().num_days_from_monday() as i64);
        monday + chrono::Duration::days(offset)
    }

    proptest! {
        // Contract point 2: `from == to` → zero-length window. Holds for
        // every (from, now, weekday) triple, including the boundary minute.
        #[test]
        fn from_eq_to_is_never_quiet(
            t_h in 0u32..24,
            t_m in 0u32..60,
            now_h in 0u32..24,
            now_m in 0u32..60,
            wd in 0u32..7,
        ) {
            let stamp = format!("{:02}:{:02}", t_h, t_m);
            let sched = serde_json::json!({"from": stamp, "to": stamp});
            let now = local_at(now_h, now_m, weekday_from_idx(wd));
            prop_assert!(!window_contains(&sched, now));
        }

        // Contract point 1: at the inclusive `from` boundary, the window
        // is active; at the exclusive `to` boundary it is not. Tested for
        // same-day windows (from < to) only — the wrap branch is covered
        // separately.
        #[test]
        fn boundary_inclusion_same_day(
            from_h in 0u32..24,
            from_m in 0u32..60,
            to_h in 0u32..24,
            to_m in 0u32..60,
            wd in 0u32..7,
        ) {
            let from_min = from_h * 60 + from_m;
            let to_min = to_h * 60 + to_m;
            prop_assume!(from_min < to_min);

            let from_str = format!("{:02}:{:02}", from_h, from_m);
            let to_str = format!("{:02}:{:02}", to_h, to_m);
            let sched = serde_json::json!({"from": from_str, "to": to_str});
            let day = weekday_from_idx(wd);

            prop_assert!(
                window_contains(&sched, local_at(from_h, from_m, day)),
                "from boundary should be inclusive"
            );
            prop_assert!(
                !window_contains(&sched, local_at(to_h, to_m, day)),
                "to boundary should be exclusive"
            );
        }

        // Contract point 3: `from > to` is the complement (modulo
        // boundaries) of `from < to`. For every clock minute that's not
        // equal to either endpoint, exactly one of (same-day, wrapped)
        // contains it.
        #[test]
        fn wrap_inverts_membership_on_interior_points(
            a_h in 0u32..24,
            a_m in 0u32..60,
            b_h in 0u32..24,
            b_m in 0u32..60,
            now_h in 0u32..24,
            now_m in 0u32..60,
            wd in 0u32..7,
        ) {
            let a_min = a_h * 60 + a_m;
            let b_min = b_h * 60 + b_m;
            let now_min = now_h * 60 + now_m;
            prop_assume!(a_min != b_min);
            prop_assume!(now_min != a_min && now_min != b_min);

            let a = format!("{:02}:{:02}", a_h, a_m);
            let b = format!("{:02}:{:02}", b_h, b_m);
            let same_day = serde_json::json!({"from": a, "to": b});
            let wrapped = serde_json::json!({"from": b, "to": a});
            let now = local_at(now_h, now_m, weekday_from_idx(wd));
            prop_assert_ne!(
                window_contains(&same_day, now),
                window_contains(&wrapped, now)
            );
        }

        // Contract point 4: a non-empty days whitelist that excludes
        // today blocks the window for the entire day, regardless of
        // from/to or now-time.
        #[test]
        fn days_filter_excluding_today_always_blocks(
            from_h in 0u32..24,
            from_m in 0u32..60,
            to_h in 0u32..24,
            to_m in 0u32..60,
            now_h in 0u32..24,
            now_m in 0u32..60,
            today_idx in 0u32..7,
        ) {
            let today = weekday_from_idx(today_idx);
            let today_label = weekday_short(today);
            let other_days: Vec<&'static str> = (0u32..7)
                .map(|i| weekday_short(weekday_from_idx(i)))
                .filter(|&s| s != today_label)
                .collect();
            let sched = serde_json::json!({
                "days": other_days,
                "from": format!("{:02}:{:02}", from_h, from_m),
                "to": format!("{:02}:{:02}", to_h, to_m),
            });
            let now = local_at(now_h, now_m, today);
            prop_assert!(!window_contains(&sched, now));
        }

        // Sanity: changing `days` to include today never narrows the
        // window relative to an unfiltered schedule with the same
        // from/to. (i.e. the days filter is monotone — adding the
        // current day cannot turn a "yes" into a "no.")
        #[test]
        fn days_filter_with_today_matches_unfiltered(
            from_h in 0u32..24,
            from_m in 0u32..60,
            to_h in 0u32..24,
            to_m in 0u32..60,
            now_h in 0u32..24,
            now_m in 0u32..60,
            wd in 0u32..7,
        ) {
            let today = weekday_from_idx(wd);
            let from_str = format!("{:02}:{:02}", from_h, from_m);
            let to_str = format!("{:02}:{:02}", to_h, to_m);
            let unfiltered = serde_json::json!({"from": &from_str, "to": &to_str});
            let with_today = serde_json::json!({
                "days": [weekday_short(today)],
                "from": from_str,
                "to": to_str,
            });
            let now = local_at(now_h, now_m, today);
            prop_assert_eq!(
                window_contains(&unfiltered, now),
                window_contains(&with_today, now)
            );
        }
    }
}
