//! Observability digest — what's happening in the Personas app *right now*.
//!
//! Athena's prompt is rebuilt each turn with a fresh digest so she has
//! current situational awareness: which agents exist, what's running, what
//! failed, what's waiting on a Human Review, what healing issues are open.
//!
//! All queries are bounded (counts + small top-K lists) so the digest
//! stays under ~1KB even with hundreds of agents.
//!
//! Reads from the *system* DB (state.db), where agent/execution/healing/
//! review tables live — not the user DB (state.user_db) which holds
//! companion + KB tables.

use crate::db::DbPool;
use crate::error::AppError;

#[derive(Debug, Default)]
pub struct ObservabilityDigest {
    pub personas_enabled: i64,
    pub personas_total: i64,
    pub top_personas: Vec<String>,
    pub executions_running: i64,
    pub executions_queued: i64,
    pub executions_completed_24h: i64,
    pub executions_failed_24h: i64,
    pub recent_failures: Vec<RecentFailure>,
    pub healing_open: i64,
    pub healing_top: Vec<HealingIssue>,
    pub reviews_pending: i64,
    pub top_reviews: Vec<PendingReview>,
}

#[derive(Debug)]
pub struct RecentFailure {
    pub persona_name: String,
    pub error: String,
    pub created_at: String,
}

#[derive(Debug)]
pub struct HealingIssue {
    pub persona_name: String,
    pub title: String,
    pub severity: String,
}

#[derive(Debug)]
pub struct PendingReview {
    pub persona_name: String,
    pub title: String,
    pub severity: String,
    pub created_at: String,
}

/// Build the digest. Best-effort — any individual query failure is logged
/// and elided from the result rather than failing the whole turn.
pub fn build(db: &DbPool) -> Result<ObservabilityDigest, AppError> {
    let conn = db.get()?;
    let mut digest = ObservabilityDigest::default();

    // Persona counts
    if let Ok(row) = conn.query_row(
        "SELECT COUNT(*) AS total,
                SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) AS enabled
         FROM personas",
        [],
        |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, Option<i64>>(1)?.unwrap_or(0),
            ))
        },
    ) {
        digest.personas_total = row.0;
        digest.personas_enabled = row.1;
    }

    // Top 10 enabled persona names
    if let Ok(mut stmt) = conn
        .prepare("SELECT name FROM personas WHERE enabled = 1 ORDER BY updated_at DESC LIMIT 10")
    {
        if let Ok(rows) = stmt.query_map([], |r| r.get::<_, String>(0)) {
            digest.top_personas = rows.filter_map(|r| r.ok()).collect();
        }
    }

    // Execution counts (24h window for completed/failed)
    if let Ok(row) = conn.query_row(
        "SELECT
            SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'completed' AND created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END),
            SUM(CASE WHEN status = 'failed'    AND created_at >= datetime('now','-1 day') THEN 1 ELSE 0 END)
         FROM persona_executions",
        [],
        |r| {
            Ok((
                r.get::<_, Option<i64>>(0)?.unwrap_or(0),
                r.get::<_, Option<i64>>(1)?.unwrap_or(0),
                r.get::<_, Option<i64>>(2)?.unwrap_or(0),
                r.get::<_, Option<i64>>(3)?.unwrap_or(0),
            ))
        },
    ) {
        digest.executions_running = row.0;
        digest.executions_queued = row.1;
        digest.executions_completed_24h = row.2;
        digest.executions_failed_24h = row.3;
    }

    // Most recent 5 failures
    if let Ok(mut stmt) = conn.prepare(
        "SELECT p.name, COALESCE(e.error_message, 'unknown'), e.created_at
         FROM persona_executions e
         JOIN personas p ON p.id = e.persona_id
         WHERE e.status = 'failed'
         ORDER BY e.created_at DESC
         LIMIT 5",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(RecentFailure {
                persona_name: r.get(0)?,
                error: r.get::<_, String>(1)?,
                created_at: r.get(2)?,
            })
        }) {
            digest.recent_failures = rows.filter_map(|r| r.ok()).collect();
        }
    }

    // Healing
    digest.healing_open = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_healing_issues WHERE status = 'open'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0);

    if let Ok(mut stmt) = conn.prepare(
        "SELECT p.name, h.title, h.severity
         FROM persona_healing_issues h
         JOIN personas p ON p.id = h.persona_id
         WHERE h.status = 'open'
         ORDER BY CASE h.severity
                    WHEN 'critical' THEN 0
                    WHEN 'high' THEN 1
                    WHEN 'medium' THEN 2
                    ELSE 3 END,
                  h.created_at DESC
         LIMIT 5",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(HealingIssue {
                persona_name: r.get(0)?,
                title: r.get(1)?,
                severity: r.get(2)?,
            })
        }) {
            digest.healing_top = rows.filter_map(|r| r.ok()).collect();
        }
    }

    // Pending Human Reviews
    digest.reviews_pending = conn
        .query_row(
            "SELECT COUNT(*) FROM persona_manual_reviews WHERE status = 'pending'",
            [],
            |r| r.get::<_, i64>(0),
        )
        .unwrap_or(0);

    if let Ok(mut stmt) = conn.prepare(
        "SELECT p.name, r.title, r.severity, r.created_at
         FROM persona_manual_reviews r
         JOIN personas p ON p.id = r.persona_id
         WHERE r.status = 'pending'
         ORDER BY r.created_at DESC
         LIMIT 5",
    ) {
        if let Ok(rows) = stmt.query_map([], |r| {
            Ok(PendingReview {
                persona_name: r.get(0)?,
                title: r.get(1)?,
                severity: r.get(2)?,
                created_at: r.get(3)?,
            })
        }) {
            digest.top_reviews = rows.filter_map(|r| r.ok()).collect();
        }
    }

    Ok(digest)
}

