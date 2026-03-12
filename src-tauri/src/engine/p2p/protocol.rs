//! Wire protocol for P2P communication.
//!
//! Uses MessagePack serialization with a 4-byte big-endian length prefix.
//! All messages are framed as: [u32 length][msgpack payload].

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use crate::error::AppError;

/// Protocol version — increment when making breaking changes.
pub const PROTOCOL_VERSION: u32 = 1;

/// Maximum message size (16 MB) to prevent memory exhaustion from malicious peers.
const MAX_MESSAGE_SIZE: u32 = 16 * 1024 * 1024;

/// Top-level wire protocol message.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Message {
    /// Initial handshake from connecting peer.
    Hello {
        peer_id: String,
        display_name: String,
        version: u32,
    },
    /// Handshake response from accepting peer.
    HelloAck {
        peer_id: String,
        display_name: String,
        version: u32,
    },
    /// Request the peer's exposure manifest.
    ManifestRequest,
    /// Response with the peer's exposure manifest.
    ManifestResponse {
        resources: Vec<ManifestEntry>,
    },
    /// Agent-to-agent message.
    AgentMessage {
        envelope: AgentEnvelope,
    },
    /// Keep-alive ping.
    Ping,
    /// Keep-alive pong response.
    Pong,
}

/// An entry in the manifest exchange.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestEntry {
    pub resource_type: String,
    pub resource_id: String,
    pub display_name: String,
    pub access_level: String,
    pub tags: Vec<String>,
}

/// Envelope for agent-to-agent messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentEnvelope {
    pub id: String,
    pub source_persona_id: String,
    pub target_persona_id: String,
    pub payload: Vec<u8>,
    pub timestamp: String,
}

/// Encode a message to bytes with a 4-byte big-endian length prefix.
pub fn encode(msg: &Message) -> Result<Vec<u8>, AppError> {
    let payload = rmp_serde::to_vec(msg)
        .map_err(|e| AppError::Internal(format!("MessagePack encode error: {e}")))?;
    let len = payload.len() as u32;
    if len > MAX_MESSAGE_SIZE {
        return Err(AppError::Validation(format!(
            "Message too large: {} bytes (max {})",
            len, MAX_MESSAGE_SIZE
        )));
    }
    let mut buf = Vec::with_capacity(4 + payload.len());
    buf.extend_from_slice(&len.to_be_bytes());
    buf.extend_from_slice(&payload);
    Ok(buf)
}

/// Decode a message from a reader (reads length prefix then payload).
pub async fn decode<R: AsyncRead + Unpin>(reader: &mut R) -> Result<Message, AppError> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf).await.map_err(|e| {
        AppError::Internal(format!("Failed to read message length: {e}"))
    })?;
    let len = u32::from_be_bytes(len_buf);

    if len > MAX_MESSAGE_SIZE {
        return Err(AppError::Validation(format!(
            "Message too large: {} bytes (max {})",
            len, MAX_MESSAGE_SIZE
        )));
    }

    let mut payload = vec![0u8; len as usize];
    reader.read_exact(&mut payload).await.map_err(|e| {
        AppError::Internal(format!("Failed to read message payload: {e}"))
    })?;

    rmp_serde::from_slice(&payload)
        .map_err(|e| AppError::Internal(format!("MessagePack decode error: {e}")))
}

/// Write an encoded message to a writer.
pub async fn write_message<W: AsyncWrite + Unpin>(
    writer: &mut W,
    msg: &Message,
) -> Result<(), AppError> {
    let bytes = encode(msg)?;
    writer.write_all(&bytes).await.map_err(|e| {
        AppError::Internal(format!("Failed to write message: {e}"))
    })?;
    writer.flush().await.map_err(|e| {
        AppError::Internal(format!("Failed to flush message: {e}"))
    })?;
    Ok(())
}
