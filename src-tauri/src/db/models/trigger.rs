use serde::{Deserialize, Serialize};
use ts_rs::TS;

// ============================================================================
// Triggers
// ============================================================================

/// Parsed, typed representation of a trigger's `config` JSON.
/// Produced by `PersonaTrigger::parse_config()` — call once, reuse everywhere.
#[derive(Debug, Clone)]
pub enum TriggerConfig {
    Schedule {
        cron: Option<String>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    Polling {
        interval_seconds: Option<u64>,
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    Webhook {
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    Chain {
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
    Manual {
        event_type: Option<String>,
        payload: Option<serde_json::Value>,
    },
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
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CreateTriggerInput {
    pub persona_id: String,
    pub trigger_type: String,
    pub config: Option<String>,
    pub enabled: Option<bool>,
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
                event_type,
                payload,
            },
            "polling" => TriggerConfig::Polling {
                interval_seconds: val.get("interval_seconds").and_then(|v| v.as_u64()),
                event_type,
                payload,
            },
            "webhook" => TriggerConfig::Webhook { event_type, payload },
            "chain" => TriggerConfig::Chain { event_type, payload },
            "manual" => TriggerConfig::Manual { event_type, payload },
            _ => TriggerConfig::Unknown { event_type, payload },
        }
    }
}
