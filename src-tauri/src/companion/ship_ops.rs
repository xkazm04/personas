//! `describe_ship_milestone` — the read half of Athena's Ship toolset.
//!
//! # Why this op exists
//!
//! Athena could PROPOSE a milestone (`show_ship_milestone`) long before she
//! could read one. That asymmetry made the conversation the Ship tab wants —
//! "where does the next milestone stand, and what should be in it" — impossible
//! to hold: her only move was to propose a brand-new cut, because she had no
//! way to see the one already there.
//!
//! # What it can and cannot answer, stated up front
//!
//! The Ship tab's numbers are DERIVED, and they are derived in two different
//! places from two different kinds of input:
//!
//! * **Decisions** — which features and goals are in the cut, in which bucket,
//!   with which operator note and rating, and whether each joined after the
//!   scope was frozen. These live in `dev_milestone_items` and this op reads
//!   them exactly.
//! * **Live readings** — the exit-criteria verdicts, per-context health, the
//!   ship verdict itself. These are computed client-side in `useShipData` from
//!   signals that are not in this database at all (Sentry error counts for the
//!   week, which connector credentials are bound). This op DOES NOT recompute
//!   them, and it says so in its own answer.
//!
//! Reimplementing the criteria here would give Athena a second, quieter
//! derivation that drifts from the one on the operator's screen — and the first
//! time they disagreed nobody would know which was wrong. So the split is
//! deliberate: this op is authoritative about the cut and honest about the
//! verdict, and the Ship control bar's "Ask Athena" button is what carries the
//! live readings into a conversation (`shipAthena.buildShipBriefing`).

use rusqlite::params;
use serde::Deserialize;

use crate::db::DbPool;

/// Rows of each list a single answer may carry. The read-op envelope caps the
/// whole body at `READ_OP_DETAIL_CHARS` anyway; capping per-list first means
/// the truncation lands somewhere legible instead of guillotining mid-row.
const LIST_CAP: usize = 14;

/// Longest brief the answer renders verbatim.
///
/// The objective's prose is operator-authored markdown with no length limit, and
/// it is the one section of this answer that could be arbitrarily long. Cutting
/// it HERE, visibly, is the whole point: the alternative is the dispatcher's
/// envelope cutting the answer's TAIL instead — silently, and taking the
/// doctrine with it, which is what it did until 2026-08-25.
const BRIEF_CAP: usize = 1000;

/// Longest per-member note the answer renders.
///
/// The other unbounded input: the ingest door accepts a 1,200-character
/// description per member, and fourteen of those would be the entire budget
/// spent on one section. A member's note is context for its bucket, not a
/// document, so the first 140 characters carry it.
const MEMBER_NOTE_CAP: usize = 140;

/// Truncate on a CHARACTER boundary with an ellipsis. Slicing a `String` by
/// bytes panics mid-codepoint, and every input here is operator-authored prose
/// that routinely contains em dashes and accented text.
fn clip_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…")
}

// ── the readiness snapshot ───────────────────────────────────────────────────
//
// The exit criteria are derived in `useShipData` from signals this database
// cannot reproduce (this week's Sentry error counts per context, which
// connector credentials are bound), so for a while this op simply refused to
// answer about them and the Ship tab's "Ask Athena" button pasted the verdict
// into its opening message instead.
//
// That paste is what made the message LEADING: it handed a conclusion to a
// model that had not yet read the milestone, and the model then wrote the
// conclusion back as if it were a finding. So the tab now PUBLISHES what it
// derived to `SHIP_READINESS` and this op serves it — the same door the
// Mastermind canvas opened with `MASTERMIND_SCENE`, for the same reason: one
// derivation, read live, rather than a second Rust implementation that drifts
// or a snapshot that goes stale the instant a button is pressed.
//
// Field names mirror `shipReadinessPublish.ts` exactly (camelCase, everything
// optional but `id`, unknown fields ignored).

/// One exit criterion as the Ship tab derived it.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SnapCriterion {
    label: String,
    /// `go` | `warn` | `nogo` | `setup`.
    state: String,
    /// The derived "why" line. Never hand-typed on the tab either.
    evidence: String,
    done: i64,
    total: i64,
}

/// One context in the milestone's footprint, with the health only the tab sees.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SnapContext {
    name: String,
    /// `ok` | `warn` | `crit` | `setup`.
    tone: String,
    kpis: i64,
    /// Sentry errors this week. `None` = monitoring is not wired, which is a
    /// different fact from zero errors and must never be flattened into one.
    errors: Option<i64>,
}

