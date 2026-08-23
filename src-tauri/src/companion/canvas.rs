//! Athena's read of the Mastermind canvas (WP2, 2026-08-04).
//!
//! # Why a published snapshot rather than a Rust re-derive
//!
//! The canvas scene is derived ENTIRELY on the frontend: an App Readiness
//! Passport per project (`sub_factory/passport/passportDerive.ts`) folded
//! through fifteen dimension `derive()` closures
//! (`sub_mastermind/lib/dimRegistry.ts`), plus five independently-fetched data
//! families whose per-family load STATUS is itself part of the picture (a cell
//! reads `unknown` when its family failed, which is not the same fact as
//! `absent`). None of that exists in SQLite: `dev_tools_generate_cross_project_metadata`
//! stores keywords, contexts and tech layers, not readiness levels.
//!
//! Re-deriving it here would be a second implementation of a fifteen-branch
//! rule set that changes every time a dimension is added, and it could never
//! report the one thing the digest most needs to be honest about: which data
//! family failed to load in the client. `DevProjectWallSummary` already wrote
//! this doctrine down ("a third implementation here would be a third thing to
//! keep in sync"). So the canvas PUBLISHES a compact snapshot of what it
//! derived into the app settings store, and everything here READS it.
//!
//! The contract is [`MASTERMIND_SCENE`](crate::db::settings_keys::MASTERMIND_SCENE)
//! (`mastermind.scene.v1`), documented on [`CanvasScene`] below. Until the
//! canvas has been opened at least once the key is absent, and every surface
//! here says so plainly instead of inventing a scene.

use serde::Deserialize;

use crate::db::DbPool;

/// The dimension keys, in `DIM_ORDER` (see `sub_mastermind/lib/dimRegistry.ts`).
/// Used only to report how many of the fifteen a snapshot actually carried, so
/// a truncated publish reads as truncated.
pub(crate) const DIM_COUNT: usize = 15;

/// Dimension statuses that mean "this cell is not fine". The digest lists only
/// these: a triage surface prints what is wrong, not what is right.
const UNHEALTHY: &[&str] = &["alert", "risk", "unknown", "absent"];

/// Statuses that are actively bad (as opposed to merely missing or unknown).
/// Drives the worst-first ordering.
const ALERTING: &[&str] = &["alert"];

/// Slug prefix of the six built-in demo islands the canvas renders when no
/// projects are registered. They have no passport, no root path and no
/// project row, so every action against one resolves to null. Every action
/// path here refuses them by name.
pub(crate) const DEMO_SLUG_PREFIX: &str = "demo-";

/// True for the canvas's built-in demo islands.
pub(crate) fn is_demo_slug(slug: &str) -> bool {
    slug.trim()
        .to_ascii_lowercase()
        .starts_with(DEMO_SLUG_PREFIX)
}

/// The refusal text every action path shares, so the reason a demo island is
/// not dispatchable is stated once.
pub(crate) fn demo_refusal(slug: &str) -> String {
    format!(
        "`{slug}` is one of the canvas demo islands, not a registered project. \
         The canvas shows six placeholder islands when no projects exist yet; \
         they have no repository, no passport and no data, so there is nothing \
         to dispatch into. Ask the user to register a real project in Dev Tools \
         first, or name one that already exists."
    )
}

// ─────────────────────────────────────────────────────────────────────────
// The published snapshot (`mastermind.scene.v1`)
// ─────────────────────────────────────────────────────────────────────────

/// One dimension cell as the canvas derived it.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CanvasDim {
    /// Registry key (`tests`, `ci`, `ideas`, ...).
    pub key: String,
    /// Human label (`Tests`). Falls back to `key` when absent.
    pub label: String,
    /// `absent` | `solid` | `partial` | `risk` | `alert` | `unknown`.
    pub status: String,
    /// The cell's concrete detail string (tool name, coverage, day count).
    pub detail: Option<String>,
}

impl CanvasDim {
    fn label(&self) -> &str {
        if self.label.trim().is_empty() {
            &self.key
        } else {
            &self.label
        }
    }

    fn is_unhealthy(&self) -> bool {
        UNHEALTHY.contains(&self.status.as_str())
    }

