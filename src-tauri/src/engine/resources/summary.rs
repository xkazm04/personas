//! The run-level math: what a run's samples summarise to. Pure, so every rule
//! below is unit-tested without a process or a database.
//!
//! * CPU and GPU are summarised as the **95th percentile** of the per-tick
//!   shares (nearest rank): a sustained level, not one spike.
//! * RAM is the **peak**: memory that was resident once had to fit once.
//! * GPU is `None` for the run when no tick had a GPU reading, never `0.0`.
//! * A run with no sample (shorter than one tick) summarises to nothing, so
//!   it writes no row.
//!
//! Memory is bounded: past [`MAX_KEPT_SAMPLES`] the series is decimated
//! (every other kept sample dropped, and only every 2nd, 4th, ... new tick
//! kept), so a session left open for days costs a fixed few hundred KB. The
//! peak RAM and the sample count are tracked exactly regardless.

use crate::db::models::{ResourceAxis, RunKind, RunResourceSummary};

/// The most per-tick samples one run keeps (a day at the 5 s cadence).
pub const MAX_KEPT_SAMPLES: usize = 17_280;

/// One tick's measurement of one run, every share in `0..=1`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Reading {
    pub cpu: f64,
    pub ram: f64,
    /// `None` when the platform could not read GPU engines this tick.
    pub gpu: Option<f64>,
}

/// A run's samples so far.
#[derive(Debug, Clone, Default)]
pub struct RunAccumulator {
    cpu: Vec<f64>,
    gpu: Vec<f64>,
    ram_peak: f64,
    /// Ticks observed - exact, never decimated.
    samples: u32,
    /// Keep every `stride`-th tick (1 until the first decimation).
    stride: u32,
}

impl RunAccumulator {
    pub fn push(&mut self, r: Reading) {
        if self.stride == 0 {
            self.stride = 1;
        }
        self.samples = self.samples.saturating_add(1);
        if r.ram > self.ram_peak {
            self.ram_peak = r.ram;
        }
        if self.samples % self.stride != 0 {
            return;
        }
        self.cpu.push(r.cpu);
        if let Some(g) = r.gpu {
            self.gpu.push(g);
        }
        if self.cpu.len() >= MAX_KEPT_SAMPLES {
            decimate(&mut self.cpu);
            decimate(&mut self.gpu);
            self.stride = self.stride.saturating_mul(2);
        }
    }

    /// The run's summary, or `None` for a run that was never sampled.
    pub fn summarize(
        &self,
        run_kind: RunKind,
        run_id: &str,
        persona_id: Option<String>,
        responsibility_id: Option<String>,
        started_at_ms: f64,
        ended_at_ms: f64,
    ) -> Option<RunResourceSummary> {
        if self.samples == 0 {
            return None;
        }
        let cpu = p95(&self.cpu).unwrap_or(0.0);
        let ram = self.ram_peak;
        let gpu = p95(&self.gpu);
        Some(RunResourceSummary {
            run_kind,
            run_id: run_id.to_string(),
            persona_id,
            responsibility_id,
            cpu_p95_share: cpu,
            ram_peak_share: ram,
            gpu_p95_share: gpu,
            dominant: ResourceAxis::dominant(cpu, ram, gpu),
            samples: self.samples,
            started_at_ms,
            ended_at_ms: ended_at_ms.max(started_at_ms),
        })
    }
}

/// Drop every other element, keeping the first.
fn decimate(v: &mut Vec<f64>) {
    let mut i = 0usize;
    v.retain(|_| {
        let keep = i % 2 == 0;
        i += 1;
        keep
    });
}

/// The 95th percentile by nearest rank (`ceil(0.95 n)`-th smallest), or
/// `None` for an empty series. NaN sorts as equal, so it cannot panic.
pub fn p95(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let rank = ((sorted.len() as f64) * 0.95).ceil() as usize;
    sorted.get(rank.saturating_sub(1)).copied()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reading(cpu: f64, ram: f64, gpu: Option<f64>) -> Reading {
        Reading { cpu, ram, gpu }
    }

    fn summarize(acc: &RunAccumulator) -> Option<RunResourceSummary> {
        acc.summarize(RunKind::Execution, "e1", None, None, 1_000.0, 6_000.0)
    }

    #[test]
    fn p95_is_nearest_rank() {
        assert_eq!(p95(&[]), None);
        assert_eq!(p95(&[0.4]), Some(0.4));
        // 20 values 0.01..=0.20: ceil(19) = 19th smallest = 0.19.
        let v: Vec<f64> = (1..=20).map(|i| f64::from(i) / 100.0).collect();
        assert_eq!(p95(&v), Some(0.19));
        // 100 values: the 95th.
        let v: Vec<f64> = (1..=100).map(f64::from).collect();
        assert_eq!(p95(&v), Some(95.0));
    }

    #[test]
    fn a_run_with_no_sample_summarises_to_nothing() {
        assert_eq!(summarize(&RunAccumulator::default()), None);
    }

    #[test]
    fn summary_takes_cpu_p95_ram_peak_and_the_dominant_axis() {
        let mut acc = RunAccumulator::default();
        for i in 0..20 {
            // CPU climbs to 0.2; one RAM spike of 0.7 mid-run.
            let ram = if i == 7 { 0.7 } else { 0.1 };
            acc.push(reading(f64::from(i + 1) / 100.0, ram, Some(0.05)));
        }
        let s = summarize(&acc).expect("sampled");
        assert_eq!(s.samples, 20);
        assert_eq!(s.cpu_p95_share, 0.19);
        assert_eq!(s.ram_peak_share, 0.7, "RAM is the peak, not a percentile");
        assert_eq!(s.gpu_p95_share, Some(0.05));
        assert_eq!(s.dominant, ResourceAxis::Ram);
        assert_eq!((s.started_at_ms, s.ended_at_ms), (1_000.0, 6_000.0));
    }

    #[test]
    fn a_none_gpu_stays_none_and_partial_readings_count_only_themselves() {
        let mut never = RunAccumulator::default();
        never.push(reading(0.1, 0.1, None));
        never.push(reading(0.1, 0.1, None));
        let s = summarize(&never).expect("sampled");
        assert_eq!(s.gpu_p95_share, None, "no reading is null, never 0");
        assert_eq!(s.dominant, ResourceAxis::Cpu);

        // The first PDH tick yields None; later ticks read. The p95 is over
        // the ticks that had a reading.
        let mut partial = RunAccumulator::default();
        partial.push(reading(0.1, 0.1, None));
        partial.push(reading(0.1, 0.1, Some(0.8)));
        let s = summarize(&partial).expect("sampled");
        assert_eq!(s.gpu_p95_share, Some(0.8));
        assert_eq!(s.dominant, ResourceAxis::Gpu);
    }

    #[test]
    fn a_long_run_is_decimated_but_keeps_its_peak_and_count() {
        let mut acc = RunAccumulator::default();
        let total = MAX_KEPT_SAMPLES * 3;
        for i in 0..total {
            let ram = if i == total - 1 { 0.9 } else { 0.2 };
            acc.push(reading(0.3, ram, None));
        }
        assert!(
            acc.cpu.len() < MAX_KEPT_SAMPLES,
            "bounded: {}",
            acc.cpu.len()
        );
        let s = summarize(&acc).expect("sampled");
        assert_eq!(s.samples as usize, total);
        assert_eq!(s.ram_peak_share, 0.9);
        assert_eq!(s.cpu_p95_share, 0.3);
    }
}
