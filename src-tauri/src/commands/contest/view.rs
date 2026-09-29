//! Projections for the page: every contest as a summary, one contest in full.

use std::collections::BTreeMap;
use std::path::Path;

use super::arena::{
    self, judge_seat_key, parse_seat_spec, spec_struct, ArenaPaths, ContestFile, ManifestFile,
    ScoreboardFile, SeatLive, Sidecar,
};
use super::driver::{self, Ctx};
use super::preview;
use super::review;
use super::types::{
    ContestDetail, ContestJudgesLead, ContestLedgerVariant, ContestReview, ContestReviewBucket,
    ContestScoreboard, ContestSeat, ContestSeatKind, ContestSeatState, ContestSummary,
    ContestVariant,
};
use crate::db::models::DevProject;
use crate::db::DbPool;
use crate::error::AppError;

/// What one read of an arena yields: everything the ledger row and the full
/// detail are both built from, so a `contest_get` reads each file once.
struct ArenaRead {
    live: BTreeMap<String, SeatLive>,
    participants: Vec<ContestSeat>,
    variants: Vec<ContestVariant>,
    scoreboard: Option<ContestScoreboard>,
    review: Option<ContestReview>,
}

fn read_arena(ctx: &Ctx, c: &ContestFile, s: &Sidecar) -> ArenaRead {
    let paths = &ctx.paths;
    let live = driver::live_by_key(s);
    let blind: BTreeMap<String, String> = arena::read_json_opt(&paths.blind_map_json())
        .ok()
        .flatten()
        .unwrap_or_default();
    let letter_of: BTreeMap<String, String> = blind
        .iter()
        .map(|(letter, id)| (id.clone(), letter.clone()))
        .collect();
    let participants = c
        .participants
        .iter()
        .map(|p| {
            seat_view(
                paths,
                s,
                &live,
                &p.id,
                &p.spec,
                ContestSeatKind::Participant,
                letter_of.get(&p.id).cloned(),
            )
        })
        .collect();
    let variants = read_variants(paths, &ctx.project_id, ctx.contest_id());
    let scoreboard = match arena::read_json_opt::<ScoreboardFile>(&paths.scoreboard_json()) {
        Ok(sb) => sb.map(arena::project_scoreboard),
        Err(e) => {
            tracing::warn!(error = %e, "contest: scoreboard.json unreadable");
            None
        }
    };
    ArenaRead {
        live,
        participants,
        variants,
        scoreboard,
        review: review::read_review(paths),
    }
}

fn summary_of(ctx: &Ctx, c: &ContestFile, s: &Sidecar, read: &ArenaRead) -> ContestSummary {
    let by_sid: BTreeMap<String, SeatLive> = s
        .seat_sessions
        .iter()
        .filter_map(|(k, sid)| read.live.get(k).map(|l| (sid.clone(), *l)))
        .collect();
    let mut summary = arena::build_summary(
        &ctx.project_id,
        &ctx.project_name,
        &ctx.paths,
        c,
        s,
        &|sid| by_sid.get(sid).copied(),
    );
    summary.ledger.seats = read.participants.clone();
    summary.ledger.variants = read
        .variants
        .iter()
        .map(|v| ledger_variant(v, read.review.as_ref()))
        .collect();
    summary.ledger.judges_lead = read.scoreboard.as_ref().and_then(judges_lead);
    summary
}

fn ledger_variant(v: &ContestVariant, review: Option<&ContestReview>) -> ContestLedgerVariant {
    ContestLedgerVariant {
        key: v.key.clone(),
        seat_id: v.seat_id.clone(),
        n: v.n,
        present: v.present,
        title: v.title.clone(),
        concept: v.concept.clone(),
        still: pick_still(&v.screenshots).cloned(),
        bucket: review_bucket(review, &v.key),
    }
}

fn review_bucket(review: Option<&ContestReview>, key: &str) -> Option<ContestReviewBucket> {
    review?.variants.iter().find(|r| r.key == key)?.bucket
}

/// The screenshot a small still shows: the visual pass's load shot (the
/// page as it first paints, before any probe clicked it), else the first.
fn pick_still(shots: &[String]) -> Option<&String> {
    shots
        .iter()
        .find(|u| u.to_ascii_lowercase().ends_with("-load.png"))
        .or_else(|| shots.first())
}

