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

/// Maximum number of entries in the backoff map before LRU eviction.
const MAX_BACKOFF_ENTRIES: usize = 1000;
/// Entries older than this TTL are evicted regardless of trigger state.
const BACKOFF_TTL_SECS: u64 = 3600; // 1 hour

struct BackoffEntry {
    until: Instant,
    failures: u32,
    /// When this entry was last updated (for TTL eviction).
    last_updated: Instant,
}

fn backoff_map() -> &'static Mutex<HashMap<String, BackoffEntry>> {
    static MAP: OnceLock<Mutex<HashMap<String, BackoffEntry>>> = OnceLock::new();
    MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_in_backoff(trigger_id: &str) -> bool {
    let Ok(map) = backoff_map().lock() else {
        return false;
    };
    map.get(trigger_id)
        .is_some_and(|e| Instant::now() < e.until)
}

fn record_mark_failure(trigger_id: &str) {
    let Ok(mut map) = backoff_map().lock() else {
        return;
    };

    // TTL eviction: remove entries that haven't been updated in BACKOFF_TTL_SECS
    let now = Instant::now();
    let ttl = Duration::from_secs(BACKOFF_TTL_SECS);
    map.retain(|_, e| now.duration_since(e.last_updated) < ttl);

    // LRU-style cap: if still over limit, batch-evict oldest 10%
    if map.len() >= MAX_BACKOFF_ENTRIES {
        let to_remove = (map.len() / 10).max(1);
        let mut keys_by_age: Vec<_> = map
            .iter()
            .map(|(k, e)| (k.clone(), e.last_updated))
            .collect();
        keys_by_age.sort_by_key(|(_, ts)| *ts);
        for (key, _) in keys_by_age.into_iter().take(to_remove) {
            map.remove(&key);
        }
    }

    let entry = map.entry(trigger_id.to_string()).or_insert(BackoffEntry {
        until: now,
        failures: 0,
        last_updated: now,
    });
    entry.failures += 1;
    entry.last_updated = now;
    let exp = entry.failures.min(4) - 1;
    let secs = (INITIAL_BACKOFF_SECS * 2u64.pow(exp)).min(MAX_BACKOFF_SECS);
    entry.until = now + Duration::from_secs(secs);
}

fn clear_backoff(trigger_id: &str) {
    if let Ok(mut map) = backoff_map().lock() {
        map.remove(trigger_id);
    }
}

/// Call `mark_triggered` and handle the backoff bookkeeping on success/failure.
fn try_mark_triggered(
    pool: &DbPool,
    trigger_id: &str,
    next: Option<String>,
    expected_version: i32,
) {
    if let Err(e) = trigger_repo::mark_triggered(pool, trigger_id, next, expected_version) {
        tracing::error!(trigger_id = %trigger_id, "mark_triggered failed: {}", e);
        record_mark_failure(trigger_id);
    } else {
        clear_backoff(trigger_id);
    }
}

/// Remove backoff entries for trigger IDs that no longer exist in the database.
/// Called once per poll cycle to prevent unbounded growth when triggers are deleted.
fn purge_stale_backoff(pool: &DbPool) {
    let ids: Vec<String> = {
        let Ok(map) = backoff_map().lock() else {
            return;
        };
        if map.is_empty() {
            return;
        }
        map.keys().cloned().collect()
    };

    // Check which IDs still exist with a single query
    let existing: std::collections::HashSet<String> =
        match (|| -> Result<_, crate::error::AppError> {
            let conn = pool.get()?;
            let placeholders: Vec<String> = ids
                .iter()
                .enumerate()
                .map(|(i, _)| format!("?{}", i + 1))
                .collect();
            let sql = format!(
                "SELECT id FROM persona_triggers WHERE id IN ({})",
                placeholders.join(", ")
            );
            let params_ref: Vec<&dyn rusqlite::types::ToSql> = ids
                .iter()
                .map(|s| s as &dyn rusqlite::types::ToSql)
                .collect();
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt.query_map(params_ref.as_slice(), |row| row.get::<_, String>(0))?;
            let set = rows.filter_map(|r| r.ok()).collect();
            Ok(set)
        })() {
            Ok(set) => set,
            Err(e) => {
                tracing::warn!("Failed to check backoff map staleness: {}", e);
                return;
            }
        };

    let stale: Vec<String> = ids
        .into_iter()
        .filter(|id| !existing.contains(id))
        .collect();
    if stale.is_empty() {
        return;
    }

    if let Ok(mut map) = backoff_map().lock() {
        for id in &stale {
            map.remove(id);
        }
    }
    tracing::debug!(
        count = stale.len(),
        "Purged stale backoff entries for deleted triggers"
    );
}