/// The published reading for ONE milestone.
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SnapMilestone {
    id: String,
    /// The overall fold: `nogo` > `setup` > `warn` > `go`.
    verdict: String,
    progress: i64,
    criteria: Vec<SnapCriterion>,
    contexts: Vec<SnapContext>,
}

/// The whole document under [`SHIP_READINESS`].
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
struct SnapDoc {
    version: i64,
    published_at: Option<String>,
    milestones: Vec<SnapMilestone>,
}

/// Load the published readiness for one milestone id.
///
/// Every failure path returns `None` and the caller says plainly that it has no
/// verdict — which is the honest answer and the one this op gave for its whole
/// life before the snapshot existed. Inventing a verdict from the shape of the
/// cut is the one thing that must never happen here.
fn load_readiness(sys_db: &DbPool, milestone_id: &str) -> Option<(SnapMilestone, Option<String>)> {
    let raw =
        crate::db::repos::core::settings::get(sys_db, crate::db::settings_keys::SHIP_READINESS)
            .ok()
            .flatten()?;
    let doc: SnapDoc = match serde_json::from_str(&raw) {
        Ok(d) => d,
        Err(e) => {
            tracing::warn!(error = %e, "companion::ship_ops: ship readiness snapshot is unparseable");
            return None;
        }
    };
    if doc.version != 1 {
        tracing::warn!(
            version = doc.version,
            "companion::ship_ops: ignoring a ship readiness snapshot of an unknown version"
        );
        return None;
    }
    let published = doc.published_at.clone();
    doc.milestones
        .into_iter()
        .find(|m| m.id == milestone_id)
        .map(|m| (m, published))
}

/// Whole hours since the snapshot was published, when the stamp parses.
fn snapshot_age_hours(published_at: Option<&str>) -> Option<i64> {
    let then = chrono::DateTime::parse_from_rfc3339(published_at?).ok()?;
    Some(
        (chrono::Utc::now() - then.with_timezone(&chrono::Utc))
            .num_hours()
            .max(0),
    )
}

/// A resolved milestone: its row, plus the project it belongs to.
struct Resolved {
    id: String,
    project_id: String,
    project_name: String,
    name: String,
    /// The objective, as a short title.
    goal: Option<String>,
    /// The objective's prose — markdown, authored by the operator. This is the
    /// statement of intent a decomposition works FROM, so an answer that omits
    /// it leaves the model guessing at what the milestone is for.
    description: Option<String>,
    status: String,
    target_date: Option<String>,
    cut_at: Option<String>,
    shipped_at: Option<String>,
}

/// One scope member of the milestone, as the answer needs it.
///
/// A named struct rather than the 7-tuple this used to be: clippy's
/// `type_complexity` is right that nobody can read `f.1` and know it means the
/// bucket, and the render loop below filters on exactly that field.
struct Member {
    /// The use case's name, or a `(deleted use case …)` marker for an orphan.
    name: String,
    bucket: String,
    /// The operator's 1..5 opinion. `None` is UNRATED — never a zero.
    rating: Option<i64>,
    /// The operator's note on why this member sits in this bucket.
    description: Option<String>,
    /// Joined after `cut_at` was stamped — scope creep awaiting triage.
    after_cut: bool,
    /// Active KPIs measuring it, directly or through one of its contexts.
    kpis: i64,
    /// Comma-joined context names, empty when the feature slices none.
    contexts: String,
}

/// Resolve a query to ONE milestone.
///
/// Three ways in, in order, because Athena reaches this op from three
/// different places and only the first of them gives her a real id:
///   1. an exact `dev_milestones.id` — what a previous answer handed back;
///   2. an exact milestone NAME (case-insensitive) — what the operator says
///      out loud ("where is M4");
///   3. a project name / slug / id — what she has from her registered-projects
///      block. That resolves to the project's OPEN milestone: the cut one if
///      there is one, else the first unshipped by plan order. Same "next" rule
///      the passport cover and the canvas status bar use, so three surfaces
///      cannot disagree about which milestone is the current one.
fn resolve(conn: &rusqlite::Connection, query: &str) -> Option<Resolved> {
    let read = |sql: &str, p: &[&dyn rusqlite::ToSql]| -> Option<Resolved> {
        conn.query_row(sql, p, |row| {
            Ok(Resolved {
                id: row.get(0)?,
                project_id: row.get(1)?,
                project_name: row.get(2)?,
                name: row.get(3)?,
                goal: row.get(4)?,
                description: row.get(5)?,
                status: row.get(6)?,
                target_date: row.get(7)?,
                cut_at: row.get(8)?,
                shipped_at: row.get(9)?,
            })
        })
        .ok()
    };
    const COLS: &str = "m.id, m.project_id, p.name, m.name, m.goal, m.description, m.status,
                        m.target_date, m.cut_at, m.shipped_at
                 FROM dev_milestones m JOIN dev_projects p ON p.id = m.project_id";

    if let Some(r) = read(&format!("SELECT {COLS} WHERE m.id = ?1"), params![query]) {
        return Some(r);
    }
    if let Some(r) = read(
        &format!("SELECT {COLS} WHERE lower(m.name) = lower(?1) ORDER BY m.order_index LIMIT 1"),
        params![query],
    ) {
        return Some(r);
    }
    // Project → its open milestone. `status = 'active'` sorts before
    // `'planned'` because 'a' < 'p'; shipped rows are excluded outright.
    read(
        &format!(
            "SELECT {COLS}
             WHERE (p.id = ?1 OR lower(p.name) = lower(?1) OR lower(COALESCE(p.slug, '')) = lower(?1))
               AND m.status != 'shipped'
             ORDER BY m.status, m.order_index LIMIT 1"
        ),
        params![query],
    )
}

