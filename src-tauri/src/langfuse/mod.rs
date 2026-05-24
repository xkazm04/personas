//! Langfuse observability integration (Phase 1a — connection plumbing only).
//!
//! Phase 1a covers: connection form UX, encrypted storage of keys via the OS
//! keyring, and a `test_connection` probe against `/api/public/projects`.
//! No spans are exported yet — the OTLP exporter wiring lands in Phase 1b.
//! See `docs/concepts/langfuse-observability.md`.

pub mod client;
pub mod config;
pub mod docker;
pub mod exporter;
pub mod lab_score;
pub mod lifecycle;
pub mod templates;
pub mod types;