/// Run one polling cycle: fetch all enabled polling triggers that are due,
/// GET their configured endpoints, compare content hashes, and fire events
/// when content changes.
pub async fn poll_due_triggers(pool: &DbPool, scheduler: &SchedulerState, http: &reqwest::Client) {
    // Sweep backoff entries for triggers that were deleted since the last cycle
    purge_stale_backoff(pool);

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

    // Independent triggers polled with bounded concurrency: the serial loop
    // awaited each 30s-timeout GET before starting the next, so one dead/slow
    // endpoint delayed every trigger behind it by up to 30s per stall
    // (compounding linearly across dead hosts). mark_triggered_with_hash's
    // CAS already dedupes racing completions, so no new locking is needed.
    use futures_util::StreamExt;
    futures_util::stream::iter(triggers.into_iter().filter(|t| t.trigger_type == "polling"))
        .for_each_concurrent(4, |trigger| {
            poll_one_trigger(pool, scheduler, http, now, trigger)
        })
        .await;
}

/// Poll a single due trigger: active-window/backoff gates, SSRF check, HTTP
/// GET, hash-compare, CAS-advance + event publish. Extracted from the former
/// inline loop body of `poll_due_triggers` so independent triggers can run
/// concurrently.
async fn poll_one_trigger(
    pool: &DbPool,
    scheduler: &SchedulerState,
    http: &reqwest::Client,
    now: chrono::DateTime<chrono::Utc>,
    trigger: crate::db::models::PersonaTrigger,
) {
    {
        // Active window gate: skip polling outside configured active hours,
        // but still advance the schedule so it doesn't pile up as overdue.
        //
        // Advance ONLY the schedule pointer here — never `last_triggered_at`.
        // The UI's "Last triggered" label (TriggerList.tsx) reads that column
        // for every trigger type, polling included; `try_mark_triggered` (=
        // `mark_triggered`) would stamp it with `now` even though no GET was
        // ever made, making the trigger look like it fired when it didn't.
        // Mirrors `background.rs`'s identical active-window skip for
        // schedule-type triggers, which uses `advance_schedule_pointer` for
        // exactly this reason.
        if !trigger.is_within_active_window(now) {
            let next = sched_logic::compute_next_trigger_at(&trigger, now);
            match trigger_repo::advance_schedule_pointer(
                pool,
                &trigger.id,
                next,
                trigger.trigger_version,
            ) {
                Ok(_) => clear_backoff(&trigger.id),
                Err(e) => {
                    tracing::error!(trigger_id = %trigger.id, "advance_schedule_pointer failed: {}", e);
                    record_mark_failure(&trigger.id);
                }
            }
            return;
        }

        // Skip triggers in backoff from prior mark_triggered failures
        if is_in_backoff(&trigger.id) {
            return;
        }

        // Parse config once -- typed access replaces scattered json_extract calls
        let cfg = trigger.parse_config();
        let (cfg_url, cfg_headers, previous_hash) = match &cfg {
            crate::db::models::TriggerConfig::Polling {
                url,
                headers,
                content_hash,
                ..
            } => (url.clone(), headers.clone(), content_hash.clone()),
            _ => return,
        };

        let url = match cfg_url {
            Some(u) if !u.is_empty() => u,
            _ => {
                tracing::warn!(trigger_id = %trigger.id, "Polling trigger missing 'url' in config");
                // Still mark triggered to advance next_trigger_at
                let next = sched_logic::compute_next_trigger_at(&trigger, now);
                try_mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
                return;
            }
        };

        // SSRF protection: block private/internal IPs
        if let Err(reason) = crate::engine::url_safety::validate_url_safety(&url) {
            tracing::warn!(
                trigger_id = %trigger.id,
                url = %url,
                "Polling trigger URL blocked (SSRF protection): {}", reason
            );
            let next = sched_logic::compute_next_trigger_at(&trigger, now);
            try_mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
            return;
        }

        let headers: Vec<(String, String)> = cfg_headers.unwrap_or_default().into_iter().collect();

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
                try_mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
                return;
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
                try_mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
                return;
            }
        };

        // The observation is (status class, body hash): a transition in either
        // is a change. Hashing the body alone made a 200 -> 404 with an equal
        // (or empty) body invisible, and made every outage fire "changed"
        // twice (error page in, recovery out).
        let body_hash = compute_content_hash(&body);
        let (current_hash, change) =
            observe_change(previous_hash.as_deref(), status.as_u16(), &body_hash);
        let observation_changed = previous_hash.as_deref() != Some(current_hash.as_str());

        // Compute next schedule time up-front (needed for both paths)
        let next = sched_logic::compute_next_trigger_at(&trigger, now);

        if observation_changed {
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

                    // CAS succeeded -- safe to publish the event
                    let event_type = sched_logic::trigger_event_type(&trigger);
                    let Some(change) = change else {
                        // State recorded (e.g. recovery to the last good body):
                        // nothing a consumer needs to hear about.
                        return;
                    };
                    let payload = serde_json::json!({
                        "url": url,
                        "status_code": status.as_u16(),
                        "content_changed": change == PollChange::Content,
                        "change": change.as_str(),
                        "content_hash": body_hash,
                        "body_preview": crate::utils::text::truncate_on_char_boundary(&body, 2000),
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
                    // CAS failed -- another cycle already updated the hash (or trigger was deleted)
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

            // No content change -- still advance the schedule so we don't re-poll immediately
            try_mark_triggered(pool, &trigger.id, next, trigger.trigger_version);
        }
    }
}

