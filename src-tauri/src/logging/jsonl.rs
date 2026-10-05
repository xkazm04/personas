//! The JSONL file layer: one envelope object per line.
//!
//! `{"ts","lvl","src","tgt","file","line","msg","fp","boot","span","f"}`, an
//! absent value OMITS its key. `f` carries every event field by name except
//! `message` and the `log.*` bookkeeping fields of `log`-crate records;
//! numbers and bools stay JSON, `%`/`?` values become strings. A field named
//! [`DEVLOG_FIELDS`] is the one exception: it carries a WebView record's
//! dynamic fields as one JSON object string (tracing field names must be
//! static), and its keys are MERGED into `f` rather than written as a string.
//!
//! Besides events the layer writes two synthetic records: `span.close` for a
//! span that was busy for at least [`SPAN_CLOSE_MIN_BUSY_NS`], and the
//! `log.suppressed` summaries queued by the rate limit.

use std::io::Write;
use std::sync::LazyLock;
use std::time::Instant;

use serde::Serialize;
use serde_json::{Map, Number, Value};
use tracing::field::{Field, Visit};
use tracing::span::{Attributes, Id, Record};
use tracing::{Event, Metadata, Subscriber};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::layer::{Context, Layer};
use tracing_subscriber::registry::LookupSpan;

use super::fingerprint::{fingerprint_normalized, fp_hex, take_stamp};
use super::rate_limit::{RateLimit, Suppressed};

/// The field `devlog_ingest` uses to carry a WebView record's own fields.
pub const DEVLOG_FIELDS: &str = "devlog_fields";

/// A span shorter than this (busy time) closes without a record.
pub const SPAN_CLOSE_MIN_BUSY_NS: u64 = 1_000_000;

/// One uuid v4 per process, on every record.
pub static BOOT_ID: LazyLock<String> = LazyLock::new(|| uuid::Uuid::new_v4().to_string());

#[derive(Serialize)]
struct Envelope<'a> {
    ts: &'a str,
    lvl: &'a str,
    src: &'a str,
    tgt: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    file: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    line: Option<u32>,
    msg: &'a str,
    fp: &'a str,
    boot: &'a str,
    #[serde(skip_serializing_if = "<[_]>::is_empty")]
    span: &'a [&'a str],
    #[serde(skip_serializing_if = "Map::is_empty")]
    f: &'a Map<String, Value>,
}

fn now_ts() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Micros, true)
}

fn src_of(tgt: &str) -> &'static str {
    if tgt.starts_with("webview") {
        "webview"
    } else {
        "rust"
    }
}

/// Collects fields into a JSON object.
#[derive(Default)]
pub(super) struct FieldVisitor {
    pub f: Map<String, Value>,
}

impl FieldVisitor {
    fn put(&mut self, field: &Field, value: Value) {
        let name = field.name();
        if name == "message" || name.starts_with("log.") {
            return;
        }
        self.f.insert(name.to_string(), value);
    }
}

impl Visit for FieldVisitor {
    fn record_f64(&mut self, field: &Field, value: f64) {
        let v =
            Number::from_f64(value).map_or_else(|| Value::String(value.to_string()), Value::Number);
        self.put(field, v);
    }
    fn record_i64(&mut self, field: &Field, value: i64) {
        self.put(field, Value::from(value));
    }
    fn record_u64(&mut self, field: &Field, value: u64) {
        self.put(field, Value::from(value));
    }
    fn record_i128(&mut self, field: &Field, value: i128) {
        let v = i64::try_from(value).map_or_else(|_| Value::String(value.to_string()), Value::from);
        self.put(field, v);
    }
    fn record_u128(&mut self, field: &Field, value: u128) {
        let v = u64::try_from(value).map_or_else(|_| Value::String(value.to_string()), Value::from);
        self.put(field, v);
    }
    fn record_bool(&mut self, field: &Field, value: bool) {
        self.put(field, Value::Bool(value));
    }
    fn record_str(&mut self, field: &Field, value: &str) {
        if field.name() == DEVLOG_FIELDS {
            if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(value) {
                // Record-level fields (scope, route, cts) win a name clash.
                for (k, v) in map {
                    self.f.entry(k).or_insert(v);
                }
                return;
            }
        }
        self.put(field, Value::String(value.to_string()));
    }
    fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
        self.put(field, Value::String(format!("{value:?}")));
    }
}

