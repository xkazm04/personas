//! `contest_decide`: the owner's verdict.
//!
//! - **winner** → `contest.mjs verdict --winner … [--runner-up …] --note …`, then
//!   the winner note to the Obsidian brain (`Contests/<contestId>.md`, through
//!   the generic mirror sink; skipped with a log when no vault is configured).
//! - **shortlist** → first delete every variant dir the review bucketed
//!   `failure` and re-run `collect` (skill 7b step 1), then
//!   `verdict --shortlist …`, then `refine --shortlist … --feedback REVIEW.md`;
//!   the child round inherits the judge settings and its summary is returned.
//!
//! The instrument's `verdict` refuses to run without at least one verdict file.
//! A contest decided without a judge panel therefore gets an OWNER verdict
//! (`runs/verdict-owner.json`, where the skill puts the host's own verdict)
//! built from the review: every present variant, `broken` for the failure
//! bucket, the owner's note as its strengths, and NO scores — the owner never
//! scored anything, so the scoreboard's mean for that judge stays null.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::Serialize;
use tauri::AppHandle;

use super::arena::{self, ArenaPaths, ManifestFile};
use super::driver::{self, Ctx};
use super::node::{self, STEP_TIMEOUT};
use super::review;
use super::types::{ContestDecision, ContestReview, ContestReviewBucket};
use crate::error::AppError;

/// `<letter>/<n>` → `(letter, n)`.
pub fn parse_key(key: &str) -> Option<(char, u32)> {
    let (l, n) = key.trim().split_once('/')?;
    let mut chars = l.chars();
    let letter = chars.next()?;
    if chars.next().is_some() || !letter.is_ascii_uppercase() {
        return None;
    }
    let n: u32 = n.parse().ok()?;
    (n > 0).then_some((letter, n))
}

fn require_key(key: &str) -> Result<String, AppError> {
    parse_key(key)
        .map(|(l, n)| format!("{l}/{n}"))
        .ok_or_else(|| AppError::Validation(format!("`{key}` is not a variant key like A/2")))
}

#[derive(Serialize)]
struct OwnerVariant {
    n: u32,
    broken: bool,
    strengths: String,
    weaknesses: String,
}

#[derive(Serialize)]
struct OwnerEntry {
    variants: Vec<OwnerVariant>,
}

#[derive(Serialize)]
struct OwnerVerdict {
    judge: String,
    entries: BTreeMap<String, OwnerEntry>,
    ranking: Vec<String>,
    patterns: Vec<String>,
    anti_patterns: Vec<String>,
}

fn has_any_verdict(paths: &ArenaPaths) -> bool {
    [paths.dir.join("judging"), paths.dir.join("runs")]
        .iter()
        .filter_map(|d| std::fs::read_dir(d).ok())
        .flat_map(|rd| rd.flatten())
        .any(|e| {
            e.file_name()
                .to_str()
                .is_some_and(|n| n.starts_with("verdict-") && n.ends_with(".json"))
        })
}

/// The owner verdict from the review (pure).
fn owner_verdict(
    manifest: &ManifestFile,
    review: Option<&ContestReview>,
    ranking: &[String],
) -> OwnerVerdict {
    let by_key: BTreeMap<&str, (&Option<ContestReviewBucket>, &str)> = review
        .map(|r| {
            r.variants
                .iter()
                .map(|v| (v.key.as_str(), (&v.bucket, v.note.as_str())))
                .collect()
        })
        .unwrap_or_default();
    let mut entries = BTreeMap::new();
    for e in manifest.entries.values() {
        let variants = e
            .variants
            .iter()
            .filter(|v| v.present)
            .map(|v| {
                let key = format!("{}/{}", e.letter, v.n);
                let (bucket, note) = by_key.get(key.as_str()).copied().unwrap_or((&None, ""));
                OwnerVariant {
                    n: v.n,
                    broken: *bucket == Some(ContestReviewBucket::Failure),
                    strengths: note.trim().to_string(),
                    weaknesses: String::new(),
                }
            })
            .collect();
        entries.insert(e.letter.clone(), OwnerEntry { variants });
    }
    OwnerVerdict {
        judge: "owner".into(),
        entries,
        ranking: ranking.to_vec(),
        patterns: Vec::new(),
        anti_patterns: Vec::new(),
    }
}

fn ensure_owner_verdict(paths: &ArenaPaths, ranking: &[String]) -> Result<(), AppError> {
    if has_any_verdict(paths) {
        return Ok(());
    }
    let manifest: ManifestFile = arena::read_json_opt(&paths.manifest_json())?
        .ok_or_else(|| AppError::Validation("the contest has not been collected yet".into()))?;
    let review = review::read_review(paths);
    let v = owner_verdict(&manifest, review.as_ref(), ranking);
    arena::write_json(&paths.dir.join("runs").join("verdict-owner.json"), &v)
}

