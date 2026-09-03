//! Per-persona manifest (`manifest.md`) — the two-author core document.
//!
//! Promoted from `identity.rs` (spark `agent-manifest-rebase`, WP1). The file
//! has two kinds of section, told apart by their `# ` heading:
//!
//! * **LAW** — operator-authored: `# Mandate`, `# Boundaries`,
//!   `# Operation defaults`. Written ONLY through [`update_law`] (the
//!   `update_persona_manifest_law` command). The anchored-diff proposal path
//!   REFUSES any diff whose section path lands under a law heading, at both
//!   the propose door and the apply door.
//! * **SELF-MODEL** — agent-authored: `# My work`, `# My self-reads`. Grown
//!   ONLY by anchored diffs filed as a `persona_memory_review_proposal` of
//!   kind `self_model_diff` ([`propose_diffs`]) and applied by a human
//!   ([`apply_approved`], reached through `apply_persona_memory_review_proposal`).
//!   **There is deliberately NO full-content replacement op** — every change
//!   is reviewable per-claim.
//!
//! The diff grammar and appliers are the companion's pure fns
//! (`companion::brain::identity::{IdentityDiff, apply_to, bump_updated}`),
//! reused verbatim.
//!
//! # Disk, mirror, migration
//!
//! Disk: `~/.personas/personas/<id>/manifest.md`. A persona that still has
//! the pre-rebase `identity.md` is migrated lazily on first access: its
//! self-model sections are carried over under freshly seeded law sections,
//! and the old file is kept as `identity.migrated.md`.
//!
//! Mirror: after EVERY successful disk write (seed, law update, applied
//! diff) the full manifest text is written to `personas.core_profile` through
//! the personas repo — the column is reused as the mirror and now holds
//! plain markdown, not `PersonaCore` JSON. A legacy JSON core found there on
//! first access is preserved next to the manifest as `core.legacy.json` and
//! its prose folded into the seeded `# Mandate`. Prompt assembly (WP2)
//! renders the mirror verbatim under `## Manifest`.

use std::path::{Path, PathBuf};

use crate::companion::brain::identity::{apply_to, bump_updated, IdentityDiff, MAX_DIFFS_PER_OP};
use crate::db::models::{PersonaManifestView, UpdatePersonaInput};
use crate::db::repos::core::memory_review_proposal as proposal_repo;
use crate::db::repos::core::{
    personas as personas_repo, responsibilities as responsibilities_repo,
};
use crate::db::DbPool;
use crate::error::AppError;
use crate::validation::contract::{self, ValidationError};

/// Proposal-family discriminator this module owns (DB CHECK-enforced).
pub const KIND_SELF_MODEL_DIFF: &str = "self_model_diff";

/// Operator-authored `# ` headings, in file order.
pub const LAW_SECTIONS: [&str; 3] = ["Mandate", "Boundaries", "Operation defaults"];
/// Agent-authored `# ` headings, in file order.
pub const SELF_SECTIONS: [&str; 2] = ["My work", "My self-reads"];

const MANIFEST_FILE: &str = "manifest.md";
const LEGACY_IDENTITY_FILE: &str = "identity.md";
const LEGACY_IDENTITY_KEPT_AS: &str = "identity.migrated.md";
const LEGACY_CORE_KEPT_AS: &str = "core.legacy.json";

/// Byte ceiling for one law section's content — the same bar the Core
/// column carried (`validate_core_profile`), applied per section so the
/// operator's own prose can never make the mirror unbounded.
const MAX_LAW_SECTION_BYTES: usize = personas_core::validation::persona::MAX_CORE_PROFILE_BYTES;

/// GENERIC self-model seed — deliberately NOT Athena's operator-specific
/// template: a user persona models its WORK and its SELF-READS, never a human.
/// Section paths follow the companion grammar (`"<# h1> / <## h2>"`), e.g.
/// `"My work / What I own"`. The two `# ` headings are [`SELF_SECTIONS`].
fn render_self_model_seed() -> String {
    format!(
        "# {}\n\n## What I own\n- (seeded — grows from approved self-model diffs)\n\n## How I work best\n- (patterns that make my runs succeed)\n\n## What I've learned about my craft\n- (durable craft lessons)\n\n# {}\n\n## What I've gotten wrong\n- (catalogue of corrections)\n\n## Open questions\n- (things I am not yet sure about)\n",
        SELF_SECTIONS[0], SELF_SECTIONS[1]
    )
}