    fn is_alerting(&self) -> bool {
        ALERTING.contains(&self.status.as_str())
    }

    /// `Tests risk (41% cov)` — one cell, one clause.
    fn cell(&self) -> String {
        match self
            .detail
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            Some(d) => format!("{} {} ({})", self.label(), self.status, d),
            None => format!("{} {}", self.label(), self.status),
        }
    }
}

/// Ship-milestone chip.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CanvasShip {
    pub next: Option<String>,
    pub shipped: i64,
    pub total: i64,
    pub late: bool,
}

/// One island.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CanvasProject {
    /// Island slug. For a real project this IS the `dev_projects.id`.
    pub slug: String,
    pub name: String,
    /// `healthy` | `building` | `warning` | `critical`.
    pub state: String,
    /// Live "needs you" marker (a fleet session awaiting input or gone stale).
    pub attention: bool,
    /// Passport blockers (automation + production readiness).
    pub blockers: i64,
    /// Open fleet CLI sessions docked to this island.
    pub fleet: i64,
    /// Personas with an execution in progress for this project's team.
    pub personas_running: i64,
    /// Live unresolved-issue count, or None when no monitoring credential is
    /// bound (honestly unknown, never a fake zero).
    pub monitor_errors: Option<i64>,
    /// Whole days since the last idea scan; None = never scanned.
    pub ideas_days: Option<i64>,
    pub goals_ongoing: Option<i64>,
    pub kpi_total: Option<i64>,
    pub kpi_off: Option<i64>,
    pub ship: Option<CanvasShip>,
    /// All fifteen dimension cells (the canvas publishes the full set; the
    /// digest filters, the read op prints them all).
    pub dims: Vec<CanvasDim>,
}

impl CanvasProject {
    fn state_rank(&self) -> u8 {
        match self.state.as_str() {
            "critical" => 3,
            "warning" => 2,
            "building" => 1,
            _ => 0,
        }
    }

    fn alerting(&self) -> usize {
        self.dims.iter().filter(|d| d.is_alerting()).count()
    }

    fn unhealthy(&self) -> Vec<&CanvasDim> {
        self.dims.iter().filter(|d| d.is_unhealthy()).collect()
    }

    /// The not-fine cells as printable clauses (`Tests risk (41% cov)`).
    /// This is what the prompt digest lists: a triage surface prints what is
    /// wrong, and a healthy cell costs budget without informing a decision.
    pub(crate) fn unhealthy_cells(&self) -> Vec<String> {
        self.unhealthy().iter().map(|d| d.cell()).collect()
    }

    /// **The triage sort key.** The canvas digest is a "what needs me first"
    /// surface, not a directory, so the order is worst-first and NOT
    /// alphabetical. Descending on, in order:
    ///
    /// 1. `attention` — a live session is blocked on the user right now.
    /// 2. island state (critical > warning > building > healthy).
    /// 3. alerting dimension count (cells that are actively red).
    /// 4. passport blockers.
    /// 5. total unhealthy cells (risk / unknown / absent).
    ///
    /// The slug breaks ties ASCENDING so the block is stable between turns:
    /// a digest that reshuffles equal-priority rows every turn reads as
    /// change when nothing changed.
    fn triage_key(&self) -> (bool, u8, usize, i64, usize) {
        (
            self.attention,
            self.state_rank(),
            self.alerting(),
            self.blockers,
            self.unhealthy().len(),
        )
    }
}

