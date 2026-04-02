use std::collections::HashMap;

use chrono::{DateTime, Datelike, Timelike, Utc};
use chrono_tz::Tz;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::engine::lifecycle::TriggerStatus;

// ============================================================================
// Triggers
// ============================================================================

/// Valid condition types for chain triggers.
///
/// Determines when a chain trigger fires based on the source persona's
/// execution outcome.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChainConditionType {
    /// Fire regardless of execution outcome (default).
    #[default]
    Any,
    /// Fire only when the source execution completed successfully
    /// (execution status == "completed").
    Success,
    /// Fire only when the source execution failed
    /// (execution status == "failed").
    Failure,
    /// Fire based on a JSONPath expression evaluated against the execution
    /// output. Requires `jsonpath` and optionally `expected` fields in the
    /// condition object.
    Jsonpath,
}

impl ChainConditionType {
    /// All valid condition type values, for use in error messages.
    pub const VALID_VALUES: &'static [&'static str] = &["any", "success", "failure", "jsonpath"];
}

impl std::fmt::Display for ChainConditionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Any => write!(f, "any"),
            Self::Success => write!(f, "success"),
            Self::Failure => write!(f, "failure"),
            Self::Jsonpath => write!(f, "jsonpath"),
        }
    }
}

impl std::str::FromStr for ChainConditionType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "any" => Ok(Self::Any),
            "success" => Ok(Self::Success),
            "failure" => Ok(Self::Failure),
            "jsonpath" => Ok(Self::Jsonpath),
            other => Err(format!(
                "Unknown chain condition type \"{}\". Valid values: {}",
                other,
                Self::VALID_VALUES.join(", ")
            )),
        }
    }
}


/// Condition for chain triggers: when a source persona finishes, what outcome
/// should fire the chain?
///
/// ## Condition types
///
/// | `type`      | Fires when                                         | `status` field |
/// |-------------|-----------------------------------------------------|---------------|
/// | `"any"`     | Always, regardless of outcome (default)             | Ignored       |
/// | `"success"` | Execution status is `"completed"`                   | Ignored       |
/// | `"failure"` | Execution status is `"failed"`                      | Ignored       |
/// | `"jsonpath"`| A JSONPath expression on the output matches         | Ignored       |
///
/// ## Status mapping
///
/// The `status` field is an optional filter on the raw execution status string.
/// Execution statuses are: `"completed"`, `"failed"`, `"running"`, `"queued"`.
/// When set, only executions with a matching status will fire the chain.
/// In practice, prefer using `condition_type` (`success`/`failure`) instead of
/// the raw `status` field for readability.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainCondition {
    /// Condition type — must be one of: "any", "success", "failure", "jsonpath".
    #[serde(rename = "type", default)]
    pub condition_type: ChainConditionType,
    /// Optional raw execution status filter (e.g. "completed", "failed").
    /// Prefer using `condition_type` instead for standard success/failure matching.
    #[serde(default)]
    pub status: Option<String>,
}

/// A single condition within a composite trigger.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositeCondition {
    /// The event type to match.
    pub event_type: String,
    /// Optional wildcard source filter.
    #[serde(default)]
    pub source_filter: Option<String>,
}

/// Time-window constraint: trigger only fires during configured active hours.
/// Stored inside the trigger's `config` JSON under the `active_window` key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActiveWindow {
    /// Whether the active window constraint is enabled.
    #[serde(default)]
    pub enabled: bool,
    /// Days of the week when the trigger is active (0 = Sunday .. 6 = Saturday).
    #[serde(default)]
    pub days: Vec<u8>,
    /// Start hour (0-23) in the configured timezone.
    #[serde(default = "default_start_hour")]
    pub start_hour: u8,
    /// Start minute (0-59).
    #[serde(default)]
    pub start_minute: u8,
    /// End hour (0-23) in the configured timezone.
    #[serde(default = "default_end_hour")]
    pub end_hour: u8,
    /// End minute (0-59).
    #[serde(default)]
    pub end_minute: u8,
    /// IANA timezone name (e.g. "America/New_York", "Europe/London").
    /// When `None`, the system's local timezone is used.
    #[serde(default)]
    pub timezone: Option<String>,
}