/// `~/.personas/personas/<persona_id>/` — where `manifest.md` and any
/// `manifest.bak-*.md` backups live. Returns `Result` because home-dir
/// resolution can genuinely fail, and every caller already speaks `AppError`.
pub fn persona_manifest_root(persona_id: &str) -> Result<PathBuf, AppError> {
    super::persona_root(persona_id)
}

fn manifest_path(persona_id: &str) -> Result<PathBuf, AppError> {
    Ok(persona_manifest_root(persona_id)?.join(MANIFEST_FILE))
}

/// Timestamped + uuid'd backup name, mirroring the companion's
/// `make_backup_name` so backups of both brains read alike.
fn make_backup_name() -> String {
    format!(
        "manifest.bak-{}-{}.md",
        chrono::Utc::now().format("%Y%m%dT%H%M%S%.3f"),
        uuid::Uuid::new_v4()
    )
}

/// Whether a diff's section path (`"<h1>"` or `"<h1> / <h2>"`) sits under a
/// law heading.
pub fn is_law_section(section_path: &str) -> bool {
    let h1 = section_path
        .split(" / ")
        .next()
        .unwrap_or(section_path)
        .trim();
    LAW_SECTIONS.iter().any(|l| l.eq_ignore_ascii_case(h1))
}

fn law_heading(section: &str) -> Option<&'static str> {
    LAW_SECTIONS
        .iter()
        .copied()
        .find(|l| l.eq_ignore_ascii_case(section.trim()))
}

// ── Seeding + lazy migration ───────────────────────────────────────────────

/// What the law seed is built from — read once from the persona row.
struct SeedSource {
    name: String,
    description: Option<String>,
    notification_channels: Option<String>,
    core_profile: Option<String>,
    mandate_titles: Vec<String>,
}

fn seed_source(pool: &DbPool, persona_id: &str) -> Result<SeedSource, AppError> {
    let persona = personas_repo::get_by_id(pool, persona_id)?;
    let mandate_titles = responsibilities_repo::list_by_persona(pool, persona_id, false)?
        .into_iter()
        .filter(|r| {
            r.domain == personas_engine::responsibility::DOMAIN_SOFTWARE_ENGINEERING
                && r.status == "active"
        })
        .map(|r| r.title)
        .collect();
    Ok(SeedSource {
        name: persona.name,
        description: persona.description,
        notification_channels: persona.notification_channels,
        core_profile: persona.core_profile,
        mandate_titles,
    })
}

/// The legacy `PersonaCore` JSON, when the mirror column still holds one
/// (anything that is not a JSON object is already markdown or empty).
fn legacy_core_json(core_profile: Option<&str>) -> Option<serde_json::Value> {
    let raw = core_profile?.trim();
    if !raw.starts_with('{') {
        return None;
    }
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .filter(|v| v.is_object())
}

fn channel_types(notification_channels: Option<&str>) -> Vec<String> {
    let Some(raw) = notification_channels else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    v.as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|c| c.get("type").and_then(|t| t.as_str()))
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

