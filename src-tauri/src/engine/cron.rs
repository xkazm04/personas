use chrono::{DateTime, Datelike, Timelike, Utc, Duration};

/// Parsed cron schedule (5-field standard cron) using bitfield matching.
///
/// Each field stores a bitmask where bit N indicates value N is active.
/// Matching is O(1) per field — a single bitwise AND instead of Vec::contains.
#[derive(Debug, Clone)]
pub struct CronSchedule {
    /// Bitmask for minutes 0–59 (bits 0..60 of u64)
    pub minutes: u64,
    /// Bitmask for hours 0–23 (bits 0..24 of u32)
    pub hours: u32,
    /// Bitmask for days of month 1–31 (bits 1..32 of u32)
    pub days_of_month: u32,
    /// Bitmask for months 1–12 (bits 1..13 of u16)
    pub months: u16,
    /// Bitmask for days of week 0–6 (bits 0..7 of u8)
    pub days_of_week: u8,
}

impl CronSchedule {
    /// Check if a value is set in the minutes bitfield.
    pub fn has_minute(&self, v: u32) -> bool {
        v < 64 && (self.minutes & (1u64 << v)) != 0
    }

    /// Check if a value is set in the hours bitfield.
    pub fn has_hour(&self, v: u32) -> bool {
        v < 32 && (self.hours & (1u32 << v)) != 0
    }

    /// Check if a value is set in the days_of_month bitfield.
    pub fn has_day_of_month(&self, v: u32) -> bool {
        v < 32 && (self.days_of_month & (1u32 << v)) != 0
    }

    /// Check if a value is set in the months bitfield.
    pub fn has_month(&self, v: u32) -> bool {
        v < 16 && (self.months & (1u16 << v)) != 0
    }

    /// Check if a value is set in the days_of_week bitfield.
    pub fn has_day_of_week(&self, v: u32) -> bool {
        v < 8 && (self.days_of_week & (1u8 << v)) != 0
    }

    #[allow(dead_code)]
    /// Count how many values are set in the minutes bitfield.
    pub fn minutes_count(&self) -> u32 {
        self.minutes.count_ones()
    }

    #[allow(dead_code)]
    /// Count how many values are set in the hours bitfield.
    pub fn hours_count(&self) -> u32 {
        self.hours.count_ones()
    }

    #[allow(dead_code)]
    /// Count how many values are set in the days_of_month bitfield.
    pub fn days_of_month_count(&self) -> u32 {
        self.days_of_month.count_ones()
    }

    #[allow(dead_code)]
    /// Count how many values are set in the months bitfield.
    pub fn months_count(&self) -> u32 {
        self.months.count_ones()
    }

    #[allow(dead_code)]
    /// Count how many values are set in the days_of_week bitfield.
    pub fn days_of_week_count(&self) -> u32 {
        self.days_of_week.count_ones()
    }
}

/// Parse a 5-field cron expression. Returns Err on invalid input.
pub fn parse_cron(expr: &str) -> Result<CronSchedule, String> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(format!("Expected 5 fields, got {}", fields.len()));
    }
    Ok(CronSchedule {
        minutes: parse_field(fields[0], 0, 59)?,
        hours: parse_field(fields[1], 0, 23)? as u32,
        days_of_month: parse_field(fields[2], 1, 31)? as u32,
        months: parse_field(fields[3], 1, 12)? as u16,
        days_of_week: parse_field(fields[4], 0, 6)? as u8,
    })
}

