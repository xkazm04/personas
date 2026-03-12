use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Triggers
// ============================================================================

/// Condition for chain triggers: when a source persona finishes, what outcome
/// should fire the chain?
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainCondition {
    /// Condition type: "any", "success", "failure", etc.
    #[serde(rename = "type", default = "default_chain_condition_type")]
    pub condition_type: String,
    /// Optional status filter.
    #[serde(default)]
    pub status: Option<String>,
}

fn default_chain_condition_type() -> String {
    "any".into()
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
    pub last_triggered_at: Option<String>,
    pub next_trigger_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub use_case_id: Option<String>,
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
    /// Parse the raw `config` JSON string once and return a typed `TriggerConfig`.
    /// All downstream consumers should call this once and reuse the result.
    pub fn parse_config(&self) -> TriggerConfig {
        let val: serde_json::Value = self
            .config
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
            last_triggered_at: None,
            next_trigger_at: None,
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
                assert_eq!(cond.condition_type, "success");
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
            assert_eq!(cond.condition_type, "any");
        }
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
