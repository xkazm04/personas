//! The three commands the WebView shell itself calls: a liveness probe, the
//! batched log sink (`devlog_ingest`), and the time-to-interactive report.
//!
//! Moved verbatim out of `lib.rs` (Rust refactor W1). The command *names* are
//! part of the IPC contract and are derived from these fn names. The old
//! per-message `log_frontend_error` was retired by the devlog spark: it wrote
//! every WebView message twice (once raw with a local-time stamp, once as a
//! tracing event), and `devlog_ingest` replaced it.

use serde::Deserialize;
use ts_rs::TS;

use crate::error::AppError;
use crate::startup_timing;

/// Hello world IPC command -- verifies the Rust <-> React bridge works.
#[tauri::command]
#[tracing::instrument]
pub fn greet(name: String) -> String {
    tracing::info!(name = %name, "greet command called");
    format!("Hello from Rust, {}! Personas desktop is alive.", name)
}

/// What a [`DevlogRecord`] reports. The WebView's producers are fixed: each
/// kind is one instrument in `src/lib/devlog/`, and the record lands in the
/// rolling JSONL file with target `webview::<kind>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DevlogKind {
    Error,
    IpcSlow,
    IpcWindow,
    LongTask,
    Commit,
    Freeze,
    StoreAlert,
    SwallowRollup,
}

/// Severity of a [`DevlogRecord`], with the same meaning as the Rust levels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum DevlogLevel {
    Debug,
    Info,
    Warn,
    Error,
}

/// One record the WebView sends into the app's log sink through
/// [`devlog_ingest`]. `msg` is a constant string; everything variable goes in
/// `fields`, so the sink can fingerprint and group it.
#[derive(Debug, Clone, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct DevlogRecord {
    pub kind: DevlogKind,
    pub lvl: DevlogLevel,
    /// The producer's scope, e.g. `ipc`, `global-error`, `silentFailures`.
    pub scope: String,
    pub msg: String,
    /// Client clock at the moment the record was made, epoch milliseconds.
    pub cts: f64,
    /// The active sidebar section, when the shell has one.
    #[serde(default)]
    #[ts(optional)]
    pub route: Option<String>,
    /// Named fields; always a JSON object.
    #[ts(type = "Record<string, unknown>")]
    pub fields: serde_json::Value,
}

/// Batched sink for WebView records (see `src/lib/devlog/`). Each record is
/// re-emitted as a tracing event so it shares the file, envelope, fingerprint
/// and rate limit of every Rust record.
#[tauri::command]
pub fn devlog_ingest(records: Vec<DevlogRecord>) -> Result<(), AppError> {
    let dropped = records.len().saturating_sub(INGEST_MAX_RECORDS);
    for record in records.iter().take(INGEST_MAX_RECORDS) {
        emit_record(record);
    }
    if dropped > 0 {
        tracing::warn!(dropped, "devlog ingest batch truncated");
    }
    Ok(())
}

/// Records accepted per `devlog_ingest` call; the rest are dropped and counted.
const INGEST_MAX_RECORDS: usize = 200;
/// `msg` is a constant by contract; this only bounds a producer that breaks it.
const INGEST_MAX_MSG_CHARS: usize = 512;
/// Serialized size cap of a record's `fields` object.
const INGEST_MAX_FIELDS_BYTES: usize = 4096;