/// The highest-scoring variant no judge marked broken.
fn judges_lead(sb: &ContestScoreboard) -> Option<ContestJudgesLead> {
    sb.rows
        .iter()
        .filter(|r| !r.broken)
        .filter_map(|r| r.mean.map(|m| (r, m)))
        .max_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(r, mean)| ContestJudgesLead {
            key: r.key.clone(),
            mean,
        })
}

/// Every contest across every managed dev project, newest first. A malformed
/// arena is skipped with a warning.
pub fn list(db: &DbPool) -> Result<Vec<ContestSummary>, AppError> {
    let projects: Vec<DevProject> = crate::db::repos::dev_tools::list_projects(db, None)?;
    let mut out = Vec::new();
    for p in &projects {
        for contest_id in arena::list_contest_ids(Path::new(&p.root_path)) {
            let ctx = match driver::ctx_for_project(p, &contest_id) {
                Ok(c) => c,
                Err(_) => continue,
            };
            match driver::read_contest(&ctx.paths) {
                Ok(c) => {
                    let s = arena::read_sidecar(&ctx.paths);
                    let read = read_arena(&ctx, &c, &s);
                    out.push(summary_of(&ctx, &c, &s, &read));
                }
                Err(e) => {
                    tracing::warn!(project = %p.name, contest = %contest_id, error = %e,
                        "contest: skipping a malformed arena");
                }
            }
        }
    }
    out.sort_by(|a, b| {
        b.updated_at_ms
            .cmp(&a.updated_at_ms)
            .then_with(|| a.contest_id.cmp(&b.contest_id))
    });
    Ok(out)
}

pub fn summary(
    db: &DbPool,
    project_id: &str,
    contest_id: &str,
) -> Result<ContestSummary, AppError> {
    let ctx = driver::ctx(db, project_id, contest_id)?;
    let c = driver::read_contest(&ctx.paths)?;
    let s = arena::read_sidecar(&ctx.paths);
    let read = read_arena(&ctx, &c, &s);
    Ok(summary_of(&ctx, &c, &s, &read))
}

fn state_of_outcome(outcome: &str) -> ContestSeatState {
    match outcome {
        "completed" => ContestSeatState::Completed,
        "seat-limit" => ContestSeatState::SeatLimit,
        "timed-out" => ContestSeatState::TimedOut,
        "errored" => ContestSeatState::Errored,
        _ => ContestSeatState::Idle,
    }
}

fn seat_view(
    paths: &ArenaPaths,
    s: &Sidecar,
    live: &BTreeMap<String, SeatLive>,
    key: &str,
    spec: &str,
    kind: ContestSeatKind,
    letter: Option<String>,
) -> ContestSeat {
    let rec = driver::read_record(paths, key);
    let sid = s.seat_sessions.get(key).cloned();
    let recorded = sid.is_some() && s.recorded_sessions.get(key) == sid.as_ref();
    let from_record = || {
        rec.as_ref()
            .map(|r| state_of_outcome(&r.outcome))
            .unwrap_or(ContestSeatState::Idle)
    };
    let state = match (&sid, live.get(key)) {
        (Some(_), _) if recorded => from_record(),
        (Some(_), Some(SeatLive::Queued)) => ContestSeatState::Queued,
        (Some(_), Some(SeatLive::Running)) => ContestSeatState::Running,
        // Settled but not yet recorded: the watcher is writing it now.
        (Some(id), Some(SeatLive::Settled)) if driver::is_watched(id) => ContestSeatState::Running,
        _ => from_record(),
    };
    // The record's numbers describe the run it came from; a newer live run
    // has none yet.
    let show_record = matches!(
        state,
        ContestSeatState::Completed
            | ContestSeatState::SeatLimit
            | ContestSeatState::TimedOut
            | ContestSeatState::Errored
    );
    let r = rec.filter(|_| show_record);
    ContestSeat {
        seat_id: key.to_string(),
        spec: spec.to_string(),
        kind,
        state,
        fleet_session_id: sid,
        letter,
        wall_s: r.as_ref().and_then(|r| r.wall_s),
        cost_usd: r.as_ref().and_then(|r| r.cost_usd),
        turns: r.as_ref().and_then(|r| r.turns),
        errors: r.map(|r| r.errors).unwrap_or_default(),
        started_at_ms: s.seat_started_ms.get(key).copied(),
    }
}

/// Every screenshot of the visual pass (`runs/visual/*.png`), sorted. Read
/// ONCE per `contest_get`, then split per variant by [`pick_screenshots`].
fn visual_pngs(paths: &ArenaPaths) -> Vec<String> {
    let Ok(rd) = std::fs::read_dir(paths.visual_dir()) else {
        return Vec::new();
    };
    let mut names: Vec<String> = rd
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|name| name.to_ascii_lowercase().ends_with(".png"))
        .collect();
    names.sort();
    names
}

