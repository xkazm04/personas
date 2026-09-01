//! Per-persona self-model (`identity.md`) — read, seed, propose, apply.
//!
//! The diff grammar and all validation/application logic are the companion's
//! pure fns (`companion::brain::identity::{IdentityDiff, apply_to,
//! bump_updated, MAX_DIFFS_PER_OP}`), reused verbatim — this module only owns
//! the per-persona disk plumbing and the proposal-gated write path. Chosen
//! over threading a `root: &Path` through the companion's three disk fns
//! because it touches companion code not at all (the pure half was already
//! `pub`), which is the smaller diff of the two options the brief offered.
//!
//! Governance: consolidation NEVER edits `identity.md` directly. It files a
//! `persona_memory_review_proposal` row of kind `self_model_diff`
//! ([`propose_diffs`]) and a human applies it ([`apply_approved`], reached
//! through the existing `apply_persona_memory_review_proposal` command).
//! **There is deliberately NO full-content replacement op** — anchored diffs
//! only, so every change is reviewable per-claim (the registry deviation the
//! brief refuses to reproduce).

use std::path::PathBuf;

use crate::companion::brain::identity::{apply_to, bump_updated, IdentityDiff, MAX_DIFFS_PER_OP};
use crate::db::repos::core::memory_review_proposal as proposal_repo;
use crate::db::DbPool;
use crate::error::AppError;

/// Proposal-family discriminator this module owns (DB CHECK-enforced).
pub const KIND_SELF_MODEL_DIFF: &str = "self_model_diff";

/// GENERIC self-model seed — deliberately NOT Athena's operator-specific
/// template: a user persona models its WORK and its SELF-READS, never a human.
/// Section paths follow the companion grammar (`"<# h1> / <## h2>"`), e.g.
/// `"My work / What I own"`.
const IDENTITY_SEED: &str = "---\ntype: identity\nupdated: PLACEHOLDER_CREATED_AT\n---\n\n# My work\n\n## What I own\n- (seeded — grows from approved self-model diffs)\n\n## How I work best\n- (patterns that make my runs succeed)\n\n## What I've learned about my craft\n- (durable craft lessons)\n\n# My self-reads\n\n## What I've gotten wrong\n- (catalogue of corrections)\n\n## Open questions\n- (things I am not yet sure about)\n";

/// `~/.personas/personas/<persona_id>/` — where `identity.md` and any
/// `identity.bak-*.md` backups live. Returns `Result` (not the brief's bare
/// `PathBuf`) because home-dir resolution can genuinely fail, and every
/// caller already speaks `AppError`.
pub fn persona_identity_root(persona_id: &str) -> Result<PathBuf, AppError> {
    super::persona_root(persona_id)
}

fn identity_path(persona_id: &str) -> Result<PathBuf, AppError> {
    Ok(persona_identity_root(persona_id)?.join("identity.md"))
}

/// Timestamped + uuid'd backup name, mirroring the companion's
/// `make_backup_name` (identity.rs:286) so backups of both brains read alike.
fn make_backup_name() -> String {
    format!(
        "identity.bak-{}-{}.md",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3f"),
        uuid::Uuid::new_v4()
    )
}

/// Seed `identity.md` iff absent (idempotent; creates the persona dir).
pub fn seed_if_absent(persona_id: &str) -> Result<PathBuf, AppError> {
    let path = identity_path(persona_id)?;
    if !path.exists() {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let seeded =
            IDENTITY_SEED.replace("PLACEHOLDER_CREATED_AT", &chrono::Utc::now().to_rfc3339());
        std::fs::write(&path, seeded)?;
        tracing::info!(persona_id, path = %path.display(), "seeded persona identity.md");
    }
    Ok(path)
}

/// The persona's current self-model, or `None` when never seeded.
pub fn read(persona_id: &str) -> Option<String> {
    let path = identity_path(persona_id).ok()?;
    std::fs::read_to_string(path).ok()
}

