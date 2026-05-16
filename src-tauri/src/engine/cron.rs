use chrono::{DateTime, Datelike, Duration, Local, TimeZone, Timelike, Utc};
use chrono_tz::Tz;

/// Minimum allowed interval between two fires for a cron expression.
/// The current parser only accepts 5-field cron, so minute-level cadence is
/// the lower bound.
pub const MIN_CRON_INTERVAL_SECONDS: i64 = 60;

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
}

/// Parse a 5-field cron expression. Returns Err on invalid input.
///
/// Jenkins-style `H` tokens are accepted and expanded with a zero seed before
/// parsing — every persona resolves to the same offset, which defeats the
/// thundering-herd protection. Runtime call sites with a persona/trigger
/// identifier should call [`parse_cron_seeded`] instead; this entry point is
/// reserved for syntax validation and previews that have no per-persona
/// context.
pub fn parse_cron(expr: &str) -> Result<CronSchedule, String> {
    parse_cron_seeded(expr, 0)
}

/// Parse a 5-field cron expression with a deterministic seed for Jenkins-style
/// `H` token expansion. The seed is hashed into each `H` token's allowed range
/// so two personas with the same cron string receive different fire offsets,
/// spreading load away from `:00`-of-the-hour pile-ups.
///
/// Pass [`seed_hash`] of a stable identifier (typically `trigger.id`,
/// `persona.id`, or `credential.id`) so the same persona always lands on the
/// same minute. Seeds of zero collapse all `H` tokens to their range minimum.
pub fn parse_cron_seeded(expr: &str, seed: u64) -> Result<CronSchedule, String> {
    let expanded = expand_h_tokens(expr, seed)?;
    let fields: Vec<&str> = expanded.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(format!("Expected 5 fields, got {}", fields.len()));
    }
    let schedule = CronSchedule {
        minutes: parse_field(fields[0], 0, 59)?,
        hours: parse_field(fields[1], 0, 23)? as u32,
        days_of_month: parse_field(fields[2], 1, 31)? as u32,
        months: parse_field(fields[3], 1, 12)? as u16,
        days_of_week: parse_field(fields[4], 0, 6)? as u8,
    };
    validate_min_interval(&schedule, MIN_CRON_INTERVAL_SECONDS)?;
    Ok(schedule)
}

