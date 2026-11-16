//! Host sampler: what the WHOLE machine is doing, minute by minute (spark
//! app-standup, WP2).
//!
//! The per-run sampler ([`super::spawn_sampler`]) says what each live run
//! consumes and parks while nothing runs - so it can never see the machine
//! idling, which is the only place a dead spot is visible. This one does:
//! every [`HOST_SAMPLE_INTERVAL`] it takes one whole-host reading, folds the
//! readings into a 1-minute rollup, and writes each finished minute to
//! `host_utilization` (system DB, migration `e73_host_utilization`) through
//! `db::repos::resources::host_utilization`. Minutes older than 14 days are
//! pruned once an hour.
//!
//! # One reading
//!
//! * CPU and RAM come from the app's ONE host sampler,
//!   [`SystemMetricsSampler`] in `AppState` (the footer gauge's): no second
//!   sysinfo object, no process enumeration. Its CPU% is a delta since its
//!   previous refresh by ANY reader, so it is a spot reading over the last few
//!   seconds; the first sample after boot has no delta and reads as `None`.
//! * GPU comes from [`GpuReader`] (`\GPU Engine(*)\Utilization Percentage`,
//!   PDH). Off Windows, before the counter's second collection, or when PDH
//!   cannot open it, the reading is `None` - never `0`.
//! * The fleet's running / queued counts come from the in-memory registry.
//!
//! # Cost
//!
//! A [`ReactiveSubscription`] at a 10 s interval (the per-run sampler ticks
//! every 5 s while anything runs). One tick is one CPU-usage refresh, one
//! memory refresh and one PDH collection - no process-table walk, which is the
//! expensive half of the per-run tick. Measured by
//! `tests::one_host_reading_is_cheaper_than_a_per_run_tick`.
//!
//! # The recent-minutes ring
//!
//! The last [`RECENT_MINUTES_KEPT`] finished minutes also stay in memory
//! ([`recent_minutes`]), so the dead-spot detector (`super::dead_spot`) reads
//! them on the queue's 30 s tick without a database round trip.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::commands::infrastructure::system_metrics::SystemMetricsSampler;
use crate::db::models::HostUtilizationPoint;
use crate::db::repos::resources::host_utilization::{self, MINUTE_MS, RETENTION_MS};
use crate::db::DbPool;
use crate::engine::subscription::ReactiveSubscription;
use crate::AppState;

use super::gpu::GpuReader;

/// How often the whole host is read.
pub const HOST_SAMPLE_INTERVAL: Duration = Duration::from_secs(10);

/// How many finished minutes [`recent_minutes`] keeps (two hours; the
/// dead-spot window is at most 120 minutes, `standup.dead_spot_minutes`).
pub const RECENT_MINUTES_KEPT: usize = 120;

/// How often minutes past the retention window are pruned.
pub const PRUNE_EVERY_MS: i64 = 60 * MINUTE_MS;

/// The start of the minute `ms` falls in.
pub fn minute_of(ms: i64) -> i64 {
    ms - ms.rem_euclid(MINUTE_MS)
}

/// One whole-host reading. Shares are fractions of this device's capacity,
/// `0.0..=1.0`; `None` is "no reading", never idle.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HostSample {
    pub at_ms: i64,
    pub cpu: Option<f64>,
    pub ram: Option<f64>,
    pub gpu: Option<f64>,
    pub fleet_running: i32,
    pub fleet_queued: i32,
}

/// Running avg/max of one axis over a minute's samples.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
struct Axis {
    sum: f64,
    max: f64,
    n: u32,
}

impl Axis {
    fn push(&mut self, v: Option<f64>) {
        let Some(v) = v.filter(|v| v.is_finite()) else {
            return;
        };
        let v = v.clamp(0.0, 1.0);
        self.max = if self.n == 0 { v } else { self.max.max(v) };
        self.sum += v;
        self.n += 1;
    }

    fn avg(&self) -> Option<f64> {
        (self.n > 0).then(|| self.sum / f64::from(self.n))
    }

    fn max(&self) -> Option<f64> {
        (self.n > 0).then_some(self.max)
    }
}

/// The minute being accumulated. Pure: [`MinuteRollup::push`] hands back the
/// PREVIOUS minute, finished, the first time a sample lands in a later one.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct MinuteRollup {
    minute_ms: Option<i64>,
    cpu: Axis,
    ram: Axis,
    gpu: Axis,
    fleet_running: i32,
    fleet_queued: i32,
}

