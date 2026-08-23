//! Ambient Context Fusion: continuous desktop signal aggregation.
//!
//! Unifies clipboard, file watcher, and app focus signals into a rolling
//! context window that personas can subscribe to via sensory policies.
//! The fused context is injected into execution prompts so personas are
//! aware of the user's current workflow without explicit triggers.
//!
//! Split out of the former single-file `ambient_context.rs` (2,274 lines).
//! The cut follows the module's own layers and moves no logic:
//!
//! - [`types`] — the serde/`ts-rs` wire shapes and the context-stream channel
//!   aliases: [`ContextEvent`], [`AmbientSignal`], [`SensoryPolicy`],
//!   [`AmbientContextSnapshot`], [`AmbientSignalEntry`],
//!   [`SensorySourceState`].
//! - [`fusion`] — [`AmbientContextFusion`] and its behaviour: the per-source
//!   privacy gates, the push paths, the rolling window and its policy-driven
//!   sizing, signal listing/deletion, and the tick that drives it. The struct
//!   stays beside its inherent impl, which is the only thing that touches its
//!   fields.
//! - [`redaction`] — the two prompt-safety scrubbers applied before any
//!   captured text is stored ([`redact_clipboard_content`],
//!   [`redact_window_title`]) and their length caps.
//! - [`formatting`] — rendering signals into prompt text and splicing that
//!   block onto a persona's system prompt.
//! - [`screenshot`] — [`ValidationScreenshot`] capture and its age-based
//!   pruning.
//! - `tests` — the unit tests, one module per layer above.
//!
//! Everything stays reachable as `personas_engine::ambient_context::X`; the
//! glob re-exports below preserve the pre-split surface exactly.

mod formatting;
mod fusion;
mod redaction;
mod screenshot;
mod types;

#[cfg(test)]
mod tests;

pub use formatting::*;
pub use fusion::*;
pub use redaction::*;
pub use screenshot::*;
pub use types::*;
