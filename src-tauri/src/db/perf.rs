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
        tracing::warn!(
            table = %table,
            operation = %operation,
            duration_ms = duration.as_millis() as u64,
            "Slow DB query detected"
        );
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