/// One variant's screenshots (`<tag>-<n>-*.png`, the tag being the blind
/// letter or the seat id), in the listing's order.
fn pick_screenshots(pngs: &[String], letter: &str, seat_id: &str, n: u32) -> Vec<String> {
    let prefixes = [format!("{letter}-{n}-"), format!("{seat_id}-{n}-")];
    pngs.iter()
        .filter(|name| prefixes.iter().any(|p| name.starts_with(p.as_str())))
        .cloned()
        .collect()
}

/// Every collected variant, from `manifest.json`, with its preview URL and
/// the visual pass's screenshots.
fn read_variants(paths: &ArenaPaths, project_id: &str, contest_id: &str) -> Vec<ContestVariant> {
    let manifest: Option<ManifestFile> = match arena::read_json_opt(&paths.manifest_json()) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "contest: manifest.json unreadable");
            None
        }
    };
    let mut variants = Vec::new();
    let pngs = visual_pngs(paths);
    if let Some(m) = manifest {
        for (seat_id, entry) in &m.entries {
            if !arena::is_safe_slug(seat_id) {
                continue;
            }
            for v in &entry.variants {
                let rel = format!("entries/{seat_id}/variant-{}/index.html", v.n);
                let present = paths.dir.join(&rel).is_file();
                variants.push(ContestVariant {
                    key: format!("{}/{}", entry.letter, v.n),
                    letter: entry.letter.clone(),
                    seat_id: seat_id.clone(),
                    n: v.n,
                    present,
                    title: v.title.clone(),
                    concept: v.concept.clone().unwrap_or_default(),
                    bytes: v.bytes,
                    has_notes: v.notes,
                    preview_url: if present {
                        preview::preview_url(project_id, contest_id, &rel)
                    } else {
                        None
                    },
                    screenshots: pick_screenshots(&pngs, &entry.letter, seat_id, v.n)
                        .into_iter()
                        .filter_map(|name| {
                            preview::preview_url(
                                project_id,
                                contest_id,
                                &format!("runs/visual/{name}"),
                            )
                        })
                        .collect(),
                });
            }
        }
    }
    variants.sort_by(|a, b| a.letter.cmp(&b.letter).then(a.n.cmp(&b.n)));
    variants
}

