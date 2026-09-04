//! Charter growth loop + emergent-manifest OP grammar (spark
//! `agent-manifest-rebase`, WP3 Stage B).
//!
//! Two propose-only doors grow out of here:
//!
//! * **Self-model diffs from operator chat** — a persona's chat reply may
//!   carry one `{"op":"propose_manifest_diff",...}` line (Athena's OP-line
//!   pattern, `companion::dispatcher` precedent). The line is stripped from
//!   the visible reply and filed through the ONE manifest propose door
//!   ([`super::manifest::propose_diffs`], kind `self_model_diff`) — never
//!   auto-applied, self-model sections only, provenance mandatory (the
//!   minted channel episode).
//! * **Charter drafts from the attention improve lane** — an improve pass's
//!   output may carry one `{"op":"propose_responsibility_draft",...}` line.
//!   It is validated through `personas_engine::responsibility::validate`
//!   BEFORE filing, deduped to one per persona per day (the attention
//!   refusal-dedupe posture), and filed as a `persona_memory_review_proposal`
//!   of kind [`KIND_RESPONSIBILITY_DRAFT`]. A human approval mints the
//!   charter via [`apply_responsibility_draft`] with `source` and `status`
//!   FORCED server-side (`agent-proposed` / `draft`) — whatever the payload
//!   claims is ignored, and the owner persona comes from the proposal ROW
//!   (ownership-verification golden path, the `self_model_diff` shape).

use crate::companion::brain::identity::{IdentityDiff, MAX_DIFFS_PER_OP};
use crate::db::models::{
    CreatePersonaResponsibilityInput, PersonaResponsibility, ResponsibilityStatus,
};
use crate::db::repos::core::memory_review_proposal as proposal_repo;
use crate::db::repos::core::responsibilities as responsibilities_repo;
use crate::db::DbPool;
use crate::error::AppError;

use super::manifest;

/// Proposal-family discriminator for agent-proposed charters (DB
/// CHECK-enforced since e19).
pub const KIND_RESPONSIBILITY_DRAFT: &str = "responsibility_draft";
/// `persona_responsibilities.source` for charters minted from an approved
/// draft (DB CHECK-enforced since e19).
pub const SOURCE_AGENT_PROPOSED: &str = "agent-proposed";

/// The chat-reply OP that proposes self-model manifest diffs.
pub const OP_PROPOSE_MANIFEST_DIFF: &str = "propose_manifest_diff";
/// The improve-lane OP that proposes a draft charter.
pub const OP_PROPOSE_RESPONSIBILITY_DRAFT: &str = "propose_responsibility_draft";

// The system-prompt addendum that teaches a persona this OP grammar is NOT
// declared here.
// The text lives in `personas-engine::prompt::SELF_MODEL_OP_ADDENDUM` —
// prompt assembly is in the engine crate, which cannot reach up into
// `app_lib` to read a constant here. `assemble` renders it for every persona
// that has a manifest. This module's round-trip test imports it from there
// and asserts its example line still parses through the parser below, so the
// published grammar and its parser cannot drift apart.

// ── OP-line extraction (the dispatcher's line grammar, narrowed) ───────────

/// The op payload on one line: `OP: {…}` at line start, or a bare `{…}`
/// line — the two forms `companion::dispatcher::dispatch` accepts (its
/// mid-line rescue is deliberately not carried over: the grammar addenda
/// instruct "JSON on its own line").
///
/// **Deliberately looser than the dispatcher's `starts_with("{\"op\"")`.**
/// That prefix test assumes `op` is serialized FIRST, which nothing
/// guarantees: `serde_json`'s own `Display` sorts keys, and an LLM orders
/// them however it likes. A line whose object carries `op` anywhere is the
/// honest condition; [`extract_op_lines`] still strips only lines that parse
/// AND match the requested op name, so widening the candidate set cannot
/// swallow prose.
fn op_payload(trimmed: &str) -> Option<&str> {
    let candidate = match trimmed.strip_prefix("OP:") {
        Some(rest) => rest.trim(),
        None => trimmed,
    };
    candidate.starts_with('{').then_some(candidate)
}

