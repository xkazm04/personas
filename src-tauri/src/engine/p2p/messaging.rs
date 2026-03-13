//! Agent-to-agent messaging over the P2P network.
//!
//! Provides send/receive of AgentEnvelope messages with an in-memory
//! ring buffer and rate limiting (max 10 messages/second per peer).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use tokio::sync::RwLock;

use super::connection::ConnectionManager;
use super::protocol::{self, AgentEnvelope, Message};
use crate::error::AppError;

/// Maximum messages stored per persona in the ring buffer.
const MAX_MESSAGES_PER_PERSONA: usize = 100;

/// Rate limit: max messages per second per peer.
const MAX_MESSAGES_PER_SECOND: u32 = 10;

/// Lock-free rate limit entry using atomics.
struct RateEntry {
    count: AtomicU32,
    /// Window start as milliseconds since UNIX epoch (allows atomic load/store).
    window_ms: AtomicU64,
}

impl RateEntry {
    fn new(now_ms: u64) -> Self {
        Self {
            count: AtomicU32::new(1),
            window_ms: AtomicU64::new(now_ms),
        }
    }
}

/// Routes and stores agent-to-agent messages.
pub struct MessageRouter {
    connections: Arc<ConnectionManager>,
    /// In-memory ring buffer: target_persona_id -> Vec<AgentEnvelope>
    inbox: RwLock<HashMap<String, VecDeque<AgentEnvelope>>>,
    /// Lock-free rate tracking: source_peer_id -> RateEntry
    rate_tracker: std::sync::Mutex<HashMap<String, RateEntry>>,
}

impl MessageRouter {
    pub fn new(connections: Arc<ConnectionManager>) -> Self {
        Self {
            connections,
            inbox: RwLock::new(HashMap::new()),
            rate_tracker: std::sync::Mutex::new(HashMap::new()),
        }
    }

    /// Send a message to a remote peer.
    pub async fn send_message(
        &self,
        target_peer_id: &str,
        envelope: AgentEnvelope,
    ) -> Result<(), AppError> {
        let (mut send, _recv) = self.connections.open_stream(target_peer_id).await?;

        protocol::write_message(
            &mut send,
            &Message::AgentMessage {
                envelope: envelope.clone(),
            },
        )
        .await?;

        tracing::debug!(
            target_peer = %target_peer_id,
            source_persona = %envelope.source_persona_id,
            target_persona = %envelope.target_persona_id,
            "Agent message sent"
        );

        Ok(())
    }

    /// Store a received message in the inbox ring buffer.
    pub async fn store_received(&self, source_peer_id: &str, envelope: AgentEnvelope) -> Result<(), AppError> {
        // Rate limit check
        if !self.check_rate_limit(source_peer_id) {
            return Err(AppError::RateLimited(format!(
                "Rate limit exceeded for peer {}",
                source_peer_id
            )));
        }

        let target = &envelope.target_persona_id;
        let mut inbox = self.inbox.write().await;
        let queue = inbox.entry(target.clone()).or_insert_with(VecDeque::new);

        // Ring buffer: evict oldest if at capacity
        if queue.len() >= MAX_MESSAGES_PER_PERSONA {
            queue.pop_front();
        }

        queue.push_back(envelope);
        Ok(())
    }

    /// Get received messages for a persona.
    pub async fn get_messages(&self, persona_id: &str) -> Vec<AgentEnvelope> {
        self.inbox
            .read()
            .await
            .get(persona_id)
            .map(|q| q.iter().cloned().collect())
            .unwrap_or_default()
    }

    /// Check and update rate limit for a peer using atomic counters.
    /// Uses `std::sync::Mutex` only for HashMap access (brief, non-async),
    /// while count/window checks are lock-free atomics.
    fn check_rate_limit(&self, peer_id: &str) -> bool {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let tracker = self.rate_tracker.lock().unwrap_or_else(|e| e.into_inner());

        if let Some(entry) = tracker.get(peer_id) {
            let window = entry.window_ms.load(Ordering::Relaxed);
            if now_ms.saturating_sub(window) >= 1000 {
                // New window — reset
                entry.window_ms.store(now_ms, Ordering::Relaxed);
                entry.count.store(1, Ordering::Relaxed);
                return true;
            }
            let prev = entry.count.fetch_add(1, Ordering::Relaxed);
            if prev >= MAX_MESSAGES_PER_SECOND {
                // Undo the increment so we don't inflate the counter
                entry.count.fetch_sub(1, Ordering::Relaxed);
                return false;
            }
            true
        } else {
            drop(tracker);
            let mut tracker = self.rate_tracker.lock().unwrap_or_else(|e| e.into_inner());
            tracker.insert(peer_id.to_string(), RateEntry::new(now_ms));
            true
        }
    }

    /// Background loop for periodic cleanup of stale rate entries.
    pub async fn receive_loop(&self, connections: Arc<ConnectionManager>) {
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            // Cleanup old rate tracker entries
            let now_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64;
            let mut tracker = self.rate_tracker.lock().unwrap_or_else(|e| e.into_inner());
            tracker.retain(|_, entry| {
                now_ms.saturating_sub(entry.window_ms.load(Ordering::Relaxed)) < 60_000
            });
            let _ = connections; // keep reference alive
        }
    }
}
