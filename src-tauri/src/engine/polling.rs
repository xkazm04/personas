use sha2::{Digest, Sha256};

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::engine::scheduler as sched_logic;

/// Run one polling cycle: fetch all enabled polling triggers that are due,
/// GET their configured endpoints, compare content hashes, and fire events
/// when content changes.
pub async fn poll_due_triggers(
    pool: &DbPool,
    scheduler: &SchedulerState,
    http: &reqwest::Client,
) {
    let now = chrono::Utc::now();
    let now_str = now.to_rfc3339();

    // Get due triggers (already filtered by enabled + next_trigger_at <= now)
    let triggers = match trigger_repo::get_due(pool, &now_str) {
        Ok(t) => t,
        Err(e) => {
            tracing::error!("Polling trigger fetch error: {}", e);
            return;
        }
    };

    for trigger in triggers {
        if trigger.trigger_type != "polling" {
            continue; // Only process polling triggers in this loop
        }

        let config: serde_json::Value = match trigger
            .config
            .as_deref()
            .and_then(|c| serde_json::from_str(c).ok())
        {
            Some(c) => c,
            None => continue,
        };

        let url = match config.get("url").and_then(|u| u.as_str()) {
            Some(u) => u.to_string(),
            None => {
                tracing::warn!(trigger_id = %trigger.id, "Polling trigger missing 'url' in config");
                // Still mark triggered to advance next_trigger_at
                let next = sched_logic::compute_next_trigger_at(&trigger, now);
                let _ = trigger_repo::mark_triggered(pool, &trigger.id, next);
                continue;
            }
        };

        // Extract optional headers from config
        let headers: Vec<(String, String)> = config
            .get("headers")
            .and_then(|h| h.as_object())
            .map(|obj| {
                obj.iter()
                    .filter_map(|(k, v)| v.as_str().map(|s| (k.clone(), s.to_string())))
                    .collect()
            })
            .unwrap_or_default();

        let previous_hash = config
            .get("content_hash")
            .and_then(|h| h.as_str())
            .map(String::from);

        // Make the HTTP request
        let mut req = http.get(&url);
        for (key, value) in &headers {
            req = req.header(key.as_str(), value.as_str());
        }

        let response = match req.send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::warn!(
                    trigger_id = %trigger.id,
                    url = %url,
                    "Polling HTTP request failed: {}", e
                );
                let next = sched_logic::compute_next_trigger_at(&trigger, now);
                let _ = trigger_repo::mark_triggered(pool, &trigger.id, next);
                continue;
            }
        };

        let status = response.status();
        let body = match response.text().await {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(
                    trigger_id = %trigger.id,
                    "Polling: failed to read response body: {}", e
                );
                let next = sched_logic::compute_next_trigger_at(&trigger, now);
                let _ = trigger_repo::mark_triggered(pool, &trigger.id, next);
                continue;
            }
        };

        // Compute content hash
        let current_hash = compute_content_hash(&body);

        let content_changed = match &previous_hash {
            Some(prev) => prev != &current_hash,
            None => true, // First poll — always fire
        };

        // Update the stored content_hash in the trigger config
        let mut updated_config = config.clone();
        updated_config["content_hash"] = serde_json::Value::String(current_hash.clone());
        let _ = trigger_repo::update(
            pool,
            &trigger.id,
            crate::db::models::UpdateTriggerInput {
                trigger_type: None,
                config: Some(serde_json::to_string(&updated_config).unwrap_or_default()),
                enabled: None,
                next_trigger_at: None,
            },
        );

        if content_changed {
            // Build event payload
            let event_type = sched_logic::trigger_event_type(&trigger);
            let payload = serde_json::json!({
                "url": url,
                "status_code": status.as_u16(),
                "content_changed": true,
                "content_hash": current_hash,
                "body_preview": &body[..body.len().min(2000)],
            });

            match event_repo::publish(
                pool,
                CreatePersonaEventInput {
                    event_type,
                    source_type: "polling".into(),
                    source_id: Some(trigger.id.clone()),
                    target_persona_id: Some(trigger.persona_id.clone()),
                    project_id: None,
                    payload: Some(serde_json::to_string(&payload).unwrap_or_default()),
                },
            ) {
                Ok(_) => {
                    tracing::info!(
                        trigger_id = %trigger.id,
                        url = %url,
                        "Polling: content changed, event published"
                    );
                    scheduler
                        .triggers_fired
                        .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                }
                Err(e) => {
                    tracing::error!(
                        trigger_id = %trigger.id,
                        "Polling: failed to publish event: {}", e
                    );
                }
            }
        } else {
            tracing::debug!(
                trigger_id = %trigger.id,
                url = %url,
                "Polling: no content change detected"
            );
        }

        // Advance next_trigger_at
        let next = sched_logic::compute_next_trigger_at(&trigger, now);
        let _ = trigger_repo::mark_triggered(pool, &trigger.id, next);
    }
}

/// Compute SHA-256 hash of content, returned as hex string.
pub fn compute_content_hash(content: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    hex::encode(hasher.finalize())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_content_hash_deterministic() {
        let hash1 = compute_content_hash("hello world");
        let hash2 = compute_content_hash("hello world");
        assert_eq!(hash1, hash2);
    }

    #[test]
    fn test_content_hash_differs() {
        let hash1 = compute_content_hash("hello world");
        let hash2 = compute_content_hash("hello world!");
        assert_ne!(hash1, hash2);
    }

    #[test]
    fn test_content_hash_format() {
        let hash = compute_content_hash("test");
        // SHA-256 produces 64 hex characters
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