/// The note file `verdict --note` reads: the owner's note, or REVIEW.md when
/// the note is empty. A temp file is removed by the caller.
fn note_file(paths: &ArenaPaths, note: &str) -> Result<(PathBuf, bool), AppError> {
    if note.trim().is_empty() && paths.review_md().is_file() {
        return Ok((paths.review_md(), false));
    }
    let tmp = std::env::temp_dir().join(format!(
        "personas-contest-note-{}.md",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::write(&tmp, note.trim())
        .map_err(|e| AppError::Internal(format!("write {}: {e}", tmp.display())))?;
    Ok((tmp, true))
}

async fn run_verdict(
    ctx: &Ctx,
    instrument: &std::path::Path,
    extra: Vec<String>,
    note: &str,
) -> Result<(), AppError> {
    let (file, temp) = note_file(&ctx.paths, note)?;
    let mut args = ctx.id_args("verdict");
    args.extend(extra);
    args.extend(["--note".into(), file.to_string_lossy().into_owned()]);
    let res = node::run_node_checked(instrument, &args, ctx.root(), STEP_TIMEOUT).await;
    if temp {
        let _ = std::fs::remove_file(&file);
    }
    res.map(|_| ())
}

/// The Obsidian winner note (pure).
pub fn winner_note(
    title: &str,
    contest_id: &str,
    project: &str,
    key: &str,
    spec: &str,
    concept: &str,
    owner_note: &str,
) -> String {
    let mut s = format!(
        "---\ntype: contest_winner\ncontest: {contest_id}\nproject: {project}\n---\n\n# {title}\n\n\
         - **Winner:** {key}\n- **Seat:** {spec}\n- **Concept:** {concept}\n"
    );
    if !owner_note.trim().is_empty() {
        s.push_str("\n## The owner's note\n\n");
        s.push_str(owner_note.trim_end());
        s.push('\n');
    }
    s
}

fn push_winner_note(app: &AppHandle, ctx: &Ctx, note: &str) {
    let Ok(db) = driver::db_of(app) else { return };
    let Some(cfg) = crate::commands::obsidian_brain::mirror_vault_root(&db) else {
        tracing::info!(contest = %ctx.contest_id(), "contest: no Obsidian vault configured; winner note skipped");
        return;
    };
    let c = match driver::read_contest(&ctx.paths) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!(error = %e, "contest: winner note skipped, contest.json unreadable");
            return;
        }
    };
    let Some(w) = c.winner.as_ref() else { return };
    let content = winner_note(
        &c.title,
        ctx.contest_id(),
        &ctx.project_name,
        &w.label,
        &w.spec,
        &w.concept,
        note,
    );
    let rel = format!("Contests/{}.md", ctx.contest_id());
    let entity_id = format!("{}:{}", ctx.project_id, ctx.contest_id());
    if let Err(e) = crate::commands::obsidian_brain::mirror_write_note(
        &db,
        &cfg.vault_path,
        &rel,
        "contest",
        &entity_id,
        &content,
    ) {
        tracing::warn!(error = %e, "contest: winner note write failed");
    }
}

/// Delete every variant dir bucketed `failure`; returns how many went.
fn delete_failures(paths: &ArenaPaths, review: &ContestReview) -> Result<usize, AppError> {
    let blind: BTreeMap<String, String> =
        arena::read_json_opt(&paths.blind_map_json())?.unwrap_or_default();
    let mut deleted = 0;
    for v in &review.variants {
        if v.bucket != Some(ContestReviewBucket::Failure) {
            continue;
        }
        let Some((letter, n)) = parse_key(&v.key) else {
            continue;
        };
        let Some(seat) = blind.get(&letter.to_string()) else {
            continue;
        };
        arena::require_slug("seat id", seat)?;
        let dir = paths
            .dir
            .join("entries")
            .join(seat)
            .join(format!("variant-{n}"));
        if dir.is_dir() {
            std::fs::remove_dir_all(&dir)
                .map_err(|e| AppError::Internal(format!("delete {}: {e}", dir.display())))?;
            deleted += 1;
        }
    }
    Ok(deleted)
}

