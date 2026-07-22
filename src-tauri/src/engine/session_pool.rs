//! Session reuse pool for persona executions.
//!
//! Caches the last `claude_session_id` per persona so that subsequent executions
//! can automatically resume the prior session via `Continuation::SessionResume`.
//! This preserves LLM conversation context across runs, improving coherence and
//! reducing cold-start prompt costs.
//!
//! Sessions are automatically invalidated when:
//! - The persona's config changes (prompt, tools, credentials)
//! - The session expires (configurable TTL, default 30 minutes)
//! - The execution that produced the session failed

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::sync::RwLock;

/// Default time-to-live for cached sessions.
const DEFAULT_SESSION_TTL: Duration = Duration::from_secs(30 * 60); // 30 minutes

/// A cached session for a persona.
#[derive(Debug, Clone)]
struct CachedSession {
    /// The Claude CLI session ID for `--resume`.
    session_id: String,
    /// When this session was cached.
    cached_at: Instant,
    /// Config fingerprint at cache time (hash of prompt + tools + model).
    config_hash: u64,
}

/// Manages session reuse across persona executions.
pub struct SessionPool {
    sessions: Arc<RwLock<HashMap<String, CachedSession>>>,
    ttl: Duration,
}

impl SessionPool {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(HashMap::new())),
            ttl: DEFAULT_SESSION_TTL,
        }
    }

    /// Store a session for a persona after successful execution.
    pub async fn offer(&self, persona_id: &str, session_id: String, config_hash: u64) {
        let mut sessions = self.sessions.write().await;
        sessions.insert(
            persona_id.to_string(),
            CachedSession {
                session_id,
                cached_at: Instant::now(),
                config_hash,
            },
        );
        tracing::debug!(
            persona_id,
            "Session cached for reuse (TTL: {}s)",
            self.ttl.as_secs()
        );
    }

    /// Try to retrieve a cached session for a persona.
    ///
    /// Returns `Some(session_id)` if a valid, non-expired session exists
    /// whose config hash matches the current config.
    pub async fn take(&self, persona_id: &str, current_config_hash: u64) -> Option<String> {
        let mut sessions = self.sessions.write().await;
        let session = sessions.get(persona_id)?;

        // Check TTL
        if session.cached_at.elapsed() > self.ttl {
            sessions.remove(persona_id);
            tracing::debug!(persona_id, "Session expired — removed from pool");
            return None;
        }

        // Check config hasn't changed
        if session.config_hash != current_config_hash {
            sessions.remove(persona_id);
            tracing::debug!(
                persona_id,
                "Session invalidated — persona config changed since last run"
            );
            return None;
        }

        // Take (consume) the session — it can only be used once
        let session = sessions.remove(persona_id)?;
        tracing::info!(
            persona_id,
            session_age_secs = session.cached_at.elapsed().as_secs(),
            "Reusing cached session for warm start"
        );
        Some(session.session_id)
    }

    /// Explicitly invalidate a persona's cached session.
    /// Called when persona config is updated (prompt, tools, model changes).
    pub async fn invalidate(&self, persona_id: &str) {
        let mut sessions = self.sessions.write().await;
        if sessions.remove(persona_id).is_some() {
            tracing::debug!(persona_id, "Session invalidated by config change");
        }
    }

    /// Evict all expired sessions (called periodically or on-demand).
    pub async fn evict_expired(&self) {
        let mut sessions = self.sessions.write().await;
        let before = sessions.len();
        sessions.retain(|_, s| s.cached_at.elapsed() < self.ttl);
        let evicted = before - sessions.len();
        if evicted > 0 {
            tracing::debug!(evicted, "Evicted expired sessions from pool");
        }
    }

    /// Number of cached sessions (for diagnostics).
    pub async fn count(&self) -> usize {
        self.sessions.read().await.len()
    }
}

/// Compute the config fingerprint for invalidation checks.
///
/// This is the CANONICAL hash used by BOTH the `offer()` site (engine result
/// handling) and the `take()` site (execution start). The two sites previously
/// hand-rolled hashes over disjoint inputs (execution_config JSON vs persona
/// fields), so `take` never matched and warm session reuse was a permanent
/// no-op — every run cold-started. Always call this helper from both sides.
pub fn compute_config_hash(
    system_prompt: &str,
    structured_prompt: Option<&str>,
    model_profile: Option<&str>,
    tool_count: usize,
    capabilities_fingerprint: &str,
) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    system_prompt.hash(&mut hasher);
    structured_prompt.unwrap_or("").hash(&mut hasher);
    model_profile.unwrap_or("").hash(&mut hasher);
    tool_count.hash(&mut hasher);
    capabilities_fingerprint.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn offer_take_round_trip_with_shared_hash() {
        let pool = SessionPool::new();
        let hash = compute_config_hash("prompt", Some("structured"), Some("sonnet"), 3, "caps");
        pool.offer("p1", "sess-1".into(), hash).await;
        assert_eq!(pool.take("p1", hash).await.as_deref(), Some("sess-1"));
        // Consumed — a second take misses.
        assert_eq!(pool.take("p1", hash).await, None);
    }

    #[tokio::test]
    async fn take_invalidates_on_config_change() {
        let pool = SessionPool::new();
        let offered = compute_config_hash("prompt", None, None, 3, "caps");
        let changed = compute_config_hash("prompt", Some("new-structured"), None, 3, "caps");
        assert_ne!(offered, changed);
        pool.offer("p1", "sess-1".into(), offered).await;
        assert_eq!(pool.take("p1", changed).await, None);
        // Invalidation consumed the entry entirely.
        assert_eq!(pool.count().await, 0);
    }
}