/// Characters ONE list section may spend.
///
/// `LIST_CAP` bounds a section by ROW COUNT, which bounds nothing: a member's
/// note can be 1,200 characters (the ingest door's own limit), so fourteen rows
/// is anywhere from 800 characters to 17,000. Measured 2026-08-25, a worst-case
/// cut produced a 7,912-character answer against a 4,200 budget — and the
/// dispatcher's clip would have taken the difference off the END, which is
/// where the doctrine lives.
///
/// So each section spends at most this, and `cap` announces what that cost.
/// The answer decides what to drop, from the middle, out loud; the envelope
/// never gets to decide, silently, from the tail.
const LIST_SECTION_CHARS: usize = 550;

/// Keep rows while the section's character allowance lasts.
///
/// Always keeps at least one row: a section that renders nothing tells the
/// reader the milestone is empty, which is a different and much worse claim
/// than telling them it is long.
fn take_within(lines: Vec<String>, budget: usize) -> Vec<String> {
    let mut spent = 0usize;
    let mut kept: Vec<String> = Vec::new();
    for l in lines {
        spent += l.chars().count() + 1;
        if spent > budget && !kept.is_empty() {
            break;
        }
        kept.push(l);
    }
    kept
}

fn cap(mut lines: Vec<String>, total: usize) -> Vec<String> {
    if total > lines.len() {
        // Truncation is ANNOUNCED, never silent: a clipped cut would have her
        // reason about a smaller milestone than the real one and never say so.
        lines.push(format!("  … and {} more not listed", total - lines.len()));
    }
    lines
}

