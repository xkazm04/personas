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

use crate::db::DbPool;

/// Rows of each list a single answer may carry. The read-op envelope caps the
/// whole body at `READ_OP_DETAIL_CHARS` anyway; capping per-list first means
/// the truncation lands somewhere legible instead of guillotining mid-row.
const LIST_CAP: usize = 14;

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
                    bits.push(format!("note: \"{d}\""));
                }
                bits.join(" · ")
            })
            .collect();
        out.extend(cap(lines, rows.len()));
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
        out.extend(cap(goals.into_iter().take(LIST_CAP).collect(), n));
    }

    // ── what this op deliberately does not know ───────────────────────────
    out.push(String::new());
    out.push(
        "NOT IN THIS ANSWER, and do not guess at it: the exit-criteria verdicts, \
         per-context health and the overall ship verdict are derived live in the \
         Ship tab from runtime signals this read cannot see (this week's error \
         counts, which connector credentials are bound). If you need them, the \
         operator can press \"Ask Athena\" in the Ship control bar — that hands you \
         the whole live reading. Say you do not have them rather than inferring \
         them from the cut."
            .to_string(),
    );
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

    out.join("\n")
}
