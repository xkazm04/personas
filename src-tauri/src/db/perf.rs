use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use ts_rs::TS;

// ---------------------------------------------------------------------------
// Ring buffer entry
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
struct QuerySample {
    table: String,
    operation: String,
    duration: Duration,
    timestamp: Instant,
}

// ---------------------------------------------------------------------------
// Aggregate stats exposed via Tauri command
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TablePerfStats {
    pub table: String,
    pub total_queries: u64,
    pub slow_queries: u64,
    pub avg_ms: f64,
    pub p95_ms: f64,
    pub max_ms: f64,
    pub last_slow_operation: Option<String>,
}

#[derive(Debug, Clone, Serialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct DbPerfSnapshot {
    pub tables: Vec<TablePerfStats>,
    pub total_queries: u64,
    pub total_slow_queries: u64,
    pub buffer_capacity: usize,
    pub buffer_used: usize,
}

// ---------------------------------------------------------------------------
// Global ring buffer
// ---------------------------------------------------------------------------

const RING_CAPACITY: usize = 2048;
const SLOW_QUERY_THRESHOLD: Duration = Duration::from_millis(100);

// Per-table slow-query warning throttle. A burst (retry storm, hot-loop
// query, long migration) used to emit hundreds of warns per second, drowning
// real signal in tracing/Sentry. Cap to N warns per table per window; once
// the window closes, emit a single summary line counting suppressed events.
const WARN_WINDOW: Duration = Duration::from_secs(60);
const WARN_BUDGET_PER_WINDOW: u32 = 5;

#[derive(Debug)]
struct WarnBucket {
    window_start: Instant,
    emitted: u32,
    suppressed: u32,
    max_suppressed_ms: u64,
}

impl WarnBucket {
    fn new(now: Instant) -> Self {
        Self {
            window_start: now,
            emitted: 0,
            suppressed: 0,
            max_suppressed_ms: 0,
        }
    }
}

static WARN_BUCKETS: Mutex<Option<HashMap<String, WarnBucket>>> = Mutex::new(None);

/// Decide whether a slow-query warn for `table` should be emitted now.
/// Returns (should_emit, summary_to_emit) — the summary is `Some` when a
/// window just rolled over with suppressed events, carrying the table name
/// and suppressed count so the caller can log one consolidation line.
fn evaluate_warn(table: &str) -> (bool, Option<(String, u32, u64)>) {
    let now = Instant::now();
    let mut guard = WARN_BUCKETS.lock().unwrap_or_else(|e| e.into_inner());
    let buckets = guard.get_or_insert_with(HashMap::new);

    let bucket = buckets
        .entry(table.to_string())
        .or_insert_with(|| WarnBucket::new(now));

    let mut summary = None;
    if now.duration_since(bucket.window_start) >= WARN_WINDOW {
        if bucket.suppressed > 0 {
            summary = Some((table.to_string(), bucket.suppressed, bucket.max_suppressed_ms));
        }
        *bucket = WarnBucket::new(now);
    }

    if bucket.emitted < WARN_BUDGET_PER_WINDOW {
        bucket.emitted += 1;
        (true, summary)
    } else {
        bucket.suppressed += 1;
        (false, summary)
    }
}

fn record_suppressed_duration(table: &str, duration_ms: u64) {
    let mut guard = WARN_BUCKETS.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(buckets) = guard.as_mut() {
        if let Some(bucket) = buckets.get_mut(table) {
            if duration_ms > bucket.max_suppressed_ms {
                bucket.max_suppressed_ms = duration_ms;
            }
        }
    }
}

#[allow(dead_code)]
struct RingBuffer {
    samples: Vec<QuerySample>,
    head: usize,
    len: usize,
}

#[allow(dead_code)]
impl RingBuffer {
    const fn new() -> Self {
        Self {
            samples: Vec::new(),
            head: 0,
            len: 0,
        }
    }

    fn push(&mut self, sample: QuerySample) {
        if self.samples.len() < RING_CAPACITY {
            self.samples.push(sample);
            self.len = self.samples.len();
        } else {
            self.samples[self.head] = sample;
            self.head = (self.head + 1) % RING_CAPACITY;
            self.len = RING_CAPACITY;
        }
    }