/// Busy/idle bookkeeping and recorded fields, kept in the span's extensions
/// (the same accounting `FmtSpan::CLOSE` does).
struct SpanState {
    fields: Map<String, Value>,
    busy_ns: u64,
    idle_ns: u64,
    last: Instant,
}

fn nanos_since(t: Instant, now: Instant) -> u64 {
    u64::try_from(now.saturating_duration_since(t).as_nanos()).unwrap_or(u64::MAX)
}

fn ms_tenths(ns: u64) -> f64 {
    (ns as f64 / 100_000.0).round() / 10.0
}

pub struct JsonlLayer<W> {
    make_writer: W,
    rate: Option<RateLimit>,
}

impl<W> JsonlLayer<W>
where
    W: for<'w> MakeWriter<'w> + 'static,
{
    /// `rate` is the limiter whose `log.suppressed` summaries this layer
    /// writes; pass the same instance that filters the layer.
    pub fn new(make_writer: W, rate: Option<RateLimit>) -> Self {
        Self { make_writer, rate }
    }

    fn write_line(&self, meta: Option<&Metadata<'_>>, env: &Envelope<'_>) {
        let mut buf = Vec::with_capacity(256);
        if serde_json::to_writer(&mut buf, env).is_err() {
            return;
        }
        buf.push(b'\n');
        // One write per line: the non-blocking writer ships each write as one
        // message, so lines from different threads never interleave.
        let mut w = match meta {
            Some(m) => self.make_writer.make_writer_for(m),
            None => self.make_writer.make_writer(),
        };
        let _ = w.write_all(&buf);
    }

    fn write_suppressed(&self, s: &Suppressed) {
        let mut f = Map::new();
        f.insert("fp_suppressed".into(), Value::String(fp_hex(s.fp)));
        f.insert("count".into(), Value::from(s.count));
        f.insert("window_s".into(), Value::from(s.window_s));
        f.insert("sample_tgt".into(), Value::String(s.sample_tgt.clone()));
        let fp = fp_hex(fingerprint_normalized("INFO", "devlog", "log.suppressed"));
        self.write_line(
            None,
            &Envelope {
                ts: &now_ts(),
                lvl: "INFO",
                src: "rust",
                tgt: "devlog",
                file: None,
                line: None,
                msg: "log.suppressed",
                fp: &fp,
                boot: &BOOT_ID,
                span: &[],
                f: &f,
            },
        );
    }

    fn flush_suppressed(&self) {
        if let Some(rate) = &self.rate {
            for s in rate.take_pending() {
                self.write_suppressed(&s);
            }
        }
    }
}