/// Render the digest as a markdown section to splice into Athena's
/// system prompt. Empty when there's nothing meaningful to report.
pub fn format_for_prompt(d: &ObservabilityDigest) -> String {
    let mut out = String::new();
    out.push_str("\n\n# Current state of the Personas app (right now)\n\n");

    out.push_str(&format!(
        "- **Agents**: {} total, {} enabled\n",
        d.personas_total, d.personas_enabled
    ));
    if !d.top_personas.is_empty() {
        out.push_str(&format!(
            "  - Recently active: {}\n",
            d.top_personas.join(", ")
        ));
    }

    out.push_str(&format!(
        "- **Executions**: {} running, {} queued; in last 24h — {} completed, {} failed\n",
        d.executions_running,
        d.executions_queued,
        d.executions_completed_24h,
        d.executions_failed_24h
    ));
    if !d.recent_failures.is_empty() {
        out.push_str("- Recent failures:\n");
        for f in &d.recent_failures {
            let err = if f.error.len() > 120 {
                format!("{}…", &f.error[..120])
            } else {
                f.error.clone()
            };
            out.push_str(&format!(
                "  - {} ({}): {}\n",
                f.persona_name, f.created_at, err
            ));
        }
    }

    if d.healing_open > 0 {
        out.push_str(&format!("- **Healing**: {} open issues\n", d.healing_open));
        for h in &d.healing_top {
            out.push_str(&format!(
                "  - [{}] {} — {}\n",
                h.severity, h.persona_name, h.title
            ));
        }
    }

    if d.reviews_pending > 0 {
        out.push_str(&format!(
            "- **Pending Human Reviews**: {} awaiting decision\n",
            d.reviews_pending
        ));
        for r in &d.top_reviews {
            out.push_str(&format!(
                "  - [{}] {} — {} ({})\n",
                r.severity, r.persona_name, r.title, r.created_at
            ));
        }
    }

    out.push_str(
        "\nUse this for situational awareness. Refer to specific agents/runs by name when relevant.\n",
    );

    out
}
