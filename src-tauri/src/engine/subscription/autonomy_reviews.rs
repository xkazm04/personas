use super::*;
use crate::db::DbPool;
use std::time::Duration;

// ---------------------------------------------------------------------------
// Autonomous manual-review triage (default-OFF) — keep the learning loop turning
// ---------------------------------------------------------------------------

/// A review must sit `pending` at least this long before auto-triage touches
/// it, giving a human first crack.
const REVIEW_TRIAGE_GRACE_MINUTES: i64 = 60;
/// Max reviews auto-triaged per tick.
const REVIEW_TRIAGE_MAX_PER_TICK: usize = 10;

/// Auto-resolves routine `persona_manual_reviews` that have sat `pending` past a
/// grace window, so the accept/reject → memory learning loop keeps turning
/// unattended. Conservative policy: APPROVES only low/medium severity (which
/// `manual_reviews::update_status` routes into a `decision` team/persona memory);
/// HIGH/critical severity is left for a human. Gated on the master autonomous
/// toggle (`COMPANION_AUTONOMOUS_MODE`) — review triage is implied whenever
/// autonomy is ON; the legacy `AUTONOMOUS_REVIEW_TRIAGE` key is kept but no
/// longer read. Distinct from the command-triggered
/// `gc_stale_pending`, which neutral-resolves (no learning signal).
pub struct ManualReviewAutoTriageSubscription {
    pub pool: DbPool,
}

/// One pending review eligible for auto-triage.
struct TriageCandidate {
    id: String,
    severity: String,
    title: String,
    description: String,
    suggested_actions: String,
}

fn find_triage_candidates(pool: &DbPool) -> Result<Vec<TriageCandidate>, crate::error::AppError> {
    let conn = pool.get()?;
    let cutoff = format!("-{REVIEW_TRIAGE_GRACE_MINUTES} minutes");
    let mut stmt = conn.prepare(
        "SELECT id, COALESCE(severity,'medium'), COALESCE(title,''), \
                COALESCE(description,''), COALESCE(suggested_actions,'')
         FROM persona_manual_reviews
         WHERE status = 'pending' AND datetime(created_at) < datetime('now', ?1)
         -- Auto-APPROVABLE severities first (low/medium), THEN high/critical,
         -- each oldest-first. Without this, a backlog of legitimately-held
         -- high/critical business items (PHI/PII/compliance) at the front of an
         -- oldest-first queue permanently STARVES the approvable low/medium
         -- reviews behind them under the per-tick cap — the real reason
         -- autonomous triage resolved nothing despite 29 approvable pending.
         ORDER BY CASE WHEN lower(COALESCE(severity,'medium')) IN ('low','medium') THEN 0 ELSE 1 END,
                  created_at ASC",
    )?;
    let rows = stmt.query_map(rusqlite::params![cutoff], |r| {
        Ok(TriageCandidate {
            id: r.get(0)?,
            severity: r.get(1)?,
            title: r.get(2)?,
            description: r.get(3)?,
            suggested_actions: r.get(4)?,
        })
    })?;
    Ok(rows.filter_map(Result::ok).collect())
}

/// Business/policy markers — a HARD denylist. A high/critical review whose text
/// matches ANY of these is NEVER auto-approved unattended; it is a genuine human
/// decision (PHI/compliance, production config, pricing, irreversible/destructive
/// change, secrets/credentials). The denylist wins on any overlap with the
/// safe-technical allowlist below.
const REVIEW_BUSINESS_POLICY_MARKERS: &[&str] = &[
    "phi",
    "hipaa",
    "baa",
    "pii",
    "compliance",
    "gdpr",
    "production",
    "prod deploy",
    "prod-deploy",
    "production config",
    "production-config",
    "pricing",
    "price",
    "payment",
    "billing",
    "origin push",
    "push to origin",
    "force push",
    "force-push",
    "--force",
    "irreversible",
    "destructive",
    "rm -rf",
    "drop table",
    "delete all",
    "purge",
    "credential",
    "secret",
    "api key",
    "egress",
];