/// The published canvas snapshot.
///
/// # Contract for the publisher (`sub_mastermind`)
///
/// Write this JSON to the `mastermind.scene.v1` app setting whenever the scene
/// finishes deriving. Shape (camelCase; every field optional except `slug`):
///
/// ```json
/// {
///   "version": 1,
///   "publishedAt": "2026-08-04T10:11:12Z",
///   "demo": false,
///   "families": { "relations": "loaded", "scans": "failed", "sentry": "stale",
///                 "goals": "loaded", "llmSpend": "loaded", "kpi": "loaded",
///                 "passports": "loaded" },
///   "projects": [{
///     "slug": "<dev_projects.id>", "name": "Personas", "state": "warning",
///     "attention": true, "blockers": 3, "fleet": 2, "personasRunning": 1,
///     "monitorErrors": 7, "ideasDays": 42, "goalsOngoing": 3,
///     "kpiTotal": 6, "kpiOff": 2,
///     "ship": { "next": "M3", "shipped": 1, "total": 4, "late": true },
///     "dims": [{ "key": "tests", "label": "Tests", "status": "risk",
///                "detail": "41% cov" }]
///   }]
/// }
/// ```
///
/// Unknown fields are ignored and missing ones default, so the publisher may
/// grow the shape without a coordinated Rust release.
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct CanvasScene {
    pub version: i64,
    /// RFC3339 timestamp of the publish. Drives the staleness note.
    pub published_at: Option<String>,
    /// True when the canvas is rendering its six placeholder islands.
    pub demo: bool,
    /// Per-family fetch status (`idle` | `loading` | `loaded` | `failed` |
    /// `stale`). Global, not per project: the scene store fetches each family
    /// once for the whole canvas.
    pub families: std::collections::BTreeMap<String, String>,
    pub projects: Vec<CanvasProject>,
}

impl CanvasScene {
    /// Families that are not currently trustworthy, as `name (status)` clauses.
    fn degraded_families(&self) -> Vec<String> {
        self.families
            .iter()
            .filter(|(_, v)| v.as_str() == "failed" || v.as_str() == "stale")
            .map(|(k, v)| format!("{k} ({v})"))
            .collect()
    }

    /// Projects in worst-first triage order (see [`CanvasProject::triage_key`]).
    pub(crate) fn triaged(&self) -> Vec<&CanvasProject> {
        let mut out: Vec<&CanvasProject> = self.projects.iter().collect();
        out.sort_by(|a, b| {
            b.triage_key()
                .cmp(&a.triage_key())
                .then_with(|| a.slug.cmp(&b.slug))
        });
        out
    }

    fn find(&self, query: &str) -> Option<&CanvasProject> {
        let q = query.trim().to_ascii_lowercase();
        self.projects
            .iter()
            .find(|p| p.slug.to_ascii_lowercase() == q)
            .or_else(|| {
                self.projects
                    .iter()
                    .find(|p| p.name.to_ascii_lowercase() == q)
            })
            .or_else(|| {
                self.projects
                    .iter()
                    .find(|p| p.name.to_ascii_lowercase().contains(&q))
            })
    }

    /// Slugs offered when a lookup misses, so the next attempt is grounded.
    fn slug_suggestions(&self, max: usize) -> String {
        let names: Vec<String> = self
            .triaged()
            .iter()
            .take(max)
            .map(|p| format!("`{}`", p.slug))
            .collect();
        if names.is_empty() {
            "none (the canvas has no projects)".to_string()
        } else {
            names.join(", ")
        }
    }
}

/// Read the published snapshot. `None` when the canvas has never been opened,
/// the row is unreadable, or the document is not v1.
pub(crate) fn load_scene(sys_db: &DbPool) -> Option<CanvasScene> {
    let raw =
        crate::db::repos::core::settings::get(sys_db, crate::db::settings_keys::MASTERMIND_SCENE)
            .ok()
            .flatten()?;
    match serde_json::from_str::<CanvasScene>(&raw) {
        Ok(scene) if scene.version == 1 => Some(scene),
        Ok(scene) => {
            tracing::warn!(
                version = scene.version,
                "companion::canvas: ignoring a mastermind scene snapshot of an unknown version"
            );
            None
        }
        Err(e) => {
            tracing::warn!(error = %e, "companion::canvas: mastermind scene snapshot is unparseable");
            None
        }
    }
}

/// Whole hours since `published_at`, when it parses.
fn published_age_hours(scene: &CanvasScene) -> Option<i64> {
    let raw = scene.published_at.as_deref()?;
    let then = chrono::DateTime::parse_from_rfc3339(raw).ok()?;
    Some(
        (chrono::Utc::now() - then.with_timezone(&chrono::Utc))
            .num_hours()
            .max(0),
    )
}

