//! A2A (Agent-to-Agent) protocol surface for the Personas management API.
//!
//! This module exposes Personas as A2A-compatible agents over HTTP. The
//! `types` submodule defines the on-the-wire request/response shapes.
//!
//! Future work (out of scope for the gateway-foundation handoff):
//! - `client.rs` — outbound A2A consumer (Personas as A2A client)
//! - streaming via `message/stream`
//! - per-key scope-based persona allowlists

pub mod types;