/// Render the three law sections from the persona row (+ the legacy core
/// prose, when any). Pure over its inputs.
fn render_law_seed(src: &SeedSource, legacy_core: Option<&serde_json::Value>) -> String {
    let mut out = String::new();

    out.push_str("# Mandate\n\n");
    match src
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        Some(d) => out.push_str(&format!("{} — {d}\n", src.name)),
        None => out.push_str(&format!(
            "{} — (describe what this persona is for)\n",
            src.name
        )),
    }
    for title in &src.mandate_titles {
        out.push_str(&format!("- App-master mandate: {title}\n"));
    }
    if let Some(core) = legacy_core {
        let prose = |key: &str| {
            core.get(key)
                .and_then(|v| v.as_str())
                .map(str::trim)
                .filter(|s| !s.is_empty())
        };
        for (label, key) in [
            ("Identity", "identity"),
            ("Motivation", "motivation"),
            ("Stance", "stance"),
            ("North star", "northStarCommitment"),
            ("Voice", "voice"),
        ] {
            if let Some(text) = prose(key) {
                out.push_str(&format!("- {label}: {text}\n"));
            }
        }
        for (label, key) in [
            ("Principle", "principles"),
            ("Decision principle", "decisionPrinciples"),
        ] {
            if let Some(items) = core.get(key).and_then(|v| v.as_array()) {
                for item in items.iter().filter_map(|i| i.as_str()) {
                    out.push_str(&format!("- {label}: {item}\n"));
                }
            }
        }
    }

    out.push_str("\n# Boundaries\n\n");
    let mut wrote_boundary = false;
    if let Some(items) = legacy_core
        .and_then(|c| c.get("constraints"))
        .and_then(|v| v.as_array())
    {
        for item in items.iter().filter_map(|i| i.as_str()) {
            out.push_str(&format!("- {item}\n"));
            wrote_boundary = true;
        }
    }
    if !wrote_boundary {
        out.push_str("- (operator-authored limits; nothing recorded yet)\n");
    }

    out.push_str("\n# Operation defaults\n\n");
    let channels = channel_types(src.notification_channels.as_deref());
    if channels.is_empty() {
        out.push_str("- Notification channels: (none configured)\n");
    } else {
        out.push_str(&format!(
            "- Notification channels: {}\n",
            channels.join(", ")
        ));
    }
    out.push('\n');
    out
}

fn frontmatter(now: &str) -> String {
    format!("---\ntype: manifest\nupdated: {now}\n---\n\n")
}

/// Strip a leading YAML frontmatter block, if any.
fn strip_frontmatter(md: &str) -> &str {
    let rest = md
        .strip_prefix("---\n")
        .or_else(|| md.strip_prefix("---\r\n"));
    let Some(rest) = rest else {
        return md;
    };
    match rest.find("\n---\n").or_else(|| rest.find("\n---\r\n")) {
        Some(idx) => {
            let after = &rest[idx..];
            let after = after
                .strip_prefix("\n---\r\n")
                .or_else(|| after.strip_prefix("\n---\n"))
                .unwrap_or(after);
            after.trim_start_matches(['\r', '\n'])
        }
        None => md,
    }
}

/// Ensure `manifest.md` exists: migrate a legacy `identity.md` when present,
/// else seed. Idempotent; creates the persona dir. Every branch that writes
/// the disk file also refreshes the mirror. Returns the manifest path.
pub fn ensure(pool: &DbPool, persona_id: &str) -> Result<PathBuf, AppError> {
    let path = manifest_path(persona_id)?;
    if path.exists() {
        return Ok(path);
    }
    let root = persona_manifest_root(persona_id)?;
    std::fs::create_dir_all(&root)?;

    let src = seed_source(pool, persona_id)?;
    let legacy_core = legacy_core_json(src.core_profile.as_deref());
    if let Some(core) = &legacy_core {
        // The JSON core is about to be overwritten by the mirror; keep it.
        let kept = root.join(LEGACY_CORE_KEPT_AS);
        if !kept.exists() {
            std::fs::write(&kept, core.to_string())?;
        }
    }
    let now = chrono::Utc::now().to_rfc3339();
    let law = render_law_seed(&src, legacy_core.as_ref());

    let legacy_identity = root.join(LEGACY_IDENTITY_FILE);
    let self_model = if legacy_identity.exists() {
        let raw = std::fs::read_to_string(&legacy_identity)?;
        let body = strip_frontmatter(&raw).trim_start().to_string();
        // Keep the original beside the manifest rather than deleting the
        // only copy of a self-model the agent grew.
        std::fs::rename(&legacy_identity, root.join(LEGACY_IDENTITY_KEPT_AS))?;
        tracing::info!(persona_id, "migrated identity.md into manifest.md");
        if body.trim().is_empty() {
            render_self_model_seed()
        } else {
            body
        }
    } else {
        render_self_model_seed()
    };

    let mut content = frontmatter(&now);
    content.push_str(&law);
    content.push_str(&self_model);
    if !content.ends_with('\n') {
        content.push('\n');
    }
    write_and_mirror(pool, persona_id, &path, &content)?;
    tracing::info!(persona_id, path = %path.display(), "seeded persona manifest.md");
    Ok(path)
}