/// One-clause freshness note for a footer.
pub(crate) fn freshness_note(scene: &CanvasScene) -> String {
    match published_age_hours(scene) {
        None => "publish time unknown".to_string(),
        Some(0) => "published within the hour".to_string(),
        Some(1) => "published 1 hour ago".to_string(),
        Some(h) => format!("published {h} hours ago"),
    }
}

/// The footer sentence every canvas surface shares: how fresh the snapshot is,
/// which families are degraded, and what to do about a demo scene.
pub(crate) fn scene_caveats(scene: &CanvasScene) -> String {
    let mut out = freshness_note(scene);
    let degraded = scene.degraded_families();
    if !degraded.is_empty() {
        out.push_str(&format!(
            ". Data families not currently trustworthy: {}. Cells fed by them \
             may read `unknown`; say so rather than reporting a gap as fact",
            degraded.join(", ")
        ));
    }
    if scene.demo {
        out.push_str(
            ". This is the DEMO scene (no projects are registered), so every \
             island is a placeholder and nothing on it is dispatchable",
        );
    }
    out
}

/// The line every surface prints when no snapshot exists.
pub(crate) fn no_scene_line() -> &'static str {
    "The Mastermind canvas has not published a scene yet (it publishes when the \
     user opens Teams then Mastermind). Say that you cannot see the canvas right \
     now rather than describing one."
}

// ─────────────────────────────────────────────────────────────────────────
// Read ops (auto-fire, bounded, no executor) — see dispatcher::READ_OPS
// ─────────────────────────────────────────────────────────────────────────

/// Suggestions offered on a miss.
const SLUG_SUGGESTIONS: usize = 6;
/// Longest single dimension clause in a per-project answer.
const DETAIL_CELL_MAX: usize = 60;
/// Characters the fifteen cells may occupy together, leaving room under the
/// dispatcher's `READ_OP_DETAIL_CHARS` for the header lines and the footer.
const PROJECT_CELLS_CHARS: usize = 900;

/// Truncate on a char boundary with an ellipsis.
fn index_clip(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    format!(
        "{}\u{2026}",
        crate::utils::text::truncate_on_char_boundary(s, max)
    )
}

/// Full dimension detail for ONE island: all fifteen cells with their status
/// and detail string, plus the live counters the digest only summarises.
pub(crate) fn describe_canvas_project(sys_db: &DbPool, query: &str) -> String {
    let Some(scene) = load_scene(sys_db) else {
        return no_scene_line().to_string();
    };
    if is_demo_slug(query) {
        return demo_refusal(query);
    }
    let Some(p) = scene.find(query) else {
        return format!(
            "No project matches `{query}` on the canvas. Existing slugs include: {}. \
             Ask the user which they meant; do not invent a slug.",
            scene.slug_suggestions(SLUG_SUGGESTIONS)
        );
    };

    // Bounded like every other read op: fifteen cells with long tool strings
    // would otherwise sail past the dispatcher's own clip, which would take
    // the caveats footer with it. Budget the cells, then SAY how many made it.
    let mut cells: Vec<String> = Vec::new();
    let mut used = 0usize;
    for d in &p.dims {
        let cell = index_clip(&d.cell(), DETAIL_CELL_MAX);
        if used + cell.len() > PROJECT_CELLS_CHARS {
            break;
        }
        used += cell.len();
        cells.push(cell);
    }
    let shown_cells = cells.len();
    if cells.is_empty() {
        cells.push("no dimension cells published".to_string());
    }
    let monitoring = match p.monitor_errors {
        Some(n) => format!("{n} open issues"),
        None => "no monitoring credential bound".to_string(),
    };
    let ship = match &p.ship {
        Some(s) => format!(
            "{} of {} milestones shipped{}{}",
            s.shipped,
            s.total,
            s.next
                .as_deref()
                .map(|n| format!(", next is {n}"))
                .unwrap_or_default(),
            if s.late { ", forecast LATE" } else { "" },
        ),
        None => "no milestones planned".to_string(),
    };
    format!(
        "**{name}** `{slug}`\n\
         - state: {state}{attention}\n\
         - blockers: {blockers} · live fleet sessions: {fleet} · personas running: {running}\n\
         - monitoring: {monitoring}\n\
         - ship: {ship}\n\
         - dimensions ({shown} of {dim_count}): {cells}\n\
         \n_{caveats}._",
        name = p.name,
        slug = p.slug,
        state = p.state,
        attention = if p.attention {
            " (NEEDS THE USER: a session is awaiting input or has gone stale)"
        } else {
            ""
        },
        blockers = p.blockers,
        fleet = p.fleet,
        running = p.personas_running,
        monitoring = monitoring,
        ship = ship,
        shown = shown_cells,
        dim_count = DIM_COUNT,
        cells = cells.join(" · "),
        caveats = scene_caveats(&scene),
    )
}

