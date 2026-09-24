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
    ContestDetail, ContestSeat, ContestSeatKind, ContestSeatState, ContestSummary, ContestVariant,
};
use crate::db::models::DevProject;
use crate::db::DbPool;
use crate::error::AppError;

fn summary_of(ctx: &Ctx, c: &ContestFile, s: &Sidecar) -> ContestSummary {
    let live = driver::live_by_key(s);
    let by_sid: BTreeMap<String, SeatLive> = s
        .seat_sessions
        .iter()
        .filter_map(|(k, sid)| live.get(k).map(|l| (sid.clone(), *l)))
        .collect();
    arena::build_summary(
        &ctx.project_id,
        &ctx.project_name,
        &ctx.paths,
        c,
        s,
        &|sid| by_sid.get(sid).copied(),
    )
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
                    out.push(summary_of(&ctx, &c, &s));
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
    Ok(summary_of(&ctx, &c, &s))
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

/// Screenshot files of the visual pass for one variant (`<tag>-<n>-*.png`,
/// the tag being the blind letter or the seat id).
fn screenshots(paths: &ArenaPaths, letter: &str, seat_id: &str, n: u32) -> Vec<String> {
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

pub fn detail(db: &DbPool, project_id: &str, contest_id: &str) -> Result<ContestDetail, AppError> {
    let ctx = driver::ctx(db, project_id, contest_id)?;
    let paths = &ctx.paths;
    let c = driver::read_contest(paths)?;
    let s = arena::read_sidecar(paths);
    let live = driver::live_by_key(&s);
    let summary = summary_of(&ctx, &c, &s);

    let blind: BTreeMap<String, String> = arena::read_json_opt(&paths.blind_map_json())
        .ok()
        .flatten()
        .unwrap_or_default();
    let letter_of: BTreeMap<String, String> = blind
        .iter()
        .map(|(letter, id)| (id.clone(), letter.clone()))
        .collect();

    let mut seats: Vec<ContestSeat> = c
        .participants
        .iter()
        .map(|p| {
            seat_view(
                paths,
                &s,
                &live,
                &p.id,
                &p.spec,
                ContestSeatKind::Participant,
                letter_of.get(&p.id).cloned(),
            )
        })
        .collect();
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
    let manifest: Option<ManifestFile> = match arena::read_json_opt(&paths.manifest_json()) {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = %e, "contest: manifest.json unreadable");
            None
        }
    };
    let mut variants = Vec::new();
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
                    screenshots: screenshots(paths, &entry.letter, seat_id, v.n)
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

    let scoreboard = match arena::read_json_opt::<ScoreboardFile>(&paths.scoreboard_json()) {
        Ok(sb) => sb.map(arena::project_scoreboard),
        Err(e) => {
            tracing::warn!(error = %e, "contest: scoreboard.json unreadable");
            None
        }
    };
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
        review: review::read_review(paths),
        chain: s.chain_view(),
    })
}