/// `record.fields` as one JSON object string for `logging::DEVLOG_FIELDS`,
/// or `None` when empty. Keys are kept in order (serde_json's map order)
/// until the next one would cross [`INGEST_MAX_FIELDS_BYTES`]; the rest are
/// dropped and `truncated: true` is added. A non-object payload is kept under
/// the key `value`.
fn fields_blob(fields: &serde_json::Value) -> Option<String> {
    let map = match fields {
        serde_json::Value::Object(map) if map.is_empty() => return None,
        serde_json::Value::Object(map) => map.clone(),
        serde_json::Value::Null => return None,
        other => {
            let mut map = serde_json::Map::new();
            map.insert("value".into(), other.clone());
            map
        }
    };
    let full = serde_json::to_string(&map).ok()?;
    if full.len() <= INGEST_MAX_FIELDS_BYTES {
        return Some(full);
    }
    // Room for the braces and `,"truncated":true`.
    let budget = INGEST_MAX_FIELDS_BYTES - r#"{,"truncated":true}"#.len();
    let mut kept = serde_json::Map::new();
    let mut used = 0usize;
    for (key, value) in map {
        let entry = serde_json::to_string(&key).map_or(0, |k| k.len())
            + 1
            + serde_json::to_string(&value).map_or(0, |v| v.len())
            + usize::from(!kept.is_empty());
        if used + entry > budget {
            break;
        }
        used += entry;
        kept.insert(key, value);
    }
    kept.insert("truncated".into(), serde_json::Value::Bool(true));
    serde_json::to_string(&kept).ok()
}

/// One record as one tracing event. Tracing needs a static target and level
/// per callsite, so `emit_at!` expands one call per level and the match below
/// picks the `webview::<kind>` target. The message is dynamic, so the sink
/// fingerprints it through the normalization path.
fn emit_record(record: &DevlogRecord) {
    let msg: std::borrow::Cow<'_, str> = if record.msg.chars().count() > INGEST_MAX_MSG_CHARS {
        record
            .msg
            .chars()
            .take(INGEST_MAX_MSG_CHARS)
            .collect::<String>()
            .into()
    } else {
        record.msg.as_str().into()
    };
    let fields = fields_blob(&record.fields);
    let devlog_fields = fields.as_deref();
    let (scope, route, cts) = (record.scope.as_str(), record.route.as_deref(), record.cts);
    let lvl = record.lvl;

    // `devlog_fields` must match `logging::DEVLOG_FIELDS`, the name the JSONL
    // layer merges into `f` (field names are identifiers, not expressions).
    macro_rules! emit_at {
        ($target:literal) => {
            match lvl {
                DevlogLevel::Error => {
                    tracing::error!(target: $target, scope, route, cts, devlog_fields, "{}", msg)
                }
                DevlogLevel::Warn => {
                    tracing::warn!(target: $target, scope, route, cts, devlog_fields, "{}", msg)
                }
                DevlogLevel::Info => {
                    tracing::info!(target: $target, scope, route, cts, devlog_fields, "{}", msg)
                }
                DevlogLevel::Debug => {
                    tracing::debug!(target: $target, scope, route, cts, devlog_fields, "{}", msg)
                }
            }
        };
    }

    match record.kind {
        DevlogKind::Error => emit_at!("webview::error"),
        DevlogKind::IpcSlow => emit_at!("webview::ipc_slow"),
        DevlogKind::IpcWindow => emit_at!("webview::ipc_window"),
        DevlogKind::LongTask => emit_at!("webview::long_task"),
        DevlogKind::Commit => emit_at!("webview::commit"),
        DevlogKind::Freeze => emit_at!("webview::freeze"),
        DevlogKind::StoreAlert => emit_at!("webview::store_alert"),
        DevlogKind::SwallowRollup => emit_at!("webview::swallow_rollup"),
    }
}