/// What a poll observed, relative to the previous observation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PollChange {
    /// Success response whose body differs from the last successful body.
    Content,
    /// The resource answered 404 / 410: it left.
    Gone,
    /// The source is failing (5xx, or a non-gone 4xx such as 401/403/429).
    Failing,
}

impl PollChange {
    pub fn as_str(self) -> &'static str {
        match self {
            PollChange::Content => "content",
            PollChange::Gone => "gone",
            PollChange::Failing => "failing",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum StatusClass {
    Success,
    Gone,
    Failing,
}

fn status_class(status: u16) -> StatusClass {
    match status {
        200..=399 => StatusClass::Success,
        404 | 410 => StatusClass::Gone,
        _ => StatusClass::Failing,
    }
}

/// Split a stored observation key into (class, last successful body hash).
/// Success keys are the bare body hash (the pre-status format, so hashes
/// stored by older builds read as success); non-success keys are
/// `gone|<last good hash>` / `failing|<last good hash>`.
fn parse_observation(key: &str) -> (StatusClass, &str) {
    if let Some(rest) = key.strip_prefix("gone|") {
        (StatusClass::Gone, rest)
    } else if let Some(rest) = key.strip_prefix("failing|") {
        (StatusClass::Failing, rest)
    } else {
        (StatusClass::Success, key)
    }
}

/// Decide the new stored observation key and whether this poll is an event.
///
/// - success -> success: an event when the body hash differs.
/// - success -> gone / failing: a transition event, whatever the body.
/// - failing -> gone: an event (the resource left).
/// - gone -> failing, and same-class repeats: no event, key unchanged.
/// - gone / failing -> success: compared against the last *successful* body,
///   so recovering to unchanged content records state without an event.
/// - first poll: always an event, of the observed class.
pub fn observe_change(
    previous: Option<&str>,
    status: u16,
    body_hash: &str,
) -> (String, Option<PollChange>) {
    let class = status_class(status);
    let Some(prev) = previous else {
        return match class {
            StatusClass::Success => (body_hash.to_string(), Some(PollChange::Content)),
            StatusClass::Gone => ("gone|".to_string(), Some(PollChange::Gone)),
            StatusClass::Failing => ("failing|".to_string(), Some(PollChange::Failing)),
        };
    };
    let (prev_class, last_good) = parse_observation(prev);
    match (prev_class, class) {
        (_, StatusClass::Success) => {
            let change = (last_good != body_hash).then_some(PollChange::Content);
            (body_hash.to_string(), change)
        }
        (StatusClass::Success | StatusClass::Failing, StatusClass::Gone) => {
            (format!("gone|{last_good}"), Some(PollChange::Gone))
        }
        (StatusClass::Success, StatusClass::Failing) => {
            (format!("failing|{last_good}"), Some(PollChange::Failing))
        }
        // gone -> gone, gone -> failing, failing -> failing: one state.
        _ => (prev.to_string(), None),
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
    fn status_transition_at_equal_body_is_a_change() {
        let h = compute_content_hash("{}");
        // 200 -> 404 with the same body used to read as "no change".
        let (key, change) = observe_change(Some(&h), 404, &h);
        assert_eq!(change, Some(PollChange::Gone));
        assert_ne!(key, h);
        // Repeated 404s are one state.
        let (key2, change2) = observe_change(Some(&key), 404, &h);
        assert_eq!((key2.as_str(), change2), (key.as_str(), None));
        // Coming back with the old body is not a content change.
        let (key3, change3) = observe_change(Some(&key2), 200, &h);
        assert_eq!((key3.as_str(), change3), (h.as_str(), None));
    }

    #[test]
    fn outage_fires_once_not_two_content_changes() {
        let good = compute_content_hash("page v1");
        let err_a = compute_content_hash("<h1>502 Bad Gateway</h1>");
        let err_b = compute_content_hash("<h1>503 Unavailable</h1>");
        let (k1, c1) = observe_change(Some(&good), 502, &err_a);
        assert_eq!(c1, Some(PollChange::Failing));
        let (k2, c2) = observe_change(Some(&k1), 503, &err_b);
        assert_eq!(c2, None);
        let (k3, c3) = observe_change(Some(&k2), 200, &good);
        assert_eq!(c3, None, "recovery compares against the last good body");
        assert_eq!(k3, good);
        // Recovery to new content is a content change.
        let newer = compute_content_hash("page v2");
        assert_eq!(
            observe_change(Some(&k2), 200, &newer).1,
            Some(PollChange::Content)
        );
    }

    #[test]
    fn plain_body_change_and_first_poll_still_fire() {
        let a = compute_content_hash("a");
        let b = compute_content_hash("b");
        assert_eq!(
            observe_change(None, 200, &a),
            (a.clone(), Some(PollChange::Content))
        );
        assert_eq!(observe_change(Some(&a), 200, &a).1, None);
        assert_eq!(
            observe_change(Some(&a), 200, &b).1,
            Some(PollChange::Content)
        );
        let (gone_key, c) = observe_change(None, 410, &a);
        assert_eq!(c, Some(PollChange::Gone));
        // failing -> gone: the resource left.
        let (fk, _) = observe_change(Some(&a), 500, &b);
        assert_eq!(observe_change(Some(&fk), 404, &b).1, Some(PollChange::Gone));
        // gone -> failing: one non-success state.
        assert_eq!(observe_change(Some(&gone_key), 500, &b).1, None);
    }

    #[test]
    fn test_content_hash_format() {
        let hash = compute_content_hash("test");
        // SHA-256 produces 64 hex characters
        assert_eq!(hash.len(), 64);
        assert!(hash.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