/// Safe technical-status markers — items the team policy says should NOT be human
/// review items at all (a red build, a lint failure, a code-review change-request,
/// a missing dependency/migration, a mis-sequenced handoff). A high/critical
/// review matching one of these (and NO business/policy marker) is safe to
/// auto-approve unattended.
const REVIEW_SAFE_TECHNICAL_MARKERS: &[&str] = &[
    "lint",
    "eslint",
    "tsc",
    "typecheck",
    "type error",
    "red build",
    "build is red",
    "build red",
    "ci red",
    "ci fail",
    "build fail",
    "test fail",
    "tests fail",
    "failing test",
    "request_changes",
    "request-changes",
    "request changes",
    "change-request",
    "missing dependency",
    "missing migration",
    "migration landed",
    "migration needed",
    "migration before",
    "pre-existing lint",
    "pre-existing",
    "baseline lint",
    "stray file",
    "mis-sequenced",
    "handoff",
    "blocked — fix",
    "blocked - fix",
    "findings to triage",
    "review findings",
    "e2e review",
];

/// Decide whether a HIGH/critical-severity pending review is safe to auto-approve
/// unattended. Conservative: the business/policy denylist wins on any overlap, and
/// anything not recognised as a safe technical-status item stays pending for a
/// human. Pure + unit-tested.
pub(super) fn high_severity_auto_approvable(
    title: &str,
    description: &str,
    suggested_actions: &str,
) -> bool {
    let hay = format!("{title}\n{description}\n{suggested_actions}").to_ascii_lowercase();
    if REVIEW_BUSINESS_POLICY_MARKERS
        .iter()
        .any(|m| hay.contains(m))
    {
        return false; // genuine business/policy decision — never auto-approve
    }
    REVIEW_SAFE_TECHNICAL_MARKERS
        .iter()
        .any(|m| hay.contains(m))
}

#[async_trait::async_trait]
impl ReactiveSubscription for ManualReviewAutoTriageSubscription {
    fn name(&self) -> &'static str {
        "manual_review_auto_triage"
    }
    fn interval(&self) -> Duration {
        Duration::from_secs(600)
    }
    fn idle_interval(&self) -> Duration {
        Duration::from_secs(1800)
    }
    fn initial_delay(&self) -> Duration {
        Duration::from_secs(120)
    }

    async fn tick(&self) {
        // Gated on the master autonomous toggle: turning autonomy ON implies
        // review triage (no separate opt-in; the legacy
        // `autonomous_review_triage` key is no longer consulted).
        use crate::engine::autonomy::{self, Action};
        let enabled = autonomy::global_enabled(&self.pool, Action::CompanionMaster);
        if !enabled {
            return;
        }

        // High/critical auto-approval is a SEPARATE, riskier opt-in: only safe
        // technical-status items (allowlist) with no business/policy marker
        // (denylist) are approved; genuine business/policy decisions stay human.
        let high_enabled = autonomy::global_enabled(&self.pool, Action::ReviewTriageHigh);

        let pool = self.pool.clone();
        let triaged = tokio::task::spawn_blocking(move || {
            let cands = match find_triage_candidates(&pool) {
                Ok(c) => c,
                Err(e) => {
                    tracing::warn!(error = %e, "manual_review_auto_triage: query failed");
                    return 0usize;
                }
            };
            let mut n = 0usize;
            for c in cands.into_iter().take(REVIEW_TRIAGE_MAX_PER_TICK) {
                let sev = c.severity.to_ascii_lowercase();
                let note = if sev == "high" || sev == "critical" {
                    // High/critical: approve ONLY when the high tier is enabled AND
                    // the item is a safe technical-status item with no business/policy
                    // marker. Everything else (incl. unrecognised high items) stays
                    // pending for a human.
                    if !high_enabled
                        || !high_severity_auto_approvable(
                            &c.title,
                            &c.description,
                            &c.suggested_actions,
                        )
                    {
                        continue;
                    }
                    "[auto-triaged — high-severity technical-status item: matched the \
                     safe-technical allowlist with no business/policy marker; genuine \
                     business/policy decisions are never auto-approved]"
                } else {
                    "[auto-triaged — unattended review policy: routine (low/medium) \
                     severity auto-approved; feeds the accept→decision learning loop]"
                };
                match crate::db::repos::communication::manual_reviews::update_status(
                    &pool,
                    &c.id,
                    crate::db::models::ManualReviewStatus::Approved,
                    Some(note.to_string()),
                ) {
                    Ok(_) => n += 1,
                    Err(e) => {
                        tracing::warn!(review_id = %c.id, error = %e, "manual_review_auto_triage: approve failed")
                    }
                }
            }
            n
        })
        .await
        .unwrap_or(0);

        if triaged > 0 {
            tracing::info!(
                count = triaged,
                "manual_review_auto_triage: auto-approved {triaged} routine review(s)"
            );
        }
    }
}
