//! `describe_note` — the read half of Athena's Notepad toolset.
//!
//! # Why this op exists
//!
//! The pad is where an idea lives before it is work. Athena can turn a note
//! into goals (`show_ship_goals` with a `note_id`) and can propose edits back
//! into it (`show_note_suggestions`), and both of those are decompositions of
//! something she must have READ. Without this op the only way to get a note in
//! front of her was to paste it into the turn — which goes stale the moment it
//! is composed, costs the whole body every turn, and is exactly the mistake the
//! Ship layer already made once and corrected (`ship_ops`' header).
//!
//! # What it answers, and what it deliberately does not
//!
//! * The note itself: title, status, the project it is mapped to, and the body
//!   in full up to [`NOTE_BODY_CAP`].
//! * The project's OPEN milestone (name + id), resolved the same way
//!   `describe_ship_milestone` resolves a project → its open milestone, so the
//!   `milestone_id` `show_ship_goals` needs is in the answer rather than being
//!   a second lookup she has to remember to make.
//!
//! It does NOT restate the note's dispatch history (`dispatch_target`,
//! `fleet_session_id`, the ingested `result_json`). Those are the pad's own
//! bookkeeping, they are visible on the operator's screen, and a decomposition
//! is not improved by knowing which fleet session last touched the note.

use rusqlite::OptionalExtension;

use crate::db::models::DevNote;
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;

/// Longest body the answer renders verbatim.
///
/// A note is operator-authored markdown with no length limit and it is the one
/// unbounded input here. Cutting it HERE, visibly, is the point: the
/// alternative is the dispatcher's envelope cutting the answer's TAIL instead
/// — silently, and taking the closing doctrine with it, which is what happened
/// to `describe_ship_milestone` until 2026-08-25.
const NOTE_BODY_CAP: usize = 4000;

/// Truncate on a CHARACTER boundary with an ellipsis. Slicing a `String` by
/// bytes panics mid-codepoint, and a note routinely contains em dashes.
fn clip_chars(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{head}…\n\n[body truncated at {max} characters — ask the operator for the rest rather than guessing what follows]")
}

/// Resolve a lookup string to one note: exact id first, then an exact
/// case-insensitive title, then a title prefix. Archived notes are included —
/// a question about an archived note is a real question, and the answer says
/// the status.
fn resolve(pool: &DbPool, query: &str) -> Option<DevNote> {
    let rows = repo::list_notes(pool, true).ok()?;
    if let Some(n) = rows.iter().find(|n| n.id == query) {
        return Some(n.clone());
    }
    if let Some(n) = rows.iter().find(|n| n.title.eq_ignore_ascii_case(query)) {
        return Some(n.clone());
    }
    rows.into_iter()
        .find(|n| n.title.to_lowercase().starts_with(&query.to_lowercase()))
}

/// The project's open milestone (name, id), or `None`.
///
/// Same ordering rule as `ship_ops::resolve`'s third arm — `status = 'active'`
/// sorts before `'planned'` because 'a' < 'p', and shipped rows are excluded
/// outright — so the milestone this op names is the milestone that tab names.
fn open_milestone(pool: &DbPool, project_id: &str) -> Option<(String, String)> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT id, name FROM dev_milestones
          WHERE project_id = ?1 AND status != 'shipped'
          ORDER BY status, order_index LIMIT 1",
        [project_id],
        |row| Ok((row.get("id")?, row.get("name")?)),
    )
    .optional()
    .ok()
    .flatten()
}

fn project_name(pool: &DbPool, project_id: &str) -> Option<String> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT name FROM dev_projects WHERE id = ?1",
        [project_id],
        |row| row.get("name"),
    )
    .optional()
    .ok()
    .flatten()
}