/// The whole answer. Returns prose because that is what the read-op channel
/// carries (a System episode Athena reads at the top of her next turn).
pub fn describe_ship_milestone(sys_db: &DbPool, query: &str) -> String {
    let Ok(conn) = sys_db.get() else {
        return "database unavailable".to_string();
    };
    let Some(m) = resolve(&conn, query) else {
        return format!(
            "No milestone matched `{query}`. Try the milestone's exact name, its id, \
             or a registered project's name (which resolves to that project's open \
             milestone). If the project has no milestones yet, `show_ship_milestone` \
             is how you propose the first one."
        );
    };

    let mut out = vec![
        format!("MILESTONE `{}` — {}", m.id, m.name),
        format!("Project: {} (`{}`)", m.project_name, m.project_id),
        format!(
            "Status: {}{}{}{}",
            m.status,
            m.target_date
                .as_deref()
                .map(|d| format!(" · target {d}"))
                .unwrap_or_default(),
            m.cut_at
                .as_deref()
                .map(|d| format!(" · cut {}", &d[..10.min(d.len())]))
                .unwrap_or_else(|| " · NOT CUT YET".into()),
            m.shipped_at
                .as_deref()
                .map(|d| format!(" · shipped {}", &d[..10.min(d.len())]))
                .unwrap_or_default(),
        ),
        format!(
            "Objective: {}",
            m.goal.as_deref().unwrap_or("(not written)")
        ),
    ];

    // The objective's PROSE. This field was read from SQL into `Resolved` and
    // then never rendered — for four days the answer carried the objective's
    // short TITLE and dropped the paragraph under it, which is where the
    // operator writes what shipping actually means: the deliverables, the
    // research he wants done, the explicit out-of-scope. A model reading that
    // answer had no way to know any of it existed, so it asked him to restate
    // in chat what it was already holding. Never truncate this: it is the
    // statement of intent every decomposition works FROM, and the whole cut
    // below is meaningless without it.
    match m
        .description
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
    {
        Some(d) => {
            let shown = clip_chars(d, BRIEF_CAP);
            let truncated = d.chars().count() > BRIEF_CAP;
            out.push(String::new());
            out.push("WHAT SHIPPING THIS MEANS — the operator's own words:".to_string());
            for line in shown.lines() {
                out.push(format!("  {line}"));
            }
            if truncated {
                // Say it here rather than letting the envelope do it further
                // down, unannounced. A brief this long means there is more
                // intent than fits, which is itself worth knowing.
                out.push(format!(
                    "  (brief shown to {BRIEF_CAP} of {} characters — the rest is on his screen, so ask about the part you cannot see rather than assuming it says nothing)",
                    d.chars().count()
                ));
            }
            out.push(
                "Read that as the brief. If it names deliverables, research, a target path or an out-of-scope, those are DECIDED — do not ask him to restate them, and do not propose anything he put out of scope."
                    .to_string(),
            );
        }
        None => {
            out.push(String::new());
            out.push(
                "WHAT SHIPPING THIS MEANS — not written. The objective above is a title with no prose under it, so the intent behind this cut is genuinely unstated. This is the one case where asking him what he means is the right move."
                    .to_string(),
            );
        }
    }

    // ── scope members, by bucket ──────────────────────────────────────────
    // `item_id` is polymorphic with no FK (see the migration's own note), so a
    // LEFT JOIN is load-bearing: a use case deleted by a rescan leaves an
    // orphan row, and reporting it as a nameless member is more honest than
    // dropping it — an orphan in the cut is a real thing to fix.
    // `read_all` below is why this is not `.flatten()`. Dropping a failing row
    // with `filter_map(Result::ok)` would make a member of the cut disappear
    // from the answer with no trace, and Athena would then reason — confidently
    // — about a smaller milestone than the real one. A read that cannot be
    // trusted to be complete is worse than one that says it failed.
    let mut features: Vec<Member> = Vec::new();
    let mut read_error: Option<String> = None;
    if let Ok(mut stmt) = conn.prepare(
        "SELECT COALESCE(u.name, '(deleted use case ' || i.item_id || ')'),
                i.bucket, i.rating, i.description, i.added_after_cut,
                (SELECT COUNT(*) FROM dev_kpis k
                  WHERE k.status = 'active'
                    AND (k.use_case_id = i.item_id
                         OR (k.context_id IS NOT NULL AND k.context_id IN
                             (SELECT context_id FROM dev_use_case_contexts WHERE use_case_id = i.item_id)))),
                COALESCE((SELECT GROUP_CONCAT(c.name, ', ') FROM dev_use_case_contexts uc
                           JOIN dev_contexts c ON c.id = uc.context_id
                          WHERE uc.use_case_id = i.item_id), '')
           FROM dev_milestone_items i
           LEFT JOIN dev_use_cases u ON u.id = i.item_id
          WHERE i.milestone_id = ?1 AND i.item_kind = 'use_case'
          ORDER BY i.bucket, i.order_index, i.created_at",
    ) {
        if let Ok(rows) = stmt.query_map(params![m.id], |r| {
            Ok(Member {
                name: r.get(0)?,
                bucket: r.get(1)?,
                rating: r.get(2)?,
                description: r.get(3)?,
                after_cut: r.get::<_, i64>(4)? != 0,
                kpis: r.get(5)?,
                contexts: r.get(6)?,
            })
        }) {
            for row in rows {
                match row {
                    Ok(r) => features.push(r),
                    Err(e) => {
                        read_error = Some(format!("{e}"));
                        break;
                    }
                }
            }
        }
    }
    if let Some(e) = &read_error {
        return format!(
            "MILESTONE `{}` — {}\n\nCould not read its scope members: {e}\n\nTell the user \
             the read failed rather than describing a cut you could not see.",
            m.id, m.name
        );
    }

    for bucket in ["core", "later", "never"] {
        let rows: Vec<&Member> = features.iter().filter(|f| f.bucket == bucket).collect();
        if rows.is_empty() && bucket != "core" {
            continue;
        }
        let heading = match bucket {
            "core" => "IN THE CUT (core)",
            "later" => "DEFERRED (later)",
            _ => "EXCLUDED (never)",
        };
        out.push(String::new());
        out.push(format!("{heading} — {} item(s)", rows.len()));
        if rows.is_empty() {
            out.push("  (empty)".to_string());
            continue;
        }
        let lines: Vec<String> = rows
            .iter()
            .take(LIST_CAP)
            .map(|f| {
                let mut bits = vec![format!("  - {}", f.name)];
                bits.push(if f.contexts.is_empty() {
                    "no context".into()
                } else {
                    format!("contexts: {}", f.contexts)
                });
                bits.push(format!("{} active KPI(s)", f.kpis));
                // Say what a rating IS every time it appears. It is the
                // operator's second opinion and it gates nothing (shipDuality)
                // — without the note she reads a 2/5 as a blocker.
                if let Some(r) = f.rating {
                    bits.push(format!("operator rates it {r}/5 (opinion, not a gate)"));
                }
                if f.after_cut {
                    bits.push("JOINED AFTER THE CUT".into());
                }
                if let Some(d) = &f.description {
                    bits.push(format!("note: \"{}\"", clip_chars(d, MEMBER_NOTE_CAP)));
                }
                bits.join(" · ")
            })
            .collect();
        out.extend(cap(take_within(lines, LIST_SECTION_CHARS), rows.len()));
    }

    // ── bound goals ───────────────────────────────────────────────────────
    let mut goals: Vec<String> = Vec::new();
    if let Ok(mut stmt) = conn.prepare(
        "SELECT COALESCE(g.title, '(deleted goal ' || i.item_id || ')'),
                COALESCE(g.status, '?'), COALESCE(g.progress, 0),
                COALESCE(c.name, '')
           FROM dev_milestone_items i
           LEFT JOIN dev_goals g ON g.id = i.item_id
           LEFT JOIN dev_contexts c ON c.id = g.context_id
          WHERE i.milestone_id = ?1 AND i.item_kind = 'goal'
          ORDER BY i.order_index, i.created_at",
    ) {
        if let Ok(rows) = stmt.query_map(params![m.id], |r| {
            Ok(format!(
                "  - {} [{}, {}%]{}",
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                match r.get::<_, String>(3)?.as_str() {
                    "" => " (no context assigned)".to_string(),
                    c => format!(" — context: {c}"),
                }
            ))
        }) {
            for row in rows {
                match row {
                    Ok(line) => goals.push(line),
                    Err(e) => {
                        // Same rule as the members read: a bound goal that
                        // vanished silently is the one fact that would make her
                        // call the `objective` criterion unmet when it is met.
                        goals.push(format!("  - (a bound goal could not be read: {e})"));
                        break;
                    }
                }
            }
        }
    }
    out.push(String::new());
    out.push(format!("BOUND GOALS — {} ", goals.len()));
    if goals.is_empty() {
        out.push(
            "  (none — the `objective` exit criterion is unmet until one is bound)".to_string(),
        );
    } else {
        let n = goals.len();
        out.extend(cap(
            take_within(
                goals.into_iter().take(LIST_CAP).collect(),
                LIST_SECTION_CHARS,
            ),
            n,
        ));
    }

    // ── the live reading, from the tab's own derivation ───────────────────
    // This used to be a paragraph saying the verdicts were unknowable here and
    // that the operator should press "Ask Athena" to be handed them. That was
    // true, and it was exactly why the button pasted a conclusion into its
    // opening message. Now the tab publishes what it derived and this reads it,
    // so the verdict arrives THROUGH the op like everything else — pulled when
    // it is needed, never pushed ahead of the question.
    out.push(String::new());
    match load_readiness(sys_db, &m.id) {
        Some((snap, published_at)) => {
            let age = match snapshot_age_hours(published_at.as_deref()) {
                None => "publish time unknown".to_string(),
                Some(0) => "derived within the hour".to_string(),
                Some(1) => "derived 1 hour ago".to_string(),
                Some(h) => format!("derived {h} hours ago"),
            };
            out.push(format!(
                "LIVE READING — ship verdict {} · {}% of the core cut ready ({age})",
                if snap.verdict.is_empty() {
                    "unknown"
                } else {
                    &snap.verdict
                },
                snap.progress,
            ));
            if snap.criteria.is_empty() {
                out.push("  (the snapshot carries no exit criteria)".to_string());
            } else {
                let total = snap.criteria.len();
                let lines: Vec<String> = snap
                    .criteria
                    .iter()
                    .take(LIST_CAP)
                    .map(|c| {
                        format!(
                            "  - {} [{}] {}/{} — {}",
                            c.label, c.state, c.done, c.total, c.evidence
                        )
                    })
                    .collect();
                out.extend(cap(take_within(lines, LIST_SECTION_CHARS), total));
            }
            // Per-context health is the half of this the database genuinely
            // cannot see. `errors: None` means monitoring is not wired, which
            // is a different fact from zero errors — never fold them together.
            if !snap.contexts.is_empty() {
                let total = snap.contexts.len();
                out.push("  contexts in the footprint:".to_string());
                let lines: Vec<String> = snap
                    .contexts
                    .iter()
                    .take(LIST_CAP)
                    .map(|c| {
                        format!(
                            "  - {} [{}] · {} active KPI(s) · {}",
                            c.name,
                            c.tone,
                            c.kpis,
                            match c.errors {
                                None => "monitoring not wired".to_string(),
                                Some(0) => "no errors this week".to_string(),
                                Some(1) => "1 error this week".to_string(),
                                Some(n) => format!("{n} errors this week"),
                            }
                        )
                    })
                    .collect();
                out.extend(cap(take_within(lines, LIST_SECTION_CHARS), total));
            }
            out.push(
                "These are the Ship tab's OWN numbers, republished as it derived them — \
                 the same ones on his screen. Do not recompute them and do not \
                 contradict them; if one looks wrong, say which criterion and why."
                    .to_string(),
            );
        }
        None => {
            out.push(
                "LIVE READING — not available. The exit-criteria verdicts, per-context \
                 health and the overall ship verdict derive in the Ship tab from runtime \
                 signals this read cannot see (this week's error counts, which connector \
                 credentials are bound), and no snapshot has been published for this \
                 milestone — the tab has not been opened since this build. Say you do not \
                 have the verdict rather than inferring one from the shape of the cut."
                    .to_string(),
            );
        }
    }
    out.push(
        "To act on this: `set_ship_scope` moves members between core/later/never \
         or drops them, `ship_milestone_lifecycle` cuts or ships it, and \
         `show_ship_milestone` proposes an entirely new cut. All three are cards \
         the operator confirms."
            .to_string(),
    );
    out.push(
        "DECOMPOSING IT. The objective above is the intent; the cut is what has \
         been committed to it so far. To turn one into the other, work out what \
         the objective needs that the cut does not yet contain, and propose those \
         as GOALS bound to this milestone — a goal is where an intention lives \
         before it has a home, and the operator must never be asked which context \
         or use case it belongs to (that mapping is yours). Bind them with \
         `set_ship_scope` (item_kind: goal); where the gap is real work rather \
         than a scoping decision, put a session on it with `show_fleet_plan`. \
         Propose few and concrete over many and vague."
            .to_string(),
    );
    out.push(
        "BEFORE YOU ASK HIM ANYTHING. Compare what the brief above already \
         settles against what you were about to ask. An objective that names a \
         SUBJECT rather than a deliverable (\"knowledge for X\", \"support for Y\") \
         is not a signal to ask him what he means — it is a signal that the work \
         starts with INVESTIGATION. Read the project: `describe_context` over its \
         contexts, and where the answer is not in this database, dispatch \
         sessions that go and find out (`canvas_dispatch` into that project, \
         `show_fleet_plan` for real work, `enqueue_runner_task` for the queue). \
         Come back with what you found and, at most, the two or three questions \
         only he can answer. A question you could have answered by reading costs \
         him a turn and tells him you did not look."
            .to_string(),
    );

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A project + milestone straight into the production schema. Never
    /// `CREATE TABLE` here: a hand-built fixture is not the schema the answer
    /// is read from, and the whole point of these tests is that the answer
    /// reflects real rows.
    fn seed(db: &DbPool, description: Option<&str>) -> String {
        let conn = db.get().unwrap();
        conn.execute(
            "INSERT INTO dev_projects (id, name, root_path, status, created_at, updated_at)
             VALUES ('p1', 'gravitone', 'C:/repo', 'active', '2026-08-01', '2026-08-01')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO dev_milestones
                 (id, project_id, name, goal, description, status, order_index,
                  created_at, updated_at)
             VALUES ('ms-1', 'p1', 'Test milestone',
                     'Gathering knowledge for trailer storytelling', ?1,
                     'planned', 0, '2026-08-24', '2026-08-24')",
            params![description],
        )
        .unwrap();
        "ms-1".to_string()
    }

    /// THE REGRESSION THIS FILE EXISTS FOR.
    ///
    /// `Resolved.description` was selected from SQL and stored in the struct
    /// from the day the field was added — with a doc comment saying an answer
    /// that omits it "leaves the model guessing at what the milestone is for" —
    /// and never rendered. So the answer carried the objective's short TITLE
    /// and silently dropped the paragraph underneath it, which is where the
    /// operator writes the deliverables, the research he wants run and the
    /// out-of-scope. A model reading that answer could not know any of it
    /// existed, and asked him to restate in chat what it was already holding.
    #[test]
    fn the_objectives_prose_is_rendered_in_full() {
        let db = crate::db::init_test_db().unwrap();
        let brief = "Deep research possible web resources\n- Update AI registry if gained knowledge\nOut of scope: Script to image, image to video";
        let id = seed(&db, Some(brief));

        let out = describe_ship_milestone(&db, &id);

        // Every line of the brief survives — not a summary, not a prefix.
        for line in brief.lines() {
            assert!(
                out.contains(line.trim()),
                "brief line missing: {line}\n---\n{out}"
            );
        }
        // And it is labelled, so the reader knows it is the operator's own words
        // rather than something the op derived.
        assert!(out.contains("WHAT SHIPPING THIS MEANS"), "{out}");
        assert!(out.contains("do not ask him to restate"), "{out}");
    }

    /// The absence case is a different fact and must read differently. A
    /// milestone with a title and no prose is the ONE case where asking the
    /// operator what he means is the right move, so the answer says so —
    /// otherwise the doctrine "do not ask, read the brief" would suppress the
    /// question in the only situation that needs it.
    #[test]
    fn a_missing_brief_says_so_and_licenses_the_question() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, None);
        let out = describe_ship_milestone(&db, &id);
        assert!(out.contains("not written"), "{out}");
        assert!(
            out.contains("asking him what he means is the right move"),
            "{out}"
        );
        assert!(!out.contains("do not ask him to restate"), "{out}");
    }

    /// Whitespace-only is absence, not content. Without the `.filter()` an
    /// operator who typed a newline into the field would get a "brief" heading
    /// over nothing, and the answer would then tell the reader that a blank
    /// paragraph had DECIDED things.
    #[test]
    fn a_blank_brief_counts_as_missing() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, Some("   \n  "));
        let out = describe_ship_milestone(&db, &id);
        assert!(out.contains("not written"), "{out}");
    }

    /// With no published snapshot the op must say it has no verdict. This is
    /// the state every install starts in, and it is the state in which
    /// inventing a verdict from the shape of the cut does the most damage.
    #[test]
    fn no_snapshot_means_no_verdict_and_says_so() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, Some("ship it"));
        let out = describe_ship_milestone(&db, &id);
        assert!(out.contains("LIVE READING — not available"), "{out}");
        assert!(out.contains("rather than inferring one"), "{out}");
        assert!(!out.contains("ship verdict setup"), "{out}");
    }

    /// The happy path: what the tab published is what the op serves. The
    /// `errors: null` row is the one to watch — "monitoring not wired" and "no
    /// errors this week" are different facts, and a reader that folded them
    /// together would state a measurement nobody took.
    #[test]
    fn a_published_snapshot_is_served_back_verbatim() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, Some("ship it"));
        let doc = r#"{"version":1,"publishedAt":"2026-08-25T10:00:00Z","milestones":[
            {"id":"ms-1","verdict":"setup","progress":42,
             "criteria":[{"label":"Objective bound","state":"nogo","evidence":"no goal bound","done":0,"total":1}],
             "contexts":[{"name":"auth","tone":"ok","kpis":2,"errors":0},
                         {"name":"ingest","tone":"setup","kpis":0,"errors":null}]}]}"#;
        crate::db::repos::core::settings::set(&db, crate::db::settings_keys::SHIP_READINESS, doc)
            .unwrap();

        let out = describe_ship_milestone(&db, &id);
        assert!(out.contains("ship verdict setup"), "{out}");
        assert!(out.contains("42%"), "{out}");
        assert!(out.contains("Objective bound"), "{out}");
        assert!(out.contains("no goal bound"), "{out}");
        assert!(out.contains("no errors this week"), "{out}");
        assert!(out.contains("monitoring not wired"), "{out}");
        assert!(!out.contains("LIVE READING — not available"), "{out}");
    }

    /// A snapshot that carries other milestones must not answer for THIS one.
    /// Serving a neighbour's verdict is worse than serving none: it is
    /// confidently wrong, and nothing downstream could tell.
    #[test]
    fn a_snapshot_without_this_milestone_reports_no_verdict() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, Some("ship it"));
        crate::db::repos::core::settings::set(
            &db,
            crate::db::settings_keys::SHIP_READINESS,
            r#"{"version":1,"milestones":[{"id":"ms-OTHER","verdict":"go","progress":100}]}"#,
        )
        .unwrap();
        let out = describe_ship_milestone(&db, &id);
        assert!(out.contains("LIVE READING — not available"), "{out}");
        assert!(
            !out.contains("verdict go"),
            "a neighbour's verdict must not leak: {out}"
        );
    }

    /// An unknown document version is ignored, not guessed at. The version
    /// exists so a future shape change fails closed.
    #[test]
    fn an_unknown_snapshot_version_is_ignored() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, Some("ship it"));
        crate::db::repos::core::settings::set(
            &db,
            crate::db::settings_keys::SHIP_READINESS,
            r#"{"version":2,"milestones":[{"id":"ms-1","verdict":"go","progress":100}]}"#,
        )
        .unwrap();
        assert!(
            describe_ship_milestone(&db, &id).contains("LIVE READING — not available"),
            "a v2 document must not be read as v1"
        );
    }

    /// The closing doctrine has to arrive WITH the data, not only in the
    /// constitution — this is the paragraph she reads at the moment she is
    /// deciding whether to ask a question or go and look.
    #[test]
    fn the_answer_closes_by_teaching_investigation_before_questions() {
        let db = crate::db::init_test_db().unwrap();
        let id = seed(&db, Some("ship it"));
        let out = describe_ship_milestone(&db, &id);
        assert!(out.contains("BEFORE YOU ASK HIM ANYTHING"), "{out}");
        assert!(out.contains("canvas_dispatch"), "{out}");
    }

    /// THE ENVELOPE IS PART OF THE ANSWER.
    ///
    /// Measured 2026-08-25, before this test existed: a realistic milestone
    /// produced **3,092 characters against the dispatcher's 1,600-character
    /// cap**, so 48% of the answer was thrown away on the way into the turn —
    /// silently, from the tail, taking the op list and every line of doctrine
    /// with it. The op had been written as though it controlled its own output
    /// and it did not, and nothing anywhere compared the two numbers.
    ///
    /// This test is that comparison. It builds the worst REALISTIC answer —
    /// an over-long brief, a full core cut with long notes, five criteria, a
    /// footprint — and asserts the whole thing fits the budget the dispatcher
    /// will actually allow it.
    #[test]
    fn answer_fits_its_budget() {
        use crate::companion::dispatcher::read_op_detail_budget;

        let db = crate::db::init_test_db().unwrap();
        // A brief twice the render cap, so the visible-truncation path runs.
        let brief = "x".repeat(BRIEF_CAP * 2);
        let id = seed(&db, Some(&brief));
        {
            let conn = db.get().unwrap();
            for n in 0..LIST_CAP {
                let uc = format!("uc-{n}");
                conn.execute(
                    "INSERT INTO dev_use_cases (id, project_id, slug, name, created_at, updated_at)
                     VALUES (?1, 'p1', ?2, ?3, '2026-08-01', '2026-08-01')",
                    params![
                        uc,
                        format!("uc-slug-{n}"),
                        format!("a use case with a reasonably long name {n}")
                    ],
                )
                .unwrap();
                conn.execute(
                    "INSERT INTO dev_milestone_items
                         (milestone_id, item_kind, item_id, bucket, added_after_cut,
                          order_index, created_at, description, rating)
                     VALUES (?1, 'use_case', ?2, 'core', 1, ?3, '2026-08-01', ?4, 2)",
                    params![id, uc, n as i64, "n".repeat(MEMBER_NOTE_CAP * 4)],
                )
                .unwrap();
            }
        }
        crate::db::repos::core::settings::set(
            &db,
            crate::db::settings_keys::SHIP_READINESS,
            r#"{"version":1,"publishedAt":"2026-08-25T10:00:00Z","milestones":[{"id":"ms-1",
               "verdict":"setup","progress":0,
               "criteria":[{"label":"Objective bound","state":"nogo","evidence":"no goal bound","done":0,"total":1},
                           {"label":"Scope frozen","state":"setup","evidence":"not cut","done":0,"total":1},
                           {"label":"Contexts healthy","state":"setup","evidence":"no signal","done":0,"total":0},
                           {"label":"KPI coverage","state":"setup","evidence":"no KPIs","done":0,"total":0},
                           {"label":"Sensors wired","state":"nogo","evidence":"monitoring unbound","done":0,"total":1}],
               "contexts":[{"name":"auth","tone":"ok","kpis":2,"errors":0},
                           {"name":"ingest","tone":"setup","kpis":0,"errors":null}]}]}"#,
        )
        .unwrap();

        let out = describe_ship_milestone(&db, &id);
        let budget = read_op_detail_budget("describe_ship_milestone");
        assert!(
            out.chars().count() <= budget,
            "answer is {} chars against a {budget}-char budget — the dispatcher              would clip the tail, which is where the doctrine lives",
            out.chars().count()
        );

        // And the parts that must survive are all present at that length.
        assert!(out.contains("WHAT SHIPPING THIS MEANS"), "{out}");
        assert!(out.contains("brief shown to"), "the cut must be announced");
        assert!(out.contains("BEFORE YOU ASK HIM ANYTHING"), "{out}");
        assert!(out.contains("LIVE READING"), "{out}");
        assert!(out.contains("DECOMPOSING IT"), "{out}");
        assert!(out.contains("set_ship_scope"), "{out}");
    }
}