impl<S, W> Layer<S> for JsonlLayer<W>
where
    S: Subscriber + for<'a> LookupSpan<'a>,
    W: for<'w> MakeWriter<'w> + 'static,
{
    fn on_new_span(&self, attrs: &Attributes<'_>, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut visitor = FieldVisitor::default();
        attrs.record(&mut visitor);
        span.extensions_mut().insert(SpanState {
            fields: visitor.f,
            busy_ns: 0,
            idle_ns: 0,
            last: Instant::now(),
        });
    }

    fn on_record(&self, id: &Id, values: &Record<'_>, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut ext = span.extensions_mut();
        if let Some(state) = ext.get_mut::<SpanState>() {
            let mut visitor = FieldVisitor {
                f: std::mem::take(&mut state.fields),
            };
            values.record(&mut visitor);
            state.fields = visitor.f;
        }
    }

    fn on_enter(&self, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut ext = span.extensions_mut();
        if let Some(state) = ext.get_mut::<SpanState>() {
            let now = Instant::now();
            state.idle_ns = state.idle_ns.saturating_add(nanos_since(state.last, now));
            state.last = now;
        }
    }

    fn on_exit(&self, id: &Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(id) else { return };
        let mut ext = span.extensions_mut();
        if let Some(state) = ext.get_mut::<SpanState>() {
            let now = Instant::now();
            state.busy_ns = state.busy_ns.saturating_add(nanos_since(state.last, now));
            state.last = now;
        }
    }

    fn on_close(&self, id: Id, ctx: Context<'_, S>) {
        let Some(span) = ctx.span(&id) else { return };
        let Some(mut state) = span.extensions_mut().remove::<SpanState>() else {
            return;
        };
        if state.busy_ns < SPAN_CLOSE_MIN_BUSY_NS {
            return;
        }
        state.idle_ns = state
            .idle_ns
            .saturating_add(nanos_since(state.last, Instant::now()));
        let meta = span.metadata();
        let mut f = state.fields;
        f.insert("span".into(), Value::String(meta.name().to_string()));
        f.insert("busy_ms".into(), Value::from(ms_tenths(state.busy_ns)));
        f.insert("idle_ms".into(), Value::from(ms_tenths(state.idle_ns)));
        // The parents of the closing span, outermost first; the span itself
        // (the last, innermost entry) is `f.span`.
        let mut parents: Vec<&str> = span.scope().from_root().map(|s| s.name()).collect();
        parents.pop();
        let (lvl, tgt) = (meta.level().as_str(), meta.target());
        let fp = fp_hex(fingerprint_normalized(lvl, tgt, "span.close"));
        self.write_line(
            Some(meta),
            &Envelope {
                ts: &now_ts(),
                lvl,
                src: src_of(tgt),
                tgt,
                file: meta.file(),
                line: meta.line(),
                msg: "span.close",
                fp: &fp,
                boot: &BOOT_ID,
                span: &parents,
                f: &f,
            },
        );
    }

    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        self.flush_suppressed();
        let meta = event.metadata();
        let (msg, fp) = take_stamp(event);
        let mut visitor = FieldVisitor::default();
        event.record(&mut visitor);
        let spans: Vec<&str> = ctx
            .event_scope(event)
            .map(|scope| scope.from_root().map(|s| s.name()).collect())
            .unwrap_or_default();
        let tgt = meta.target();
        // A WebView record's callsite is the Rust line that re-emits it
        // (`frontend_bridge::emit_record`), which says nothing about where it
        // came from; its origin travels in `f.scope` instead.
        let (file, line) = if src_of(tgt) == "webview" {
            (None, None)
        } else {
            (meta.file(), meta.line())
        };
        self.write_line(
            Some(meta),
            &Envelope {
                ts: &now_ts(),
                lvl: meta.level().as_str(),
                src: src_of(tgt),
                tgt,
                file,
                line,
                msg: &msg,
                fp: &fp_hex(fp),
                boot: &BOOT_ID,
                span: &spans,
                f: &visitor.f,
            },
        );
    }
}

#[cfg(test)]
pub(crate) mod test_support {
    use std::io;
    use std::sync::{Arc, Mutex};

    use tracing_subscriber::fmt::MakeWriter;

    /// An in-memory sink for a test subscriber.
    #[derive(Clone, Default)]
    pub struct MemWriter(pub Arc<Mutex<Vec<u8>>>);

    impl io::Write for MemWriter {
        fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> io::Result<()> {
            Ok(())
        }
    }

    impl<'a> MakeWriter<'a> for MemWriter {
        type Writer = MemWriter;
        fn make_writer(&'a self) -> Self::Writer {
            self.clone()
        }
    }