impl MinuteRollup {
    /// Fold one sample in. Returns the finished previous minute when `sample`
    /// starts a new one. A sample OLDER than the current minute (a clock step
    /// backwards) is dropped rather than reopening a written minute.
    pub fn push(&mut self, sample: HostSample) -> Option<HostUtilizationPoint> {
        let minute = minute_of(sample.at_ms);
        let finished = match self.minute_ms {
            Some(current) if minute < current => return None,
            Some(current) if minute > current => {
                let done = self.point();
                *self = Self::default();
                done
            }
            _ => None,
        };
        self.minute_ms = Some(minute);
        self.cpu.push(sample.cpu);
        self.ram.push(sample.ram);
        self.gpu.push(sample.gpu);
        // Counts are "at the minute's last sample".
        self.fleet_running = sample.fleet_running;
        self.fleet_queued = sample.fleet_queued;
        finished
    }

    /// The minute as it stands, `None` before any sample.
    pub fn point(&self) -> Option<HostUtilizationPoint> {
        Some(HostUtilizationPoint {
            minute_ms: self.minute_ms?,
            cpu_avg: self.cpu.avg(),
            cpu_max: self.cpu.max(),
            ram_avg: self.ram.avg(),
            gpu_avg: self.gpu.avg(),
            gpu_max: self.gpu.max(),
            fleet_running: self.fleet_running,
            fleet_queued: self.fleet_queued,
        })
    }
}

/// The whole-host GPU share from one PDH collection's raw instances
/// (`(instance name, utilisation percent)`): percent summed per ENGINE TYPE
/// (the `_engtype_<Type>` suffix: 3D, Copy, VideoDecode, Compute_0, ...),
/// then the max over types, as a share clamped to `0..=1`. `None` when no
/// instance names an engine type. This is what Task Manager's GPU figure
/// approximates; summing every engine instead would count a 50% 3D load plus
/// a 10% copy as 60%.
///
/// Not wired yet: `GpuReader` folds the instances per PID inside `gpu.rs`
/// (outside this package's file scope) before they reach here. The request to
/// expose the raw instances is in the WP2 report; until it lands
/// [`host_gpu_share_from_pids`] is the reading.
#[cfg_attr(not(test), allow(dead_code))]
pub fn host_gpu_share_from_instances<'a>(
    instances: impl IntoIterator<Item = (&'a str, f64)>,
) -> Option<f64> {
    let mut per_type: HashMap<&'a str, f64> = HashMap::new();
    for (name, pct) in instances {
        if !pct.is_finite() || pct < 0.0 {
            continue;
        }
        let Some((_, engtype)) = name.rsplit_once("_engtype_") else {
            continue;
        };
        if engtype.is_empty() {
            continue;
        }
        *per_type.entry(engtype).or_insert(0.0) += pct;
    }
    per_type
        .values()
        .copied()
        .reduce(f64::max)
        .map(|pct| (pct / 100.0).clamp(0.0, 1.0))
}

/// The whole-host GPU share from the per-PID map [`GpuReader::read`] returns:
/// every PID's share summed, clamped to `0..=1`. An OVER-estimate (it adds
/// engine types together - see [`host_gpu_share_from_instances`]), so it can
/// read a light GPU as busier than it is but never a busy one as idle, which
/// is the safe side for the dead-spot detector. `None` when the tick had no
/// reading at all.
pub fn host_gpu_share_from_pids(per_pid: Option<&HashMap<u32, f64>>) -> Option<f64> {
    let map = per_pid?;
    let sum: f64 = map.values().filter(|v| v.is_finite() && **v > 0.0).sum();
    Some(sum.clamp(0.0, 1.0))
}

/// Read CPU and RAM off the shared sampler: `(cpu, ram)` shares. CPU is
/// `None` on the sampler's first (delta-less) reading; RAM is `None` when the
/// host reported no memory at all.
pub fn read_cpu_ram(sampler: &mut SystemMetricsSampler) -> (Option<f64>, Option<f64>) {
    let m = sampler.sample();
    let cpu = m
        .sample_valid
        .then(|| f64::from(m.cpu_percent) / 100.0)
        .filter(|v| v.is_finite());
    let ram = (m.mem_total_mb > 0)
        .then(|| f64::from(m.mem_used_percent) / 100.0)
        .filter(|v| v.is_finite());
    (
        cpu.map(|v| v.clamp(0.0, 1.0)),
        ram.map(|v| v.clamp(0.0, 1.0)),
    )
}

