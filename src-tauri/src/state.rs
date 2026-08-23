//! `AppState` — the shared application state every Tauri command reaches
//! through `tauri::State<Arc<AppState>>`.
//!
//! Moved out of `lib.rs` unchanged (Rust refactor W1). The struct is a
//! verbatim move: same field order, same `#[cfg]` gates, same visibility, and
//! deliberately still no methods — an accessor layer is a later wave, and
//! adding one here would turn a move into a redesign.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::db::{self, DbPool};
use crate::process_registry::ActiveProcessRegistry;
use crate::{cloud, commands, engine, gitlab, webbuild};

/// Shared application state accessible from all Tauri commands.
#[allow(clippy::type_complexity)]
pub struct AppState {
    pub db: DbPool,
    /// Separate user-facing database (`personas_data.db`).
    /// Agents and users can freely read/write here without affecting app internals.
    pub user_db: db::UserDbPool,
    pub engine: Arc<engine::ExecutionEngine>,
    pub scheduler: Arc<engine::background::SchedulerState>,
    /// Registry of active CLI-backed processes (design, credential_design,
    /// negotiation, automation_design, auto_cred).
    pub process_registry: Arc<ActiveProcessRegistry>,
    /// Authentication state (Supabase OAuth).
    pub auth: Arc<tokio::sync::RwLock<commands::infrastructure::auth::AuthStateInner>>,
    /// Serialises token refresh attempts so that only one in-flight refresh
    /// executes at a time, preventing the race where concurrent callers each
    /// consume the same single-use refresh token (Supabase rotates on use).
    pub refresh_lock: Arc<tokio::sync::Mutex<()>>,
    /// Cloud orchestrator HTTP client (None when not connected).
    pub cloud_client: Arc<tokio::sync::Mutex<Option<Arc<cloud::client::CloudClient>>>>,
    /// Guard flag: prevents concurrent cloud_connect / cloud_reconnect_from_keyring
    /// calls from racing through the health check and keyring write.
    pub cloud_connecting: Arc<std::sync::atomic::AtomicBool>,
    /// Maps local execution ID -> cloud execution ID for active cloud runs.
    pub cloud_exec_ids: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    /// GitLab API client (None when not connected).
    pub gitlab_client: Arc<tokio::sync::Mutex<Option<Arc<gitlab::client::GitLabClient>>>>,
    /// Cached GitLab token validation result (username, timestamp). TTL: 60s.
    pub gitlab_config_cache: Arc<tokio::sync::Mutex<Option<(std::time::Instant, String)>>>,
    /// Rate limiter for event publishing and webhook intake.
    pub rate_limiter: Arc<engine::rate_limiter::RateLimiter>,
    /// Session-specific RSA key pair for encrypted IPC.
    pub session_key: Arc<engine::crypto::SessionKeyPair>,
    /// Current tier configuration (rate limits, queue depth).
    pub tier_config: Arc<Mutex<engine::tier::TierConfig>>,
    /// TTL-cached tier usage snapshot (avoids repeated lock contention on
    /// tier_config + concurrency tracker for dashboard polling).
    pub tier_usage_cache: Arc<
        Mutex<
            Option<(
                std::time::Instant,
                commands::infrastructure::tier_usage::TierUsageSnapshot,
            )>,
        >,
    >,
    /// Persistent host CPU/RAM sampler for the footer load gauge. Holds one
    /// `System` so consecutive CPU refreshes yield a correct usage delta.
    pub system_metrics: Mutex<commands::infrastructure::system_metrics::SystemMetricsSampler>,
    /// Desktop connector capability approvals.
    #[cfg(feature = "desktop")]
    pub desktop_approvals: Arc<engine::desktop_security::DesktopApprovalStore>,
    /// Local agent runtime for cross-app desktop plan execution.
    #[cfg(feature = "desktop")]
    pub desktop_runtime: Arc<engine::desktop_runtime::DesktopRuntime>,
    /// Ambient context fusion: rolling window of desktop signals for persona senses.
    #[cfg(feature = "desktop")]
    pub ambient_context: engine::ambient_context::AmbientContextHandle,
    /// Context rule engine: pattern-based subscriptions for proactive persona actions.
    #[cfg(feature = "desktop")]
    pub context_rule_engine: engine::context_rules::ContextRuleEngineHandle,
    /// P2P network service (LAN discovery, QUIC transport, manifest sync).
    #[cfg(feature = "p2p")]
    pub network: Option<Arc<engine::p2p::NetworkService>>,
    /// Cached auth detection results with expiry time.
    /// Avoids re-spawning 9 CLI probes + cookie DB copies on repeated wizard calls.
    pub auth_detect_cache: Arc<
        tokio::sync::Mutex<
            Option<(
                std::time::Instant,
                Vec<commands::credentials::auth_detect::AuthDetection>,
            )>,
        >,
    >,
    /// Embedding manager for vector knowledge bases (lazy-loaded model).
    #[cfg(feature = "ml")]
    pub embedding_manager: Option<Arc<engine::embedder::EmbeddingManager>>,
    /// SQLite-vec vector store for knowledge bases.
    #[cfg(feature = "ml")]
    pub vector_store: Option<Arc<engine::vector_store::SqliteVectorStore>>,
    /// Active KB ingestion jobs: maps kb_id → CancellationToken so that
    /// `delete_knowledge_base` can cancel in-flight ingestion before dropping tables.
    #[cfg(feature = "ml")]
    pub kb_ingest_jobs:
        Arc<tokio::sync::Mutex<HashMap<String, tokio_util::sync::CancellationToken>>>,
    /// Cloud webhook relay state — shared with the background subscription so
    /// that the `cloud_webhook_relay_status` command can read live counters.
    pub cloud_webhook_relay_state:
        Arc<tokio::sync::Mutex<engine::cloud_webhook_relay::CloudWebhookRelayState>>,
    /// Shared event relay state — polls subscribed shared event feeds from
    /// the FastAPI facade and injects them into the local event bus.
    pub shared_event_relay_state:
        Arc<tokio::sync::Mutex<engine::shared_event_relay::SharedEventRelayState>>,
    /// Build session manager for multi-turn agent builder sessions.
    pub build_session_manager: Arc<engine::build_session::BuildSessionManager>,
    /// Composite trigger evaluation state (suppression cache + partial matches).
    pub composite_state: engine::composite::CompositeState,
    /// Session reuse pool — caches Claude session IDs for warm persona re-execution.
    pub session_pool: Arc<engine::session_pool::SessionPool>,
    /// TTL-based cache for CLI binary probes (version / PATH checks).
    pub binary_probe_cache: Arc<commands::infrastructure::system::BinaryProbeCache>,
    /// Notifier for the Smee relay manager — wake it immediately on relay
    /// create / update / delete instead of waiting for the next poll cycle.
    pub smee_relay_notifier: engine::smee_relay::SmeeRelayNotifier,
    /// Whether the clipboard error watcher is enabled (toggled from system tray).
    #[cfg(feature = "desktop")]
    pub clipboard_watcher_enabled: Arc<std::sync::atomic::AtomicBool>,
    /// Project tracking subsystem — absorbs CLI activity (git commits,
    /// active-runs ledger, optional Obsidian notes) into per-project
    /// pulses consumed by Companion's brain. Always present; the master
    /// enable gate inside controls whether ticks do work.
    pub project_tracking: Arc<engine::project_tracking::ProjectTracker>,
    /// Engine leadership for this process — which instance owns the singleton
    /// background loops against the shared local DB (multi-driver
    /// orchestration, ADR 2026-05-26). Acquired at startup; a heartbeat task
    /// keeps the lease fresh. Loop gating on `is_leader()` lands in a later
    /// phase — present here so all surfaces can read leadership now.
    pub leadership: Arc<engine::leadership::EngineLeadership>,
    /// Bun dev-server registry for the web-build runtime (Athena web-dev
    /// companion). Held here so `stop_all` runs from the app-exit hook and a
    /// closing app never orphans a `bun`/`next` process tree.
    pub webbuild_servers: Arc<webbuild::DevServerRegistry>,
    /// Backpressure for the local Piper TTS sidecar. Each piper process loads a
    /// full ONNX voice into memory; chunked replies (multiple `companion_tts`
    /// calls) or TTS-while-STT could otherwise stack unbounded piper processes
    /// and spike memory. Permit is held across the synth call. (combined-scan
    /// 2026-06-25 #3 — separate per-engine cap so one piper + one whisper can
    /// still run at once.)
    pub companion_tts_semaphore: Arc<tokio::sync::Semaphore>,
    /// Backpressure for the local whisper STT sidecar. Whisper saturates all
    /// CPU cores, so overlapping dictations must not stack whisper processes.
    /// Permit is held across the transcribe call. (combined-scan 2026-06-25 #3)
    pub companion_stt_semaphore: Arc<tokio::sync::Semaphore>,
}