/// Freshness and rollup detail: idea-scan age, ongoing goals, KPI standing.
/// An empty query answers for the whole canvas (bounded, worst-first); a slug
/// answers for one island.
pub(crate) fn describe_canvas_freshness(sys_db: &DbPool, query: &str) -> String {
    let Some(scene) = load_scene(sys_db) else {
        return no_scene_line().to_string();
    };
    if !query.trim().is_empty() && is_demo_slug(query) {
        return demo_refusal(query);
    }

    let rollup = |p: &CanvasProject| -> String {
        let ideas = match p.ideas_days {
            None => "ideas: never scanned".to_string(),
            Some(0) => "ideas: scanned today".to_string(),
            Some(d) => format!("ideas: {d}d old"),
        };
        let goals = match p.goals_ongoing {
            Some(n) if n > 0 => format!("goals: {n} ongoing"),
            Some(_) => "goals: none ongoing".to_string(),
            None => "goals: unknown".to_string(),
        };
        let kpis = match (p.kpi_total, p.kpi_off) {
            (Some(0), _) | (None, _) => "KPIs: none".to_string(),
            (Some(t), Some(off)) if off > 0 => format!("KPIs: {off} of {t} OFF TRACK"),
            (Some(t), _) => format!("KPIs: {t} on track"),
        };
        format!("{ideas} · {goals} · {kpis}")
    };

    if !query.trim().is_empty() {
        let Some(p) = scene.find(query) else {
            return format!(
                "No project matches `{query}` on the canvas. Existing slugs include: {}. \
                 Ask the user which they meant; do not invent a slug.",
                scene.slug_suggestions(SLUG_SUGGESTIONS)
            );
        };
        return format!(
            "**{name}** `{slug}` · {rollup}\n\n_{caveats}._",
            name = p.name,
            slug = p.slug,
            rollup = rollup(p),
            caveats = scene_caveats(&scene),
        );
    }

    let triaged = scene.triaged();
    let total = triaged.len();
    if total == 0 {
        return format!("The canvas has no projects. _{}_", scene_caveats(&scene));
    }
    // Bounded twice over, exactly like `list_teams`: a row cap AND a character
    // cap, with the footer reserved so the "N of M" honesty line survives.
    let mut body = String::new();
    let mut shown = 0usize;
    for p in triaged.iter().take(FRESHNESS_MAX_ROWS) {
        let row = format!("- **{}** `{}` · {}\n", p.name, p.slug, rollup(p));
        if body.len() + row.len() + FRESHNESS_FOOTER_RESERVE > FRESHNESS_BODY_CHARS {
            break;
        }
        body.push_str(&row);
        shown += 1;
    }
    format!(
        "{body}\n_Listing {shown} of {total} projects, worst-first. {caveats}._",
        body = body,
        shown = shown,
        total = total,
        caveats = scene_caveats(&scene),
    )
}

/// Rows a fleet-wide freshness answer may carry.
const FRESHNESS_MAX_ROWS: usize = 25;
/// Character cap on the freshness body, under the dispatcher's own
/// `READ_OP_DETAIL_CHARS` clip so the footer is never the thing clipped away.
const FRESHNESS_BODY_CHARS: usize = 1400;
/// Held back from [`FRESHNESS_BODY_CHARS`] for the "N of M" footer.
const FRESHNESS_FOOTER_RESERVE: usize = 220;

// ─────────────────────────────────────────────────────────────────────────
// Action-target resolution (shared by every canvas action executor)
// ─────────────────────────────────────────────────────────────────────────