// ---------------------------------------------------------------------------
// The recent-minutes ring
// ---------------------------------------------------------------------------

static RECENT: Mutex<VecDeque<HostUtilizationPoint>> = Mutex::new(VecDeque::new());

fn lock_recent() -> std::sync::MutexGuard<'static, VecDeque<HostUtilizationPoint>> {
    // A cache of readings: a poisoned lock loses at most one minute.
    RECENT.lock().unwrap_or_else(|e| e.into_inner())
}

fn remember(point: HostUtilizationPoint) {
    let mut ring = lock_recent();
    // Keyed by minute: a re-flushed minute replaces its entry.
    if let Some(last) = ring.back_mut() {
        if last.minute_ms == point.minute_ms {
            *last = point;
            return;
        }
    }
    ring.push_back(point);
    while ring.len() > RECENT_MINUTES_KEPT {
        ring.pop_front();
    }
}

/// The finished minutes still in memory, oldest first (at most
/// [`RECENT_MINUTES_KEPT`]). Empty until the sampler has finished a minute.
pub fn recent_minutes() -> Vec<HostUtilizationPoint> {
    lock_recent().iter().cloned().collect()
}

// ---------------------------------------------------------------------------
// The subscription
// ---------------------------------------------------------------------------

/// What persists between ticks: the PDH query (a rate needs two collections
/// of the SAME query), the open minute and the prune clock.
#[derive(Default)]
struct SamplerState {
    /// Opened on the first tick, inside the blocking pool.
    gpu: Option<GpuReader>,
    rollup: MinuteRollup,
    last_prune_ms: i64,
}

/// The whole-host sampler, registered in `background::lifecycle`.
pub struct HostSamplerSubscription {
    app: AppHandle,
    state: Arc<Mutex<SamplerState>>,
}

impl HostSamplerSubscription {
    pub fn new(app: AppHandle) -> Self {
        Self {
            app,
            state: Arc::new(Mutex::new(SamplerState::default())),
        }
    }
}

#[async_trait::async_trait]
impl ReactiveSubscription for HostSamplerSubscription {
    fn name(&self) -> &'static str {
        "host_sampler"
    }

    fn interval(&self) -> Duration {
        HOST_SAMPLE_INTERVAL
    }

    // Deliberately NOT slower when idle: an idle machine is exactly what this
    // sampler exists to see.

    fn initial_delay(&self) -> Duration {
        HOST_SAMPLE_INTERVAL
    }

    async fn tick(&self) {
        let Some(app_state) = self.app.try_state::<Arc<AppState>>() else {
            return;
        };
        let app_state: Arc<AppState> = app_state.inner().clone();
        let state = self.state.clone();
        crate::engine::subscription::run_blocking_tick(move || {
            sample_once(&app_state, &state);
        })
        .await;
    }
}

/// One tick: read, fold, and write the minute that just finished. Blocking.
fn sample_once(app_state: &AppState, state: &Mutex<SamplerState>) {
    let (cpu, ram) = {
        let mut sampler = app_state
            .system_metrics
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        read_cpu_ram(&mut sampler)
    };
    let fleet_running = i32::try_from(crate::commands::fleet::queue::live_count()).unwrap_or(0);
    let fleet_queued = i32::try_from(
        crate::commands::fleet::registry::registry()
            .queued_in_order()
            .len(),
    )
    .unwrap_or(0);
    let now = personas_core::utils::now_ms();
    let (finished, prune) = {
        let mut st = state.lock().unwrap_or_else(|e| e.into_inner());
        let per_pid = st.gpu.get_or_insert_with(GpuReader::open).read();
        let finished = st.rollup.push(HostSample {
            at_ms: now,
            cpu,
            ram,
            gpu: host_gpu_share_from_pids(per_pid.as_ref()),
            fleet_running,
            fleet_queued,
        });
        let prune = now.saturating_sub(st.last_prune_ms) >= PRUNE_EVERY_MS;
        if prune {
            st.last_prune_ms = now;
        }
        (finished, prune)
    };
    if let Some(point) = finished {
        write_minute(&app_state.db, point);
    }
    if prune {
        prune_old(&app_state.db, now);
    }
}

