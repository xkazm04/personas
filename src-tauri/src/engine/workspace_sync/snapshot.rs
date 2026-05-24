//! A sync-safe projection of a persona definition, plus its content hash.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ts_rs::TS;

/// A sync-safe projection of a persona **definition** for cross-device continuity.
///
/// EXCLUDES, by construction, every field that is either a secret or device-local:
/// - `model_profile`, `notification_channels` — AES-256-GCM encrypted at rest with
///   a *per-device* keyring master key (`engine/crypto.rs:get_master_key`); a peer
///   device cannot decrypt them, so they are never put on the wire.
/// - trust/audit fields (`trust_level`, `trust_origin`, `trust_score`, …) — locally
///   computed, not authored content.
/// - build artifacts (`last_design_result`, `last_test_report`) — regenerated locally.
/// - local foreign keys (`project_id`, `group_id`, `home_team_id`, `source_review_id`)
///   — identities differ per device.
/// - credential-readiness (`setup_status`, `setup_detail`) — derived from the local
///   vault, which is intentionally not synced.
///
/// The set above is the credentials-stay-local boundary made structural: there is no
/// runtime filter to forget — a secret field simply has no home on this struct.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PersonaWorkspaceSnapshot {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub system_prompt: String,
    pub structured_prompt: Option<String>,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub enabled: bool,
    pub headless: bool,
    pub max_concurrent: i32,
    pub timeout_ms: i32,
    pub max_turns: Option<i32>,
    pub max_budget_usd: Option<f64>,
    /// JSON-encoded `PersonaParameter[]` — runtime-adjustable definition data.
    pub parameters: Option<String>,
    pub template_category: Option<String>,
    /// `gateway_exposure` as its `snake_case` token (`local_only` | `invite_only` | `public`).
    pub gateway_exposure: String,
    pub cli_awareness_enabled: bool,
    /// RFC3339 wall-clock last-modified time. This is the **last-writer-wins
    /// ordering key** for conflict resolution — it is intentionally NOT part of
    /// `content_hash()` so that re-touching a row without changing its content
    /// does not register as a content change.
    pub updated_at: String,
}

/// Deterministic SHA-256 content hash of a snapshot, formatted `sha256:<hex>` to
/// match the convention in `obsidian_brain/markdown.rs:compute_content_hash`.
///
/// The `updatedAt` field is excluded from the digest: the hash captures *content*,
/// the timestamp captures *recency*. Serialization goes through `serde_json::Value`,
/// whose object map yields a stable key order, so the digest is reproducible across
/// devices and runs. Shared by every snapshot type so they hash identically.
pub(crate) fn canonical_content_hash<T: Serialize>(value: &T) -> String {
    let mut value = serde_json::to_value(value).unwrap_or(serde_json::Value::Null);
    if let Some(obj) = value.as_object_mut() {
        obj.remove("updatedAt");
    }
    let canonical = serde_json::to_string(&value).unwrap_or_default();
    format!("sha256:{}", hex::encode(Sha256::digest(canonical.as_bytes())))
}

/// Common behaviour every syncable entity snapshot provides so the merge can be
/// generic over entity type: a content hash (excluding the timestamp) and the
/// RFC3339 last-modified instant used as the last-writer-wins ordering key.
pub trait SyncSnapshot {
    fn content_hash(&self) -> String;
    fn updated_at(&self) -> &str;
}

impl SyncSnapshot for PersonaWorkspaceSnapshot {
    fn content_hash(&self) -> String {
        canonical_content_hash(self)
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
}

/// Sync-safe projection of a `persona_memories` row. Excludes device-local runtime
/// fields (`access_count`, `last_accessed_at`) — only authored content syncs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    pub id: String,
    pub persona_id: String,
    pub title: String,
    pub content: String,
    pub category: Option<String>,
    pub importance: Option<i32>,
    /// JSON-encoded tag array.
    pub tags: Option<String>,
    pub tier: Option<String>,
    /// RFC3339 last-modified; the LWW key, excluded from `content_hash`.
    pub updated_at: String,
}

impl SyncSnapshot for MemorySnapshot {
    fn content_hash(&self) -> String {
        canonical_content_hash(self)
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
}

/// Sync-safe projection of a `persona_triggers` row. Excludes device-local runtime
/// fields (`last_triggered_at`, `next_trigger_at`) — only the definition syncs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TriggerSnapshot {
    pub id: String,
    pub persona_id: String,
    pub trigger_type: String,
    /// JSON-encoded trigger config (cron/timezone, webhook, chain conditions, …).
    pub config: Option<String>,
    pub enabled: bool,
    /// RFC3339 last-modified; the LWW key, excluded from `content_hash`.
    pub updated_at: String,
}

impl SyncSnapshot for TriggerSnapshot {
    fn content_hash(&self) -> String {
        canonical_content_hash(self)
    }
    fn updated_at(&self) -> &str {
        &self.updated_at
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> PersonaWorkspaceSnapshot {
        PersonaWorkspaceSnapshot {
            id: "p1".into(),
            name: "Researcher".into(),
            description: Some("digs".into()),
            system_prompt: "You are helpful.".into(),
            structured_prompt: None,
            icon: Some("flask".into()),
            color: Some("#abc".into()),
            enabled: true,
            headless: false,
            max_concurrent: 1,
            timeout_ms: 30_000,
            max_turns: Some(10),
            max_budget_usd: Some(1.5),
            parameters: None,
            template_category: Some("research".into()),
            gateway_exposure: "local_only".into(),
            cli_awareness_enabled: false,
            updated_at: "2026-05-24T10:00:00Z".into(),
        }
    }

    #[test]
    fn hash_is_stable_and_prefixed() {
        let h = sample().content_hash();
        assert!(h.starts_with("sha256:"));
        assert_eq!(h, sample().content_hash());
    }

    #[test]
    fn hash_ignores_updated_at() {
        let a = sample();
        let mut b = sample();
        b.updated_at = "2030-01-01T00:00:00Z".into();
        assert_eq!(a.content_hash(), b.content_hash());
    }

    #[test]
    fn hash_changes_with_content() {
        let a = sample();
        let mut b = sample();
        b.system_prompt = "You are terse.".into();
        assert_ne!(a.content_hash(), b.content_hash());
    }
}
