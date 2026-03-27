//! Shared mock-seeding helpers for dev/test event and message generation.
//!
//! Centralises the "pick a persona by timestamp-modulus" pattern and replaces
//! fragile parallel const arrays with self-documenting struct arrays.

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

use crate::db::models::PersonaEventStatus;
use crate::error::AppError;

/// Pick a persona ID from the database using a deterministic-ish timestamp
/// modulus. Returns `None` when no personas exist.
pub fn pick_persona_id(
    db: &Pool<SqliteConnectionManager>,
    t: usize,
) -> Result<Option<String>, AppError> {
    let personas = crate::db::repos::core::personas::get_all(db)?;
    let idx = t % std::cmp::max(personas.len(), 1);
    Ok(personas.get(idx).map(|p| p.id.clone()))
}

/// Returns `chrono::Utc::now().timestamp_millis()` cast to `usize` — the
/// shared source of pseudo-randomness for mock seed functions.
pub fn seed_index() -> usize {
    chrono::Utc::now().timestamp_millis() as usize
}

// ---------------------------------------------------------------------------
// Mock event templates
// ---------------------------------------------------------------------------

pub struct MockEventTemplate {
    pub event_type: &'static str,
    pub source: &'static str,
    pub status: PersonaEventStatus,
}

pub const MOCK_EVENT_TEMPLATES: &[MockEventTemplate] = &[
    MockEventTemplate { event_type: "webhook_received",    source: "webhook",         status: PersonaEventStatus::Completed  },
    MockEventTemplate { event_type: "execution_completed", source: "scheduler",       status: PersonaEventStatus::Completed  },
    MockEventTemplate { event_type: "trigger_fired",       source: "trigger_engine",  status: PersonaEventStatus::Processing },
    MockEventTemplate { event_type: "credential_rotated",  source: "vault",           status: PersonaEventStatus::Completed  },
    MockEventTemplate { event_type: "health_check_failed", source: "health_monitor",  status: PersonaEventStatus::Failed     },
    MockEventTemplate { event_type: "deployment_started",  source: "cloud_deploy",    status: PersonaEventStatus::Processing },
    MockEventTemplate { event_type: "memory_created",      source: "memory_engine",   status: PersonaEventStatus::Completed  },
    MockEventTemplate { event_type: "review_submitted",    source: "review_pipeline", status: PersonaEventStatus::Pending    },
];

// ---------------------------------------------------------------------------
// Mock message templates
// ---------------------------------------------------------------------------

pub struct MockMessageTemplate {
    pub title: &'static str,
    pub content: &'static str,
    pub priority: &'static str,
}

pub const MOCK_MESSAGE_TEMPLATES: &[MockMessageTemplate] = &[
    MockMessageTemplate {
        title: "Build completed successfully",
        content: "The CI pipeline completed in 3m 42s with all 127 tests passing. No warnings detected.",
        priority: "normal",
    },
    MockMessageTemplate {
        title: "API rate limit warning",
        content: "API endpoint /v2/users is approaching the rate limit (85/100 req/min). Consider implementing caching.",
        priority: "high",
    },
    MockMessageTemplate {
        title: "New deployment ready for review",
        content: "Version 2.4.1 has been deployed to staging. Please review the changes before promoting to production.",
        priority: "normal",
    },
    MockMessageTemplate {
        title: "Database migration completed",
        content: "Migration #047 applied successfully. Added indexes on created_at columns for improved query performance.",
        priority: "normal",
    },
    MockMessageTemplate {
        title: "Scheduled report generated",
        content: "Weekly analytics report for March 2026 has been generated and is ready for download.",
        priority: "low",
    },
    MockMessageTemplate {
        title: "Error threshold exceeded",
        content: "Error rate for the payment service has exceeded 5% threshold over the last 15 minutes.",
        priority: "high",
    },
    MockMessageTemplate {
        title: "Customer feedback received",
        content: "New feedback from enterprise customer: 'The API response times have improved significantly since the last update.'",
        priority: "normal",
    },
    MockMessageTemplate {
        title: "Security scan completed",
        content: "Security scan found 0 critical, 2 moderate, and 5 low severity issues. Moderate issues require attention within 30 days.",
        priority: "high",
    },
];