/// A canvas slug resolved to a real, dispatchable project.
#[derive(Debug, Clone)]
pub(crate) struct CanvasTarget {
    pub project_id: String,
    pub name: String,
    pub root_path: String,
}

/// Resolve one canvas slug to a registered dev project.
///
/// Refusals, in order: a demo island (never dispatchable, see [`demo_refusal`]),
/// then a slug that matches no project row. Resolution is by `dev_projects.id`
/// first (the canvas slug IS the project id for real islands), then by exact
/// name, then by name substring, so a user saying "dispatch to Personas" still
/// lands.
///
/// This does NOT replace `validate_fleet_cwd_in_db`: it produces a candidate
/// root path, and the fleet plan validator applies the containment rule to it.
/// One boundary, applied in one place.
pub(crate) fn resolve_canvas_target(
    sys_db: &DbPool,
    slug: &str,
) -> Result<CanvasTarget, crate::error::AppError> {
    let q = slug.trim();
    if q.is_empty() {
        return Err(crate::error::AppError::Validation(
            "a canvas action needs a project `slug`".into(),
        ));
    }
    if is_demo_slug(q) {
        return Err(crate::error::AppError::Validation(demo_refusal(q)));
    }
    let projects = crate::db::repos::dev_tools::list_projects(sys_db, None)?;
    let lower = q.to_ascii_lowercase();
    let hit = projects
        .iter()
        .find(|p| p.id.to_ascii_lowercase() == lower)
        .or_else(|| {
            projects
                .iter()
                .find(|p| p.name.to_ascii_lowercase() == lower)
        })
        .or_else(|| {
            projects
                .iter()
                .find(|p| p.name.to_ascii_lowercase().contains(&lower))
        });
    let Some(p) = hit else {
        let known: Vec<String> = projects
            .iter()
            .take(6)
            .map(|p| format!("`{}`", p.id))
            .collect();
        return Err(crate::error::AppError::Validation(format!(
            "no registered project matches the canvas slug `{q}`. Registered \
             project ids include: {}. Do not invent a slug.",
            if known.is_empty() {
                "none (no projects are registered)".to_string()
            } else {
                known.join(", ")
            }
        )));
    };
    Ok(CanvasTarget {
        project_id: p.id.clone(),
        name: p.name.clone(),
        root_path: p.root_path.clone(),
    })
}