/// FNV-1a 64-bit hash for converting an opaque string identifier (persona id,
/// trigger id, credential id, ...) into a seed for [`parse_cron_seeded`].
/// Stable across runs and platforms — the same id always produces the same
/// schedule.
pub fn seed_hash(s: &str) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= u64::from(*b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// Expand Jenkins-style `H` tokens in a 5-field cron expression into concrete
/// values derived from `seed`. The output is a plain cron expression that
/// [`parse_cron`]'s grammar already accepts; passes through unchanged when no
/// `H` appears.
///
/// Grammar accepted inside any single comma-separated part of a field:
///
/// - `H` — hashed value in `[field_min, field_max]`
/// - `H/N` — hash an offset in `[0, min(N, field_max-field_min+1)-1]`, then
///   render `offset, offset+N, offset+2N, …` clipped to the field range
/// - `H(lo-hi)` — hashed value in `[lo, hi]`
/// - `H(lo-hi)/N` — hashed offset in `[lo, lo + min(N, hi-lo+1) - 1]`, then
///   stepped by N up to `hi`
///
/// Each field is salted with its position index so `H H * * *` does not put
/// minute and hour on the same value. Each comma-separated part is further
/// salted with its part index so `H,H * * * *` produces two distinct minutes.
pub fn expand_h_tokens(expr: &str, seed: u64) -> Result<String, String> {
    // Cheap pre-check: nothing to do if the expression has no H tokens.
    if !expr.contains('H') {
        return Ok(expr.to_string());
    }
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        // Defer the "wrong field count" error to parse_cron so the user-facing
        // message stays consistent.
        return Ok(expr.to_string());
    }
    let ranges: [(u32, u32); 5] = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)];
    let mut out: Vec<String> = Vec::with_capacity(5);
    for (idx, (field, &(lo, hi))) in fields.iter().zip(ranges.iter()).enumerate() {
        // Mix the field index into the seed so each field hashes independently.
        let field_seed = seed.wrapping_add((idx as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        out.push(expand_h_field(field, lo, hi, field_seed)?);
    }
    Ok(out.join(" "))
}

fn expand_h_field(field: &str, fmin: u32, fmax: u32, seed: u64) -> Result<String, String> {
    if !field.contains('H') {
        return Ok(field.to_string());
    }
    let mut parts_out: Vec<String> = Vec::new();
    for (part_idx, part) in field.split(',').enumerate() {
        let trimmed = part.trim();
        let part_seed =
            seed.wrapping_add((part_idx as u64).wrapping_mul(0x517C_C1B7_2722_0A95));
        parts_out.push(expand_h_part(trimmed, fmin, fmax, part_seed)?);
    }
    Ok(parts_out.join(","))
}

fn expand_h_part(part: &str, fmin: u32, fmax: u32, seed: u64) -> Result<String, String> {
    if !part.contains('H') {
        return Ok(part.to_string());
    }
    let (left, step) = match part.split_once('/') {
        Some((l, r)) => {
            let n: u32 = r
                .trim()
                .parse()
                .map_err(|_| format!("Invalid H step: {r}"))?;
            (l.trim(), Some(n))
        }
        None => (part, None),
    };

    if !left.starts_with('H') {
        // `H` only appears on the right of the slash — e.g. `*/H` is not
        // supported. Surface a clear error rather than silently passing the
        // raw text to parse_cron (which would also fail, less helpfully).
        return Err(format!("Invalid H token: {part}"));
    }

    let suffix = &left[1..];
    let (lo, hi) = if suffix.is_empty() {
        (fmin, fmax)
    } else if suffix.starts_with('(') && suffix.ends_with(')') && suffix.len() >= 3 {
        let inside = &suffix[1..suffix.len() - 1];
        let (a, b) = inside
            .split_once('-')
            .ok_or_else(|| format!("Invalid H range: {inside}"))?;
        let a: u32 = a
            .trim()
            .parse()
            .map_err(|_| format!("Invalid H range start: {a}"))?;
        let b: u32 = b
            .trim()
            .parse()
            .map_err(|_| format!("Invalid H range end: {b}"))?;
        if a < fmin || b > fmax || a > b {
            return Err(format!(
                "H range {a}-{b} out of bounds {fmin}-{fmax}"
            ));
        }
        (a, b)
    } else {
        return Err(format!("Invalid H token: {part}"));
    };

    let span = hi - lo + 1;
    match step {
        None => {
            let v = lo + ((seed % span as u64) as u32);
            Ok(v.to_string())
        }
        Some(n) => {
            if n == 0 {
                return Err("Step cannot be zero".into());
            }
            // Hash offset into [0, min(step, span)-1] so distinct seeds spread
            // evenly when step < span. When step >= span there is only one
            // bucket, so all seeds collapse to a single value — which is the
            // intended Jenkins behaviour.
            let bucket = u64::from(n.min(span));
            let offset = (seed % bucket) as u32;
            let start = lo + offset;
            let mut values: Vec<String> = Vec::new();
            let mut v = start;
            while v <= hi {
                values.push(v.to_string());
                match v.checked_add(n) {
                    Some(next) => v = next,
                    None => break,
                }
            }
            Ok(values.join(","))
        }
    }
}

fn validate_min_interval(schedule: &CronSchedule, min_seconds: i64) -> Result<(), String> {
    let minute_count = schedule.minutes.count_ones();
    if min_seconds <= 60 || minute_count <= 1 {
        return Ok(());
    }

    let mut previous: Option<u32> = None;
    let mut first: Option<u32> = None;
    let mut min_gap = 60;
    for minute in 0..60 {
        if schedule.has_minute(minute) {
            if first.is_none() {
                first = Some(minute);
            }
            if let Some(prev) = previous {
                min_gap = min_gap.min(minute - prev);
            }
            previous = Some(minute);
        }
    }
    if let (Some(first), Some(last)) = (first, previous) {
        min_gap = min_gap.min(60 - last + first);
    }
    let min_gap_seconds = i64::from(min_gap) * 60;
    if min_gap_seconds < min_seconds {
        return Err(format!(
            "Cron expression fires every {min_gap_seconds}s; minimum is {min_seconds}s"
        ));
    }
    Ok(())
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
            // Reject pathological steps that exceed the range span. Without
            // this guard, a step like `0/4294967295` survives validation and
            // its `v += step` increment silently wraps u32 in release builds,
            // pegging the scheduler thread in an infinite loop. The legal
            // upper bound for a step is the field's range span — anything
            // larger only ever fires the first value, which authors should
            // express as a literal instead.
            let span = range_max - range_min;
            if step > span && span > 0 {
                return Err(format!(
                    "Step {step} exceeds range span {span} ({range_min}-{range_max})"
                ));
            }
            // Iterate in u64 so the increment cannot wrap even if a future
            // change relaxes the span check above. `range_max` is always
            // ≤ 59, so the `1u64 << v` shift is safe.
            let mut v = range_min as u64;
            let max_u64 = range_max as u64;
            let step_u64 = step as u64;
            while v <= max_u64 {
                bits |= 1u64 << v;
                v += step_u64;
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
            let v: u32 = part.parse().map_err(|_| format!("Invalid value: {part}"))?;
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
        return Err(format!("Range {lo}-{hi} out of bounds {min}-{max}"));
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

/// Check if a datetime matches the schedule (evaluated in UTC).
#[allow(dead_code)]
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

/// Check if a UTC datetime matches the schedule when interpreted in `tz`.
/// Generic over any `TimeZone` so callers can pass `chrono::Local` (system
/// timezone) or `chrono_tz::Tz` (an explicit IANA zone).
fn matches_in_zone<Z: TimeZone>(schedule: &CronSchedule, dt: &DateTime<Utc>, tz: &Z) -> bool {
    let local = dt.with_timezone(tz);
    schedule.has_minute(local.minute())
        && schedule.has_hour(local.hour())
        && schedule.has_month(local.month())
        && day_matches(
            schedule,
            local.day(),
            local.weekday().num_days_from_sunday(),
        )
}

/// Compute the next fire time strictly after `from` (cron evaluated in UTC).
/// Returns None if no valid time found within 4 years (safety limit).
#[allow(dead_code)]
pub fn next_fire_time(schedule: &CronSchedule, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let start = from.with_second(0).unwrap().with_nanosecond(0).unwrap() + Duration::minutes(1);

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

        if !day_matches(
            schedule,
            current.day(),
            current.weekday().num_days_from_sunday(),
        ) {
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

/// Compute the next fire time strictly after `from`, evaluating the cron
/// expression in `tz` (any `TimeZone` impl, typically `chrono::Local` or
/// `chrono_tz::Tz`).
///
/// The returned `DateTime<Utc>` is the UTC instant when the local clock in
/// `tz` reaches the next matching minute. `with_*` calls return `Option` so
/// DST gaps (non-existent local times) fall through to minute-level
/// advancement instead of panicking.
fn next_fire_time_in_zone<Z: TimeZone>(
    schedule: &CronSchedule,
    from: DateTime<Utc>,
    tz: &Z,
) -> Option<DateTime<Utc>> {
    let start = from.with_second(0).unwrap().with_nanosecond(0).unwrap() + Duration::minutes(1);

    let max_iterations = 4 * 366 * 24 * 60; // ~4 years of minutes
    let mut current = start;

    for _ in 0..max_iterations {
        if matches_in_zone(schedule, &current, tz) {
            return Some(current);
        }

        let local = current.with_timezone(tz);

        if !schedule.has_month(local.month()) {
            let next_month = if local.month() == 12 {
                local
                    .with_year(local.year() + 1)
                    .and_then(|d| d.with_month(1))
                    .and_then(|d| d.with_day(1))
            } else {
                local
                    .with_month(local.month() + 1)
                    .and_then(|d| d.with_day(1))
            };
            current = match next_month
                .and_then(|d| d.with_hour(0))
                .and_then(|d| d.with_minute(0))
            {
                Some(t) => t.with_timezone(&Utc),
                None => current + Duration::minutes(1),
            };
            continue;
        }

        if !day_matches(
            schedule,
            local.day(),
            local.weekday().num_days_from_sunday(),
        ) {
            let next_day = (local + Duration::days(1))
                .with_hour(0)
                .and_then(|d| d.with_minute(0));
            current = match next_day {
                Some(t) => t.with_timezone(&Utc),
                None => current + Duration::minutes(1),
            };
            continue;
        }

        if !schedule.has_hour(local.hour()) {
            let next_hour = (local + Duration::hours(1)).with_minute(0);
            current = match next_hour {
                Some(t) => t.with_timezone(&Utc),
                None => current + Duration::minutes(1),
            };
            continue;
        }

        current += Duration::minutes(1);
    }

    None
}

/// Compute the next fire time strictly after `from`, evaluating the cron
/// expression in the system's local timezone.
///
/// This matches user expectations: cron "0 9 * * *" fires at 9:00 local time,
/// consistent with how `ActiveWindow::is_active_at()` interprets hours.
pub fn next_fire_time_local(schedule: &CronSchedule, from: DateTime<Utc>) -> Option<DateTime<Utc>> {
    next_fire_time_in_zone(schedule, from, &Local)
}

/// Compute the next fire time strictly after `from`, evaluating the cron
/// expression in the supplied IANA timezone.
///
/// Use this when the trigger's `config` has an explicit `timezone` field
/// (e.g. `"America/New_York"`). Falls back to `next_fire_time_local` when the
/// caller has no explicit zone.
pub fn next_fire_time_in_tz(
    schedule: &CronSchedule,
    from: DateTime<Utc>,
    tz: Tz,
) -> Option<DateTime<Utc>> {
    next_fire_time_in_zone(schedule, from, &tz)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_parse_star() {
        let s = parse_cron("* * * * *").unwrap();
        assert_eq!(s.minutes.count_ones(), 60);
        assert_eq!(s.hours.count_ones(), 24);
        assert_eq!(s.days_of_month.count_ones(), 31);
        assert_eq!(s.months.count_ones(), 12);
        assert_eq!(s.days_of_week.count_ones(), 7);
    }

    #[test]
    fn test_every_minute_matches_minimum_interval() {
        let s = parse_cron("* * * * *").unwrap();
        assert!(validate_min_interval(&s, MIN_CRON_INTERVAL_SECONDS).is_ok());
    }

    #[test]
    fn test_parse_step() {
        let s = parse_cron("*/15 * * * *").unwrap();
        assert!(s.has_minute(0));
        assert!(s.has_minute(15));
        assert!(s.has_minute(30));
        assert!(s.has_minute(45));
        assert_eq!(s.minutes.count_ones(), 4);
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
        assert_eq!(s.minutes.count_ones(), 3);
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
        assert!(
            matches(&s, &thu_15),
            "should match: 15th (dom), even though not Monday"
        );

        // 2026-01-19 is a Monday (day 19) — matches on day_of_week
        let mon_19 = Utc.with_ymd_and_hms(2026, 1, 19, 9, 0, 0).unwrap();
        assert!(
            matches(&s, &mon_19),
            "should match: Monday (dow), even though not 15th"
        );

        // 2026-01-16 is a Friday, not 15th nor Monday — no match
        let fri_16 = Utc.with_ymd_and_hms(2026, 1, 16, 9, 0, 0).unwrap();
        assert!(
            !matches(&s, &fri_16),
            "should NOT match: neither 15th nor Monday"
        );
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

    // -- IANA timezone awareness ------------------------------------------------

    #[test]
    fn test_next_fire_in_tz_handoff_case_edt() {
        // Repro from C5-handoff-2026-04-26: cron "0 7 * * *" + America/New_York
        // on 2026-04-26 should fire at 11:00 UTC (07:00 EDT, UTC-4).
        let s = parse_cron("0 7 * * *").unwrap();
        let tz: Tz = "America/New_York".parse().unwrap();
        let from = Utc.with_ymd_and_hms(2026, 4, 26, 22, 0, 0).unwrap();
        let next = next_fire_time_in_tz(&s, from, tz).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 4, 27, 11, 0, 0).unwrap());
    }

    #[test]
    fn test_next_fire_in_tz_winter_est() {
        // Same cron, winter (EST, UTC-5): 07:00 EST = 12:00 UTC.
        let s = parse_cron("0 7 * * *").unwrap();
        let tz: Tz = "America/New_York".parse().unwrap();
        let from = Utc.with_ymd_and_hms(2026, 1, 14, 22, 0, 0).unwrap();
        let next = next_fire_time_in_tz(&s, from, tz).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 1, 15, 12, 0, 0).unwrap());
    }

    #[test]
    fn test_next_fire_in_tz_utc_is_identity() {
        // When tz is UTC, behaviour matches the plain UTC matcher.
        let s = parse_cron("30 14 * * *").unwrap();
        let tz: Tz = "UTC".parse().unwrap();
        let from = Utc.with_ymd_and_hms(2026, 6, 1, 10, 0, 0).unwrap();
        let next = next_fire_time_in_tz(&s, from, tz).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 6, 1, 14, 30, 0).unwrap());
    }

    #[test]
    fn test_next_fire_in_tz_crosses_utc_day_boundary() {
        // Asia/Tokyo (UTC+9): 09:00 JST is 00:00 UTC the same day. From the
        // previous day at 23:00 UTC, next fire is 00:00 UTC the next day.
        let s = parse_cron("0 9 * * *").unwrap();
        let tz: Tz = "Asia/Tokyo".parse().unwrap();
        let from = Utc.with_ymd_and_hms(2026, 5, 9, 23, 0, 0).unwrap();
        let next = next_fire_time_in_tz(&s, from, tz).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2026, 5, 10, 0, 0, 0).unwrap());
    }

    // -- Pathological-step regression tests -------------------------------------

    #[test]
    fn test_step_overflow_u32_max_rejected() {
        // u32::MAX as step would wrap `v += step` in release builds and
        // infinite-loop the parser. Must reject at validation time.
        assert!(parse_cron("0/4294967295 * * * *").is_err());
        assert!(parse_cron("* */4294967295 * * *").is_err());
    }

    #[test]
    fn test_step_exceeds_range_rejected() {
        // Minutes range is 0-59 (span 59). Step 60 cannot legally generate
        // multiple values within the range.
        assert!(parse_cron("0/60 * * * *").is_err());
        // Step exactly equal to the span fires only the first value, but
        // we treat it as legal because `v += step` lands at range_max + 1
        // and exits cleanly.
        assert!(parse_cron("0/59 * * * *").is_ok());
    }

    #[test]
    fn test_step_does_not_infinite_loop_on_large_step() {
        // The historical bug: `*/100` for minutes (max 59) used to wrap.
        // After the fix, this is rejected — but if it weren't, we'd just
        // loop once. Belt-and-braces.
        let res = parse_cron("*/100 * * * *");
        assert!(res.is_err(), "step beyond range should be rejected");
    }

    #[test]
    fn test_step_one_is_equivalent_to_wildcard() {
        // Sanity: */1 should set all bits in the range.
        let s = parse_cron("*/1 * * * *").unwrap();
        assert_eq!(s.minutes.count_ones(), 60);
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

    // -- Jenkins-style H token expansion ---------------------------------------

    #[test]
    fn test_seed_hash_is_deterministic_and_distinct() {
        let a = seed_hash("persona-alpha");
        let b = seed_hash("persona-alpha");
        let c = seed_hash("persona-bravo");
        assert_eq!(a, b, "same id must hash to same seed");
        assert_ne!(a, c, "different ids should usually hash to different seeds");
    }

    #[test]
    fn test_expand_h_plain_minute() {
        // H in minutes with a non-zero seed should land somewhere in 0..=59
        let expanded = expand_h_tokens("H * * * *", 42).unwrap();
        let minute: u32 = expanded.split_whitespace().next().unwrap().parse().unwrap();
        assert!(minute <= 59);
    }

    #[test]
    fn test_expand_h_pure_passthrough() {
        // Non-H expressions must pass through verbatim.
        let expr = "*/15 9-17 * * 1-5";
        assert_eq!(expand_h_tokens(expr, 12345).unwrap(), expr);
    }

    #[test]
    fn test_expand_h_step_spreads_within_range() {
        // H/15 minutes: hash should produce 4 minutes one quarter-hour apart,
        // starting at hash mod 15 in [0,14].
        let expanded = expand_h_tokens("H/15 * * * *", 0).unwrap();
        // seed=0 → offset 0 → "0,15,30,45"
        assert!(expanded.starts_with("0,15,30,45 "), "got: {expanded}");

        let expanded = expand_h_tokens("H/15 * * * *", 7).unwrap();
        // seed=7 → offset 7 → "7,22,37,52"
        assert!(expanded.starts_with("7,22,37,52 "), "got: {expanded}");
    }

    #[test]
    fn test_expand_h_step_clips_to_field_max() {
        // H/20 minutes with seed=15 → offset 15 → 15,35,55 (not 75/95).
        let expanded = expand_h_tokens("H/20 * * * *", 15).unwrap();
        assert!(expanded.starts_with("15,35,55 "), "got: {expanded}");
    }

    #[test]
    fn test_expand_h_with_explicit_range() {
        // H(9-17) for hours field: result must fall inside [9, 17] for any
        // seed. We can't assert a specific value because the field-index salt
        // mixes with the seed before the modulo — the assertion only checks
        // the property the user actually cares about: bounded by the range.
        for seed in [0u64, 1, 7, 8, 42, u64::MAX] {
            let expanded = expand_h_tokens("0 H(9-17) * * *", seed).unwrap();
            let parts: Vec<&str> = expanded.split_whitespace().collect();
            let hour: u32 = parts[1].parse().unwrap();
            assert!(
                (9..=17).contains(&hour),
                "seed={seed} produced hour {hour}, expected 9..=17"
            );
        }

        // Determinism: same seed gives the same hour every time.
        let first = expand_h_tokens("0 H(9-17) * * *", 12345).unwrap();
        let again = expand_h_tokens("0 H(9-17) * * *", 12345).unwrap();
        assert_eq!(first, again);
    }

    #[test]
    fn test_expand_h_range_with_step() {
        // H(0-29)/10 minutes, seed=0 → offset 0 → 0,10,20.
        let expanded = expand_h_tokens("H(0-29)/10 * * * *", 0).unwrap();
        assert!(expanded.starts_with("0,10,20 "), "got: {expanded}");
        // seed=3 → offset 3 → 3,13,23.
        let expanded = expand_h_tokens("H(0-29)/10 * * * *", 3).unwrap();
        assert!(expanded.starts_with("3,13,23 "), "got: {expanded}");
    }

    #[test]
    fn test_parse_cron_seeded_accepts_h() {
        // Round-trip: parse_cron_seeded should accept H syntax and produce a
        // legal schedule whose minute matches the expansion.
        let seed = seed_hash("persona-1");
        let s = parse_cron_seeded("H/15 * * * *", seed).unwrap();
        assert_eq!(s.minutes.count_ones(), 4);
    }

    #[test]
    fn test_parse_cron_back_compat_accepts_h_with_zero_seed() {
        // `parse_cron` is the back-compat entry point: it must still accept H
        // syntax (so validators don't reject Jenkins expressions), even though
        // it collapses everything to the range minimum.
        let s = parse_cron("H * * * *").unwrap();
        assert!(s.has_minute(0));
        assert_eq!(s.minutes.count_ones(), 1);
    }

    #[test]
    fn test_expand_h_distributes_personas_across_minute() {
        // Two personas with the same `H/15` cron must usually land on
        // different minute offsets. Probabilistic but with 15 buckets and
        // FNV-1a, two well-separated string ids should collide < 10% of time.
        let a = expand_h_tokens("H/15 * * * *", seed_hash("persona-aaa")).unwrap();
        let b = expand_h_tokens("H/15 * * * *", seed_hash("persona-bbb")).unwrap();
        assert_ne!(
            a, b,
            "distinct personas with H/15 collided on the same offset"
        );
    }

    #[test]
    fn test_expand_h_multiple_fields_independent() {
        // `H H * * *` — minute and hour must not be identical for every seed.
        // Field-index salt prevents collapse.
        let mut hour_eq_minute = 0;
        for i in 0..50 {
            let expanded = expand_h_tokens("H H * * *", seed_hash(&format!("p-{i}"))).unwrap();
            let parts: Vec<&str> = expanded.split_whitespace().collect();
            if parts[0] == parts[1] {
                hour_eq_minute += 1;
            }
        }
        // With 60 minutes × 24 hours and a field salt, collisions should be
        // rare. Allow generous slack — the assertion only fails if the salt
        // accidentally aligned hour and minute pools.
        assert!(
            hour_eq_minute < 25,
            "H H field salt failed to decorrelate: {hour_eq_minute}/50 collisions"
        );
    }

    #[test]
    fn test_expand_h_invalid_range_rejected() {
        // H(50-20) is reversed
        assert!(expand_h_tokens("H(50-20) * * * *", 0).is_err());
        // H(70-80) is out of bounds for minutes
        assert!(expand_h_tokens("H(70-80) * * * *", 0).is_err());
    }

    #[test]
    fn test_expand_h_invalid_step_rejected() {
        assert!(expand_h_tokens("H/0 * * * *", 0).is_err());
        assert!(expand_h_tokens("H/abc * * * *", 0).is_err());
    }

    #[test]
    fn test_expand_h_in_list_each_part_independent() {
        // `H,H * * * *` — two H tokens in the same field; salt by part index
        // should usually give two distinct minutes.
        let expanded = expand_h_tokens("H,H * * * *", seed_hash("persona-list")).unwrap();
        let minute_field = expanded.split_whitespace().next().unwrap();
        let parts: Vec<&str> = minute_field.split(',').collect();
        assert_eq!(parts.len(), 2);
        // Don't strictly require difference (small chance of collision), just
        // require both parsed correctly as numbers.
        for p in &parts {
            let _: u32 = p.parse().unwrap();
        }
    }

    #[test]
    fn test_parse_cron_seeded_next_fire_matches_expansion() {
        // Sanity end-to-end: a seeded H/15 cron's next fire must be one of
        // the four minutes the expansion produced.
        let seed = seed_hash("e2e-persona");
        let expanded = expand_h_tokens("H/15 * * * *", seed).unwrap();
        let allowed: Vec<u32> = expanded
            .split_whitespace()
            .next()
            .unwrap()
            .split(',')
            .map(|s| s.parse().unwrap())
            .collect();
        let s = parse_cron_seeded("H/15 * * * *", seed).unwrap();
        let from = Utc.with_ymd_and_hms(2026, 6, 1, 10, 0, 0).unwrap();
        let next = next_fire_time(&s, from).unwrap();
        assert!(
            allowed.contains(&next.minute()),
            "next fire minute {} not in expansion {:?}",
            next.minute(),
            allowed
        );
    }
}
