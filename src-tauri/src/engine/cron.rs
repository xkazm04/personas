use chrono::{DateTime, Datelike, Timelike, Utc, Duration};

/// Parsed cron schedule (5-field standard cron)
#[derive(Debug, Clone)]
pub struct CronSchedule {
    pub minutes: Vec<u32>,
    pub hours: Vec<u32>,
    pub days_of_month: Vec<u32>,
    pub months: Vec<u32>,
    pub days_of_week: Vec<u32>,
}

/// Parse a 5-field cron expression. Returns Err on invalid input.
pub fn parse_cron(expr: &str) -> Result<CronSchedule, String> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return Err(format!("Expected 5 fields, got {}", fields.len()));
    }
    Ok(CronSchedule {
        minutes: parse_field(fields[0], 0, 59)?,
        hours: parse_field(fields[1], 0, 23)?,
        days_of_month: parse_field(fields[2], 1, 31)?,
        months: parse_field(fields[3], 1, 12)?,
        days_of_week: parse_field(fields[4], 0, 6)?,
    })
}

/// Parse a single cron field. Supports *, */N, N, N-M, N,M,P and combinations.
fn parse_field(field: &str, min: u32, max: u32) -> Result<Vec<u32>, String> {
    let mut values = Vec::new();
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
                values.push(v);
                v += step;
            }
        } else if part.contains('-') {
            let (lo, hi) = parse_range_bounds(part, min, max)?;
            for v in lo..=hi {
                values.push(v);
            }
        } else if part == "*" {
            for v in min..=max {
                values.push(v);
            }
        } else {
            let v: u32 = part
                .parse()
                .map_err(|_| format!("Invalid value: {}", part))?;
            if v < min || v > max {
                return Err(format!("Value {} out of range {}-{}", v, min, max));
            }
            values.push(v);
        }
    }
    values.sort();
    values.dedup();
    if values.is_empty() {
        return Err("Empty field".into());
    }
    Ok(values)
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
            "Range {}-{} out of bounds {}-{}",
            lo, hi, min, max
        ));
    }
    Ok((lo, hi))
}

/// Check if a datetime matches the schedule.
fn matches(schedule: &CronSchedule, dt: &DateTime<Utc>) -> bool {
    let minute = dt.minute();
    let hour = dt.hour();
    let day = dt.day();
    let month = dt.month();
    let weekday = dt.weekday().num_days_from_sunday(); // 0=Sun

    schedule.minutes.contains(&minute)
        && schedule.hours.contains(&hour)
        && schedule.days_of_month.contains(&day)
        && schedule.months.contains(&month)
        && schedule.days_of_week.contains(&weekday)
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
        if !schedule.months.contains(&current.month()) {
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

        if !schedule.days_of_month.contains(&current.day())
            || !schedule
                .days_of_week
                .contains(&current.weekday().num_days_from_sunday())
        {
            current = (current + Duration::days(1))
                .with_hour(0)
                .unwrap()
                .with_minute(0)
                .unwrap();
            continue;
        }

        if !schedule.hours.contains(&current.hour()) {
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
        assert_eq!(s.minutes.len(), 60);
        assert_eq!(s.hours.len(), 24);
        assert_eq!(s.days_of_month.len(), 31);
        assert_eq!(s.months.len(), 12);
        assert_eq!(s.days_of_week.len(), 7);
    }

    #[test]
    fn test_parse_step() {
        let s = parse_cron("*/15 * * * *").unwrap();
        assert_eq!(s.minutes, vec![0, 15, 30, 45]);
    }

    #[test]
    fn test_parse_range() {
        let s = parse_cron("* * * * 1-5").unwrap();
        assert_eq!(s.days_of_week, vec![1, 2, 3, 4, 5]);
    }

    #[test]
    fn test_parse_list() {
        let s = parse_cron("1,15,30 * * * *").unwrap();
        assert_eq!(s.minutes, vec![1, 15, 30]);
    }

    #[test]
    fn test_parse_combined() {
        let s = parse_cron("1-5,10,*/20 * * * *").unwrap();
        assert!(s.minutes.contains(&1));
        assert!(s.minutes.contains(&5));
        assert!(s.minutes.contains(&10));
        assert!(s.minutes.contains(&20));
        assert!(s.minutes.contains(&40));
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
}