/// Parse a single cron field into a bitmask. Supports *, */N, N, N-M, N,M,P and combinations.
fn parse_field(field: &str, min: u32, max: u32) -> Result<u64, String> {
    let mut bits: u64 = 0;
    for part in field.split(',') {
        let part = part.trim();
        if part.contains('/') {
            let pieces: Vec<&str> = part.splitn(2, '/').collect();
            let step: u32 = pieces[1]
                .parse()
                .map_err(|_| format!("Invalid step: {}", pieces[1]))?;
            if step == 0 {
                return Err("Step cannot be zero".into());
            }
            let (range_min, range_max) = if pieces[0] == "*" {
                (min, max)
            } else if pieces[0].contains('-') {
                parse_range_bounds(pieces[0], min, max)?
            } else {
                let start: u32 = pieces[0]
                    .parse()
                    .map_err(|_| format!("Invalid value: {}", pieces[0]))?;
                (start, max)
            };
            let mut v = range_min;
            while v <= range_max {
                bits |= 1u64 << v;
                v += step;
            }
        } else if part.contains('-') {
            let (lo, hi) = parse_range_bounds(part, min, max)?;
            for v in lo..=hi {
                bits |= 1u64 << v;
            }
        } else if part == "*" {
            for v in min..=max {
                bits |= 1u64 << v;
            }
        } else {
            let v: u32 = part
                .parse()
                .map_err(|_| format!("Invalid value: {part}"))?;
            if v < min || v > max {
                return Err(format!("Value {v} out of range {min}-{max}"));
            }
            bits |= 1u64 << v;
        }
    }
    if bits == 0 {
        return Err("Empty field".into());
    }
    Ok(bits)
}

fn parse_range_bounds(s: &str, min: u32, max: u32) -> Result<(u32, u32), String> {
    let pieces: Vec<&str> = s.splitn(2, '-').collect();
    let lo: u32 = pieces[0]
        .parse()
        .map_err(|_| format!("Invalid range start: {}", pieces[0]))?;
    let hi: u32 = pieces[1]
        .parse()
        .map_err(|_| format!("Invalid range end: {}", pieces[1]))?;
    if lo < min || hi > max || lo > hi {
        return Err(format!(
            "Range {lo}-{hi} out of bounds {min}-{max}"
        ));
    }
    Ok((lo, hi))
}

/// Bitmask for days_of_month when all 1–31 are set (wildcard).
const DOM_WILDCARD: u32 = 0xFFFF_FFFE; // bits 1..=31
/// Bitmask for days_of_week when all 0–6 are set (wildcard).
const DOW_WILDCARD: u8 = 0x7F; // bits 0..=6

/// Check whether the day component matches, applying POSIX cron semantics:
/// when both day_of_month and day_of_week are restricted (non-wildcard),
/// fire if EITHER matches (OR). When only one is restricted, just that one
/// is checked. When both are wildcard, every day matches.
fn day_matches(schedule: &CronSchedule, day: u32, weekday: u32) -> bool {
    let dom_restricted = schedule.days_of_month != DOM_WILDCARD;
    let dow_restricted = schedule.days_of_week != DOW_WILDCARD;

    match (dom_restricted, dow_restricted) {
        (true, true) => schedule.has_day_of_month(day) || schedule.has_day_of_week(weekday),
        (true, false) => schedule.has_day_of_month(day),
        (false, true) => schedule.has_day_of_week(weekday),
        (false, false) => true,
    }
}

/// Check if a datetime matches the schedule.
fn matches(schedule: &CronSchedule, dt: &DateTime<Utc>) -> bool {
    let minute = dt.minute();
    let hour = dt.hour();
    let day = dt.day();
    let month = dt.month();
    let weekday = dt.weekday().num_days_from_sunday(); // 0=Sun

    schedule.has_minute(minute)
        && schedule.has_hour(hour)
        && schedule.has_month(month)
        && day_matches(schedule, day, weekday)
}

