//! **The propose-upward lane** — a persona's learnings become org candidates.
//!
//! P6 of `docs/concepts/knowledge-registry-migration.md`, the other half of the
//! consult lane (`engine::knowledge_consult`). Consult carries org knowledge
//! DOWN into a run; this carries what a run discovered back UP.
//!
//! ## Where the material already comes from
//!
//! Nothing new is asked of personas. The Knowledge Annotation Protocol has long
//! told them to emit `{"knowledge_annotation": {...}}` when they learn something
//! "valuable for future executions (by you or other personas)", and those land
//! in `execution_knowledge` with a `scope_type` of `persona`, `tool`,
//! `connector` or `global`. That scope is the persona's own statement about how
//! far its insight travels, so it is the selector: `persona`-scoped rows stay
//! where they are, the other three are candidates for the org.
//!
//! ## Through the existing door, not beside it
//!
//! Promotion routes through `ws_repo::ingest_candidates` — the same governed
//! ingest the practice-harvest uses — with `actor_kind = "persona-execution"`.
//! That buys the whole contract for free: candidates land as **`observed`**,
//! never adopted; the dedup key and the 90-day rejected window stop a
//! re-promotion from re-proposing something a human already declined; the
//! per-run cap holds. A second door with its own rules would have been a second
//! set of rules to keep honest.
//!
//! **Nothing auto-adopts, and this command cannot make it.** `observed` is a
//! queue a person works, exactly like a harvest result.
//!
//! ## What it deliberately does not do
//!
//! - **It does not classify.** Every candidate is `kind: "fact"`. The protocol's
//!   annotation is free text; deciding it is a pitfall rather than a howto is a
//!   judgment, and a keyword guess would be a *confident* wrong label on a row a
//!   human then trusts. The adjudicator re-kinds it. An LLM classification pass
//!   is a legitimate later refinement — a keyword heuristic is not.
//! - **It does not invent a project.** `origin_project_id` stays `None`: a
//!   persona's `project_id` names a personas project, not the dev project that
//!   column refers to, and stamping it would fabricate provenance that reads as
//!   verified. The persona and execution ids go in `detail_md`, where they are
//!   plainly what they are.
//! - **It does not track what it promoted.** Re-running re-submits, and the
//!   door's dedup absorbs it. That costs a noisier summary and saves a schema
//!   column plus a second source of truth about the same fact.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::db::repos::execution::knowledge as ek_repo;
use crate::db::repos::workspaces::ingest::{ingest_candidates, KnowledgeCandidate};
use crate::error::AppError;
use crate::ipc_auth::require_auth;
use crate::AppState;

/// Scopes whose insights are about something other than one persona. `persona`
/// is excluded by construction — the protocol defines it as "insight specific to
/// your current persona", which is the definition of not generalizable.
const PROMOTABLE_SCOPES: [&str; 3] = ["global", "tool", "connector"];

/// Confidence a persona must have expressed for its annotation to be proposed
/// to the whole organization.
///
/// The protocol's default is 0.5 — what an annotation carries when the model
/// said nothing about confidence. The floor sits just above it so promotion
/// means the persona actively claimed more than the default, rather than
/// sweeping up every unqualified aside. Rows below it are counted and reported,
/// never silently dropped.
const MIN_CONFIDENCE: f64 = 0.6;

/// How many annotations to read per scope. Above the door's own 120-per-run cap
/// so the cap, not this, is what bounds a run — and the report says when the
/// read itself was the limit.
const SCAN_LIMIT: i64 = 200;

/// What a promotion run did, or would do.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct PromotionReport {
    /// True when nothing was written.
    pub dry_run: bool,
    /// Annotations read across the promotable scopes.
    pub scanned: u32,
    /// Below [`MIN_CONFIDENCE`].
    pub below_confidence: u32,
    /// No annotation text to promote.
    pub empty: u32,
    /// Candidates offered to the door (or that would have been).
    pub proposed: u32,
    /// Newly landed as `observed`. Zero on a dry run.
    pub inserted: u32,
    /// The door's reasons for not taking a candidate — duplicates included.
    pub skipped: Vec<String>,
    /// Titles offered, so a dry run shows the operator what it would propose.
    pub titles: Vec<String>,
    /// True when a scope returned a full page, so more may exist unread.
    pub truncated: bool,
}

/// First sentence of an annotation, as its title.
///
/// A title is a handle in a review queue, not a summary — so this takes the
/// leading sentence and caps it, rather than trying to compose something. The
/// full text always survives verbatim as the statement, which is what a person
/// actually adjudicates on.
fn title_from(text: &str) -> String {
    const MAX: usize = 90;
    let flat = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let first = flat
        .find(". ")
        .map(|i| &flat[..i])
        .unwrap_or(&flat)
        .trim_end_matches('.')
        .trim();
    if first.chars().count() <= MAX {
        return first.to_string();
    }
    // Cut on a char boundary, then back off to the last word break so the title
    // does not end mid-word.
    //
    // The ellipsis is the only marker of the cut, and that is safe HERE for one
    // specific reason: the caller stores the untruncated text verbatim as the
    // candidate's `statement` on the same row. Nothing downstream has to trust
    // this string to be whole — the whole version is one field away. Census rule
    // `unflagged-string-truncation` flags this shape because usually that is not
    // true and the removed bytes are simply gone.
    let cut: String = first.chars().take(MAX).collect();
    match cut.rfind(' ') {
        Some(i) if i > MAX / 2 => format!("{}…", &cut[..i]),
        _ => format!("{cut}…"),
    }
}