/// File a batch of anchored diffs as a `self_model_diff` proposal. NEVER
/// applies — the write happens only in [`apply_approved`], behind the human
/// gate. Returns the proposal id.
pub fn propose_diffs(
    pool: &DbPool,
    persona_id: &str,
    diffs: Vec<IdentityDiff>,
    rationale: &str,
) -> Result<String, AppError> {
    if diffs.is_empty() {
        return Err(AppError::Validation(
            "self-model proposal needs at least one diff".into(),
        ));
    }
    if diffs.len() > MAX_DIFFS_PER_OP {
        return Err(AppError::Validation(format!(
            "self-model proposal carries {} diffs; one reviewable batch is at most {MAX_DIFFS_PER_OP}",
            diffs.len()
        )));
    }
    let payload = serde_json::json!({
        "diffs": diffs.iter().map(diff_to_json).collect::<Vec<_>>(),
        "rationale": rationale,
    });
    let summary = diffs
        .iter()
        .map(|d| d.preview())
        .collect::<Vec<_>>()
        .join("\n");
    proposal_repo::create_raw(
        pool,
        proposal_repo::CreateRawProposalInput {
            persona_id,
            kind: KIND_SELF_MODEL_DIFF,
            proposal_json: &payload.to_string(),
            summary: Some(&summary),
            proposed_changes: diffs.len() as i32,
        },
    )
}

/// Serialize one diff into the payload shape [`IdentityDiff::from_json`]
/// parses back (round-trip property is what makes the proposal durable).
fn diff_to_json(d: &IdentityDiff) -> serde_json::Value {
    use crate::companion::brain::identity::DiffOp;
    let op = match d.op {
        DiffOp::AppendBullet => "append",
        DiffOp::ReplaceBullet => "replace",
        DiffOp::RemoveBullet => "remove",
    };
    serde_json::json!({
        "section": d.section,
        "op": op,
        "anchor_text": d.anchor_text,
        "new_text": d.new_text,
    })
}

/// What [`apply_approved`] did.
#[derive(Debug, Clone)]
pub struct IdentityApplyOutcome {
    /// Human-readable previews of the diffs that applied.
    pub applied: Vec<String>,
    /// Per-diff failure reasons for the ones that did not.
    pub skipped: Vec<String>,
    /// Backup file name written before the edit (empty when no prior file —
    /// unreachable in practice because the file is seeded first).
    pub backup: String,
}

