//! `"HH:MM-HH:MM"` - one parse, three readers.
//!
//! The persona attention loop has quieted itself against this spelling since it
//! shipped, with the parser private inside a 9,000-line subscription file. Two
//! more readers arrived on 2026-09-24 - Curator's tick, which refuses to
//! dispatch inside her window, and `settings_keys::validate_value`, which now
//! refuses a window it cannot read rather than accepting a typo that would
//! silently quiet nothing. `db` cannot reach `app_lib`, so the parser comes
//! down here rather than being spelled a second and third time.
//!
//! This is a MOVE, not a new abstraction: the function below is the attention
//! loop's, verbatim in behaviour, and that loop now calls it here. Nothing in
//! the grammar changed, which is what lets the settings validator promise that
//! anything it accepts is a window the readers will actually honour.
//!
//! **Local time, and deliberately no timezone.** A quiet window is the
//! operator's wall clock on the machine the app is running on; storing an
//! offset would invite a window that means something different from the one
//! they typed.

use std::cmp::Ordering;

/// Lenient `"HH:MM-HH:MM"` -> `(start, end)` minutes-of-day. `None` when the
/// string is not a window at all.
///
/// Lenient in the whitespace and in the leading zero (`" 9:15 - 17:45 "`
/// parses); strict in the ranges, because `25:00` is a typo and reading it as
/// anything would be inventing a window nobody declared.
pub fn parse(spec: &str) -> Option<(u32, u32)> {
    let (start, end) = spec.split_once('-')?;
    Some((parse_hhmm(start.trim())?, parse_hhmm(end.trim())?))
}

fn parse_hhmm(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    let h: u32 = h.trim().parse().ok()?;
    let m: u32 = m.trim().parse().ok()?;
    (h <= 23 && m <= 59).then_some(h * 60 + m)
}

/// Wrap-aware window membership: `22:00-07:00` covers the night across
/// midnight. Equal endpoints are an EMPTY window - `"09:00-09:00"` quiets
/// nothing rather than everything, which is the lenient reading of a window
/// somebody typed by accident.
pub fn contains(now_minute: u32, start: u32, end: u32) -> bool {
    match start.cmp(&end) {
        Ordering::Less => now_minute >= start && now_minute < end,
        Ordering::Greater => now_minute >= start || now_minute < end,
        Ordering::Equal => false,
    }
}

/// Whether `now_minute` falls inside the window `spec` declares.
///
/// `None` is the answer for a spec that is blank or unparseable, and it is
/// deliberately not `false`: a caller that cannot read the window has NOT
/// established that now is outside it, and the two readers want to say so
/// differently - the settings door refuses the value, the tick warns once and
/// carries on. Collapsing them into `false` here is how a brake stops being
/// one without anybody noticing.
pub fn now_is_quiet(spec: &str, now_minute: u32) -> Option<bool> {
    let spec = spec.trim();
    if spec.is_empty() {
        return None;
    }
    let (start, end) = parse(spec)?;
    Some(contains(now_minute, start, end))
}

/// Minutes-of-day on the machine's LOCAL clock.
pub fn local_minute_of_day() -> u32 {
    use chrono::Timelike;
    let now = chrono::Local::now();
    now.hour() * 60 + now.minute()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The grammar, exactly as the attention loop's own fixtures asserted it
    /// before the move. These cases are carried over verbatim so the move
    /// cannot have changed behaviour silently.
    #[test]
    fn the_parse_is_lenient_and_bounded() {
        assert_eq!(parse("22:00-07:00"), Some((22 * 60, 7 * 60)));
        assert_eq!(parse(" 9:15 - 17:45 "), Some((9 * 60 + 15, 17 * 60 + 45)));
        assert_eq!(parse("22:00"), None, "no dash");
        assert_eq!(parse("25:00-07:00"), None, "hour out of range");
        assert_eq!(parse("22:61-07:00"), None, "minute out of range");
        assert_eq!(parse("evening-morning"), None, "prose");
        assert_eq!(parse(""), None);
    }

    #[test]
    fn a_window_wraps_midnight_and_an_empty_one_quiets_nothing() {
        let (s, e) = parse("22:00-07:00").unwrap();
        assert!(contains(23 * 60, s, e), "inside, before midnight");
        assert!(contains(2 * 60, s, e), "inside, after midnight");
        assert!(
            !contains(12 * 60, s, e),
            "the middle of the day is not quiet"
        );
        assert!(contains(22 * 60, s, e), "the start is inside");
        assert!(!contains(7 * 60, s, e), "the end is outside");

        let (s, e) = parse("09:00-17:00").unwrap();
        assert!(contains(12 * 60, s, e));
        assert!(!contains(20 * 60, s, e));

        let (s, e) = parse("09:00-09:00").unwrap();
        assert!(!contains(9 * 60, s, e), "equal endpoints quiet nothing");
    }

    /// The whole point of the three-valued answer: unreadable is not "not
    /// quiet". A caller that could not read the window must be able to say so.
    #[test]
    fn an_unreadable_window_is_none_and_never_false() {
        assert_eq!(now_is_quiet("22:00-07:00", 23 * 60), Some(true));
        assert_eq!(now_is_quiet("22:00-07:00", 12 * 60), Some(false));
        assert_eq!(now_is_quiet("   ", 12 * 60), None, "blank declares none");
        assert_eq!(now_is_quiet("nights", 12 * 60), None, "prose is unreadable");
        assert_eq!(now_is_quiet("22:00", 12 * 60), None, "half a window");
    }

    #[test]
    fn the_local_clock_lands_inside_a_day() {
        assert!(local_minute_of_day() < 24 * 60);
    }
}
