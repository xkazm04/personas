use crate::DbPool;
use personas_core::error::AppError;
use rusqlite::params;

use super::knowledge::{normalize_abstraction, KNOWLEDGE_KINDS};
use super::org::get_workspace_by_id;

/// A machine-harvested knowledge candidate (from the `practice-harvest` skill
/// or a deterministic miner). Distinct from the human `create_knowledge` path:
/// candidates land `observed` with machine provenance and are dedup-gated
/// against the workspace's existing keys (incl. the 90-day rejected window).
#[derive(Debug, Clone)]
pub struct KnowledgeCandidate {
    /// Territory that produced this candidate. App-owned (stamped at ingest
    /// from the run's `scope`), never trusted from the item itself.
    pub harvest_scope: Option<String>,
    pub kind: String,
    pub title: String,
    pub statement: String,
    pub detail_md: Option<String>,
    pub topic: Option<String>,
    /// Categorization axes (macro|meso|micro · finding-type · durable|situational|mechanical).
    pub abstraction: Option<String>,
    pub ftype: Option<String>,
    pub durability: Option<String>,
    /// Roll-up to a governing macro doctrine.
    pub governing_id: Option<String>,
    pub evidence_count: Option<i64>,
    /// JSON applicability envelope; validated parseable if present.
    pub applicability: Option<String>,
    pub origin_project_id: Option<String>,
    /// Miner idempotency key; the dedup gate keys off this.
    pub dedup_key: Option<String>,
    pub confidence: Option<f64>,
    /// Pattern id this candidate REFINES (fabric F4 contribution loop). On
    /// ingest an `extends` edge is created child->parent; on adoption the
    /// child inherits the parent's topic when it has none of its own. The
    /// item itself still lands `observed` — sessions propose, humans adopt.
    pub extends: Option<String>,
    /// Three-layer model (pattern-fabric v2): 'principle' | 'manifestation'.
    /// Validated at the door; anything else lands NULL (unclassified) rather
    /// than inventing a layer.
    pub layer: Option<String>,
    /// Structured proof rows (pattern-fabric v2) — written to
    /// `workspace_knowledge_evidence` with `source='harvest'` and the run's
    /// own project id. Supersedes fusing citations into `detail_md`.
    pub evidence: Vec<EvidenceCandidate>,
}

/// One structured proof reference carried by a harvest/propose candidate.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct EvidenceCandidate {
    /// `path:line` (or bare path) strings.
    #[serde(default)]
    pub refs: Vec<String>,
    #[serde(default)]
    pub quote: Option<String>,
}

/// Result of an ingest run — inserted count + a per-row reason for every
/// candidate that was refused (a lossy ingest is never silent).
#[derive(Debug, Default, serde::Serialize, ts_rs::TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct IngestSummary {
    pub inserted: u32,
    pub skipped: Vec<String>,
}

/// Hard cap on candidates accepted in one ingest call — a runaway harvest
/// (or a miner bug) must not flood the review queue.
pub const MAX_INGEST_PER_RUN: usize = 120;

/// Rejected practices are retained so miners don't re-propose them; the block
/// expires after this many days ("rejection is knowledge", but not forever).
pub const REJECTED_DEDUP_WINDOW_DAYS: i64 = 90;

// ============================================================================
// Row mappers
// ============================================================================

/// Dedup verdict for one candidate against the workspace's existing rows.
enum DedupVerdict {
    /// No blocking row — insert.
    Fresh,
    /// A live (non-rejected) row already carries this key.
    Present,
    /// A rejected row carries this key within the retention window.
    RecentlyRejected,
}