fn default_start_hour() -> u8 { 9 }
fn default_end_hour() -> u8 { 18 }

impl ActiveWindow {
    /// Resolve the configured timezone. Falls back to system local offset
    /// when `timezone` is `None` or contains an unrecognised IANA name.
    fn resolve_tz(&self) -> Option<Tz> {
        self.timezone.as_deref().and_then(|s| s.parse::<Tz>().ok())
    }

    /// Return the IANA timezone name that will actually be used at evaluation
    /// time. Useful for displaying in the UI so users know which timezone is
    /// in effect.
    pub fn resolved_timezone_name(&self) -> String {
        match self.resolve_tz() {
            Some(tz) => tz.name().to_string(),
            None => iana_time_zone::get_timezone().unwrap_or_else(|_| "Local".to_string()),
        }
    }

    /// Check whether the given UTC time falls within this active window.
    /// Uses the configured timezone (or system local when unset).
    pub fn is_active_at(&self, utc_now: DateTime<Utc>) -> bool {
        if !self.enabled || self.days.is_empty() {
            return true; // no constraint → always active
        }

        let (weekday, now_minutes) = match self.resolve_tz() {
            Some(tz) => {
                let t = utc_now.with_timezone(&tz);
                (t.weekday().num_days_from_sunday() as u8, t.hour() as u16 * 60 + t.minute() as u16)
            }
            None => {
                let t = utc_now.with_timezone(&chrono::Local);
                (t.weekday().num_days_from_sunday() as u8, t.hour() as u16 * 60 + t.minute() as u16)
            }
        };

        if !self.days.contains(&weekday) {
            return false;
        }

        let start_minutes = self.start_hour as u16 * 60 + self.start_minute as u16;
        let end_minutes = self.end_hour as u16 * 60 + self.end_minute as u16;

        if start_minutes <= end_minutes {
            now_minutes >= start_minutes && now_minutes < end_minutes
        } else {
            // Overnight window (e.g. 22:00 → 06:00)
            now_minutes >= start_minutes || now_minutes < end_minutes
        }
    }

    /// Compute the number of seconds until the next active window opens.
    ///
    /// Searches up to 7 days ahead for the next matching day + start_hour:start_minute.
    /// Returns `None` if no active days are configured or the window is disabled.
    pub fn seconds_until_next_open(&self, utc_now: DateTime<Utc>) -> Option<u64> {
        if !self.enabled || self.days.is_empty() {
            return None;
        }

        let (now_minutes, current_weekday, seconds_into_minute) = match self.resolve_tz() {
            Some(tz) => {
                let t = utc_now.with_timezone(&tz);
                (
                    t.hour() as u16 * 60 + t.minute() as u16,
                    t.weekday().num_days_from_sunday() as u8,
                    t.second() as u64,
                )
            }
            None => {
                let t = utc_now.with_timezone(&chrono::Local);
                (
                    t.hour() as u16 * 60 + t.minute() as u16,
                    t.weekday().num_days_from_sunday() as u8,
                    t.second() as u64,
                )
            }
        };

        let start_minutes = self.start_hour as u16 * 60 + self.start_minute as u16;

        // Check today first: if we're before the start time on an active day
        if self.days.contains(&current_weekday) && now_minutes < start_minutes {
            let diff = (start_minutes - now_minutes) as u64 * 60;
            return Some(diff.saturating_sub(seconds_into_minute));
        }

        // Search up to 7 days ahead for the next active day
        for offset in 1..=7u8 {
            let candidate_day = (current_weekday + offset) % 7;
            if self.days.contains(&candidate_day) {
                let remaining_today_minutes = (24 * 60) - now_minutes as u64;
                let full_days_between = (offset as u64 - 1) * 24 * 60;
                let total_minutes = remaining_today_minutes + full_days_between + start_minutes as u64;
                return Some(total_minutes * 60 - seconds_into_minute);
            }
        }

        None
    }
}

