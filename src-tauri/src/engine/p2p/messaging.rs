//! Agent-to-agent messaging over the P2P network.
//!
//! Provides send/receive of AgentEnvelope messages with an in-memory
//! ring buffer and rate limiting (max 10 messages/second per peer).

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use ts_rs::TS;

use super::connection::ConnectionManager;
use super::protocol::{self, AgentEnvelope, Message};
use crate::error::AppError;

/// Maximum messages stored per persona in the ring buffer.
const MAX_MESSAGES_PER_PERSONA: usize = 100;

/// Rate limit: max messages per second per peer.
const MAX_MESSAGES_PER_SECOND: u32 = 10;

/// Atomic counters for message delivery observability.
pub struct MessagingCounters {
    pub messages_sent: AtomicU64,
    pub messages_received: AtomicU64,
    pub messages_dropped_buffer_full: AtomicU64,
    pub messages_rate_limited: AtomicU64,
    pub bytes_sent: AtomicU64,
    pub bytes_received: AtomicU64,
}

impl MessagingCounters {
    fn new() -> Self {
        Self {
            messages_sent: AtomicU64::new(0),
            messages_received: AtomicU64::new(0),
            messages_dropped_buffer_full: AtomicU64::new(0),
            messages_rate_limited: AtomicU64::new(0),
            bytes_sent: AtomicU64::new(0),
            bytes_received: AtomicU64::new(0),
        }
    }
}

/// Serializable snapshot of messaging metrics for the frontend.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct MessagingMetrics {
    pub messages_sent: u64,
    pub messages_received: u64,
    pub messages_dropped_buffer_full: u64,
    pub messages_rate_limited: u64,
    pub bytes_sent: u64,
    pub bytes_received: u64,
}

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
    /// Delivery metrics counters.
    counters: MessagingCounters,
}

impl MessageRouter {
    pub fn new(connections: Arc<ConnectionManager>) -> Self {
        Self {
            connections,
            inbox: RwLock::new(HashMap::new()),
            rate_tracker: std::sync::Mutex::new(HashMap::new()),
            counters: MessagingCounters::new(),
        }
    }

    /// Send a message to a remote peer.
    pub async fn send_message(
        &self,
        target_peer_id: &str,
        envelope: AgentEnvelope,
    ) -> Result<(), AppError> {
        let payload_bytes = envelope.payload.len() as u64;
        let (mut send, _recv) = self.connections.open_stream(target_peer_id).await?;

        protocol::write_message(
            &mut send,
            &Message::AgentMessage {
                envelope: envelope.clone(),
            },
        )
        .await?;

        self.counters.messages_sent.fetch_add(1, Ordering::Relaxed);
        self.counters.bytes_sent.fetch_add(payload_bytes, Ordering::Relaxed);

        tracing::debug!(
            target_peer = %target_peer_id,
            source_persona = %envelope.source_persona_id,
            target_persona = %envelope.target_persona_id,
            payload_bytes = payload_bytes,
            "Agent message sent"
        );

        Ok(())
    }

    /// Store a received message in the inbox ring buffer.
    pub async fn store_received(&self, source_peer_id: &str, envelope: AgentEnvelope) -> Result<(), AppError> {
        // Rate limit check
        if !self.check_rate_limit(source_peer_id) {
            self.counters.messages_rate_limited.fetch_add(1, Ordering::Relaxed);
            tracing::warn!(
                peer = %source_peer_id,
                "Message rate-limited and dropped"
            );
            return Err(AppError::RateLimited(format!(
                "Rate limit exceeded for peer {}",
                source_peer_id
            )));
        }

        let payload_bytes = envelope.payload.len() as u64;
        let target = &envelope.target_persona_id;
        let mut inbox = self.inbox.write().await;
        let queue = inbox.entry(target.clone()).or_insert_with(VecDeque::new);

        // Ring buffer: evict oldest if at capacity
        if queue.len() >= MAX_MESSAGES_PER_PERSONA {
            queue.pop_front();
            self.counters.messages_dropped_buffer_full.fetch_add(1, Ordering::Relaxed);
            tracing::debug!(
                target_persona = %target,
                "Ring buffer full — oldest message evicted"
            );
        }

        self.counters.messages_received.fetch_add(1, Ordering::Relaxed);
        self.counters.bytes_received.fetch_add(payload_bytes, Ordering::Relaxed);
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
    ///
    /// The mutex is held for the full check-or-insert to prevent a TOCTOU
    /// race where two concurrent calls for the same new peer_id both see
    /// `None` and both insert fresh entries, resetting the counter.
    ///
    /// Window reset uses `compare_exchange` on `window_ms` so that only one
    /// thread wins the reset — preventing doubled throughput at window
    /// boundaries.
    fn check_rate_limit(&self, peer_id: &str) -> bool {
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64;

        let mut tracker = self.rate_tracker.lock().unwrap_or_else(|e| {
            tracing::warn!("rate_tracker mutex was poisoned — recovering");
            e.into_inner()
        });

        use std::collections::hash_map::Entry;

        let entry = match tracker.entry(peer_id.to_string()) {
            Entry::Occupied(o) => o.into_mut(),
            Entry::Vacant(v) => {
                // Brand-new peer — insert with count=1 and allow immediately.
                v.insert(RateEntry::new(now_ms));
                return true;
            }
        };

        let window = entry.window_ms.load(Ordering::Acquire);
        if now_ms.saturating_sub(window) >= 1000 {
            // Try to claim the window reset — only one thread wins the CAS.
            match entry.window_ms.compare_exchange(
                window,
                now_ms,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => {
                    // We won the reset — start a fresh window at count 1.
                    entry.count.store(1, Ordering::Release);
                    return true;
                }
                Err(_) => {
                    // Another thread already reset the window.
                    // Fall through to the normal increment path.
                }
            }
        }
        let prev = entry.count.fetch_add(1, Ordering::AcqRel);
        if prev >= MAX_MESSAGES_PER_SECOND {
            // Undo the increment so we don't inflate the counter
            entry.count.fetch_sub(1, Ordering::AcqRel);
            return false;
        }
        true
    }

    /// Return a point-in-time snapshot of messaging delivery metrics.
    pub fn get_metrics(&self) -> MessagingMetrics {
        MessagingMetrics {
            messages_sent: self.counters.messages_sent.load(Ordering::Relaxed),
            messages_received: self.counters.messages_received.load(Ordering::Relaxed),
            messages_dropped_buffer_full: self.counters.messages_dropped_buffer_full.load(Ordering::Relaxed),
            messages_rate_limited: self.counters.messages_rate_limited.load(Ordering::Relaxed),
            bytes_sent: self.counters.bytes_sent.load(Ordering::Relaxed),
            bytes_received: self.counters.bytes_received.load(Ordering::Relaxed),
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
            let mut tracker = self.rate_tracker.lock().unwrap_or_else(|e| {
                tracing::warn!("rate_tracker mutex was poisoned — recovering");
                e.into_inner()
            });
            tracker.retain(|_, entry| {
                now_ms.saturating_sub(entry.window_ms.load(Ordering::Relaxed)) < 60_000
            });
            let _ = connections; // keep reference alive
        }
    }
}
