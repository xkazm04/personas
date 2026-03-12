//! Clipboard monitor ambient trigger.
//!
//! Polls the system clipboard for changes and publishes events when the content
//! changes and matches the trigger's filter criteria.

use std::sync::Arc;

use tokio::sync::Mutex;

use crate::db::models::{CreatePersonaEventInput, TriggerConfig};
use crate::db::repos::communication::events as event_repo;
use crate::db::repos::resources::triggers as trigger_repo;
use crate::db::DbPool;

/// Shared state: stores the hash of the last known clipboard content to detect changes.
pub struct ClipboardState {
    last_hash: Option<u64>,
}

impl ClipboardState {
    pub fn new() -> Self {
        Self { last_hash: None }
    }
}

/// Simple FNV-1a hash for change detection.
fn hash_content(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &byte in data {
        h ^= byte as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

/// Tick function called by the subscription loop.
///
/// 1. Read current clipboard content.
/// 2. Compare hash with last known state.
/// 3. If changed, check against all enabled `clipboard` triggers and publish matching events.
pub async fn clipboard_tick(
    pool: &DbPool,
    state: &Arc<Mutex<ClipboardState>>,
) {
    // Read clipboard on a blocking thread (arboard is not async)
    let clip_result = tokio::task::spawn_blocking(|| {
        match arboard::Clipboard::new() {
            Ok(mut clipboard) => {
                // Try text first
                if let Ok(text) = clipboard.get_text() {
                    if !text.is_empty() {
                        return Some(("text".to_string(), text));
                    }
                }
                // Could check image here in the future
                None
            }
            Err(_) => None,
        }
    })
    .await;

    let (content_type, content) = match clip_result {
        Ok(Some((ct, c))) => (ct, c),
        _ => return,
    };

    // Hash the content for change detection
    let current_hash = hash_content(content.as_bytes());

    let changed = {
        let mut s = state.lock().await;
        let was_different = s.last_hash != Some(current_hash);
        if was_different {
            s.last_hash = Some(current_hash);
        }
        was_different
    };

    if !changed {
        return;
    }

    // Load enabled clipboard triggers (SQL-filtered)
    let clipboard_triggers = match trigger_repo::get_enabled_by_type(pool, "clipboard") {
        Ok(t) => t,
        Err(_) => return,
    };

    if clipboard_triggers.is_empty() {
        return;
    }

    for trigger in &clipboard_triggers {
        let config = trigger.parse_config();
        if let TriggerConfig::Clipboard {
            content_type: ref ct_filter,
            pattern: ref pat,
            event_type,
            ..
        } = config
        {
            // Check content type filter
            let ct_match = ct_filter.as_deref().map_or(true, |f| f == "any" || f == content_type);
            if !ct_match {
                continue;
            }

            // Check pattern filter (regex or substring)
            if let Some(ref pattern) = pat {
                match regex::Regex::new(pattern) {
                    Ok(re) => {
                        if !re.is_match(&content) {
                            continue;
                        }
                    }
                    Err(_) => {
                        // Fall back to substring match
                        if !content.contains(pattern.as_str()) {
                            continue;
                        }
                    }
                }
            }

            // Publish event -- store only a hash, never plaintext clipboard content
            let payload = serde_json::json!({
                "content_type": content_type,
                "content_hash": format!("{:016x}", current_hash),
                "content_length": content.len(),
            });

            let input = CreatePersonaEventInput {
                event_type: event_type.as_deref().unwrap_or("clipboard_changed").into(),
                source_type: "clipboard".into(),
                project_id: None,
                source_id: Some(trigger.id.clone()),
                target_persona_id: Some(trigger.persona_id.clone()),
                payload: Some(serde_json::to_string(&payload).unwrap_or_default()),
                use_case_id: trigger.use_case_id.clone(),
            };

            if let Err(e) = event_repo::publish(pool, input) {
                tracing::warn!(trigger_id = %trigger.id, "clipboard publish error: {e}");
            }
        }
    }
}