/// Called by the frontend to report its time-to-interactive.
#[tauri::command]
pub fn report_frontend_ready(tti_ms: f64) {
    startup_timing::set_frontend_tti(tti_ms);
    tracing::info!(tti_ms = tti_ms, "Frontend time-to-interactive reported");
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use tracing_subscriber::layer::SubscriberExt;

    use super::*;
    use crate::logging::test_support::{jsonl_capture, MemWriter, DEVLOG_FIELDS};

    fn record(kind: DevlogKind, lvl: DevlogLevel, fields: serde_json::Value) -> DevlogRecord {
        DevlogRecord {
            kind,
            lvl,
            scope: "ipc".into(),
            msg: "ipc slow".into(),
            cts: 1_759_650_000_123.5,
            route: Some("agents".into()),
            fields,
        }
    }

    fn ingest(records: Vec<DevlogRecord>) -> Vec<serde_json::Value> {
        let mem = MemWriter::default();
        let sub = tracing_subscriber::registry().with(jsonl_capture(mem.clone()));
        tracing::subscriber::with_default(sub, || devlog_ingest(records).unwrap());
        mem.records()
    }

    #[test]
    fn record_becomes_a_webview_event_with_merged_fields() {
        let recs = ingest(vec![record(
            DevlogKind::IpcSlow,
            DevlogLevel::Warn,
            json!({"command": "list_personas", "duration_ms": 412.5, "ok": true}),
        )]);
        assert_eq!(recs.len(), 1);
        let r = &recs[0];
        assert_eq!(r["tgt"], "webview::ipc_slow");
        assert_eq!(r["src"], "webview");
        assert_eq!(r["lvl"], "WARN");
        assert_eq!(r["msg"], "ipc slow");
        assert_eq!(r["f"]["scope"], "ipc");
        assert_eq!(r["f"]["route"], "agents");
        assert_eq!(r["f"]["cts"], json!(1_759_650_000_123.5));
        assert_eq!(r["f"]["command"], "list_personas");
        assert_eq!(r["f"]["duration_ms"], json!(412.5));
        assert_eq!(r["f"]["ok"], json!(true));
        assert!(r["f"].get("truncated").is_none());
        assert!(r["f"].get(DEVLOG_FIELDS).is_none(), "merged, not a string");
    }

    #[test]
    fn absent_route_and_empty_fields_are_omitted() {
        let mut rec = record(DevlogKind::Error, DevlogLevel::Error, json!({}));
        rec.route = None;
        let recs = ingest(vec![rec]);
        let f = recs[0]["f"].as_object().unwrap();
        assert!(!f.contains_key("route"));
        assert!(!f.contains_key(DEVLOG_FIELDS));
        assert_eq!(recs[0]["tgt"], "webview::error");
        assert_eq!(recs[0]["lvl"], "ERROR");
    }

    #[test]
    fn batch_over_cap_emits_200_and_one_truncation_warning() {
        let batch: Vec<_> = (0..201)
            .map(|_| record(DevlogKind::LongTask, DevlogLevel::Info, json!({"ms": 60})))
            .collect();
        let recs = ingest(batch);
        let webview = recs.iter().filter(|r| r["src"] == "webview").count();
        assert_eq!(webview, 200);
        let warn: Vec<_> = recs
            .iter()
            .filter(|r| r["msg"] == "devlog ingest batch truncated")
            .collect();
        assert_eq!(warn.len(), 1);
        assert_eq!(warn[0]["f"]["dropped"], json!(1));
        assert_eq!(warn[0]["lvl"], "WARN");
    }

    #[test]
    fn oversized_fields_keep_a_prefix_and_flag_truncated() {
        let mut fields = serde_json::Map::new();
        for i in 0..40 {
            fields.insert(format!("k{i:02}"), json!("x".repeat(200)));
        }
        let fields = serde_json::Value::Object(fields);
        let blob = fields_blob(&fields).unwrap();
        assert!(blob.len() <= INGEST_MAX_FIELDS_BYTES, "{}", blob.len());
        let parsed: serde_json::Value = serde_json::from_str(&blob).unwrap();
        assert_eq!(parsed["truncated"], json!(true));
        assert!(parsed.get("k00").is_some() && parsed.get("k39").is_none());

        let recs = ingest(vec![record(
            DevlogKind::StoreAlert,
            DevlogLevel::Warn,
            fields,
        )]);
        assert_eq!(recs[0]["f"]["truncated"], json!(true));
        assert!(recs[0]["f"].get("k00").is_some());
    }

    #[test]
    fn long_message_is_cut_to_512_chars() {
        let mut rec = record(DevlogKind::Freeze, DevlogLevel::Warn, json!({}));
        rec.msg = "\u{e9}".repeat(600);
        let recs = ingest(vec![rec]);
        assert_eq!(recs[0]["msg"].as_str().unwrap().chars().count(), 512);
    }
}
