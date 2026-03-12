//! Agent-to-agent messaging over the P2P network.
//!
//! Provides send/receive of AgentEnvelope messages with an in-memory
//! ring buffer and rate limiting (max 10 messages/second per peer).

use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

use tokio::sync::RwLock;

use super::connection::ConnectionManager;
use super::protocol::{self, AgentEnvelope, Message};
use crate::error::AppError;

/// Maximum messages stored per persona in the ring buffer.
const MAX_MESSAGES_PER_PERSONA: usize = 100;

/// Rate limit: max messages per second per peer.
const MAX_MESSAGES_PER_SECOND: u32 = 10;

/// Routes and stores agent-to-agent messages.
pub struct MessageRouter {
    connections: Arc<ConnectionManager>,
    /// In-memory ring buffer: target_persona_id -> Vec<AgentEnvelope>
    inbox: RwLock<HashMap<String, VecDeque<AgentEnvelope>>>,
    /// Rate tracking: source_peer_id -> (count, window_start)
    rate_tracker: RwLock<HashMap<String, (u32, std::time::Instant)>>,
}

impl MessageRouter {
    pub fn new(connections: Arc<ConnectionManager>) -> Self {
        Self {
            connections,
            inbox: RwLock::new(HashMap::new()),
            rate_tracker: RwLock::new(HashMap::new()),
        }
    }

    /// Send a message to a remote peer.
    pub async fn send_message(
        &self,
        target_peer_id: &str,
        envelope: AgentEnvelope,
    ) -> Result<(), AppError> {
        let quinn_conn = self
            .connections
            .get_quinn_conn(target_peer_id)
            .await
            .ok_or_else(|| {
                AppError::NotFound(format!("Not connected to peer {}", target_peer_id))
            })?;

        let (send, _recv) = quinn_conn.open_bi().await.map_err(|e| {
            AppError::Internal(format!("Failed to open message stream: {e}"))
        })?;

        let mut send = tokio::io::BufWriter::new(send);

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
        if !self.check_rate_limit(source_peer_id).await {
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

    /// Check and update rate limit for a peer.
    async fn check_rate_limit(&self, peer_id: &str) -> bool {
        let mut tracker = self.rate_tracker.write().await;
        let now = std::time::Instant::now();

        let entry = tracker
            .entry(peer_id.to_string())
            .or_insert((0, now));

        // Reset window if more than 1 second has passed
        if now.duration_since(entry.1).as_secs() >= 1 {
            entry.0 = 0;
            entry.1 = now;
        }

        if entry.0 >= MAX_MESSAGES_PER_SECOND {
            return false;
        }

        entry.0 += 1;
        true
    }

    /// Background loop that receives messages from all connected peers.
    /// Listens for incoming uni/bi streams on each connection.
    pub async fn receive_loop(&self, connections: Arc<ConnectionManager>) {
        // This is handled in the connection accept path -- each incoming stream
        // is dispatched based on the message type. This loop is a placeholder
        // for future background processing (e.g., event emission).
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(60)).await;
            // Cleanup old rate tracker entries
            let mut tracker = self.rate_tracker.write().await;
            let now = std::time::Instant::now();
            tracker.retain(|_, (_, window_start)| {
                now.duration_since(*window_start).as_secs() < 60
            });
            let _ = connections; // keep reference alive
        }
    }
}
