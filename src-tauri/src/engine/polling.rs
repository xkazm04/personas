use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use crate::db::models::CreatePersonaEventInput;
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;
use crate::engine::background::SchedulerState;
use crate::engine::scheduler as sched_logic;

// ---------------------------------------------------------------------------
// Backoff tracking for failed mark_triggered calls
// ---------------------------------------------------------------------------
// When mark_triggered fails, next_trigger_at stays in the past and get_due
// returns the trigger every cycle. This in-memory backoff prevents a storm.

const INITIAL_BACKOFF_SECS: u64 = 30;
const MAX_BACKOFF_SECS: u64 = 300;

struct BackoffEntry {
    until: Instant,
    failures: u32,
}

fn backoff_map() -> &'static Mutex<HashMap<String, BackoffEntry>> {
    static MAP: OnceLock<Mutex<HashMap<String, BackoffEntry>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_in_backoff(trigger_id: &str) -> bool {
    let Ok(map) = backoff_map().lock() else { return false };
    map.get(trigger_id)
        .is_some_and(|e| Instant::now() < e.until)
}

fn record_mark_failure(trigger_id: &str) {
    let Ok(mut map) = backoff_map().lock() else { return };
    let entry = map
        .entry(trigger_id.to_string())
        .or_insert(BackoffEntry { until: Instant::now(), failures: 0 });
    entry.failures += 1;
    let exp = entry.failures.min(4) - 1;
    let secs = (INITIAL_BACKOFF_SECS * 2u64.pow(exp)).min(MAX_BACKOFF_SECS);
    entry.until = Instant::now() + Duration::from_secs(secs);
}

fn clear_backoff(trigger_id: &str) {
    if let Ok(mut map) = backoff_map().lock() {
        map.remove(trigger_id);
    }
}

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

        // Skip triggers in backoff from prior mark_triggered failures
        if is_in_backoff(&trigger.id) {
            continue;
        }

        // Parse config once — typed access replaces scattered json_extract calls
        let cfg = trigger.parse_config();
        let (cfg_url, cfg_headers, previous_hash) = match &cfg {
            crate::db::models::TriggerConfig::Polling {
                url, headers, content_hash, ..
            } => (url.clone(), headers.clone(), content_hash.clone()),
            _ => continue,
        };

        let url = match cfg_url {
            Some(u) if !u.is_empty() => u,
            _ => {
                tracing::warn!(trigger_id = %trigger.id, "Polling trigger missing 'url' in config");
                // Still mark triggered to advance next_trigger_at
                let next = sched_logic::compute_next_trigger_at(&trigger, now);
                if let Err(e) = trigger_repo::mark_triggered(pool, &trigger.id, next) {
                    tracing::error!(trigger_id = %trigger.id, "mark_triggered failed: {}", e);
                    record_mark_failure(&trigger.id);
                } else {
                    clear_backoff(&trigger.id);
                }
                continue;
            }
        };

        let headers: Vec<(String, String)> = cfg_headers
            .unwrap_or_default()
            .into_iter()
            .collect();

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
                if let Err(me) = trigger_repo::mark_triggered(pool, &trigger.id, next) {
                    tracing::error!(trigger_id = %trigger.id, "mark_triggered failed: {}", me);
                    record_mark_failure(&trigger.id);
                } else {
                    clear_backoff(&trigger.id);
                }
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
                if let Err(me) = trigger_repo::mark_triggered(pool, &trigger.id, next) {
                    tracing::error!(trigger_id = %trigger.id, "mark_triggered failed: {}", me);
                    record_mark_failure(&trigger.id);
                } else {
                    clear_backoff(&trigger.id);
                }
                continue;
            }
        };

        // Compute content hash
        let current_hash = compute_content_hash(&body);

        let content_changed = match &previous_hash {
            Some(prev) => prev != &current_hash,
            None => true, // First poll — always fire
        };

        // Compute next schedule time up-front (needed for both paths)
        let next = sched_logic::compute_next_trigger_at(&trigger, now);

        if content_changed {
            // Atomically update the content hash AND advance the schedule via CAS.
            // If another poll cycle already updated the hash (race), the CAS returns
            // false and we skip the event publish to prevent duplicates.
            match trigger_repo::mark_triggered_with_hash(
                pool,
                &trigger.id,
                &current_hash,
                previous_hash.as_deref(),
                next,
            ) {
                Ok(true) => {
                    clear_backoff(&trigger.id);

                    // CAS succeeded — safe to publish the event
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
                            use_case_id: trigger.use_case_id.clone(),
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
                }
                Ok(false) => {
                    // CAS failed — another cycle already updated the hash (or trigger was deleted)
                    tracing::debug!(
                        trigger_id = %trigger.id,
                        "Polling: CAS failed (hash already updated), skipping duplicate event"
                    );
                }
                Err(e) => {
                    tracing::error!(trigger_id = %trigger.id, "mark_triggered_with_hash failed: {}", e);
                    record_mark_failure(&trigger.id);
                }
            }
        } else {
            tracing::debug!(
                trigger_id = %trigger.id,
                url = %url,
                "Polling: no content change detected"
            );

            // No content change — still advance the schedule so we don't re-poll immediately
            if let Err(e) = trigger_repo::mark_triggered(pool, &trigger.id, next) {
                tracing::error!(trigger_id = %trigger.id, "mark_triggered failed: {}", e);
                record_mark_failure(&trigger.id);
            } else {
                clear_backoff(&trigger.id);
            }
        }
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