/// Scan `text` line by line for `{"op": <op_name>, …}` lines. Matched lines
/// are REMOVED from the returned text and their parsed envelopes returned.
/// An op-shaped line that fails to parse, or parses to a different op, is
/// left in the text untouched — stripping only what was actually understood
/// keeps a malformed proposal visible instead of silently vanishing.
pub(crate) fn extract_op_lines(text: &str, op_name: &str) -> (String, Vec<serde_json::Value>) {
    let mut kept: Vec<&str> = Vec::new();
    let mut ops: Vec<serde_json::Value> = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if let Some(payload) = op_payload(trimmed) {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) {
                if v.get("op").and_then(|o| o.as_str()) == Some(op_name) {
                    ops.push(v);
                    continue;
                }
            }
        }
        kept.push(line);
    }
    (kept.join("\n"), ops)
}

// ── Channel door: self-model diffs out of a chat reply ─────────────────────

/// Strip every `propose_manifest_diff` OP line from a chat reply. Returns
/// `(visible_reply, envelopes)`.
pub(crate) fn extract_manifest_diff_ops(text: &str) -> (String, Vec<serde_json::Value>) {
    extract_op_lines(text, OP_PROPOSE_MANIFEST_DIFF)
}

/// File the diffs carried by a reply's OP envelopes as ONE `self_model_diff`
/// proposal (the manifest propose door refuses law sections again — belt and
/// suspenders). Diffs are admitted only when they parse as the companion
/// grammar AND target a SELF section; an envelope without a motivation is
/// dropped whole (provenance mandatory). The batch is capped at
/// [`MAX_DIFFS_PER_OP`]. Returns the proposal id, or `None` when nothing
/// admissible survived.
pub(crate) fn file_channel_manifest_diffs(
    pool: &DbPool,
    persona_id: &str,
    ops: &[serde_json::Value],
    episode_id: &str,
    message_id: &str,
) -> Result<Option<String>, AppError> {
    let mut diffs: Vec<IdentityDiff> = Vec::new();
    let mut motivations: Vec<String> = Vec::new();
    let mut dropped = 0usize;
    for op in ops {
        let motivation = op
            .get("motivation")
            .and_then(|m| m.as_str())
            .map(str::trim)
            .filter(|m| !m.is_empty());
        let Some(motivation) = motivation else {
            dropped += 1;
            tracing::warn!(
                persona_id,
                "channel manifest op dropped: no motivation (provenance mandatory)"
            );
            continue;
        };
        let Some(list) = op.get("diffs").and_then(|d| d.as_array()) else {
            dropped += 1;
            tracing::warn!(persona_id, "channel manifest op dropped: no `diffs` array");
            continue;
        };
        let mut admitted_any = false;
        for raw in list {
            if diffs.len() >= MAX_DIFFS_PER_OP {
                dropped += 1;
                continue;
            }
            match IdentityDiff::from_json(raw) {
                Ok(d) if manifest::is_self_section(&d.section) => {
                    diffs.push(d);
                    admitted_any = true;
                }
                Ok(d) => {
                    dropped += 1;
                    tracing::warn!(
                        persona_id,
                        section = %d.section,
                        "channel manifest diff dropped: not a self-model section"
                    );
                }
                Err(e) => {
                    dropped += 1;
                    tracing::warn!(persona_id, error = %e, "channel manifest diff dropped: malformed");
                }
            }
        }
        if admitted_any {
            motivations.push(motivation.to_string());
        }
    }
    if diffs.is_empty() {
        if dropped > 0 {
            tracing::warn!(
                persona_id,
                dropped,
                "channel manifest ops: nothing admissible survived"
            );
        }
        return Ok(None);
    }
    let rationale = format!(
        "{} (operator-chat exchange {message_id}, episode {episode_id})",
        motivations.join("; ")
    );
    manifest::propose_diffs(pool, persona_id, diffs, &rationale).map(Some)
}