/// Resolve one canvas slug against the PUBLISHED SCENE (WP3).
///
/// Deliberately not [`resolve_canvas_target`]: composing a panel touches no
/// repository and starts nothing, so the question is not "is this a registered
/// project with a root path" but "is this an island Athena can actually see".
/// Validating against the same snapshot she read keeps the vocabulary closed —
/// a slug that is not in the block is a slug she invented.
///
/// Returns the canonical slug on success; on failure, a message that names real
/// alternatives so the next attempt is grounded rather than another guess.
pub(crate) fn resolve_scene_slug(sys_db: &DbPool, query: &str) -> Result<String, String> {
    let q = query.trim();
    if q.is_empty() {
        return Err("a canvas panel needs the `slug` of the island it belongs to".to_string());
    }
    if is_demo_slug(q) {
        return Err(demo_refusal(q));
    }
    let Some(scene) = load_scene(sys_db) else {
        return Err(no_scene_line().to_string());
    };
    let Some(p) = scene.find(q) else {
        return Err(format!(
            "No project matches `{q}` on the canvas, so there is nothing to dock a \
             panel to. Existing slugs include: {}. Ask the user which they meant; \
             do not invent a slug.",
            scene.slug_suggestions(SLUG_SUGGESTIONS)
        ));
    };
    // A published scene should never carry demo islands (the canvas refuses to
    // publish the demo scene), but a stale snapshot from an older build might.
    if is_demo_slug(&p.slug) {
        return Err(demo_refusal(&p.slug));
    }
    Ok(p.slug.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scene_from(json: &str) -> CanvasScene {
        serde_json::from_str(json).expect("scene parses")
    }

    fn project(slug: &str, state: &str, attention: bool, blockers: i64, alerts: usize) -> String {
        let dims: Vec<String> = (0..alerts)
            .map(|i| format!(r#"{{"key":"d{i}","label":"D{i}","status":"alert"}}"#))
            .collect();
        format!(
            r#"{{"slug":"{slug}","name":"{slug}","state":"{state}","attention":{attention},
                 "blockers":{blockers},"dims":[{}]}}"#,
            dims.join(",")
        )
    }

    #[test]
    fn ordering_is_worst_first_and_stable() {
        let scene = scene_from(&format!(
            r#"{{"version":1,"projects":[{},{},{},{}]}}"#,
            project("aaa-healthy", "healthy", false, 0, 0),
            project("zzz-critical", "critical", false, 1, 1),
            project("mmm-attention", "healthy", true, 0, 0),
            project("bbb-warning", "warning", false, 9, 0),
        ));
        let order: Vec<&str> = scene.triaged().iter().map(|p| p.slug.as_str()).collect();
        assert_eq!(
            order,
            vec![
                // attention wins outright, even on a healthy island.
                "mmm-attention",
                // then state rank, regardless of alphabetical position.
                "zzz-critical",
                "bbb-warning",
                "aaa-healthy",
            ],
            "worst-first ordering broke"
        );
    }

    #[test]
    fn ties_break_on_slug_so_the_block_is_stable_between_turns() {
        let scene = scene_from(&format!(
            r#"{{"version":1,"projects":[{},{}]}}"#,
            project("zeta", "warning", false, 2, 0),
            project("alpha", "warning", false, 2, 0),
        ));
        let order: Vec<&str> = scene.triaged().iter().map(|p| p.slug.as_str()).collect();
        assert_eq!(order, vec!["alpha", "zeta"]);
    }

    #[test]
    fn demo_slugs_are_recognised_and_refused_with_a_reason() {
        assert!(is_demo_slug("demo-desktop"));
        assert!(is_demo_slug("DEMO-web"));
        assert!(!is_demo_slug("personas"));
        let msg = demo_refusal("demo-codex");
        assert!(msg.contains("demo islands"), "{msg}");
        assert!(
            msg.contains("register"),
            "must say what to do instead: {msg}"
        );
    }

    #[test]
    fn degraded_families_are_named_in_the_caveats() {
        let scene = scene_from(
            r#"{"version":1,"families":{"scans":"failed","goals":"loaded","sentry":"stale"},
                "projects":[]}"#,
        );
        let caveats = scene_caveats(&scene);
        assert!(caveats.contains("scans (failed)"), "{caveats}");
        assert!(caveats.contains("sentry (stale)"), "{caveats}");
        assert!(
            !caveats.contains("goals"),
            "healthy families are noise: {caveats}"
        );
    }

    #[test]
    fn a_demo_scene_says_nothing_on_it_is_dispatchable() {
        let scene = scene_from(r#"{"version":1,"demo":true,"projects":[]}"#);
        assert!(
            scene_caveats(&scene).contains("DEMO"),
            "{:?}",
            scene_caveats(&scene)
        );
    }

    #[test]
    fn unhealthy_filter_keeps_only_the_cells_worth_printing() {
        let scene = scene_from(
            r#"{"version":1,"projects":[{"slug":"p","name":"P","dims":[
                {"key":"tests","label":"Tests","status":"risk","detail":"41% cov"},
                {"key":"ci","label":"CI","status":"solid"},
                {"key":"kpi","label":"KPIs","status":"unknown"},
                {"key":"db","label":"Database","status":"partial"}
            ]}]}"#,
        );
        let p = &scene.projects[0];
        let cells: Vec<String> = p.unhealthy().iter().map(|d| d.cell()).collect();
        assert_eq!(cells.len(), 2, "{cells:?}");
        assert!(cells[0].contains("Tests risk (41% cov)"), "{cells:?}");
        assert!(cells[1].contains("KPIs unknown"), "{cells:?}");
    }

    #[test]
    fn an_unknown_version_is_ignored_rather_than_half_read() {
        let raw = r#"{"version":99,"projects":[{"slug":"p"}]}"#;
        let parsed: CanvasScene = serde_json::from_str(raw).unwrap();
        assert_ne!(parsed.version, 1, "load_scene rejects anything but v1");
    }
}
