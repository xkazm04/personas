//! How far one day's cost sits above the days before it. Pure, so the rule can
//! be tested on plain series.

pub(super) struct CostDeviation {
    pub mean: f64,
    pub std_dev: f64,
    pub sigma: f64,
}

/// Over a baseline with spread, standard deviations above the mean. A flat baseline
/// has no spread, and skipping it hid every jump, so it reads half its mean as one
/// sigma: the 2-sigma rule then fires above double, the same bar as
/// `detect_chart_anomalies`. The near-zero test is there because float rounding
/// leaves a flat 0.1 with a tiny deviation, not zero. A baseline that cost nothing
/// gives no reading, as in `readCostSpike` and `detect_rolling_anomalies`.
pub(super) fn cost_deviation(preceding: &[f64], today: f64) -> Option<CostDeviation> {
    if preceding.is_empty() {
        return None;
    }
    let n = preceding.len() as f64;
    let mean = preceding.iter().sum::<f64>() / n;
    let variance = preceding.iter().map(|c| (c - mean).powi(2)).sum::<f64>() / n;
    let std_dev = variance.sqrt();
    let spread = if std_dev <= mean * 1e-9 {
        mean * 0.5
    } else {
        std_dev
    };
    if spread == 0.0 {
        return None;
    }
    Some(CostDeviation {
        mean,
        std_dev,
        sigma: (today - mean) / spread,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fires(preceding: &[f64], today: f64) -> bool {
        cost_deviation(preceding, today).is_some_and(|d| d.sigma > 2.0)
    }

    #[test]
    fn flat_series_that_jumps_reports() {
        for base in [1.0, 0.1, 0.37, 250.0] {
            assert!(fires(&[base; 7], base * 10.0), "flat at {base}, then 10x");
            let d = cost_deviation(&[base; 7], base * 10.0).expect("a reading");
            // serde_json writes a non-finite f64 as null, and the UI formats this number.
            assert!(d.sigma.is_finite());
        }
    }

    #[test]
    fn flat_series_stays_quiet_without_a_real_jump() {
        for base in [1.0, 0.1, 0.37, 250.0] {
            assert!(!fires(&[base; 7], base), "flat at {base}, unchanged");
            assert!(!fires(&[base; 7], base * 1.5), "flat at {base}, then 1.5x");
        }
    }

    #[test]
    fn a_baseline_that_cost_nothing_gives_no_reading() {
        assert!(cost_deviation(&[0.0; 7], 5.0).is_none());
    }

    #[test]
    fn varied_series_keeps_the_two_sigma_rule() {
        let varied = [1.0, 2.0, 1.0, 2.0, 1.0, 2.0, 1.0];
        assert!(fires(&varied, 10.0));
        assert!(!fires(&varied, 2.0));
        let d = cost_deviation(&varied, 10.0).expect("a reading");
        assert!((d.sigma - (10.0 - d.mean) / d.std_dev).abs() < 1e-12);
    }
}
