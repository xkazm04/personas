//! Companion (Athena) — always-available chat partner over the agent ecosystem.
//!
//! Phase 0 scaffold: directory layout, embedded constitution/identity templates,
//! and brain submodule stubs. Real wiring lands in subsequent phases.
//!
//! Source of truth for memory is markdown on disk at
//! `~/.personas/companion-brain/`. SQL tables (see `companion_node`,
//! `companion_edge`, ...) are an index over those files plus runtime state.

pub mod athena_reaction;
pub mod brain;
pub mod canvas;
pub mod connectors;
pub mod conversation;
pub mod dev_mode;
pub mod disk;
pub mod dispatcher;
pub mod generated_anchors;
pub mod generated_tour_anchors;
pub mod jobs;
pub mod knowledge_ops;
pub mod model_routing;
pub mod night_shift;
pub mod observability;
pub mod orchestration;
pub mod plugins;
pub mod proactive;
pub mod projects;
pub mod prompt;
/// Athena's end of the cross-device link. Gated on `p2p` because the seam it
/// implements (`engine::p2p::remote_jobs::RemoteJobExecutor`) and the transport
/// it listens to only exist in a build that has the network. The OUTBOUND op
/// (`remote_instruct`) is deliberately NOT gated — see
/// `commands::companion::approvals::approval_exec_devices`.
#[cfg(feature = "p2p")]
pub mod remote_jobs;
pub mod session;
pub mod stt;
pub mod templates;
pub mod tours;
pub mod tts;
pub mod turn_ledger;
pub mod util;
pub mod wake_window;