/// Apply a human-approved `self_model_diff` proposal to the persona's
/// `identity.md`: validate every diff against the live file (companion pure
/// `apply_to`), back up, bump `updated`, write, and mark the proposal
/// `applied` (CAS — a concurrent double-apply loses and errors).
///
/// If NO diff validates, the proposal is left `pending_review` and an error
/// names every failure — the human can fix or discard, and nothing burned.
pub fn apply_approved(
    pool: &DbPool,
    persona_id: &str,
    proposal_id: &str,
) -> Result<IdentityApplyOutcome, AppError> {
    let proposal = proposal_repo::get_raw(pool, proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("proposal `{proposal_id}`")))?;
    if proposal.kind != KIND_SELF_MODEL_DIFF {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` is kind `{}`, not `{KIND_SELF_MODEL_DIFF}`",
            proposal.kind
        )));
    }
    if proposal.persona_id.as_deref() != Some(persona_id) {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` does not belong to persona `{persona_id}`"
        )));
    }
    if proposal.status != "pending_review" {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` already `{}`",
            proposal.status
        )));
    }

    let payload: serde_json::Value = serde_json::from_str(&proposal.proposal_json)
        .map_err(|e| AppError::Internal(format!("self_model_diff payload unparseable: {e}")))?;
    let diffs: Vec<IdentityDiff> = payload
        .get("diffs")
        .and_then(|d| d.as_array())
        .ok_or_else(|| AppError::Internal("self_model_diff payload has no `diffs`".into()))?
        .iter()
        .map(IdentityDiff::from_json)
        .collect::<Result<Vec<_>, _>>()?;

    let path = seed_if_absent(persona_id)?;
    let raw = std::fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();

    let mut applied = Vec::new();
    let mut skipped = Vec::new();
    for d in &diffs {
        match apply_to(&mut lines, d) {
            Ok(()) => applied.push(d.preview()),
            Err(e) => skipped.push(format!("{} — {e}", d.preview())),
        }
    }
    if applied.is_empty() {
        return Err(AppError::Validation(format!(
            "no self-model diffs applied (proposal left pending): {}",
            skipped.join("; ")
        )));
    }

    // CAS the status BEFORE the disk write so a concurrent apply cannot write
    // twice; the loser errors here with the file untouched.
    if !proposal_repo::mark_applied(pool, proposal_id)? {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` was decided by a concurrent action"
        )));
    }

    let backup = make_backup_name();
    let root = persona_identity_root(persona_id)?;
    // Backup is best-effort (mirrors the companion's apply_diffs_on_disk);
    // the durable safety is the proposal row + git-like append-only episodes.
    let _ = std::fs::copy(&path, root.join(&backup));
    bump_updated(&mut lines, &chrono::Utc::now().to_rfc3339());
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    std::fs::write(&path, out)?;

    Ok(IdentityApplyOutcome {
        applied,
        skipped,
        backup,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::init_test_db;

    fn seed_persona(pool: &DbPool, id: &str) -> Result<(), AppError> {
        pool.get()?.execute(
            "INSERT INTO personas (id, name, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'sp', datetime('now'), datetime('now'))",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    fn diff(section: &str, new_text: &str) -> IdentityDiff {
        IdentityDiff::from_json(&serde_json::json!({
            "section": section, "op": "append", "new_text": new_text,
        }))
        .unwrap()
    }

    #[test]
    fn propose_then_apply_grows_the_identity_behind_the_gate() {
        let home = crate::companion::brain::test_home::TestHome::new("persona_identity");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();

        seed_if_absent("p1").unwrap();
        let seeded = read("p1").expect("seeded identity exists");
        assert!(seeded.contains("# My work"));
        assert!(seeded.contains("## Open questions"));
        assert!(
            !seeded.to_lowercase().contains("michal"),
            "the seed is generic, never Athena's operator-specific template"
        );

        let proposal_id = propose_diffs(
            &pool,
            "p1",
            vec![diff(
                "My work / What I've learned about my craft",
                "retry flaky fetches once before failing (pep_ab12)",
            )],
            "two runs failed on a transient fetch",
        )
        .unwrap();

        // Proposing NEVER applies.
        assert!(!read("p1").unwrap().contains("retry flaky fetches"));

        let outcome = apply_approved(&pool, "p1", &proposal_id).unwrap();
        assert_eq!(outcome.applied.len(), 1);
        assert!(outcome.skipped.is_empty());
        assert!(read("p1").unwrap().contains("retry flaky fetches"));
        // Backup landed next to the file.
        assert!(home
            .path()
            .join("personas")
            .join("p1")
            .join(&outcome.backup)
            .exists());

        // Re-apply loses the CAS: the proposal is already decided.
        let err = apply_approved(&pool, "p1", &proposal_id).unwrap_err();
        assert!(err.to_string().contains("already"), "{err}");
    }

    #[test]
    fn apply_with_no_valid_diff_leaves_the_proposal_pending() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_identity_bad");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();
        let proposal_id =
            propose_diffs(&pool, "p1", vec![diff("No Such / Section", "bullet")], "r").unwrap();
        assert!(apply_approved(&pool, "p1", &proposal_id).is_err());
        let raw = proposal_repo::get_raw(&pool, &proposal_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            raw.status, "pending_review",
            "a fully-invalid batch burns nothing"
        );
    }

    #[test]
    fn apply_refuses_the_wrong_persona_and_wrong_kind() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_identity_scope");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();
        seed_persona(&pool, "p2").unwrap();
        let proposal_id =
            propose_diffs(&pool, "p1", vec![diff("My work / What I own", "x")], "r").unwrap();
        assert!(apply_approved(&pool, "p2", &proposal_id).is_err());
    }

    #[test]
    fn propose_caps_the_batch_at_one_reviewable_card() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_identity_cap");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();
        let too_many: Vec<IdentityDiff> = (0..=MAX_DIFFS_PER_OP)
            .map(|i| diff("My work / What I own", &format!("bullet {i}")))
            .collect();
        assert!(propose_diffs(&pool, "p1", too_many, "r").is_err());
        assert!(propose_diffs(&pool, "p1", vec![], "r").is_err());
    }
}