pub fn detail(db: &DbPool, project_id: &str, contest_id: &str) -> Result<ContestDetail, AppError> {
    let ctx = driver::ctx(db, project_id, contest_id)?;
    let paths = &ctx.paths;
    let c = driver::read_contest(paths)?;
    let s = arena::read_sidecar(paths);
    let read = read_arena(&ctx, &c, &s);
    let summary = summary_of(&ctx, &c, &s, &read);
    let ArenaRead {
        live,
        participants,
        variants,
        scoreboard,
        review,
    } = read;

    let mut seats = participants;
    // Judges: those contest.json recorded (planned) plus those configured.
    let mut judge_specs: Vec<String> = Vec::new();
    for spec in c.judges.iter().chain(s.judges.iter()) {
        if let Ok(p) = parse_seat_spec(spec) {
            if !judge_specs.contains(&p.spec) {
                judge_specs.push(p.spec);
            }
        }
    }
    for spec in &judge_specs {
        if let Ok(p) = parse_seat_spec(spec) {
            let key = judge_seat_key(&p.id);
            seats.push(seat_view(
                paths,
                &s,
                &live,
                &key,
                &p.spec,
                ContestSeatKind::Judge,
                None,
            ));
        }
    }
    let brief = std::fs::read_to_string(paths.brief_md()).unwrap_or_default();

    Ok(ContestDetail {
        summary,
        brief,
        arena_path: paths.dir.to_string_lossy().into_owned(),
        timeout_min: c.timeout_min,
        judges_enabled: s.judges_enabled,
        judges: s
            .judges
            .iter()
            .filter_map(|j| parse_seat_spec(j).ok())
            .map(|p| spec_struct(&p))
            .collect(),
        not_before_ms: s.not_before_ms,
        seats,
        variants,
        scoreboard,
        review,
        chain: s.chain_view(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The old per-variant scan (one read_dir per variant), kept as the oracle.
    fn screenshots_per_variant(
        paths: &ArenaPaths,
        letter: &str,
        seat_id: &str,
        n: u32,
    ) -> Vec<String> {
        let Ok(rd) = std::fs::read_dir(paths.visual_dir()) else {
            return Vec::new();
        };
        let prefixes = [format!("{letter}-{n}-"), format!("{seat_id}-{n}-")];
        let mut names: Vec<String> = rd
            .flatten()
            .filter_map(|e| e.file_name().to_str().map(str::to_string))
            .filter(|name| {
                name.to_ascii_lowercase().ends_with(".png")
                    && prefixes.iter().any(|p| name.starts_with(p.as_str()))
            })
            .collect();
        names.sort();
        names
    }

    #[test]
    fn a_ledger_still_is_the_load_shot_else_the_first() {
        let shots = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
        let probe_first = shots(&["A-1-1280x800-descend.png", "A-1-1280x800-load.png"]);
        assert_eq!(
            pick_still(&probe_first).map(String::as_str),
            Some("A-1-1280x800-load.png")
        );
        let plain = shots(&["A-1-1280.png", "A-1-1920.png"]);
        assert_eq!(pick_still(&plain).map(String::as_str), Some("A-1-1280.png"));
        assert_eq!(pick_still(&[]), None);
    }

    fn row(key: &str, mean: Option<f64>, broken: bool) -> super::super::types::ContestScoreRow {
        super::super::types::ContestScoreRow {
            key: key.into(),
            mean,
            spread: None,
            broken,
            dims: BTreeMap::new(),
        }
    }

    #[test]
    fn the_judges_lead_is_the_best_intact_variant() {
        let sb = ContestScoreboard {
            judges: vec!["j".into()],
            rows: vec![
                row("A/1", Some(9.1), true),
                row("A/2", Some(7.4), false),
                row("B/1", Some(8.2), false),
                row("B/2", None, false),
            ],
        };
        let lead = judges_lead(&sb).unwrap();
        assert_eq!((lead.key.as_str(), lead.mean), ("B/1", 8.2));
        let all_broken = ContestScoreboard {
            judges: vec![],
            rows: vec![row("A/1", Some(9.0), true)],
        };
        assert!(judges_lead(&all_broken).is_none());
    }

    #[test]
    fn a_ledger_variant_carries_the_owners_tray() {
        use super::super::types::ContestVariantReview;
        let review = ContestReview {
            field: String::new(),
            variants: vec![ContestVariantReview {
                key: "B/2".into(),
                bucket: Some(ContestReviewBucket::Shortlist),
                note: String::new(),
                pins: vec![],
            }],
        };
        assert_eq!(
            review_bucket(Some(&review), "B/2"),
            Some(ContestReviewBucket::Shortlist)
        );
        assert_eq!(review_bucket(Some(&review), "A/1"), None);
        assert_eq!(review_bucket(None, "B/2"), None);
    }

    #[test]
    fn one_listing_splits_into_the_same_screenshots_per_variant() {
        let tmp = tempfile::tempdir().unwrap();
        let paths = ArenaPaths::new(tmp.path(), "c").unwrap();
        std::fs::create_dir_all(paths.visual_dir()).unwrap();
        for name in [
            "A-1-desktop.png",
            "A-1-mobile.PNG",
            "A-10-desktop.png",
            "A-2-desktop.png",
            "claude-opus_high-1-wide.png",
            "B-1-desktop.png",
            "A-1-notes.txt",
            "A-1.png",
        ] {
            std::fs::write(paths.visual_dir().join(name), b"x").unwrap();
        }
        let pngs = visual_pngs(&paths);
        for (letter, seat, n) in [
            ("A", "claude-opus_high", 1),
            ("A", "claude-opus_high", 2),
            ("A", "claude-opus_high", 10),
            ("B", "grok-grok-4.6_low", 1),
            ("C", "nobody", 3),
        ] {
            assert_eq!(
                pick_screenshots(&pngs, letter, seat, n),
                screenshots_per_variant(&paths, letter, seat, n),
                "{letter}/{n}"
            );
        }
        assert_eq!(
            pick_screenshots(&pngs, "A", "claude-opus_high", 1),
            vec![
                "A-1-desktop.png",
                "A-1-mobile.PNG",
                "claude-opus_high-1-wide.png"
            ]
        );
        // No visual dir at all: nothing, as before.
        let bare = ArenaPaths::new(tmp.path(), "other").unwrap();
        assert!(visual_pngs(&bare).is_empty());
    }
}