    fn snapshot(&self) -> DbPerfSnapshot {
        // Group by table
        let mut by_table: HashMap<String, Vec<&QuerySample>> = HashMap::new();
        for s in &self.samples {
            by_table.entry(s.table.clone()).or_default().push(s);
        }

        let mut tables: Vec<TablePerfStats> = Vec::new();
        let mut total_queries = 0u64;
        let mut total_slow = 0u64;

        for (table, samples) in &by_table {
            let count = samples.len() as u64;
            total_queries += count;

            let mut durations_ms: Vec<f64> = samples
                .iter()
                .map(|s| s.duration.as_secs_f64() * 1000.0)
                .collect();
            durations_ms.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));

            let slow_count = samples
                .iter()
                .filter(|s| s.duration >= SLOW_QUERY_THRESHOLD)
                .count() as u64;
            total_slow += slow_count;

            let avg = durations_ms.iter().sum::<f64>() / durations_ms.len() as f64;
            let p95_idx = ((durations_ms.len() as f64) * 0.95).ceil() as usize;
            let p95 = durations_ms
                .get(p95_idx.saturating_sub(1))
                .copied()
                .unwrap_or(0.0);
            let max = durations_ms.last().copied().unwrap_or(0.0);

            let last_slow_op = samples
                .iter()
                .filter(|s| s.duration >= SLOW_QUERY_THRESHOLD)
                .max_by_key(|s| s.timestamp)
                .map(|s| s.operation.clone());

            tables.push(TablePerfStats {
                table: table.clone(),
                total_queries: count,
                slow_queries: slow_count,
                avg_ms: (avg * 100.0).round() / 100.0,
                p95_ms: (p95 * 100.0).round() / 100.0,
                max_ms: (max * 100.0).round() / 100.0,
                last_slow_operation: last_slow_op,
            });
        }

        tables.sort_by(|a, b| b.max_ms.partial_cmp(&a.max_ms).unwrap_or(std::cmp::Ordering::Equal));

        DbPerfSnapshot {
            tables,
            total_queries,
            total_slow_queries: total_slow,
            buffer_capacity: RING_CAPACITY,
            buffer_used: self.len,
        }
    }
}

static RING: Mutex<Option<RingBuffer>> = Mutex::new(None);

fn with_ring<F, R>(f: F) -> R
where
    F: FnOnce(&mut RingBuffer) -> R,
{
    let mut guard = RING.lock().unwrap_or_else(|e| e.into_inner());
    let ring = guard.get_or_insert_with(|| RingBuffer {
        samples: Vec::with_capacity(RING_CAPACITY),
        head: 0,
        len: 0,
    });
    f(ring)
}

/// Record a completed query's timing. Called by the `timed_query!` macro
/// and instrumented CRUD macros.
pub fn record_query(table: &str, operation: &str, duration: Duration) {
    if duration >= SLOW_QUERY_THRESHOLD {
        let duration_ms = duration.as_millis() as u64;
        let (should_emit, summary) = evaluate_warn(table);

        // A window just rolled over with suppressed events — consolidate them
        // into one line so ops can see the burst magnitude without drowning.
        if let Some((tbl, suppressed, max_ms)) = summary {
            tracing::warn!(
                table = %tbl,
                suppressed = suppressed,
                window_secs = WARN_WINDOW.as_secs(),
                max_duration_ms = max_ms,
                "Suppressed slow DB query warnings (rolled over)"
            );
        }

        if should_emit {
            tracing::warn!(
                table = %table,
                operation = %operation,
                duration_ms = duration_ms,
                "Slow DB query detected"
            );
        } else {
            record_suppressed_duration(table, duration_ms);
        }
    }

    with_ring(|ring| {
        ring.push(QuerySample {
            table: table.to_string(),
            operation: operation.to_string(),
            duration,
            timestamp: Instant::now(),
        });
    });
}

/// Return an aggregate snapshot of DB performance stats.
pub fn get_snapshot() -> DbPerfSnapshot {
    with_ring(|ring| ring.snapshot())
}