/// Decide whether a `dedup_key` is clear to insert. A key with no rows is
/// Fresh; a key on any live row is Present; a key only on rejected rows is
/// RecentlyRejected while the newest rejection is within the window, else
/// Fresh again (the block has expired).
fn dedup_verdict(
    conn: &rusqlite::Connection,
    workspace_id: &str,
    dedup_key: &str,
) -> Result<DedupVerdict, AppError> {
    // Any live row with this key blocks immediately.
    let live: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspace_knowledge
         WHERE workspace_id = ?1 AND dedup_key = ?2 AND status != 'rejected'",
        params![workspace_id, dedup_key],
        |r| r.get(0),
    )?;
    if live > 0 {
        return Ok(DedupVerdict::Present);
    }
    // Otherwise, is there a rejection inside the retention window?
    let cutoff = format!("-{REJECTED_DEDUP_WINDOW_DAYS} days");
    let recent_reject: i64 = conn.query_row(
        "SELECT COUNT(*) FROM workspace_knowledge
         WHERE workspace_id = ?1 AND dedup_key = ?2 AND status = 'rejected'
           AND COALESCE(decided_at, updated_at) >= datetime('now', ?3)",
        params![workspace_id, dedup_key, cutoff],
        |r| r.get(0),
    )?;
    if recent_reject > 0 {
        Ok(DedupVerdict::RecentlyRejected)
    } else {
        Ok(DedupVerdict::Fresh)
    }
}