/// The persona's current manifest, or `None` when never seeded. Reads disk
/// only — no seeding, no DB.
pub fn read(persona_id: &str) -> Option<String> {
    let path = manifest_path(persona_id).ok()?;
    std::fs::read_to_string(path).ok()
}

/// `# ` headings present in `content`, in file order.
fn h1_headings(content: &str) -> Vec<String> {
    content
        .lines()
        .filter_map(|l| l.trim_start().strip_prefix("# "))
        .map(|h| h.trim().to_string())
        .collect()
}

fn frontmatter_updated(content: &str) -> Option<String> {
    content
        .lines()
        .take(6)
        .find_map(|l| l.trim_start().strip_prefix("updated:"))
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

/// The manifest as the editor reads it: ensured on disk, with the law /
/// self-model section split and the pending-proposal count.
pub fn view(pool: &DbPool, persona_id: &str) -> Result<PersonaManifestView, AppError> {
    let path = ensure(pool, persona_id)?;
    let content = std::fs::read_to_string(&path)?;
    let headings = h1_headings(&content);
    let (law_sections, self_sections): (Vec<String>, Vec<String>) = headings
        .into_iter()
        .partition(|h| LAW_SECTIONS.iter().any(|l| l.eq_ignore_ascii_case(h)));
    let pending_proposals =
        proposal_repo::count_pending_for_persona(pool, persona_id, KIND_SELF_MODEL_DIFF)?;
    Ok(PersonaManifestView {
        updated_at: frontmatter_updated(&content),
        content,
        law_sections,
        self_sections,
        pending_proposals,
    })
}

// ── The mirror ─────────────────────────────────────────────────────────────

/// Write the manifest to disk, then mirror the full text into
/// `personas.core_profile`. The disk write is the durable record; a mirror
/// failure surfaces as the error (the next successful write re-mirrors).
fn write_and_mirror(
    pool: &DbPool,
    persona_id: &str,
    path: &Path,
    content: &str,
) -> Result<(), AppError> {
    std::fs::write(path, content)?;
    mirror(pool, persona_id, content)
}

/// Rebuild the mirror: the manifest text verbatim into `personas.core_profile`
/// through the personas repo (which also snapshots a prompt version, because
/// a Core change is a prompt-shaping change).
fn mirror(pool: &DbPool, persona_id: &str, content: &str) -> Result<(), AppError> {
    personas_repo::update(
        pool,
        persona_id,
        UpdatePersonaInput {
            core_profile: Some(Some(content.to_string())),
            source: Some("manifest".to_string()),
            ..Default::default()
        },
    )
    .map(|_| ())
}

// ── Law writes (operator door) ─────────────────────────────────────────────

/// Replace the body of one law section (`Mandate` | `Boundaries` |
/// `Operation defaults`) with `content`, keeping every other line, then
/// bump `updated:` and refresh the mirror. Refuses a heading that is not law
/// (typed `{section, law_section}` validation) and oversized content.
pub fn update_law(
    pool: &DbPool,
    persona_id: &str,
    section: &str,
    content: &str,
) -> Result<(), AppError> {
    let heading = law_heading(section);
    contract::check(
        [
            heading.is_none().then(|| {
                ValidationError::new(
                    "section",
                    "law_section",
                    format!(
                        "`{section}` is not a law section; the operator door writes only {}",
                        LAW_SECTIONS.join(" / ")
                    ),
                )
            }),
            (content.len() > MAX_LAW_SECTION_BYTES).then(|| {
                ValidationError::new(
                    "content",
                    "max_length",
                    format!(
                        "Law section exceeds maximum size of {} KB",
                        MAX_LAW_SECTION_BYTES / 1024
                    ),
                )
            }),
            content
                .lines()
                .any(|l| l.trim_start().starts_with("# "))
                .then(|| {
                    ValidationError::new(
                        "content",
                        "no_h1",
                        "Law content may not introduce a `# ` heading; that would mint a section",
                    )
                }),
        ]
        .into_iter()
        .flatten()
        .collect(),
    )?;
    // INVARIANT: `contract::check` above refused every `None` heading.
    let heading = heading.unwrap_or(LAW_SECTIONS[0]);

    let path = ensure(pool, persona_id)?;
    let raw = std::fs::read_to_string(&path)?;
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();
    let (start, end) = h1_range(&lines, heading).ok_or_else(|| {
        AppError::Internal(format!(
            "manifest for `{persona_id}` has no `# {heading}` section (file predates the law seed?)"
        ))
    })?;

    let mut body: Vec<String> = vec![String::new()];
    body.extend(content.trim_matches(['\r', '\n']).lines().map(String::from));
    body.push(String::new());
    lines.splice(start + 1..end, body);

    let backup = make_backup_name();
    let _ = std::fs::copy(&path, persona_manifest_root(persona_id)?.join(backup));
    bump_updated(&mut lines, &chrono::Utc::now().to_rfc3339());
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    write_and_mirror(pool, persona_id, &path, &out)
}

/// `(heading_line_index, end_exclusive)` of the `# {heading}` section: the
/// lines up to the next `# ` heading (or EOF).
fn h1_range(lines: &[String], heading: &str) -> Option<(usize, usize)> {
    let start = lines.iter().position(|l| {
        l.trim_start()
            .strip_prefix("# ")
            .is_some_and(|h| h.trim().eq_ignore_ascii_case(heading))
    })?;
    let end = lines
        .iter()
        .enumerate()
        .skip(start + 1)
        .find(|(_, l)| l.trim_start().starts_with("# "))
        .map(|(i, _)| i)
        .unwrap_or(lines.len());
    Some((start, end))
}

// ── Self-model diffs (agent door, human-gated) ─────────────────────────────

/// The typed refusal for any diff aimed at a law section.
fn law_diff_errors(diffs: &[IdentityDiff]) -> Vec<ValidationError> {
    diffs
        .iter()
        .filter(|d| is_law_section(&d.section))
        .map(|d| {
            ValidationError::new(
                "diffs",
                "law_section",
                format!(
                    "diff targets law section `{}`; only the operator writes {}",
                    d.section,
                    LAW_SECTIONS.join(" / ")
                ),
            )
        })
        .collect()
}

/// File a batch of anchored diffs as a `self_model_diff` proposal. NEVER
/// applies — the write happens only in [`apply_approved`], behind the human
/// gate. Diffs aimed at a law section are refused here. Returns the proposal id.
pub fn propose_diffs(
    pool: &DbPool,
    persona_id: &str,
    diffs: Vec<IdentityDiff>,
    rationale: &str,
) -> Result<String, AppError> {
    // Through the validation contract so the {field, rule} identity survives
    // (command-input-validation golden path), not an open-coded refusal.
    let mut errors: Vec<ValidationError> = [
        diffs.is_empty().then(|| {
            ValidationError::new(
                "diffs",
                "required",
                "self-model proposal needs at least one diff",
            )
        }),
        (diffs.len() > MAX_DIFFS_PER_OP).then(|| {
            ValidationError::new(
                "diffs",
                "max_count",
                format!(
                    "self-model proposal carries {} diffs; one reviewable batch is at most {MAX_DIFFS_PER_OP}",
                    diffs.len()
                ),
            )
        }),
    ]
    .into_iter()
    .flatten()
    .collect();
    errors.extend(law_diff_errors(&diffs));
    contract::check(errors)?;

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
pub struct ManifestApplyOutcome {
    /// The persona whose `manifest.md` was edited — derived from the
    /// proposal ROW, never from the caller (ownership-verification golden
    /// path: the row the server fetched is the only honest source).
    pub persona_id: String,
    /// Human-readable previews of the diffs that applied.
    pub applied: Vec<String>,
    /// Per-diff failure reasons for the ones that did not.
    pub skipped: Vec<String>,
    /// Backup file name written before the edit.
    pub backup: String,
}

/// Apply a human-approved `self_model_diff` proposal to the persona's
/// `manifest.md`: refuse law-section diffs, validate every diff against the
/// live file (companion pure `apply_to`), back up, bump `updated`, write,
/// mirror, and mark the proposal `applied` (CAS — a concurrent double-apply
/// loses and errors).
///
/// The persona is derived from the proposal ROW the server fetched — there
/// is deliberately no caller-supplied persona parameter.
///
/// If NO diff validates, the proposal is left `pending_review` and an error
/// names every failure — the human can fix or discard, and nothing burned.
pub fn apply_approved(pool: &DbPool, proposal_id: &str) -> Result<ManifestApplyOutcome, AppError> {
    let proposal = proposal_repo::get_raw(pool, proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("proposal `{proposal_id}`")))?;
    if proposal.kind != KIND_SELF_MODEL_DIFF {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` is kind `{}`, not `{KIND_SELF_MODEL_DIFF}`",
            proposal.kind
        )));
    }
    let persona_id = proposal.persona_id.clone().ok_or_else(|| {
        AppError::Validation(format!(
            "self_model_diff proposal `{proposal_id}` carries no persona_id"
        ))
    })?;
    let persona_id = persona_id.as_str();
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
    // A proposal minted around the propose door is refused here too — the
    // law sections have exactly one writer.
    contract::check(law_diff_errors(&diffs))?;

    let path = ensure(pool, persona_id)?;
    let raw = std::fs::read_to_string(&path)?;
    let mut lines: Vec<String> = raw.lines().map(String::from).collect();

    let mut applied = Vec::new();
    let mut skipped = Vec::new();
    for d in &diffs {
        match apply_to(&mut lines, d) {
            Ok(()) => applied.push(d.preview()),
            Err(e) => skipped.push(format!("{} — {e}", d.preview())),
        }
    }
    contract::check(
        applied
            .is_empty()
            .then(|| {
                ValidationError::new(
                    "diffs",
                    "none_applied",
                    format!(
                        "no self-model diffs applied (proposal left pending): {}",
                        skipped.join("; ")
                    ),
                )
            })
            .into_iter()
            .collect(),
    )?;

    // CAS the status BEFORE the disk write so a concurrent apply cannot write
    // twice; the loser errors here with the file untouched.
    if !proposal_repo::mark_applied(pool, proposal_id)? {
        return Err(AppError::Validation(format!(
            "proposal `{proposal_id}` was decided by a concurrent action"
        )));
    }

    let backup = make_backup_name();
    let root = persona_manifest_root(persona_id)?;
    // Backup is best-effort (mirrors the companion's apply_diffs_on_disk);
    // the durable safety is the proposal row + the append-only episodes.
    let _ = std::fs::copy(&path, root.join(&backup));
    bump_updated(&mut lines, &chrono::Utc::now().to_rfc3339());
    let mut out = lines.join("\n");
    if !out.ends_with('\n') {
        out.push('\n');
    }
    write_and_mirror(pool, persona_id, &path, &out)?;

    Ok(ManifestApplyOutcome {
        persona_id: persona_id.to_string(),
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
            "INSERT INTO personas (id, name, description, system_prompt, created_at, updated_at)
             VALUES (?1, ?1, 'keeps the docs honest', 'sp', datetime('now'), datetime('now'))",
            rusqlite::params![id],
        )?;
        Ok(())
    }

    fn core_profile_of(pool: &DbPool, id: &str) -> Option<String> {
        personas_repo::get_by_id(pool, id).unwrap().core_profile
    }

    fn diff(section: &str, new_text: &str) -> IdentityDiff {
        IdentityDiff::from_json(&serde_json::json!({
            "section": section, "op": "append", "new_text": new_text,
        }))
        .unwrap()
    }

    #[test]
    fn seed_writes_law_and_self_sections_and_mirrors_them() {
        let home = crate::companion::brain::test_home::TestHome::new("persona_manifest_seed");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();

        let v = view(&pool, "p1").unwrap();
        assert_eq!(v.law_sections, LAW_SECTIONS.map(String::from).to_vec());
        assert_eq!(v.self_sections, SELF_SECTIONS.map(String::from).to_vec());
        assert!(v.updated_at.is_some());
        assert_eq!(v.pending_proposals, 0);
        assert!(v.content.contains("p1 — keeps the docs honest"));
        assert!(v.content.contains("## Open questions"));
        assert!(
            !v.content.to_lowercase().contains("michal"),
            "the seed is generic, never Athena's operator-specific template"
        );
        assert!(home.path().join("personas/p1/manifest.md").exists());

        // The mirror is the full text, verbatim.
        assert_eq!(
            core_profile_of(&pool, "p1").as_deref(),
            Some(v.content.as_str())
        );
        // Idempotent: a second view does not reseed.
        let again = view(&pool, "p1").unwrap();
        assert_eq!(again.content, v.content);
    }

    #[test]
    fn legacy_identity_and_json_core_are_migrated_not_lost() -> Result<(), AppError> {
        let home = crate::companion::brain::test_home::TestHome::new("persona_manifest_migrate");
        let pool = init_test_db()?;
        seed_persona(&pool, "p1")?;
        let conn = pool.get()?;
        conn.execute(
                r#"UPDATE personas SET core_profile =
                   '{"motivation":"ship honest docs","stance":"terse","northStarCommitment":"n",
                     "riskTolerance":0.2,"speedVsQuality":0.5,"conflictStyle":"analyst","deference":0.5,
                     "constraints":["never push to main"]}'
                   WHERE id = 'p1'"#,
                [],
            )
            .unwrap();
        drop(conn);
        let root = home.path().join("personas/p1");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("identity.md"),
            "---\ntype: identity\nupdated: 2026-01-01T00:00:00Z\n---\n\n# My work\n\n## What I own\n- the changelog (ep_1)\n\n# My self-reads\n\n## Open questions\n- none\n",
        )
        .unwrap();

        let v = view(&pool, "p1").unwrap();
        assert!(v.content.contains("- Motivation: ship honest docs"));
        assert!(
            v.content.contains("- never push to main"),
            "constraints → Boundaries"
        );
        assert!(
            v.content.contains("- the changelog (ep_1)"),
            "self-model carried over"
        );
        assert!(
            !v.content.contains("type: identity"),
            "old frontmatter dropped"
        );
        assert!(root.join("manifest.md").exists());
        assert!(root.join("identity.migrated.md").exists());
        assert!(!root.join("identity.md").exists());
        let kept: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join("core.legacy.json")).unwrap())
                .unwrap();
        assert_eq!(kept["riskTolerance"], 0.2, "the dials survive on disk");
        assert!(core_profile_of(&pool, "p1")
            .unwrap()
            .starts_with("---\ntype: manifest"));
        Ok(())
    }

    #[test]
    fn law_door_rewrites_one_section_and_refuses_the_rest() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_manifest_law");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();
        view(&pool, "p1").unwrap();

        update_law(
            &pool,
            "p1",
            "Boundaries",
            "- no external sends\n- no deletes",
        )
        .unwrap();
        let after = read("p1").unwrap();
        assert!(after
            .contains("# Boundaries\n\n- no external sends\n- no deletes\n\n# Operation defaults"));
        assert!(
            after.contains("p1 — keeps the docs honest"),
            "Mandate untouched"
        );
        assert!(after.contains("## Open questions"), "self-model untouched");
        assert_eq!(
            core_profile_of(&pool, "p1").as_deref(),
            Some(after.as_str())
        );

        // Case-insensitive heading match; self-model and unknown headings refused.
        update_law(&pool, "p1", "mandate", "p1 runs the docs").unwrap();
        assert!(read("p1")
            .unwrap()
            .contains("# Mandate\n\np1 runs the docs\n"));
        for bad in ["My work", "Nope"] {
            let err = update_law(&pool, "p1", bad, "x").unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "{err}");
        }
        assert!(update_law(&pool, "p1", "Mandate", "# Sneaky\nbody").is_err());
        assert!(update_law(
            &pool,
            "p1",
            "Mandate",
            &"x".repeat(MAX_LAW_SECTION_BYTES + 1)
        )
        .is_err());
    }

    #[test]
    fn propose_then_apply_grows_the_self_model_behind_the_gate() {
        let home = crate::companion::brain::test_home::TestHome::new("persona_manifest_diff");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();

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
        assert_eq!(view(&pool, "p1").unwrap().pending_proposals, 1);
        // Proposing NEVER applies.
        assert!(!read("p1").unwrap().contains("retry flaky fetches"));

        let outcome = apply_approved(&pool, &proposal_id).unwrap();
        assert_eq!(outcome.persona_id, "p1", "derived from the proposal row");
        assert_eq!(outcome.applied.len(), 1);
        assert!(outcome.skipped.is_empty());
        let after = read("p1").unwrap();
        assert!(after.contains("retry flaky fetches"));
        assert_eq!(
            core_profile_of(&pool, "p1").as_deref(),
            Some(after.as_str())
        );
        assert!(home
            .path()
            .join("personas/p1")
            .join(&outcome.backup)
            .exists());
        assert_eq!(view(&pool, "p1").unwrap().pending_proposals, 0);

        // Re-apply loses the CAS: the proposal is already decided.
        let err = apply_approved(&pool, &proposal_id).unwrap_err();
        assert!(err.to_string().contains("already"), "{err}");
    }

    #[test]
    fn diffs_aimed_at_law_sections_are_refused_at_both_doors() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_manifest_lawdiff");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();

        for section in ["Mandate", "Boundaries / anything", "operation defaults"] {
            let err = propose_diffs(&pool, "p1", vec![diff(section, "x")], "r").unwrap_err();
            assert!(matches!(err, AppError::Validation(_)), "{section}: {err}");
            assert!(err.to_string().contains("law section"), "{err}");
        }

        // A proposal planted around the propose door is refused at apply.
        let planted = proposal_repo::create_raw(
            &pool,
            proposal_repo::CreateRawProposalInput {
                persona_id: "p1",
                kind: KIND_SELF_MODEL_DIFF,
                proposal_json: r#"{"diffs":[{"section":"Mandate","op":"append","new_text":"x"}]}"#,
                summary: None,
                proposed_changes: 1,
            },
        )
        .unwrap();
        let err = apply_approved(&pool, &planted).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err}");
        let raw = proposal_repo::get_raw(&pool, &planted).unwrap().unwrap();
        assert_eq!(raw.status, "pending_review", "nothing burned");
        assert!(read("p1").is_none(), "refused before any seed/write");
    }

    #[test]
    fn apply_with_no_valid_diff_leaves_the_proposal_pending() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_manifest_bad");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();
        let proposal_id =
            propose_diffs(&pool, "p1", vec![diff("No Such / Section", "bullet")], "r").unwrap();
        assert!(apply_approved(&pool, &proposal_id).is_err());
        let raw = proposal_repo::get_raw(&pool, &proposal_id)
            .unwrap()
            .unwrap();
        assert_eq!(
            raw.status, "pending_review",
            "a fully-invalid batch burns nothing"
        );
    }

    #[test]
    fn propose_caps_the_batch_at_one_reviewable_card() {
        let _home = crate::companion::brain::test_home::TestHome::new("persona_manifest_cap");
        let pool = init_test_db().unwrap();
        seed_persona(&pool, "p1").unwrap();
        let too_many: Vec<IdentityDiff> = (0..=MAX_DIFFS_PER_OP)
            .map(|i| diff("My work / What I own", &format!("bullet {i}")))
            .collect();
        assert!(propose_diffs(&pool, "p1", too_many, "r").is_err());
        assert!(propose_diffs(&pool, "p1", vec![], "r").is_err());
    }
}
