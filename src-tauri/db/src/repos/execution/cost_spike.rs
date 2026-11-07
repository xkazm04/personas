//! The two numbers a `cost_spike` rule compares. Pure, so the rule can be tested
//! on plain series.

pub struct CostSpikeReading {
    pub today: f64,
    /// `None` is no reading: nothing to compare against, or priors that cost
    /// nothing. It is not a ratio of 0 or of 1.
    pub baseline: Option<f64>,
}

/// `series` is (date, cost) in date order, one entry per day that ran something:
/// `get_chart_data` does not fill gaps, so on a quiet day the last point is the
/// last ACTIVE day, and today cost nothing. The baseline is the mean of the days
/// before today and leaves today out, so a day cannot raise the bar it has to
/// clear. It stays a mean over active days: the client's median and what an idle
/// day means are the product's open question.
pub fn cost_spike_reading(series: &[(&str, f64)], today_date: &str) -> CostSpikeReading {
    let (today, prior) = match series.split_last() {
        Some(((date, cost), prior)) if *date == today_date => (*cost, prior),
        _ => (0.0, series),
    };
    let baseline = (!prior.is_empty())
        .then(|| prior.iter().map(|(_, cost)| cost).sum::<f64>() / prior.len() as f64)
        .filter(|mean| *mean > 0.0);
    CostSpikeReading { today, baseline }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TODAY: &str = "2026-11-07";

    fn week_then(today: f64) -> Vec<(&'static str, f64)> {
        let mut series: Vec<_> = [
            "2026-11-01",
            "2026-11-02",
            "2026-11-03",
            "2026-11-04",
            "2026-11-05",
            "2026-11-06",
        ]
        .map(|d| (d, 1.0))
        .to_vec();
        series.push((TODAY, today));
        series
    }

    fn ratio(series: &[(&str, f64)]) -> f64 {
        let reading = cost_spike_reading(series, TODAY);
        reading.today / reading.baseline.expect("a reading")
    }

    #[test]
    fn six_flat_days_then_triple_reads_3x() {
        assert!((ratio(&week_then(3.0)) - 3.0).abs() < 1e-9);
    }

    #[test]
    fn a_100x_day_clears_an_8x_rule() {
        assert!(ratio(&week_then(100.0)) >= 8.0);
    }

    #[test]
    fn one_active_day_gives_no_reading() {
        assert!(cost_spike_reading(&[(TODAY, 5.0)], TODAY)
            .baseline
            .is_none());
    }

    #[test]
    fn a_quiet_day_is_not_judged_by_the_last_active_day() {
        let series = [("2026-11-05", 1.0), ("2026-11-06", 9.0)];
        let reading = cost_spike_reading(&series, TODAY);
        assert_eq!(reading.today, 0.0);
        assert_eq!(reading.baseline, Some(5.0));
    }

    #[test]
    fn priors_that_cost_nothing_give_no_reading() {
        let series = [("2026-11-06", 0.0), (TODAY, 5.0)];
        assert!(cost_spike_reading(&series, TODAY).baseline.is_none());
    }

    #[test]
    fn a_flat_series_stays_at_1x() {
        assert!((ratio(&week_then(1.0)) - 1.0).abs() < 1e-9);
    }
}