/// Ingest machine-harvested candidates into a workspace's library. Each lands
/// `observed` with the given machine provenance (`actor_kind` ∈ 'agent' |
/// 'miner'), dedup-gated on `dedup_key` (existing-live → skip; rejected within
/// the 90-day window → skip; otherwise insert). Candidates without a
/// `dedup_key` are always inserted (the caller owns novelty). Bounded by
/// `MAX_INGEST_PER_RUN`; every refusal is reported in `skipped`.
pub fn ingest_candidates(
    pool: &DbPool,
    workspace_id: &str,
    candidates: &[KnowledgeCandidate],
    actor_kind: &str,
    model_ref: Option<&str>,
) -> Result<IngestSummary, AppError> {
    get_workspace_by_id(pool, workspace_id)?;
    let mut summary = IngestSummary::default();

    timed_query!(
        "workspace_knowledge",
        "dev_workspaces::ingest_candidates",
        {
            let mut conn = pool.get()?;
            let tx = conn.transaction()?;
            let now = chrono::Utc::now().to_rfc3339();
            let provenance = match model_ref {
                Some(m) => format!("{{\"actor_kind\":\"{actor_kind}\",\"model_ref\":\"{m}\"}}"),
                None => format!("{{\"actor_kind\":\"{actor_kind}\"}}"),
            };
            // Keys accepted earlier in THIS batch — so two candidates carrying the
            // same key in one run don't both insert.
            let mut seen_in_batch: std::collections::HashSet<String> =
                std::collections::HashSet::new();

            for (i, c) in candidates.iter().enumerate() {
                if summary.inserted as usize >= MAX_INGEST_PER_RUN {
                    summary
                        .skipped
                        .push(format!("#{i}: run cap reached ({MAX_INGEST_PER_RUN})"));
                    continue;
                }
                if !KNOWLEDGE_KINDS.contains(&c.kind.as_str()) {
                    summary
                        .skipped
                        .push(format!("#{i} '{}': invalid kind '{}'", c.title, c.kind));
                    continue;
                }
                if c.title.trim().is_empty() || c.statement.trim().is_empty() {
                    summary
                        .skipped
                        .push(format!("#{i}: empty title or statement"));
                    continue;
                }
                if let Some(json) = c.applicability.as_deref() {
                    if serde_json::from_str::<serde_json::Value>(json).is_err() {
                        summary.skipped.push(format!(
                            "#{i} '{}': applicability is not valid JSON",
                            c.title
                        ));
                        continue;
                    }
                }
                if let Some(key) = c.dedup_key.as_deref() {
                    if seen_in_batch.contains(key) {
                        summary
                            .skipped
                            .push(format!("#{i} '{}': duplicate key within this run", c.title));
                        continue;
                    }
                    match dedup_verdict(&tx, workspace_id, key)? {
                        DedupVerdict::Present => {
                            summary
                                .skipped
                                .push(format!("#{i} '{}': already in the library", c.title));
                            continue;
                        }
                        DedupVerdict::RecentlyRejected => {
                            summary.skipped.push(format!(
                                "#{i} '{}': rejected within {REJECTED_DEDUP_WINDOW_DAYS}d",
                                c.title
                            ));
                            continue;
                        }
                        DedupVerdict::Fresh => {}
                    }
                    seen_in_batch.insert(key.to_string());
                }

                let id = uuid::Uuid::new_v4().to_string();
                tx.execute(
                "INSERT INTO workspace_knowledge
                     (id, workspace_id, kind, title, statement, detail_md, topic,
                      abstraction, ftype, durability, governing_id, evidence_count,
                      applicability, status, origin_project_id, provenance, confidence, dedup_key,
                      harvest_scope, layer, valid_from, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 'observed', ?14, ?15, ?16, ?17, ?19, ?20, ?18, ?18, ?18)",
                params![
                    id,
                    workspace_id,
                    c.kind,
                    c.title.trim(),
                    c.statement.trim(),
                    c.detail_md,
                    // Every machine writer passes through here, so this is the
                    // one place that can hold the taxonomy. An unknown cluster
                    // under a known area survives (that is how the vocabulary
                    // grows); an unknown *area* is quarantined on a visible
                    // shelf rather than silently inventing a new top level.
                    crate::repos::workspace_taxonomy::normalize_topic(c.topic.as_deref()),
                    // Closed at the door for the same reason topic/ftype are —
                    // see `normalize_abstraction` and `KNOWLEDGE_ABSTRACTIONS`
                    // above. A caller filtering "macro"/"meso" upstream (e.g.
                    // workspace_divergence.rs) is redundant-but-harmless now;
                    // one that doesn't filter at all (workspace_harvest.rs) no
                    // longer has a silent route around the vocabulary.
                    normalize_abstraction(c.abstraction.as_deref()),
                    // Same treatment for the SHAPE axis. Left free-form, it
                    // fragmented harder than topic ever did (90 values / 330
                    // items in the 2026-07-27 scan) — see workspace_taxonomy.
                    crate::repos::workspace_taxonomy::normalize_ftype(c.ftype.as_deref()),
                    // `durability` is deliberately NOT taken from the writer.
                    // The same scan returned `durable` for 330 of 330 items:
                    // the prompt tells authors mechanical items don't belong
                    // here, so nothing is ever labelled anything else and the
                    // axis carries zero information. It is a REVIEWER's call
                    // now (or nothing at all), never an author's.
                    None::<String>,
                    c.governing_id,
                    c.evidence_count,
                    c.applicability,
                    c.origin_project_id,
                    provenance,
                    c.confidence,
                    c.dedup_key,
                    now,
                    c.harvest_scope,
                    // Closed at the door like every other axis: an unknown
                    // layer value lands NULL (unclassified), never invented.
                    c.layer
                        .as_deref()
                        .filter(|l| ["principle", "manifestation"].contains(l)),
                ],
            )?;
                summary.inserted += 1;

                // Pattern-fabric v2: structured proof rows. Stamped with the
                // run's own project (app-owned, same trust posture as
                // origin_project_id) and source='harvest'.
                for ev in &c.evidence {
                    if ev.refs.is_empty() && ev.quote.is_none() {
                        continue;
                    }
                    tx.execute(
                        "INSERT INTO workspace_knowledge_evidence
                         (id, knowledge_id, project_id, refs, quote, source, recorded_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, 'harvest', ?6)",
                        params![
                            uuid::Uuid::new_v4().to_string(),
                            id,
                            c.origin_project_id,
                            serde_json::to_string(&ev.refs).unwrap_or_else(|_| "[]".into()),
                            ev.quote,
                            now,
                        ],
                    )?;
                }

                // F4 contribution loop: an `extends` reference becomes a typed
                // edge child->parent. A dangling target never blocks the item —
                // the practice is real even when its lineage claim is stale — but
                // the skipped edge is REPORTED, never silently dropped.
                if let Some(parent) = c.extends.as_deref() {
                    let parent_ok: bool = tx
                        .query_row(
                            "SELECT 1 FROM workspace_knowledge WHERE id = ?1 AND workspace_id = ?2",
                            params![parent, workspace_id],
                            |_| Ok(true),
                        )
                        .unwrap_or(false);
                    if parent_ok && parent != id {
                        tx.execute(
                            "INSERT OR IGNORE INTO workspace_pattern_edges
                             (from_id, to_id, rel, note, created_at)
                         VALUES (?1, ?2, 'extends', 'proposed via harvest', ?3)",
                            params![id, parent, now],
                        )?;
                    } else {
                        summary.skipped.push(format!(
                        "#{i} '{}': extends target {parent} not found — item kept, edge skipped",
                        c.title
                    ));
                    }
                }
            }

            tx.commit()?;
            Ok(summary)
        }
    )
}

// ── pattern-fabric v2: evidence + structure ─────────────────────────────