/// Promote generalizable persona annotations into a workspace's knowledge queue.
///
/// `dry_run` reads and maps everything, reports exactly what it would offer, and
/// writes nothing — the default way to look before promoting a batch that a
/// person then has to triage.
#[tauri::command]
pub async fn dev_tools_promote_persona_knowledge(
    state: State<'_, Arc<AppState>>,
    workspace_id: String,
    dry_run: Option<bool>,
) -> Result<PromotionReport, AppError> {
    require_auth(&state).await?;
    promote_core(&state, &workspace_id, dry_run.unwrap_or(false))
}

pub(crate) fn promote_core(
    state: &AppState,
    workspace_id: &str,
    dry_run: bool,
) -> Result<PromotionReport, AppError> {
    let mut report = PromotionReport {
        dry_run,
        scanned: 0,
        below_confidence: 0,
        empty: 0,
        proposed: 0,
        inserted: 0,
        skipped: Vec::new(),
        titles: Vec::new(),
        truncated: false,
    };

    let mut candidates: Vec<KnowledgeCandidate> = Vec::new();
    for scope in PROMOTABLE_SCOPES {
        let rows = ek_repo::list_by_scope(&state.db, scope, None, Some(SCAN_LIMIT))?;
        if rows.len() as i64 == SCAN_LIMIT {
            report.truncated = true;
        }
        report.scanned += rows.len() as u32;

        for row in rows {
            let Some(text) = row
                .annotation_text
                .as_deref()
                .map(str::trim)
                .filter(|t| !t.is_empty())
            else {
                report.empty += 1;
                continue;
            };
            if row.confidence < MIN_CONFIDENCE {
                report.below_confidence += 1;
                continue;
            }

            let title = title_from(text);
            report.titles.push(title.clone());
            candidates.push(KnowledgeCandidate {
                harvest_scope: Some(format!("persona-execution:{scope}")),
                // Unclassified by design — see the module doc.
                kind: "fact".into(),
                title,
                statement: text.to_string(),
                detail_md: Some(format!(
                    "Promoted from a persona execution's knowledge annotation.\n\n\
                     - scope: `{scope}{}`\n\
                     - persona: `{}`\n\
                     - execution: `{}`\n\
                     - annotation confidence: {:.2}\n\
                     - user-verified on the persona: {}\n",
                    row.scope_id
                        .as_deref()
                        .map(|s| format!(":{s}"))
                        .unwrap_or_default(),
                    row.persona_id,
                    row.last_execution_id.as_deref().unwrap_or("unknown"),
                    row.confidence,
                    if row.is_verified { "yes" } else { "no" },
                )),
                topic: None,
                abstraction: None,
                ftype: None,
                durability: None,
                governing_id: None,
                evidence_count: None,
                applicability: None,
                // Deliberately absent — see the module doc.
                origin_project_id: None,
                // `pattern_key` is already `scope_type:scope_id:hash(text)`, a
                // stable identity for this insight. Reusing it means a
                // re-promotion collides with itself instead of duplicating, and
                // that an insight a human REJECTED stays rejected.
                dedup_key: Some(format!("persona-execution:{}", row.pattern_key)),
                confidence: Some(row.confidence),
                extends: None,
                layer: None,
                // No evidence rows: the annotation IS the observation, and there
                // is no cited file or line behind it to record.
                evidence: Vec::new(),
            });
        }
    }

    report.proposed = candidates.len() as u32;
    if dry_run || candidates.is_empty() {
        return Ok(report);
    }

    let summary = ingest_candidates(
        &state.db,
        workspace_id,
        &candidates,
        "persona-execution",
        None,
    )?;
    report.inserted = summary.inserted as u32;
    report.skipped = summary.skipped;
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_title_is_the_first_sentence_not_the_whole_note() {
        assert_eq!(
            title_from("Rate limits reset hourly. The header is X-RateLimit-Reset."),
            "Rate limits reset hourly"
        );
    }

    #[test]
    fn a_long_title_breaks_on_a_word_not_mid_word() {
        let t = title_from(&"supercalifragilistic ".repeat(12));
        assert!(t.ends_with('…'));
        assert!(!t.contains("supercalifragilisti…"), "cut mid-word: {t}");
        assert!(t.chars().count() <= 91, "{}", t.chars().count());
    }

    #[test]
    fn a_multibyte_title_does_not_panic_on_the_cut() {
        // Naive byte slicing at a fixed offset panics on a char boundary; the
        // annotation text is free-form model output and will contain these.
        let t = title_from(&"日本語のテキストです ".repeat(20));
        assert!(t.chars().count() <= 91);
        let t2 = title_from(&"— em dashes and “quotes” everywhere ".repeat(10));
        assert!(t2.chars().count() <= 91);
    }

    #[test]
    fn whitespace_is_flattened_so_a_title_stays_one_line() {
        assert_eq!(
            title_from("  Tokens\n\texpire\n  after 30m. More.  "),
            "Tokens expire after 30m"
        );
    }

    #[test]
    fn persona_scope_is_not_promotable() {
        // The protocol defines `persona` as "insight specific to your current
        // persona" — promoting it to the org would be promoting the one scope
        // that says it does not generalize.
        assert!(!PROMOTABLE_SCOPES.contains(&"persona"));
        assert_eq!(PROMOTABLE_SCOPES.len(), 3);
    }

    #[test]
    fn the_floor_sits_above_the_protocols_default_confidence() {
        // 0.5 is what an annotation carries when the model said nothing about
        // confidence. Promotion should mean the persona claimed more than that.
        assert!(
            MIN_CONFIDENCE > 0.5,
            "floor must exceed the unstated default"
        );
    }
}