/// Compute the next fire time strictly after `from`.
/// Returns None if no valid time found within 4 years (safety limit).
pub fn next_fire_time(schedule: &CronSchedule, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let start = from
        .with_second(0)
        .unwrap()
        .with_nanosecond(0)
        .unwrap()
        + Duration::minutes(1);

    let max_iterations = 4 * 366 * 24 * 60; // ~4 years of minutes
    let mut current = start;

    for _ in 0..max_iterations {
        if matches(schedule, &current) {
            return Some(current);
        }

        // Optimization: skip ahead when possible
        if !schedule.has_month(current.month()) {
            let next_month = if current.month() == 12 {
                current
                    .with_year(current.year() + 1)
                    .unwrap()
                    .with_month(1)
                    .unwrap()
                    .with_day(1)
                    .unwrap()
            } else {
                current
                    .with_month(current.month() + 1)
                    .unwrap()
                    .with_day(1)
                    .unwrap()
            };
            current = next_month.with_hour(0).unwrap().with_minute(0).unwrap();
            continue;
        }

        if !day_matches(schedule, current.day(), current.weekday().num_days_from_sunday()) {
            current = (current + Duration::days(1))
                .with_hour(0)
                .unwrap()
                .with_minute(0)
                .unwrap();
            continue;
        }

        if !schedule.has_hour(current.hour()) {
            current = (current + Duration::hours(1)).with_minute(0).unwrap();
            continue;
        }

        current += Duration::minutes(1);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_parse_star() {
        let s = parse_cron("* * * * *").unwrap();
        assert_eq!(s.minutes_count(), 60);
        assert_eq!(s.hours_count(), 24);
        assert_eq!(s.days_of_month_count(), 31);
        assert_eq!(s.months_count(), 12);
        assert_eq!(s.days_of_week_count(), 7);
    }

    #[test]
    fn test_parse_step() {
        let s = parse_cron("*/15 * * * *").unwrap();
        assert!(s.has_minute(0));
        assert!(s.has_minute(15));
        assert!(s.has_minute(30));
        assert!(s.has_minute(45));
        assert_eq!(s.minutes_count(), 4);
    }

    #[test]
    fn test_parse_range() {
        let s = parse_cron("* * * * 1-5").unwrap();
        for d in 1..=5 {
            assert!(s.has_day_of_week(d));
        }
        assert!(!s.has_day_of_week(0));
        assert!(!s.has_day_of_week(6));
    }

    #[test]
    fn test_parse_list() {
        let s = parse_cron("1,15,30 * * * *").unwrap();
        assert!(s.has_minute(1));
        assert!(s.has_minute(15));
        assert!(s.has_minute(30));
        assert_eq!(s.minutes_count(), 3);
    }

    #[test]
    fn test_parse_combined() {
        let s = parse_cron("1-5,10,*/20 * * * *").unwrap();
        assert!(s.has_minute(1));
        assert!(s.has_minute(5));
        assert!(s.has_minute(10));
        assert!(s.has_minute(20));
        assert!(s.has_minute(40));
    }

    #[test]
    fn test_parse_invalid_field() {
        assert!(parse_cron("60 * * * *").is_err());
    }

    #[test]
    fn test_parse_invalid_expr() {
        assert!(parse_cron("* * *").is_err());
    }

    #[test]
    fn test_next_fire_every_minute() {
        let s = parse_cron("* * * * *").unwrap();
        let from = Utc.with_ymd_and_hms(2026, 1, 15, 10, 30, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 15, 10, 31, 0).unwrap());
    }

    #[test]
    fn test_next_fire_hourly() {
        let s = parse_cron("0 * * * *").unwrap();
        let from = Utc.with_ymd_and_hms(2026, 1, 15, 10, 30, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 15, 11, 0, 0).unwrap());
    }

    #[test]
    fn test_next_fire_daily() {
        let s = parse_cron("0 9 * * *").unwrap();
        let from = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 16, 9, 0, 0).unwrap());
    }

    #[test]
    fn test_next_fire_specific_dow() {
        // Monday = 1
        let s = parse_cron("0 9 * * 1").unwrap();
        // 2026-01-15 is a Thursday
        let from = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        // Next Monday is Jan 19
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 19, 9, 0, 0).unwrap());
    }

    #[test]
    fn test_next_fire_monthly() {
        let s = parse_cron("0 0 1 * *").unwrap();
        let from = Utc.with_ymd_and_hms(2026, 1, 15, 0, 0, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 2, 1, 0, 0, 0).unwrap());
    }

    #[test]
    fn test_bitfield_matching_is_correct() {
        let s = parse_cron("30 12 15 6 *").unwrap();
        // June 15 at 12:30
        let dt = Utc.with_ymd_and_hms(2026, 6, 15, 12, 30, 0).unwrap();
        assert!(matches(&s, &dt));
        // Wrong minute
        let dt2 = Utc.with_ymd_and_hms(2026, 6, 15, 12, 31, 0).unwrap();
        assert!(!matches(&s, &dt2));
    }

    // -- POSIX OR semantics for day_of_month + day_of_week ----------------------

    #[test]
    fn test_posix_or_dom_and_dow_both_restricted() {
        // "0 9 15 * 1" = 9am on the 15th OR every Monday (POSIX OR)
        let s = parse_cron("0 9 15 * 1").unwrap();

        // 2026-01-15 is a Thursday — matches on day_of_month (15th)
        let thu_15 = Utc.with_ymd_and_hms(2026, 1, 15, 9, 0, 0).unwrap();
        assert!(matches(&s, &thu_15), "should match: 15th (dom), even though not Monday");

        // 2026-01-19 is a Monday (day 19) — matches on day_of_week
        let mon_19 = Utc.with_ymd_and_hms(2026, 1, 19, 9, 0, 0).unwrap();
        assert!(matches(&s, &mon_19), "should match: Monday (dow), even though not 15th");

        // 2026-01-16 is a Friday, not 15th nor Monday — no match
        let fri_16 = Utc.with_ymd_and_hms(2026, 1, 16, 9, 0, 0).unwrap();
        assert!(!matches(&s, &fri_16), "should NOT match: neither 15th nor Monday");
    }

    #[test]
    fn test_posix_or_next_fire_dom_and_dow() {
        // "0 9 15 * 1" — should fire on the 15th OR Mondays
        let s = parse_cron("0 9 15 * 1").unwrap();
        // Start on 2026-01-15 (Thursday) at 10:00 — already past 9am
        let from = Utc.with_ymd_and_hms(2026, 1, 15, 10, 0, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        // Next Monday is Jan 19, which comes before Feb 15
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 19, 9, 0, 0).unwrap());
    }

    #[test]
    fn test_dom_only_restricted_uses_dom() {
        // "0 9 15 * *" — day_of_week is wildcard, only dom matters
        let s = parse_cron("0 9 15 * *").unwrap();
        let dt = Utc.with_ymd_and_hms(2026, 1, 15, 9, 0, 0).unwrap();
        assert!(matches(&s, &dt));
        let dt2 = Utc.with_ymd_and_hms(2026, 1, 16, 9, 0, 0).unwrap();
        assert!(!matches(&s, &dt2));
    }

    #[test]
    fn test_dow_only_restricted_uses_dow() {
        // "0 9 * * 1" — day_of_month is wildcard, only dow matters
        let s = parse_cron("0 9 * * 1").unwrap();
        // 2026-01-19 is Monday
        let mon = Utc.with_ymd_and_hms(2026, 1, 19, 9, 0, 0).unwrap();
        assert!(matches(&s, &mon));
        // 2026-01-20 is Tuesday
        let tue = Utc.with_ymd_and_hms(2026, 1, 20, 9, 0, 0).unwrap();
        assert!(!matches(&s, &tue));
    }

    #[test]
    fn test_posix_or_weekdays_and_1st_15th() {
        // "0 9 1,15 * 1-5" — 9am on 1st/15th OR weekdays
        let s = parse_cron("0 9 1,15 * 1-5").unwrap();
        // 2026-01-04 is a Sunday, day 4 — not 1st/15th, not weekday
        let sun = Utc.with_ymd_and_hms(2026, 1, 4, 9, 0, 0).unwrap();
        assert!(!matches(&s, &sun));
        // 2026-01-06 is Monday, day 6 — weekday match
        let mon = Utc.with_ymd_and_hms(2026, 1, 6, 9, 0, 0).unwrap();
        assert!(matches(&s, &mon));
        // 2026-02-01 is Sunday, day 1 — dom match (1st)
        let sun_1st = Utc.with_ymd_and_hms(2026, 2, 1, 9, 0, 0).unwrap();
        assert!(matches(&s, &sun_1st));
    }
}