/// Parsed, typed representation of a trigger's `config` JSON.
///
/// Each variant carries only the fields that trigger type needs, making invalid
/// states unrepresentable. Produced by `PersonaTrigger::parse_config()` -- call
/// once, reuse everywhere.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum TriggerConfig {
    #[serde(rename = "schedule")]
    Schedule {
        cron: Option<String>,
        interval_seconds: Option<u64>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    #[serde(rename = "polling")]
    Polling {
        url: Option<String>,
        headers: Option<HashMap<String, String>>,
        content_hash: Option<String>,
        interval_seconds: Option<u64>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    #[serde(rename = "webhook")]
    Webhook {
        webhook_secret: Option<String>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    #[serde(rename = "chain")]
    Chain {
        source_persona_id: Option<String>,
        condition: Option<ChainCondition>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    #[serde(rename = "manual")]
    Manual {
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    /// Unified event listener -- replaces persona_event_subscriptions.
    /// Listens for events matching `listen_event_type` with optional source wildcard.
    #[serde(rename = "event_listener")]
    EventListener {
        /// The event type to listen for (matches PersonaEvent.event_type).
        listen_event_type: Option<String>,
        /// Optional wildcard source filter (e.g. "watcher-*").
        source_filter: Option<String>,
    },
    /// Watches file system paths for changes (create, modify, delete, rename).
    #[serde(rename = "file_watcher")]
    FileWatcher {
        /// Directories or files to watch.
        watch_paths: Option<Vec<String>>,
        /// Which FS events to react to: "create", "modify", "delete", "rename".
        events: Option<Vec<String>>,
        /// Watch subdirectories recursively.
        recursive: Option<bool>,
        /// Optional glob filter (e.g. "*.py", "*.rs").
        glob_filter: Option<String>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    /// Monitors clipboard content changes.
    #[serde(rename = "clipboard")]
    Clipboard {
        /// What to watch for: "text", "image", or "any".
        content_type: Option<String>,
        /// Optional regex or substring to match against text content.
        pattern: Option<String>,
        /// Poll interval in seconds (min 2).
        interval_seconds: Option<u64>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    /// Monitors application focus / foreground window changes.
    #[serde(rename = "app_focus")]
    AppFocus {
        /// Optional list of app executable names to filter (e.g. ["Code.exe", "chrome.exe"]).
        app_names: Option<Vec<String>>,
        /// Optional regex to match window titles.
        title_pattern: Option<String>,
        /// Poll interval in seconds (min 2).
        interval_seconds: Option<u64>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    /// Composite trigger: fires when multiple event conditions are met within a time window.
    #[serde(rename = "composite")]
    Composite {
        /// Array of conditions that must be satisfied.
        conditions: Option<Vec<CompositeCondition>>,
        /// How to combine conditions: "all" (AND), "any" (OR), "sequence" (ordered).
        operator: Option<String>,
        /// Time window in seconds for all conditions to be met.
        window_seconds: Option<u64>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    #[serde(rename = "unknown")]
    Unknown {
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
}

impl TriggerConfig {
    /// The event type string to publish, defaulting to `"trigger_fired"`.
    pub fn event_type(&self) -> &str {
        let opt = match self {
            TriggerConfig::Schedule { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Polling { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Webhook { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Chain { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Manual { event_type, .. } => event_type.as_deref(),
            TriggerConfig::EventListener { listen_event_type, .. } => listen_event_type.as_deref(),
            TriggerConfig::FileWatcher { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Clipboard { event_type, .. } => event_type.as_deref(),
            TriggerConfig::AppFocus { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Composite { event_type, .. } => event_type.as_deref(),
            TriggerConfig::Unknown { event_type, .. } => event_type.as_deref(),
        };
        opt.unwrap_or("trigger_fired")
    }

    /// The serialized payload string, if any.
    pub fn payload(&self) -> Option<String> {
        let opt = match self {
            TriggerConfig::Schedule { payload, .. } => payload.as_ref(),
            TriggerConfig::Polling { payload, .. } => payload.as_ref(),
            TriggerConfig::Webhook { payload, .. } => payload.as_ref(),
            TriggerConfig::Chain { payload, .. } => payload.as_ref(),
            TriggerConfig::Manual { payload, .. } => payload.as_ref(),
            TriggerConfig::EventListener { .. } => None,
            TriggerConfig::FileWatcher { payload, .. } => payload.as_ref(),
            TriggerConfig::Clipboard { payload, .. } => payload.as_ref(),
            TriggerConfig::AppFocus { payload, .. } => payload.as_ref(),
            TriggerConfig::Composite { payload, .. } => payload.as_ref(),
            TriggerConfig::Unknown { payload, .. } => payload.as_ref(),
        };
        opt.map(|p| p.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PersonaTrigger {
    pub id: String,
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: bool,
    /// Persisted lifecycle status: "active", "paused", "errored", or "disabled".
    /// Added by migration; older rows are backfilled from `enabled`.
    #[serde(default = "default_trigger_status")]
    pub status: String,
    pub last_triggered_at: Option<String>,
    pub next_trigger_at: Option<String>,
    /// Monotonic version counter for race-safe CAS in `mark_triggered`.
    #[serde(default)]
    pub trigger_version: i32,
    pub created_at: String,
    pub updated_at: String,
    pub use_case_id: Option<String>,
}

fn default_trigger_status() -> String {
    "active".into()
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTriggerInput {
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub use_case_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UpdateTriggerInput {
    pub trigger_type: Option<String>,
    pub config: Option<String>,
    pub enabled: Option<bool>,
    pub next_trigger_at: Option<Option<String>>,
}

impl PersonaTrigger {
    /// Return the typed lifecycle status parsed from the `status` column.
    ///
    /// Falls back to the legacy `enabled` boolean bridge when the column
    /// contains an unrecognised value (shouldn't happen after migration).
    pub fn typed_status(&self) -> TriggerStatus {
        self.status
            .parse::<TriggerStatus>()
            .unwrap_or_else(|_| TriggerStatus::from_enabled(self.enabled))
    }

    /// Decrypt the config JSON, transparently handling both encrypted and
    /// legacy plaintext formats.
    fn decrypted_config_json(&self) -> Option<String> {
        let raw = self.config.as_deref()?;
        match crate::engine::crypto::decrypt_trigger_config(raw) {
            Ok(decrypted) => Some(decrypted),
            Err(e) => {
                tracing::warn!(
                    trigger_id = %self.id,
                    "Failed to decrypt trigger config, using raw: {}", e
                );
                Some(raw.to_string())
            }
        }
    }

    /// Parse the `active_window` from the config JSON, if present.
    pub fn parse_active_window(&self) -> Option<ActiveWindow> {
        let config_str = self.decrypted_config_json()?;
        let val: serde_json::Value = serde_json::from_str(&config_str).ok()?;
        val.get("active_window")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
    }

    /// Check whether this trigger is within its active window right now.
    pub fn is_within_active_window(&self, utc_now: DateTime<Utc>) -> bool {
        match self.parse_active_window() {
            Some(aw) => aw.is_active_at(utc_now),
            None => true, // no window configured → always active
        }
    }

    /// Parse the raw `config` JSON string once and return a typed `TriggerConfig`.
    /// All downstream consumers should call this once and reuse the result.
    /// Automatically decrypts encrypted fields before parsing.
    pub fn parse_config(&self) -> TriggerConfig {
        let decrypted = self.decrypted_config_json();
        let val: serde_json::Value = decrypted
            .as_deref()
            .and_then(|c| serde_json::from_str(c).ok())
            .unwrap_or(serde_json::Value::Null);

        let event_type = val
            .get("event_type")
            .and_then(|v| v.as_str())
            .map(String::from);
        let payload = val.get("payload").cloned();

        match self.trigger_type.as_str() {
            "schedule" => TriggerConfig::Schedule {
                cron: val.get("cron").and_then(|v| v.as_str()).map(String::from),
                interval_seconds: val.get("interval_seconds").and_then(|v| v.as_u64()),
                event_type,
                payload,
            },
            "polling" => TriggerConfig::Polling {
                url: val.get("url").and_then(|v| v.as_str()).map(String::from),
                headers: val
                    .get("headers")
                    .and_then(|h| h.as_object())
                    .map(|obj| {
                        obj.iter()
                            .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                            .collect()
                    }),
                content_hash: val
                    .get("content_hash")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                interval_seconds: val.get("interval_seconds").and_then(|v| v.as_u64()),
                event_type,
                payload,
            },
            "webhook" => TriggerConfig::Webhook {
                webhook_secret: val
                    .get("webhook_secret")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                event_type,
                payload,
            },
            "chain" => TriggerConfig::Chain {
                source_persona_id: val
                    .get("source_persona_id")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                condition: val
                    .get("condition")
                    .and_then(|v| serde_json::from_value(v.clone()).ok()),
                event_type,
                payload,
            },
            "manual" => TriggerConfig::Manual { event_type, payload },
            "event_listener" => TriggerConfig::EventListener {
                listen_event_type: val
                    .get("listen_event_type")
                    .and_then(|v| v.as_str())
                    .map(String::from),
                source_filter: val
                    .get("source_filter")
                    .and_then(|v| v.as_str())
                    .map(String::from),
            },
            "file_watcher" => TriggerConfig::FileWatcher {
                watch_paths: val.get("watch_paths").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter().filter_map(|s| s.as_str().map(String::from)).collect()
                    })
                }),
                events: val.get("events").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter().filter_map(|s| s.as_str().map(String::from)).collect()
                    })
                }),
                recursive: val.get("recursive").and_then(|v| v.as_bool()),
                glob_filter: val.get("glob_filter").and_then(|v| v.as_str()).map(String::from),
                event_type,
                payload,
            },
            "clipboard" => TriggerConfig::Clipboard {
                content_type: val.get("content_type").and_then(|v| v.as_str()).map(String::from),
                pattern: val.get("pattern").and_then(|v| v.as_str()).map(String::from),
                interval_seconds: val.get("interval_seconds").and_then(|v| v.as_u64()),
                event_type,
                payload,
            },
            "app_focus" => TriggerConfig::AppFocus {
                app_names: val.get("app_names").and_then(|v| {
                    v.as_array().map(|arr| {
                        arr.iter().filter_map(|s| s.as_str().map(String::from)).collect()
                    })
                }),
                title_pattern: val.get("title_pattern").and_then(|v| v.as_str()).map(String::from),
                interval_seconds: val.get("interval_seconds").and_then(|v| v.as_u64()),
                event_type,
                payload,
            },
            "composite" => TriggerConfig::Composite {
                conditions: val.get("conditions").and_then(|v| {
                    serde_json::from_value(v.clone()).ok()
                }),
                operator: val.get("operator").and_then(|v| v.as_str()).map(String::from),
                window_seconds: val.get("window_seconds").and_then(|v| v.as_u64()),
                event_type,
                payload,
            },
            _ => TriggerConfig::Unknown { event_type, payload },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_trigger(trigger_type: &str, config: Option<&str>) -> PersonaTrigger {
        PersonaTrigger {
            id: "t1".into(),
            persona_id: "p1".into(),
            trigger_type: trigger_type.into(),
            config: config.map(String::from),
            enabled: true,
            status: "active".into(),
            last_triggered_at: None,
            next_trigger_at: None,
            trigger_version: 0,
            created_at: "2026-01-01T00:00:00Z".into(),
            updated_at: "2026-01-01T00:00:00Z".into(),
            use_case_id: None,
        }
    }

    #[test]
    fn test_parse_schedule_config() {
        let t = make_trigger("schedule", Some(r#"{"cron":"0 * * * *","interval_seconds":300,"event_type":"build_check"}"#));
        match t.parse_config() {
            TriggerConfig::Schedule { cron, interval_seconds, event_type, .. } => {
                assert_eq!(cron.as_deref(), Some("0 * * * *"));
                assert_eq!(interval_seconds, Some(300));
                assert_eq!(event_type.as_deref(), Some("build_check"));
            }
            other => panic!("Expected Schedule, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_polling_config() {
        let t = make_trigger(
            "polling",
            Some(r#"{"url":"https://api.example.com","headers":{"Authorization":"Bearer x"},"content_hash":"abc123","interval_seconds":600}"#),
        );
        match t.parse_config() {
            TriggerConfig::Polling { url, headers, content_hash, interval_seconds, .. } => {
                assert_eq!(url.as_deref(), Some("https://api.example.com"));
                assert_eq!(headers.as_ref().and_then(|h| h.get("Authorization")).map(|s| s.as_str()), Some("Bearer x"));
                assert_eq!(content_hash.as_deref(), Some("abc123"));
                assert_eq!(interval_seconds, Some(600));
            }
            other => panic!("Expected Polling, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_webhook_config() {
        let t = make_trigger("webhook", Some(r#"{"webhook_secret":"my-secret","event_type":"deploy"}"#));
        match t.parse_config() {
            TriggerConfig::Webhook { webhook_secret, event_type, .. } => {
                assert_eq!(webhook_secret.as_deref(), Some("my-secret"));
                assert_eq!(event_type.as_deref(), Some("deploy"));
            }
            other => panic!("Expected Webhook, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_chain_config() {
        let t = make_trigger(
            "chain",
            Some(r#"{"source_persona_id":"sp1","condition":{"type":"success","status":"completed"}}"#),
        );
        match t.parse_config() {
            TriggerConfig::Chain { source_persona_id, condition, .. } => {
                assert_eq!(source_persona_id.as_deref(), Some("sp1"));
                let cond = condition.unwrap();
                assert_eq!(cond.condition_type, ChainConditionType::Success);
                assert_eq!(cond.status.as_deref(), Some("completed"));
            }
            other => panic!("Expected Chain, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_manual_config() {
        let t = make_trigger("manual", None);
        match t.parse_config() {
            TriggerConfig::Manual { event_type, payload } => {
                assert!(event_type.is_none());
                assert!(payload.is_none());
            }
            other => panic!("Expected Manual, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_unknown_type() {
        let t = make_trigger("exotic", Some(r#"{"event_type":"foo"}"#));
        match t.parse_config() {
            TriggerConfig::Unknown { event_type, .. } => {
                assert_eq!(event_type.as_deref(), Some("foo"));
            }
            other => panic!("Expected Unknown, got {other:?}"),
        }
    }

    #[test]
    fn test_event_type_defaults() {
        let t = make_trigger("manual", None);
        assert_eq!(t.parse_config().event_type(), "trigger_fired");
    }

    #[test]
    fn test_parse_event_listener_config() {
        let t = make_trigger(
            "event_listener",
            Some(r#"{"listen_event_type":"file_changed","source_filter":"watcher-*"}"#),
        );
        match t.parse_config() {
            TriggerConfig::EventListener { listen_event_type, source_filter } => {
                assert_eq!(listen_event_type.as_deref(), Some("file_changed"));
                assert_eq!(source_filter.as_deref(), Some("watcher-*"));
            }
            other => panic!("Expected EventListener, got {other:?}"),
        }
    }

    #[test]
    fn test_event_listener_event_type() {
        let t = make_trigger(
            "event_listener",
            Some(r#"{"listen_event_type":"deploy"}"#),
        );
        // EventListener's event_type() returns the listen_event_type
        assert_eq!(t.parse_config().event_type(), "deploy");
    }

    #[test]
    fn test_event_listener_payload_is_none() {
        let t = make_trigger("event_listener", Some(r#"{"listen_event_type":"test"}"#));
        assert!(t.parse_config().payload().is_none());
    }

    #[test]
    fn test_chain_condition_default_type() {
        let t = make_trigger("chain", Some(r#"{"source_persona_id":"sp1","condition":{}}"#));
        if let TriggerConfig::Chain { condition, .. } = t.parse_config() {
            let cond = condition.unwrap();
            assert_eq!(cond.condition_type, ChainConditionType::Any);
        }
    }

    #[test]
    fn test_chain_condition_type_parse_valid() {
        assert_eq!("any".parse::<ChainConditionType>().unwrap(), ChainConditionType::Any);
        assert_eq!("success".parse::<ChainConditionType>().unwrap(), ChainConditionType::Success);
        assert_eq!("failure".parse::<ChainConditionType>().unwrap(), ChainConditionType::Failure);
        assert_eq!("jsonpath".parse::<ChainConditionType>().unwrap(), ChainConditionType::Jsonpath);
    }

    #[test]
    fn test_chain_condition_type_parse_invalid() {
        let err = "succcess".parse::<ChainConditionType>().unwrap_err();
        assert!(err.contains("Unknown chain condition type"), "got: {err}");
        assert!(err.contains("succcess"));
        assert!(err.contains("any, success, failure, jsonpath"));
    }

    #[test]
    fn test_chain_condition_type_roundtrip() {
        let cond_json = r#"{"type":"success","status":"completed"}"#;
        let cond: ChainCondition = serde_json::from_str(cond_json).unwrap();
        assert_eq!(cond.condition_type, ChainConditionType::Success);
        assert_eq!(cond.status.as_deref(), Some("completed"));

        let serialized = serde_json::to_string(&cond).unwrap();
        assert!(serialized.contains("\"type\":\"success\""));
    }

    #[test]
    fn test_chain_condition_deserialize_unknown_type() {
        // Unknown condition type should fail deserialization
        let cond_json = r#"{"type":"succcess"}"#;
        let result = serde_json::from_str::<ChainCondition>(cond_json);
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_file_watcher_config() {
        let t = make_trigger(
            "file_watcher",
            Some(r#"{"watch_paths":["/home/user/src","/tmp"],"events":["create","modify"],"recursive":true,"glob_filter":"*.py","event_type":"file_changed"}"#),
        );
        match t.parse_config() {
            TriggerConfig::FileWatcher { watch_paths, events, recursive, glob_filter, event_type, .. } => {
                assert_eq!(watch_paths.as_ref().map(|v| v.len()), Some(2));
                assert_eq!(events.as_ref().map(|v| v.len()), Some(2));
                assert_eq!(recursive, Some(true));
                assert_eq!(glob_filter.as_deref(), Some("*.py"));
                assert_eq!(event_type.as_deref(), Some("file_changed"));
            }
            other => panic!("Expected FileWatcher, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_clipboard_config() {
        let t = make_trigger(
            "clipboard",
            Some(r#"{"content_type":"text","pattern":"https?://","interval_seconds":5,"event_type":"clipboard_changed"}"#),
        );
        match t.parse_config() {
            TriggerConfig::Clipboard { content_type, pattern, interval_seconds, event_type, .. } => {
                assert_eq!(content_type.as_deref(), Some("text"));
                assert_eq!(pattern.as_deref(), Some("https?://"));
                assert_eq!(interval_seconds, Some(5));
                assert_eq!(event_type.as_deref(), Some("clipboard_changed"));
            }
            other => panic!("Expected Clipboard, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_app_focus_config() {
        let t = make_trigger(
            "app_focus",
            Some(r#"{"app_names":["Code.exe","chrome.exe"],"title_pattern":".*\\.rs","interval_seconds":3,"event_type":"app_focused"}"#),
        );
        match t.parse_config() {
            TriggerConfig::AppFocus { app_names, title_pattern, interval_seconds, event_type, .. } => {
                assert_eq!(app_names.as_ref().map(|v| v.len()), Some(2));
                assert_eq!(title_pattern.as_deref(), Some(".*\\.rs"));
                assert_eq!(interval_seconds, Some(3));
                assert_eq!(event_type.as_deref(), Some("app_focused"));
            }
            other => panic!("Expected AppFocus, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_composite_config() {
        let t = make_trigger(
            "composite",
            Some(r#"{"conditions":[{"event_type":"file_changed","source_filter":"watcher-*"},{"event_type":"build_complete"}],"operator":"all","window_seconds":300,"event_type":"composite_fired"}"#),
        );
        match t.parse_config() {
            TriggerConfig::Composite { conditions, operator, window_seconds, event_type, .. } => {
                let conds = conditions.unwrap();
                assert_eq!(conds.len(), 2);
                assert_eq!(conds[0].event_type, "file_changed");
                assert_eq!(conds[0].source_filter.as_deref(), Some("watcher-*"));
                assert_eq!(conds[1].event_type, "build_complete");
                assert!(conds[1].source_filter.is_none());
                assert_eq!(operator.as_deref(), Some("all"));
                assert_eq!(window_seconds, Some(300));
                assert_eq!(event_type.as_deref(), Some("composite_fired"));
            }
            other => panic!("Expected Composite, got {other:?}"),
        }
    }

    #[test]
    fn test_file_watcher_event_type_default() {
        let t = make_trigger("file_watcher", Some(r#"{"watch_paths":[]}"#));
        assert_eq!(t.parse_config().event_type(), "trigger_fired");
    }

    #[test]
    fn test_composite_event_type_custom() {
        let t = make_trigger("composite", Some(r#"{"event_type":"deploy_ready"}"#));
        assert_eq!(t.parse_config().event_type(), "deploy_ready");
    }
}