/// Answer `describe_note`. Never fails: a miss is an ANSWER that says so and
/// names what would have worked, because a read op that returns an error string
/// and a read op that returns nothing are indistinguishable from the model's
/// side.
pub fn describe_note(sys_db: &DbPool, query: &str) -> String {
    let Some(note) = resolve(sys_db, query) else {
        return format!(
            "No note matched `{query}`. Try the note's exact id or its exact title. \
             The pad holds at most ten open notes; if the operator is talking about \
             a note you cannot find, ask which one rather than guessing an id."
        );
    };

    let mut out = vec![
        format!("NOTE `{}` — {}", note.id, note.title),
        format!("Status: {}", note.status.as_str()),
    ];

    match note.project_id.as_deref() {
        Some(pid) => {
            let name = project_name(sys_db, pid).unwrap_or_else(|| "(unknown project)".into());
            out.push(format!("Project: {name} (`{pid}`)"));
            match open_milestone(sys_db, pid) {
                Some((mid, mname)) => out.push(format!(
                    "Open milestone: {mname} (`{mid}`) — this is the `milestone_id` \
                     `show_ship_goals` takes for this note."
                )),
                None => out.push(
                    "Open milestone: NONE. This project has no unshipped milestone, so there \
                     is nothing for `show_ship_goals` to bind to — say so rather than \
                     proposing goals into nowhere."
                        .into(),
                ),
            }
        }
        None => out.push(
            "Project: NOT MAPPED. Until the operator maps this note to a project it cannot \
             be published to Fleet or decomposed into goals — say that rather than picking \
             a project for him."
                .into(),
        ),
    }

    out.push(String::new());
    out.push("BODY (the operator's own markdown, verbatim):".into());
    if note.body_md.trim().is_empty() {
        out.push("(empty — there is nothing written here yet)".into());
    } else {
        out.push(clip_chars(&note.body_md, NOTE_BODY_CAP));
    }

    out.push(String::new());
    out.push(
        "Suggest changes with `show_note_suggestions` (note_id above): section / edit / \
         question rows that land as inline blocks in the pad, where he accepts or rejects \
         each one. Body edits only apply while the note is a DRAFT."
            .into(),
    );

    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::repos::dev::milestones::create_milestone;
    use crate::db::repos::dev::projects::create_project;

    fn pool() -> DbPool {
        crate::db::init_test_db().expect("test db")
    }

    /// A project carrying two active milestones and a planned one, so the
    /// resolver's ordering (`status` then `order_index`) has something to do
    /// rather than trivially picking the only row.
    fn seeded() -> (DbPool, String) {
        let p = pool();
        let project = create_project(
            &p,
            "Personas",
            "/tmp/personas",
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap()
        .id;
        create_milestone(&p, &project, "M0", None, None, Some("active"), None).unwrap();
        create_milestone(
            &p,
            &project,
            "M1 - first cut",
            None,
            None,
            Some("active"),
            None,
        )
        .unwrap();
        create_milestone(&p, &project, "M2", None, None, Some("planned"), None).unwrap();
        (p, project)
    }

    #[test]
    fn describes_a_note_with_its_project_and_open_milestone() {
        let (p, project) = seeded();
        let note = repo::create_note(&p, "Notepad polish", Some(&project)).unwrap();
        repo::update_note(
            &p,
            &note.id,
            None,
            Some(
                "## Goal
Make it good.",
            ),
            None,
            None,
        )
        .unwrap();

        let out = describe_note(&p, &note.id);
        assert!(out.contains(&note.id), "{out}");
        assert!(out.contains("Notepad polish"), "{out}");
        assert!(out.contains("Status: draft"), "{out}");
        assert!(out.contains("Personas"), "{out}");
        assert!(out.contains("Make it good."), "{out}");
        assert!(out.contains("Open milestone:"), "{out}");
    }

    #[test]
    fn resolves_by_title_as_well_as_id() {
        let (p, project) = seeded();
        let note = repo::create_note(&p, "Notepad polish", Some(&project)).unwrap();
        let out = describe_note(&p, "notepad POLISH");
        assert!(out.contains(&note.id), "{out}");
    }

    /// An unmapped note is a legitimate state, and the answer has to SAY it is
    /// blocked rather than silently omitting the project line — an omission
    /// reads as "no project mentioned", which is what a model fills in.
    #[test]
    fn an_unmapped_note_says_so_instead_of_going_quiet() {
        let p = pool();
        let note = repo::create_note(&p, "Unmapped thought", None).unwrap();
        let out = describe_note(&p, &note.id);
        assert!(out.contains("NOT MAPPED"), "{out}");
        assert!(!out.contains("Open milestone:"), "{out}");
    }

    #[test]
    fn a_miss_answers_rather_than_erroring() {
        let out = describe_note(&pool(), "nope");
        assert!(out.contains("No note matched `nope`"), "{out}");
    }

    /// The body is the one unbounded input. It is cut HERE, visibly, so the
    /// dispatcher's envelope never gets to cut the closing doctrine instead.
    #[test]
    fn a_long_body_is_clipped_and_says_so() {
        let p = pool();
        let note = repo::create_note(&p, "Long", None).unwrap();
        let long = "x".repeat(NOTE_BODY_CAP + 500);
        repo::update_note(&p, &note.id, None, Some(&long), None, None).unwrap();
        let out = describe_note(&p, &note.id);
        assert!(out.contains("body truncated"), "{out}");
        assert!(
            out.contains("show_note_suggestions"),
            "the tail must survive the clip"
        );
    }

    /// A project with NO unshipped milestone has nothing for `show_ship_goals`
    /// to bind to, and the answer says so rather than going quiet.
    #[test]
    fn a_project_without_an_open_milestone_says_none() {
        let p = pool();
        let project = create_project(&p, "Bare", "/tmp/bare", None, None, None, None, None)
            .unwrap()
            .id;
        let note = repo::create_note(&p, "Idea", Some(&project)).unwrap();
        let out = describe_note(&p, &note.id);
        assert!(out.contains("Open milestone: NONE"), "{out}");
    }
}
