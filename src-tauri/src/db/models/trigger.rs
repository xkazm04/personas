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

/// Parsed, typed representation of a trigger's `config` JSON.
///
/// Each variant carries only the fields that trigger type needs, making invalid
/// states unrepresentable. Produced by `PersonaTrigger::parse_config()` — call
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
    /// Unified event listener — replaces persona_event_subscriptions.
    /// Listens for events matching `listen_event_type` with optional source wildcard.
    #[serde(rename = "event_listener")]
    EventListener {
        /// The event type to listen for (matches PersonaEvent.event_type).
        listen_event_type: Option<String>,
        /// Optional wildcard source filter (e.g. "watcher-*").
        source_filter: Option<String>,
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
            other => panic!("Expected Schedule, got {:?}", other),
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
            other => panic!("Expected Polling, got {:?}", other),
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
            other => panic!("Expected Webhook, got {:?}", other),
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
            other => panic!("Expected Chain, got {:?}", other),
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
            other => panic!("Expected Manual, got {:?}", other),
        }
    }

    #[test]
    fn test_parse_unknown_type() {
        let t = make_trigger("exotic", Some(r#"{"event_type":"foo"}"#));
        match t.parse_config() {
            TriggerConfig::Unknown { event_type, .. } => {
                assert_eq!(event_type.as_deref(), Some("foo"));
            }
            other => panic!("Expected Unknown, got {:?}", other),
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
            other => panic!("Expected EventListener, got {:?}", other),
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
}