fn write_minute(pool: &DbPool, point: HostUtilizationPoint) {
    if let Err(e) = host_utilization::upsert(pool, &point) {
        tracing::warn!(minute_ms = point.minute_ms, error = %e, "host sampler: minute write failed");
    }
    remember(point);
}

fn prune_old(pool: &DbPool, now: i64) {
    match host_utilization::prune_before(pool, now - RETENTION_MS) {
        Ok(0) => {}
        Ok(n) => tracing::debug!(pruned = n, "host sampler: pruned minutes past retention"),
        Err(e) => tracing::warn!(error = %e, "host sampler: prune failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const M: i64 = MINUTE_MS;

    fn sample(at_ms: i64, cpu: Option<f64>, gpu: Option<f64>) -> HostSample {
        HostSample {
            at_ms,
            cpu,
            ram: Some(0.5),
            gpu,
            fleet_running: (at_ms / 1000) as i32,
            fleet_queued: 1,
        }
    }

    #[test]
    fn a_minute_rolls_up_avg_and_max_and_finishes_on_the_next_one() {
        let mut r = MinuteRollup::default();
        assert_eq!(r.push(sample(10 * M + 5_000, Some(0.2), Some(0.1))), None);
        assert_eq!(r.push(sample(10 * M + 15_000, Some(0.6), Some(0.3))), None);
        assert_eq!(r.push(sample(10 * M + 25_000, None, None)), None);
        let done = r
            .push(sample(11 * M + 1_000, Some(0.9), None))
            .expect("minute 10 finished");
        assert_eq!(done.minute_ms, 10 * M);
        assert!((done.cpu_avg.unwrap() - 0.4).abs() < 1e-9, "{done:?}");
        assert_eq!(done.cpu_max, Some(0.6));
        assert!((done.gpu_avg.unwrap() - 0.2).abs() < 1e-9);
        assert_eq!(done.gpu_max, Some(0.3));
        assert_eq!(done.ram_avg, Some(0.5));
        assert_eq!(done.fleet_running, 625, "counts are the last sample's");
        assert_eq!(r.point().unwrap().minute_ms, 11 * M);
    }

    #[test]
    fn a_minute_without_gpu_readings_keeps_gpu_none_never_zero() {
        let mut r = MinuteRollup::default();
        r.push(sample(3 * M, Some(0.1), None));
        r.push(sample(3 * M + 10_000, Some(0.1), None));
        let p = r.push(sample(4 * M, Some(0.1), None)).unwrap();
        assert_eq!(p.gpu_avg, None);
        assert_eq!(p.gpu_max, None);
    }

    #[test]
    fn a_skipped_minute_finishes_the_open_one_and_a_backward_step_is_dropped() {
        let mut r = MinuteRollup::default();
        r.push(sample(5 * M, Some(0.1), None));
        let p = r.push(sample(9 * M, Some(0.2), None)).unwrap();
        assert_eq!(p.minute_ms, 5 * M, "no rows are invented for 6..8");
        assert_eq!(r.push(sample(8 * M, Some(1.0), None)), None);
        assert_eq!(
            r.point().unwrap().cpu_max,
            Some(0.2),
            "the old sample left no mark"
        );
    }

    #[test]
    fn minute_of_aligns_down_including_before_the_epoch() {
        assert_eq!(minute_of(0), 0);
        assert_eq!(minute_of(59_999), 0);
        assert_eq!(minute_of(60_000), 60_000);
        assert_eq!(minute_of(-1), -60_000);
    }

    #[test]
    fn host_gpu_is_the_busiest_engine_type_not_the_sum_of_types() {
        let share = host_gpu_share_from_instances([
            ("pid_10_luid_0x0_phys_0_eng_0_engtype_3D", 30.0),
            ("pid_11_luid_0x0_phys_0_eng_0_engtype_3D", 25.0),
            ("pid_10_luid_0x0_phys_0_eng_1_engtype_Copy", 10.0),
            ("pid_12_luid_0x0_phys_0_eng_3_engtype_VideoDecode", 40.0),
            ("pid_12_luid_0x0_phys_0_eng_4_engtype_", 99.0),
            ("_Total", 99.0),
            ("pid_13_luid_0x0_phys_0_eng_0_engtype_3D", f64::NAN),
        ])
        .unwrap();
        assert!(
            (share - 0.55).abs() < 1e-9,
            "3D 30+25 beats decode 40: {share}"
        );
        assert_eq!(
            host_gpu_share_from_instances([("pid_1_luid_0x0_engtype_3D", 250.0)]),
            Some(1.0),
            "clamped"
        );
        assert_eq!(host_gpu_share_from_instances([("_Total", 5.0)]), None);
        assert_eq!(host_gpu_share_from_instances(std::iter::empty()), None);
    }

    #[test]
    fn the_per_pid_fallback_sums_clamps_and_keeps_no_reading_none() {
        let map: HashMap<u32, f64> = [(1, 0.2), (2, 0.15), (3, f64::NAN)].into_iter().collect();
        let share = host_gpu_share_from_pids(Some(&map)).unwrap();
        assert!((share - 0.35).abs() < 1e-9);
        let hot: HashMap<u32, f64> = [(1, 0.8), (2, 0.7)].into_iter().collect();
        assert_eq!(host_gpu_share_from_pids(Some(&hot)), Some(1.0));
        assert_eq!(host_gpu_share_from_pids(Some(&HashMap::new())), Some(0.0));
        assert_eq!(host_gpu_share_from_pids(None), None);
    }

    #[test]
    fn the_ring_keeps_the_newest_minutes_and_replaces_a_reflushed_one() {
        // The ring is process-global; this is the only test that writes it.
        lock_recent().clear();
        let p = |m: i64, cpu: f64| HostUtilizationPoint {
            minute_ms: m * M,
            cpu_avg: Some(cpu),
            cpu_max: Some(cpu),
            ram_avg: Some(0.5),
            gpu_avg: None,
            gpu_max: None,
            fleet_running: 0,
            fleet_queued: 0,
        };
        for m in 0..(RECENT_MINUTES_KEPT as i64 + 5) {
            remember(p(m, 0.1));
        }
        remember(p(RECENT_MINUTES_KEPT as i64 + 4, 0.9));
        let ring = recent_minutes();
        assert_eq!(ring.len(), RECENT_MINUTES_KEPT);
        assert_eq!(ring[0].minute_ms, 5 * M, "the oldest fell off");
        assert_eq!(ring.last().unwrap().cpu_max, Some(0.9), "re-flush replaced");
        lock_recent().clear();
    }

    #[test]
    fn the_real_host_reads_cpu_and_ram_shares() {
        let mut sampler = SystemMetricsSampler::new();
        let (cpu0, ram0) = read_cpu_ram(&mut sampler);
        assert_eq!(cpu0, None, "the first reading has no CPU delta");
        let ram0 = ram0.expect("RAM is always readable");
        assert!(ram0 > 0.0 && ram0 <= 1.0, "{ram0}");
        std::thread::sleep(Duration::from_millis(250));
        let (cpu1, _) = read_cpu_ram(&mut sampler);
        let cpu1 = cpu1.expect("the second reading has a delta");
        assert!((0.0..=1.0).contains(&cpu1), "{cpu1}");
    }

    /// The cost claim in the module doc. Prints the measurement (run with
    /// `--nocapture` to see it); asserts only that both readings worked, so a
    /// slow CI box cannot fail it.
    #[test]
    fn one_host_reading_is_cheaper_than_a_per_run_tick() {
        use std::time::Instant;
        const ROUNDS: u32 = 5;
        let mut sampler = SystemMetricsSampler::new();
        let mut gpu = GpuReader::open();
        let mut probe = super::super::probe::Probe::new();
        let me = super::super::probe::RunProbe {
            root_pid: std::process::id(),
            root_start: None,
        };
        // Prime both (rates need a previous collection).
        read_cpu_ram(&mut sampler);
        gpu.read();
        probe.sample(std::slice::from_ref(&me));
        std::thread::sleep(Duration::from_millis(250));

        let t = Instant::now();
        for _ in 0..ROUNDS {
            let (_, ram) = read_cpu_ram(&mut sampler);
            assert!(ram.is_some());
            let _ = host_gpu_share_from_pids(gpu.read().as_ref());
        }
        let host = t.elapsed() / ROUNDS;

        let t = Instant::now();
        for _ in 0..ROUNDS {
            let r = probe.sample(std::slice::from_ref(&me));
            assert_eq!(r.len(), 1);
        }
        let per_run = t.elapsed() / ROUNDS;
        println!(
            "host_sampler cost: host reading {host:?} per 10 s tick vs per-run probe {per_run:?} per 5 s tick"
        );
    }
}