// ── Improve-lane door: draft charters ──────────────────────────────────────

/// The first `propose_responsibility_draft` envelope in an execution's
/// output; extras are ignored with a warn (the grammar says ONE).
pub(crate) fn extract_responsibility_draft_op(output: &str) -> Option<serde_json::Value> {
    let (_, mut ops) = extract_op_lines(output, OP_PROPOSE_RESPONSIBILITY_DRAFT);
    if ops.len() > 1 {
        tracing::warn!(
            extras = ops.len() - 1,
            "improve output carried more than one responsibility-draft op; keeping the first"
        );
    }
    if ops.is_empty() {
        None
    } else {
        Some(ops.swap_remove(0))
    }
}

/// What [`file_responsibility_draft`] decided. `Invalid` is a decision, not
/// an error — the caller ledgers it and moves on.
#[derive(Debug)]
pub(crate) enum DraftFiling {
    Filed {
        proposal_id: String,
    },
    /// A `responsibility_draft` proposal for this persona already exists
    /// today — one per persona per day, the refusal-dedupe posture.
    DedupedToday,
    Invalid {
        reason: String,
    },
}

/// Validate and file one draft-charter op as a `responsibility_draft`
/// proposal. Propose-only: nothing is minted here. The owner persona is the
/// DISPATCHING persona, never whatever the payload claims, and the payload's
/// `status` is overwritten with `draft` before validation so the stored
/// input already carries what apply will force anyway.
pub(crate) fn file_responsibility_draft(
    pool: &DbPool,
    persona_id: &str,
    op: &serde_json::Value,
) -> Result<DraftFiling, AppError> {
    let Some(raw_input) = op.get("input") else {
        return Ok(DraftFiling::Invalid {
            reason: "op carries no `input`".into(),
        });
    };
    // The owner comes from the loop that dispatched the run and the status is
    // `draft`, whatever the payload claims (or omits) — forced BEFORE the
    // typed parse, so an op without a `personaId` is still well-formed and a
    // foreign claim is silently corrected, not honored.
    let input = match forced_draft_input(raw_input, persona_id) {
        Ok(i) => i,
        Err(reason) => return Ok(DraftFiling::Invalid { reason }),
    };

    let resp = draft_resp_from_input(&input);
    if let Err(e) = personas_engine::responsibility::validate(&resp) {
        return Ok(DraftFiling::Invalid {
            reason: e.to_string(),
        });
    }
    if has_draft_proposal_today(pool, persona_id)? {
        return Ok(DraftFiling::DedupedToday);
    }

    let motivation = op
        .get("motivation")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .trim();
    let payload = serde_json::json!({
        "input": input,
        "motivation": motivation,
    });
    // The Life inbox renders `summary` verbatim for non-curation kinds, so
    // it carries the title AND (bounded) motivation until WP5 grows a
    // dedicated card.
    let mut summary = format!("Draft charter: {}", resp.title.trim());
    if !motivation.is_empty() {
        let bounded: String = motivation.chars().take(240).collect();
        summary.push_str(&format!(" — {bounded}"));
    }
    let proposal_id = proposal_repo::create_raw(
        pool,
        proposal_repo::CreateRawProposalInput {
            persona_id,
            kind: KIND_RESPONSIBILITY_DRAFT,
            proposal_json: &payload.to_string(),
            summary: Some(&summary),
            proposed_changes: 1,
        },
    )?;
    Ok(DraftFiling::Filed { proposal_id })
}

/// Parse an op/payload `input` blob into the wire type with the
/// agent-proposed identity FORCED: `personaId` = the server-derived owner and
/// `status` = `draft` are written into the JSON before the typed parse, so
/// the payload can neither omit nor override either. `Err` carries the
/// human-readable refusal.
fn forced_draft_input(
    raw_input: &serde_json::Value,
    persona_id: &str,
) -> Result<CreatePersonaResponsibilityInput, String> {
    let mut raw = raw_input.clone();
    let Some(obj) = raw.as_object_mut() else {
        return Err("input is not a JSON object".into());
    };
    obj.insert(
        "personaId".into(),
        serde_json::Value::String(persona_id.to_string()),
    );
    obj.insert(
        "status".into(),
        serde_json::Value::String(ResponsibilityStatus::Draft.as_str().to_string()),
    );
    serde_json::from_value(raw)
        .map_err(|e| format!("input is not a CreatePersonaResponsibilityInput: {e}"))
}