    impl MemWriter {
        /// Every line written so far, parsed. Panics on a line that is not JSON.
        pub fn records(&self) -> Vec<serde_json::Value> {
            let raw = String::from_utf8(self.0.lock().unwrap().clone()).unwrap();
            raw.lines()
                .map(|l| serde_json::from_str(l).unwrap_or_else(|e| panic!("not JSON: {l}: {e}")))
                .collect()
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    use serde_json::json;
    use tracing_subscriber::layer::SubscriberExt;
    use tracing_subscriber::Layer as _;

    use super::test_support::MemWriter;
    use super::*;
    use crate::logging::rate_limit::{Clock, RateLimited};

    fn plain() -> (impl Subscriber + Send + Sync, MemWriter) {
        let mem = MemWriter::default();
        let sub = tracing_subscriber::registry().with(JsonlLayer::new(mem.clone(), None));
        (sub, mem)
    }

    #[test]
    fn envelope_shape_fields_spans_and_omissions() {
        let (sub, mem) = plain();
        tracing::subscriber::with_default(sub, || {
            let outer = tracing::info_span!("outer", job = 7);
            let _o = outer.enter();
            let inner = tracing::debug_span!("inner");
            let _i = inner.enter();
            tracing::warn!(
                count = 3u64,
                ratio = 0.5,
                ok = true,
                neg = -2i64,
                who = %"display",
                dbg = ?vec![1, 2],
                "Persona 3f2b8c1e-9a4d-4c2b-8e7f-1a2b3c4d5e6f updated in 1108ms"
            );
        });

        let recs = mem.records();
        let ev = recs.iter().find(|r| r["lvl"] == "WARN").unwrap();
        let obj = ev.as_object().unwrap();
        for key in [
            "ts", "lvl", "src", "tgt", "file", "line", "msg", "fp", "boot", "span", "f",
        ] {
            assert!(obj.contains_key(key), "missing {key}");
        }
        let ts = ev["ts"].as_str().unwrap();
        assert!(
            ts.ends_with('Z') && ts.len() == "2026-10-05T06:42:01.094349Z".len(),
            "{ts}"
        );
        assert_eq!(ev["src"], "rust");
        assert!(ev["line"].is_u64());
        assert_eq!(ev["span"], json!(["outer", "inner"]));
        assert_eq!(ev["f"]["count"], json!(3));
        assert_eq!(ev["f"]["ratio"], json!(0.5));
        assert_eq!(ev["f"]["ok"], json!(true));
        assert_eq!(ev["f"]["neg"], json!(-2));
        assert_eq!(ev["f"]["who"], json!("display"));
        assert_eq!(ev["f"]["dbg"], json!("[1, 2]"));
        assert!(ev["f"].get("message").is_none());
        assert_eq!(
            ev["msg"],
            "Persona 3f2b8c1e-9a4d-4c2b-8e7f-1a2b3c4d5e6f updated in 1108ms"
        );
        // The fp groups by the normalized message, so any uuid/duration gives
        // the same value.
        let expected = crate::logging::fingerprint::fingerprint(
            "WARN",
            ev["tgt"].as_str().unwrap(),
            "Persona 00000000-0000-0000-0000-000000000000 updated in 1ms",
        );
        assert_eq!(ev["fp"], fp_hex(expected));
        assert_eq!(ev["boot"], json!(*BOOT_ID));
    }

    #[test]
    fn absent_values_omit_their_keys() {
        let (sub, mem) = plain();
        tracing::subscriber::with_default(sub, || tracing::info!(target: "webview::error", "bare"));
        let rec = &mem.records()[0];
        let obj = rec.as_object().unwrap();
        assert!(!obj.contains_key("span"), "no span -> no key");
        assert!(!obj.contains_key("f"), "no fields -> no key");
        assert_eq!(rec["src"], "webview");
        // The re-emitting Rust line is not the record's origin.
        assert!(!obj.contains_key("file"), "webview -> no Rust callsite");
        assert!(!obj.contains_key("line"), "webview -> no Rust callsite");
    }

    #[test]
    fn devlog_fields_merge_into_f() {
        let (sub, mem) = plain();
        let blob =
            json!({"command": "list_personas", "duration_ms": 412, "scope": "lose"}).to_string();
        tracing::subscriber::with_default(sub, || {
            tracing::warn!(target: "webview::ipc_slow", scope = "ipc", devlog_fields = blob.as_str(), "{}", "slow ipc");
        });
        let rec = &mem.records()[0];
        assert_eq!(rec["f"]["command"], "list_personas");
        assert_eq!(rec["f"]["duration_ms"], json!(412));
        assert_eq!(rec["f"]["scope"], "ipc", "record-level field wins");
        assert!(rec["f"].get(DEVLOG_FIELDS).is_none());
        assert_eq!(rec["msg"], "slow ipc");
    }

    #[test]
    fn span_close_reports_busy_time() {
        let (sub, mem) = plain();
        tracing::subscriber::with_default(sub, || {
            let span = tracing::info_span!("work", item = "a");
            {
                let _e = span.enter();
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            drop(span);
            // Under the 1 ms floor: no record.
            drop(tracing::info_span!("quick").entered());
        });
        let closes: Vec<_> = mem
            .records()
            .into_iter()
            .filter(|r| r["msg"] == "span.close")
            .collect();
        assert_eq!(closes.len(), 1, "{closes:?}");
        let c = &closes[0];
        assert_eq!(c["f"]["span"], "work");
        assert_eq!(c["f"]["item"], "a");
        assert!(c["f"]["busy_ms"].as_f64().unwrap() >= 5.0, "{c}");
        assert!(c["f"]["idle_ms"].is_number());
        assert_eq!(c["lvl"], "INFO");
        assert!(c.get("span").is_none(), "a root span has no parents");
    }

    /// The real composition: rate limit around stdout + JSONL, shared state.
    #[test]
    fn rate_limit_bounds_repeats_and_writes_one_summary() {
        let ms = Arc::new(AtomicU64::new(0));
        let rl = RateLimit::with_params(Clock::Manual(ms.clone()), 20, 60_000, 10_000);
        let mem = MemWriter::default();
        let stdout = MemWriter::default();
        let sinks = RateLimited::new(
            tracing_subscriber::fmt::layer()
                .with_writer(stdout.clone())
                .and_then(JsonlLayer::new(mem.clone(), Some(rl.clone()))),
            rl,
        );
        let sub = tracing_subscriber::registry().with(sinks);
        tracing::subscriber::with_default(sub, || {
            for _ in 0..100 {
                tracing::warn!(target: "app_lib::engine::kp_reporter", "KP report push failed");
            }
            for _ in 0..30 {
                tracing::error!("never limited");
            }
            ms.store(61_000, Ordering::Relaxed);
            tracing::warn!(target: "app_lib::engine::kp_reporter", "KP report push failed");
        });
        let recs = mem.records();
        let warns = recs
            .iter()
            .filter(|r| r["msg"] == "KP report push failed")
            .count();
        assert_eq!(warns, 21, "20 in the first window + 1 after rollover");
        assert_eq!(
            recs.iter().filter(|r| r["msg"] == "never limited").count(),
            30
        );
        let sup: Vec<_> = recs
            .iter()
            .filter(|r| r["msg"] == "log.suppressed")
            .collect();
        assert_eq!(sup.len(), 1);
        assert_eq!(sup[0]["f"]["count"], json!(80));
        assert_eq!(sup[0]["f"]["window_s"], json!(60));
        assert_eq!(
            sup[0]["f"]["fp_suppressed"], "3de00333",
            "fp vector of this record"
        );
        assert_eq!(sup[0]["fp"], "3ebc678a");
        assert_eq!(sup[0]["tgt"], "devlog");
        // stdout saw the same bound (20 + 1 warns, 30 errors).
        let text = String::from_utf8(stdout.0.lock().unwrap().clone()).unwrap();
        assert_eq!(text.matches("KP report push failed").count(), 21);
    }
}