/// Returns the contest whose summary the caller should show: this one for a
/// winner, the child round for a shortlist.
pub async fn decide(
    app: &AppHandle,
    ctx: &Ctx,
    decision: ContestDecision,
) -> Result<Ctx, AppError> {
    let db = driver::db_of(app)?;
    let instrument = node::require_instrument(&db, ctx.root())?;
    match decision {
        ContestDecision::Winner {
            winner,
            runner_up,
            note,
        } => {
            let winner = require_key(&winner)?;
            let runner_up = runner_up
                .as_deref()
                .map(str::trim)
                .filter(|r| !r.is_empty())
                .map(require_key)
                .transpose()?;
            let mut ranking = vec![winner.clone()];
            ranking.extend(runner_up.clone());
            ensure_owner_verdict(&ctx.paths, &ranking)?;
            let mut extra = vec!["--winner".to_string(), winner];
            if let Some(r) = runner_up {
                extra.extend(["--runner-up".to_string(), r]);
            }
            run_verdict(ctx, &instrument, extra, &note).await?;
            push_winner_note(app, ctx, &note);
            driver::emit_changed(app, &ctx.project_id, ctx.contest_id());
            Ok(ctx.clone())
        }
        ContestDecision::Shortlist { keys, note } => {
            let keys = keys
                .iter()
                .map(|k| require_key(k))
                .collect::<Result<Vec<_>, _>>()?;
            personas_core::validation::require_at_least_one("shortlist", &keys)?;
            // The feedback the next round reads: the saved review, or the note.
            let saved = review::read_review(&ctx.paths);
            if let Some(r) = &saved {
                let failing: Vec<&str> = r
                    .variants
                    .iter()
                    .filter(|v| v.bucket == Some(ContestReviewBucket::Failure))
                    .map(|v| v.key.as_str())
                    .collect();
                if let Some(k) = keys.iter().find(|k| failing.contains(&k.as_str())) {
                    return Err(AppError::Validation(format!(
                        "`{k}` is bucketed as a failure and cannot be shortlisted"
                    )));
                }
                if delete_failures(&ctx.paths, r)? > 0 {
                    driver::collect(ctx, &instrument).await?;
                }
            }
            let feedback = saved.unwrap_or_else(|| ContestReview {
                field: note.clone(),
                variants: Vec::new(),
            });
            if !ctx.paths.review_md().is_file() {
                arena::write_text(
                    &ctx.paths.review_md(),
                    &review::render_review_markdown(&feedback),
                )?;
            }
            ensure_owner_verdict(&ctx.paths, &keys)?;
            run_verdict(
                ctx,
                &instrument,
                vec!["--shortlist".to_string(), keys.join(",")],
                &note,
            )
            .await?;
            let c = driver::read_contest(&ctx.paths)?;
            let round = c.round.unwrap_or(1) + 1;
            let mut args = ctx.id_args("refine");
            args.extend([
                "--shortlist".to_string(),
                keys.join(","),
                "--feedback".to_string(),
                ctx.paths.review_md().to_string_lossy().into_owned(),
                "--round".to_string(),
                round.to_string(),
            ]);
            node::run_node_checked(&instrument, &args, ctx.root(), STEP_TIMEOUT).await?;
            let child_id = format!("{}-r{round}", ctx.contest_id());
            let child = Ctx {
                project_id: ctx.project_id.clone(),
                project_name: ctx.project_name.clone(),
                paths: ArenaPaths::new(ctx.root(), &child_id)?,
            };
            let parent = arena::read_sidecar(&ctx.paths);
            driver::update_sidecar(&child.paths, |s| {
                s.judges_enabled = parent.judges_enabled;
                s.judges = parent.judges.clone();
                s.not_before_ms = parent.not_before_ms;
            })
            .await?;
            driver::emit_changed(app, &ctx.project_id, ctx.contest_id());
            driver::emit_changed(app, &child.project_id, &child_id);
            Ok(child)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::contest::arena::{ManifestEntry, ManifestVariant};
    use crate::commands::contest::types::ContestVariantReview;

    #[test]
    fn keys_parse_strictly() {
        assert_eq!(parse_key("A/2"), Some(('A', 2)));
        assert_eq!(parse_key(" C/10 "), Some(('C', 10)));
        assert_eq!(parse_key("a/2"), None);
        assert_eq!(parse_key("AB/2"), None);
        assert_eq!(parse_key("A/0"), None);
        assert_eq!(parse_key("A-2"), None);
    }

    #[test]
    fn the_owner_verdict_scores_nothing_and_marks_failures_broken() {
        let mut m = ManifestFile::default();
        m.entries.insert(
            "claude-opus_high".into(),
            ManifestEntry {
                letter: "A".into(),
                variants: vec![
                    ManifestVariant {
                        n: 1,
                        present: true,
                        ..ManifestVariant::default()
                    },
                    ManifestVariant {
                        n: 2,
                        present: false,
                        ..ManifestVariant::default()
                    },
                ],
            },
        );
        let r = ContestReview {
            field: String::new(),
            variants: vec![ContestVariantReview {
                key: "A/1".into(),
                bucket: Some(ContestReviewBucket::Failure),
                note: " blank page ".into(),
                pins: vec![],
            }],
        };
        let v = serde_json::to_value(owner_verdict(&m, Some(&r), &["A/1".to_string()])).unwrap();
        assert_eq!(v["judge"], "owner");
        let a = &v["entries"]["A"]["variants"];
        assert_eq!(
            a.as_array().unwrap().len(),
            1,
            "absent variants are not judged"
        );
        assert_eq!(a[0]["broken"], true);
        assert_eq!(a[0]["strengths"], "blank page");
        assert!(a[0].get("scores").is_none(), "the owner scored nothing");
        assert_eq!(v["ranking"][0], "A/1");
    }

    #[test]
    fn winner_note_carries_the_owner_note_verbatim() {
        let n = winner_note(
            "Home",
            "home",
            "personas",
            "B/2",
            "claude:opus@high",
            "Tide",
            "Keep it.\n  Really.",
        );
        assert!(n.contains("# Home"));
        assert!(n.contains("- **Winner:** B/2"));
        assert!(n.contains("- **Seat:** claude:opus@high"));
        assert!(n.contains("Keep it.\n  Really.\n"));
        assert!(!winner_note("t", "c", "p", "A/1", "s", "x", "  ").contains("owner's note"));
    }
}