/// One draft proposal per persona per day, any status — a draft the human
/// discarded this morning must not be re-filed this afternoon (mirror of the
/// attention loop's one-refusal-row-per-reason-day dedupe).
fn has_draft_proposal_today(pool: &DbPool, persona_id: &str) -> Result<bool, AppError> {
    let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
    let rows = proposal_repo::list(pool, Some(persona_id), false, 50)?;
    Ok(rows
        .iter()
        .any(|p| p.kind == KIND_RESPONSIBILITY_DRAFT && p.created_at.starts_with(&today)))
}

// ── Apply door (human-gated) ───────────────────────────────────────────────

/// Mint the charter a human approved: derive the owner persona from the
/// proposal ROW, force `source = 'agent-proposed'` and `status = 'draft'`
/// regardless of the payload, validate the merged charter, CAS the proposal
/// to `applied` BEFORE the insert (a concurrent double-apply loses and
/// errors with nothing minted twice), then insert. An invalid payload leaves
/// the proposal `pending_review` — the human can discard, nothing burned.
pub fn apply_responsibility_draft(
    pool: &DbPool,
    proposal_id: &str,
) -> Result<PersonaResponsibility, AppError> {
    let proposal = proposal_repo::get_raw(pool, proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("proposal `{proposal_id}`")))?;
    if proposal.kind != KIND_RESPONSIBILITY_DRAFT {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` is kind `{}`, not `{KIND_RESPONSIBILITY_DRAFT}`",
            proposal.kind
        )));
    }
    let persona_id = proposal.persona_id.clone().ok_or_else(|| {
        AppError::Validation(format!(
            "responsibility_draft proposal `{proposal_id}` carries no persona_id"
        ))
    })?;
    if proposal.status != "pending_review" {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` already `{}`",
            proposal.status
        )));
    }

    let payload: serde_json::Value =
        serde_json::from_str(&proposal.proposal_json).map_err(|e| {
            AppError::Internal(format!("responsibility_draft payload unparseable: {e}"))
        })?;
    let raw_input = payload
        .get("input")
        .ok_or_else(|| AppError::Internal("responsibility_draft payload has no `input`".into()))?;
    // SECURITY: owner from the ROW the server fetched; status and source
    // forced. The payload's persona/status/source claims are ignored, same
    // shape as the self_model_diff apply door.
    let input = forced_draft_input(raw_input, &persona_id)
        .map_err(|reason| AppError::Validation(format!("responsibility_draft input: {reason}")))?;
    let resp = draft_resp_from_input(&input);
    personas_engine::responsibility::validate(&resp)?;

    // CAS BEFORE the insert (manifest::apply_approved precedent): only the
    // winner mints; the loser errors here with nothing written.
    if !proposal_repo::mark_applied(pool, proposal_id)? {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` was decided by a concurrent action"
        )));
    }

    responsibilities_repo::create(
        pool,
        responsibilities_repo::CreateResponsibilityInput {
            persona_id: &resp.persona_id,
            title: &resp.title,
            domain: &resp.domain,
            outcomes: &resp.outcomes,
            objectives: &resp.objectives,
            scope_rung: resp.scope_rung,
            refusal_classes: &resp.refusal_classes,
            approval_gates: &resp.approval_gates,
            owner: &resp.owner,
            cadence: &resp.cadence,
            budget_monthly_usd: resp.budget_monthly_usd,
            tenure: &resp.tenure,
            status: ResponsibilityStatus::Draft.as_str(),
            project_id: resp.project_id.as_deref(),
            source: SOURCE_AGENT_PROPOSED,
            connectors: &resp.connectors,
            procedure: &resp.procedure,
            spec: &resp.spec,
        },
    )
}

/// The wire input as a full charter row with the agent-proposed identity
/// forced — the same field mapping `responsibility::create_from_input` does
/// for the operator door, minus its `source = 'operator'` stamp (which is
/// exactly why this cannot delegate to it).
fn draft_resp_from_input(input: &CreatePersonaResponsibilityInput) -> PersonaResponsibility {
    PersonaResponsibility {
        id: String::new(),
        persona_id: input.persona_id.clone(),
        title: input.title.clone(),
        domain: input
            .domain
            .clone()
            .filter(|d| !d.trim().is_empty())
            .unwrap_or_else(|| personas_engine::responsibility::DOMAIN_GENERAL.to_string()),
        outcomes: input.outcomes.clone(),
        objectives: input.objectives.clone(),
        scope_rung: input.scope_rung,
        refusal_classes: input.refusal_classes.clone(),
        approval_gates: input.approval_gates.clone(),
        owner: input.owner.clone(),
        cadence: input.cadence.clone(),
        budget_monthly_usd: input.budget_monthly_usd,
        tenure: input.tenure.clone(),
        status: ResponsibilityStatus::Draft.as_str().to_string(),
        project_id: input.project_id.clone(),
        source: SOURCE_AGENT_PROPOSED.to_string(),
        connectors: input.connectors.clone(),
        procedure: input.procedure.clone(),
        spec: input.spec.clone(),
        created_at: String::new(),
        updated_at: String::new(),
    }
}

// ── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;
    use personas_engine::prompt::SELF_MODEL_OP_ADDENDUM;

    fn seed_persona(pool: &DbPool, id: &str) {
        pool.get()
            .unwrap()
            .execute(
                "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
                 VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
                rusqlite::params![id],
            )
            .unwrap();
    }

    fn draft_op(title: &str) -> serde_json::Value {
        serde_json::json!({
            "op": OP_PROPOSE_RESPONSIBILITY_DRAFT,
            "input": {
                "personaId": "someone-else",
                "title": title,
                "procedure": "Read the channel, post a digest.",
                "connectors": ["slack"],
                "status": "active",
            },
            "motivation": "three runs in a row did this by hand",
        })
    }

    // -- OP-line extraction --------------------------------------------------

    #[test]
    fn extract_accepts_bare_and_prefixed_lines_and_strips_only_matches() {
        let text = "Here is what I think.\n\
             {\"op\":\"propose_manifest_diff\",\"diffs\":[],\"motivation\":\"m\"}\n\
             OP: {\"op\":\"propose_manifest_diff\",\"diffs\":[],\"motivation\":\"n\"}\n\
             {\"op\":\"propose_action\",\"action\":\"other\"}\n\
             Bye.";
        let (cleaned, ops) = extract_manifest_diff_ops(text);
        assert_eq!(ops.len(), 2, "bare and OP:-prefixed both parse");
        assert_eq!(ops[0]["motivation"], "m");
        assert_eq!(ops[1]["motivation"], "n");
        assert!(cleaned.contains("Here is what I think."));
        assert!(cleaned.contains("Bye."));
        assert!(
            cleaned.contains("propose_action"),
            "a DIFFERENT op is not ours to strip"
        );
        assert!(!cleaned.contains("propose_manifest_diff"));
    }

    #[test]
    fn extract_leaves_malformed_op_shaped_lines_visible() {
        let text = "{\"op\":\"propose_manifest_diff\",\"diffs\":[  \nplain line";
        let (cleaned, ops) = extract_manifest_diff_ops(text);
        assert!(ops.is_empty(), "unparseable line is not an op");
        assert_eq!(
            cleaned, text,
            "a malformed proposal stays visible instead of vanishing"
        );
    }

    /// Regression: the dispatcher's `starts_with("{\"op\"")` assumes `op` is
    /// serialized first. Nothing guarantees that — `serde_json`'s own
    /// `Display` sorts keys, so the repo's canonical way of BUILDING one of
    /// these lines produces `{"diffs":…,"motivation":…,"op":…}`, which the
    /// prefix test silently ignores. An LLM reorders keys just as freely.
    #[test]
    fn extract_is_key_order_independent() {
        let line = serde_json::json!({
            "op": OP_PROPOSE_MANIFEST_DIFF,
            "diffs": [],
            "motivation": "m",
        })
        .to_string();
        assert!(
            !line.starts_with("{\"op\""),
            "precondition: serde_json sorted the keys away from `op` first ({line})"
        );
        let (cleaned, ops) = extract_manifest_diff_ops(&line);
        assert_eq!(ops.len(), 1, "matched regardless of key order");
        assert!(cleaned.trim().is_empty());

        // A non-op JSON line (a dispatch-protocol block) is never touched.
        let protocol = r#"{"user_message": {"content": "hi"}}"#;
        let (cleaned, ops) = extract_manifest_diff_ops(protocol);
        assert!(ops.is_empty());
        assert_eq!(cleaned, protocol);
    }

    #[test]
    fn extract_responsibility_draft_op_takes_the_first() {
        let out = format!(
            "report...\n{}\n{}\n",
            serde_json::json!({"op": OP_PROPOSE_RESPONSIBILITY_DRAFT, "input": {"title": "A"}}),
            serde_json::json!({"op": OP_PROPOSE_RESPONSIBILITY_DRAFT, "input": {"title": "B"}}),
        );
        let op = extract_responsibility_draft_op(&out).expect("op found");
        assert_eq!(op["input"]["title"], "A");
        assert!(extract_responsibility_draft_op("no ops here").is_none());
    }

    // -- Draft filing (validate → dedupe → propose-only) ---------------------

    #[test]
    fn draft_filing_validates_forces_owner_and_dedupes_per_day() {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");

        // Valid op: filed as a pending proposal, owner forced to p1.
        let filing =
            file_responsibility_draft(&pool, "p1", &draft_op("Digest the channel")).unwrap();
        let proposal_id = match filing {
            DraftFiling::Filed { proposal_id } => proposal_id,
            other => panic!("expected Filed, got {other:?}"),
        };
        let raw = proposal_repo::get_raw(&pool, &proposal_id)
            .unwrap()
            .unwrap();
        assert_eq!(raw.kind, KIND_RESPONSIBILITY_DRAFT);
        assert_eq!(raw.status, "pending_review");
        assert_eq!(raw.persona_id.as_deref(), Some("p1"));
        let payload: serde_json::Value = serde_json::from_str(&raw.proposal_json).unwrap();
        assert_eq!(
            payload["input"]["personaId"], "p1",
            "the payload's foreign persona claim was corrected at intake"
        );
        assert_eq!(
            payload["input"]["status"], "draft",
            "status forced at intake"
        );
        // Propose-only: no charter row exists.
        assert!(responsibilities_repo::list_by_persona(&pool, "p1", true)
            .unwrap()
            .is_empty());

        // Second same-day op: deduped, no second row.
        let again = file_responsibility_draft(&pool, "p1", &draft_op("Another idea")).unwrap();
        assert!(matches!(again, DraftFiling::DedupedToday), "{again:?}");
        assert_eq!(
            proposal_repo::count_pending_for_persona(&pool, "p1", KIND_RESPONSIBILITY_DRAFT)
                .unwrap(),
            1
        );

        // A DIFFERENT persona is not blocked by p1's dedupe.
        seed_persona(&pool, "p2");
        assert!(matches!(
            file_responsibility_draft(&pool, "p2", &draft_op("Their idea")).unwrap(),
            DraftFiling::Filed { .. }
        ));
    }

    #[test]
    fn invalid_drafts_are_decisions_not_rows() {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");

        // Missing title → the engine validator's refusal, nothing filed.
        let mut op = draft_op("  ");
        let filing = file_responsibility_draft(&pool, "p1", &op).unwrap();
        match filing {
            DraftFiling::Invalid { reason } => assert!(reason.contains("title"), "{reason}"),
            other => panic!("expected Invalid, got {other:?}"),
        }
        // Rung past the grantable ceiling → refused like mandate intake.
        op = draft_op("Too mighty");
        op["input"]["scopeRung"] = serde_json::json!(4);
        assert!(matches!(
            file_responsibility_draft(&pool, "p1", &op).unwrap(),
            DraftFiling::Invalid { .. }
        ));
        // No `input` at all.
        assert!(matches!(
            file_responsibility_draft(&pool, "p1", &serde_json::json!({"op": "x"})).unwrap(),
            DraftFiling::Invalid { .. }
        ));
        // None of the invalid shapes left a proposal behind.
        assert_eq!(
            proposal_repo::list(&pool, Some("p1"), false, 10)
                .unwrap()
                .len(),
            0
        );
    }

    // -- Apply door ----------------------------------------------------------

    #[test]
    fn apply_forces_source_and_status_and_derives_owner_from_the_row() {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");
        seed_persona(&pool, "p-attacker");

        // Plant a payload that lies about everything it can lie about.
        let payload = serde_json::json!({
            "input": {
                "personaId": "p-attacker",
                "title": "Keep the changelog honest",
                "status": "active",
                "procedure": "Diff the changelog against merged PRs.",
            },
            "motivation": "m",
        });
        let proposal_id = proposal_repo::create_raw(
            &pool,
            proposal_repo::CreateRawProposalInput {
                persona_id: "p1",
                kind: KIND_RESPONSIBILITY_DRAFT,
                proposal_json: &payload.to_string(),
                summary: Some("Draft charter: Keep the changelog honest"),
                proposed_changes: 1,
            },
        )
        .unwrap();

        let created = apply_responsibility_draft(&pool, &proposal_id).unwrap();
        assert_eq!(created.persona_id, "p1", "owner from the proposal ROW");
        assert_eq!(created.source, SOURCE_AGENT_PROPOSED, "source forced");
        assert_eq!(created.status, "draft", "status forced");
        assert_eq!(created.title, "Keep the changelog honest");
        assert!(created.id.starts_with("resp_"));
        assert!(
            responsibilities_repo::list_by_persona(&pool, "p-attacker", true)
                .unwrap()
                .is_empty(),
            "the payload's persona claim minted nothing"
        );

        // CAS: a second apply loses.
        let err = apply_responsibility_draft(&pool, &proposal_id).unwrap_err();
        assert!(err.to_string().contains("already"), "{err}");
        assert_eq!(
            responsibilities_repo::list_by_persona(&pool, "p1", true)
                .unwrap()
                .len(),
            1,
            "no double mint"
        );
    }

    #[test]
    fn apply_refuses_wrong_kind_and_leaves_invalid_payloads_pending() {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");

        // Wrong kind is refused before anything else.
        let wrong = proposal_repo::create_raw(
            &pool,
            proposal_repo::CreateRawProposalInput {
                persona_id: "p1",
                kind: manifest::KIND_SELF_MODEL_DIFF,
                proposal_json: r#"{"diffs":[]}"#,
                summary: None,
                proposed_changes: 0,
            },
        )
        .unwrap();
        let err = apply_responsibility_draft(&pool, &wrong).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");

        // An invalid payload (rung 4) errors AND leaves the proposal pending
        // — the human can still discard, nothing burned.
        let bad = proposal_repo::create_raw(
            &pool,
            proposal_repo::CreateRawProposalInput {
                persona_id: "p1",
                kind: KIND_RESPONSIBILITY_DRAFT,
                proposal_json:
                    r#"{"input":{"personaId":"p1","title":"Too mighty","scopeRung":4},"motivation":""}"#,
                summary: None,
                proposed_changes: 1,
            },
        )
        .unwrap();
        assert!(apply_responsibility_draft(&pool, &bad).is_err());
        let raw = proposal_repo::get_raw(&pool, &bad).unwrap().unwrap();
        assert_eq!(raw.status, "pending_review", "nothing burned");
        assert!(responsibilities_repo::list_by_persona(&pool, "p1", true)
            .unwrap()
            .is_empty());

        // A discarded proposal cannot be applied.
        let discarded = proposal_repo::create_raw(
            &pool,
            proposal_repo::CreateRawProposalInput {
                persona_id: "p1",
                kind: KIND_RESPONSIBILITY_DRAFT,
                proposal_json: r#"{"input":{"personaId":"p1","title":"T"},"motivation":""}"#,
                summary: None,
                proposed_changes: 1,
            },
        )
        .unwrap();
        proposal_repo::mark_discarded(&pool, &discarded).unwrap();
        assert!(apply_responsibility_draft(&pool, &discarded).is_err());
    }

    // -- Channel manifest-diff filing ----------------------------------------

    #[test]
    fn channel_diffs_file_self_sections_only_and_require_motivation() {
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1");

        let ops = vec![
            // Law + self mixed: only the self diff survives; the batch keeps
            // its motivation.
            serde_json::json!({
                "op": OP_PROPOSE_MANIFEST_DIFF,
                "diffs": [
                    {"section": "Mandate", "op": "append", "new_text": "sneaky"},
                    {"section": "My work / What I own", "op": "append",
                     "new_text": "the weekly digest"},
                    {"section": "Somewhere / Else", "op": "append", "new_text": "x"},
                    {"op": "append"},
                ],
                "motivation": "operator confirmed the digest is mine",
            }),
            // No motivation: dropped whole (provenance mandatory).
            serde_json::json!({
                "op": OP_PROPOSE_MANIFEST_DIFF,
                "diffs": [{"section": "My self-reads / Open questions", "op": "append",
                           "new_text": "y"}],
            }),
        ];
        let proposal_id = file_channel_manifest_diffs(&pool, "p1", &ops, "ep_1", "msg-1")
            .unwrap()
            .expect("one admissible diff files a proposal");
        let raw = proposal_repo::get_raw(&pool, &proposal_id)
            .unwrap()
            .unwrap();
        assert_eq!(raw.kind, manifest::KIND_SELF_MODEL_DIFF);
        let payload: serde_json::Value = serde_json::from_str(&raw.proposal_json).unwrap();
        let diffs = payload["diffs"].as_array().unwrap();
        assert_eq!(diffs.len(), 1, "law/unknown/malformed all dropped");
        assert_eq!(diffs[0]["section"], "My work / What I own");
        let rationale = payload["rationale"].as_str().unwrap();
        assert!(rationale.contains("operator confirmed"));
        assert!(rationale.contains("ep_1"), "episode provenance rides along");
        assert!(rationale.contains("msg-1"));

        // All-law ops file nothing.
        let law_only = vec![serde_json::json!({
            "op": OP_PROPOSE_MANIFEST_DIFF,
            "diffs": [{"section": "Boundaries", "op": "append", "new_text": "z"}],
            "motivation": "m",
        })];
        assert!(
            file_channel_manifest_diffs(&pool, "p1", &law_only, "ep_2", "msg-2")
                .unwrap()
                .is_none()
        );
    }

    #[test]
    fn addendum_teaches_the_same_grammar_the_parser_accepts() {
        assert!(SELF_MODEL_OP_ADDENDUM.contains(OP_PROPOSE_MANIFEST_DIFF));
        assert!(SELF_MODEL_OP_ADDENDUM.contains("anchor_text"));
        assert!(SELF_MODEL_OP_ADDENDUM.contains("never Mandate"));
        // The addendum's own example line parses through the extractor.
        let example = SELF_MODEL_OP_ADDENDUM
            .lines()
            .find(|l| l.trim_start().starts_with("{\"op\""))
            .expect("addendum carries an example line");
        let (cleaned, ops) = extract_manifest_diff_ops(example);
        assert_eq!(ops.len(), 1);
        assert!(cleaned.trim().is_empty());
    }
}
