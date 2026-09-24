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
//! * The tail of the note's THREAD (`dev_note_comments`): the last
//!   [`THREAD_TAIL`] entries — operator comments, her own, the note-task
//!   agent's run reviews, status milestones — each clipped to
//!   [`THREAD_ENTRY_CAP`]. The pad asks her to read the thread before she
//!   answers on it, and this is the reading.
//!
//! It does NOT restate the note's dispatch history (`dispatch_target`,
//! `fleet_session_id`, the ingested `result_json`). Those are the pad's own
//! bookkeeping, they are visible on the operator's screen, and a decomposition
//! is not improved by knowing which fleet session last touched the note. (A
//! finished run DOES reach her, as the agent's review entry on the thread.)
//!
//! # `comment_on_note` — the one write here
//!
//! [`comment_on_note`] posts HER reply to a note's thread. It is the write half
//! of the thread the read above exposes, and it is deliberately narrow: one
//! comment, on a note that exists, capped at [`COMMENT_BODY_MAX_BYTES`]. A
//! miss is an answer, not an error — the same rule [`describe_note`] follows.

use rusqlite::OptionalExtension;

use crate::db::models::{DevNote, NoteComment, NoteCommentAuthor, NoteCommentKind, NoteStatus};
use crate::db::repos::dev::note_comments::{self as comments_repo, NewNoteComment};
use crate::db::repos::dev_tools as repo;
use crate::db::DbPool;

/// Thread entries `describe_note` shows — the most recent ones, oldest first.
const THREAD_TAIL: usize = 8;

/// Longest single thread entry the answer renders, in characters. Eight of
/// these plus the body cap is what `READ_OP_DETAIL_CHARS_NOTE` is sized for.
const THREAD_ENTRY_CAP: usize = 400;

/// Longest `comment_on_note` body, in BYTES (clipped on a char boundary). The
/// same 4 KiB the suggestion rows use: a comment is a reply, not a document.
pub(crate) const COMMENT_BODY_MAX_BYTES: usize = 4096;

/// How her comments are signed on the thread.
const ATHENA_AUTHOR: &str = "Athena";

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

/// One thread entry, clipped for the answer, plus whether anything was cut —
/// the flag rides out beside the text rather than as punctuation spliced into
/// it (the tool-result contract). Whitespace is flattened so an entry stays
/// one bullet: the answer is read as a list, and a multi-line entry would
/// read as several.
fn clip_entry(s: &str) -> (String, bool) {
    let flat = s.split_whitespace().collect::<Vec<_>>().join(" ");
    if flat.chars().count() <= THREAD_ENTRY_CAP {
        return (flat, false);
    }
    (flat.chars().take(THREAD_ENTRY_CAP).collect(), true)
}

/// The thread tail as answer lines. A read failure says so rather than
/// pretending the thread is empty — "no comments" is a claim she would repeat.
fn thread_lines(pool: &DbPool, note_id: &str) -> Vec<String> {
    let entries = match comments_repo::recent_comments(pool, note_id, THREAD_TAIL) {
        Ok(e) => e,
        Err(e) => {
            tracing::warn!(note_id, error = %e, "describe_note: thread read failed");
            return vec!["THREAD: could not be read this turn — do not claim it is empty.".into()];
        }
    };
    if entries.is_empty() {
        return vec!["THREAD: empty — nothing has been posted on this note yet.".into()];
    }
    let mut out = vec![format!(
        "THREAD (the last {} entries, oldest first):",
        entries.len()
    )];
    for c in &entries {
        let author = match (c.author_kind, c.author_name.as_deref()) {
            (NoteCommentAuthor::Operator, _) => "operator".to_string(),
            (NoteCommentAuthor::Athena, _) => "you (Athena)".to_string(),
            (NoteCommentAuthor::Agent, Some(name)) => format!("agent {name}"),
            (NoteCommentAuthor::Agent, None) => "agent".to_string(),
            (NoteCommentAuthor::System, _) => "system".to_string(),
        };
        let verdict = c
            .verdict
            .map(|v| format!(" [{}]", v.as_str()))
            .unwrap_or_default();
        let about = c
            .ref_kind
            .map(|r| format!(" ({})", r.as_str()))
            .unwrap_or_default();
        let (body, clipped) = clip_entry(&c.body_md);
        let clipped = if clipped {
            " [clipped — the operator sees the whole entry on the pad]"
        } else {
            ""
        };
        out.push(format!(
            "- {} · {author} · {}{verdict}{about}: {body}{clipped}",
            c.created_at,
            c.kind.as_str(),
        ));
    }
    out
}

/// What [`comment_on_note`] did. Not a `Result`: a refusal is an ANSWER she
/// reads next turn, never an error string that looks like nothing happened.
#[derive(Debug)]
pub enum CommentOnNote {
    /// The comment is on the thread.
    Posted(NoteComment),
    /// It was not posted; the text says why and what would work.
    Refused(String),
}

/// Post Athena's comment on a note's thread (`comment_on_note`).
///
/// The note is resolved by EXACT id only — unlike the read, a write that
/// guessed which note a title meant would post her words under the wrong
/// requirement. The body is trimmed and clipped to
/// [`COMMENT_BODY_MAX_BYTES`] on a char boundary.
pub fn comment_on_note(sys_db: &DbPool, note_id: &str, body_md: &str) -> CommentOnNote {
    let note_id = note_id.trim();
    let body = body_md.trim();
    if note_id.is_empty() {
        return CommentOnNote::Refused(
            "`comment_on_note` needs a `note_id` — the exact id `describe_note` printed.".into(),
        );
    }
    if body.is_empty() {
        return CommentOnNote::Refused(
            "`comment_on_note` needs a non-empty `body_md`; nothing was posted.".into(),
        );
    }
    let note = match repo::get_note(sys_db, note_id) {
        Ok(n) => n,
        Err(crate::error::AppError::NotFound(_)) => {
            return CommentOnNote::Refused(format!(
                "No note has the id `{note_id}`, so the comment was not posted. Read the note                  with `describe_note` and use the exact id it prints — do not guess one."
            ))
        }
        Err(e) => {
            return CommentOnNote::Refused(format!(
                "The comment was not posted: the note could not be read ({e}). Tell the                  operator rather than retrying blind."
            ))
        }
    };
    let mut end = body.len().min(COMMENT_BODY_MAX_BYTES);
    while !body.is_char_boundary(end) {
        end -= 1;
    }
    match comments_repo::insert_comment(
        sys_db,
        &NewNoteComment {
            note_id: &note.id,
            author_kind: NoteCommentAuthor::Athena,
            author_name: Some(ATHENA_AUTHOR),
            kind: NoteCommentKind::Comment,
            body_md: &body[..end],
            ref_kind: None,
            ref_id: None,
            verdict: None,
        },
    ) {
        Ok(c) => CommentOnNote::Posted(c),
        Err(e) => CommentOnNote::Refused(format!(
            "The comment was not posted on `{}`: {e}.",
            note.title
        )),
    }
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
/// The predicate lives in the repo now
/// (`repos::dev::milestones::open_milestone_for_project`) so this op and the
/// Notepad's promote command cannot drift on what "open" means.
fn open_milestone(pool: &DbPool, project_id: &str) -> Option<(String, String)> {
    crate::db::repos::dev::milestones::open_milestone_for_project(pool, project_id)
        .ok()
        .flatten()
        .map(|m| (m.id, m.name))
}

/// One clause after the status token, for the states whose NAME does not say
/// what they mean. A model that reads `Status: cut` and guesses is a model that
/// proposes goals into a frozen scope.
fn status_gloss(status: NoteStatus) -> &'static str {
    match status {
        NoteStatus::Scoped => " (this note is a milestone's living brief; still editable)",
        NoteStatus::Cut => " (its milestone is cut — scope is frozen; adding to it is scope creep)",
        NoteStatus::Shipped => " (its milestone shipped; this note is history)",
        _ => "",
    }
}

fn milestone_name(pool: &DbPool, milestone_id: &str) -> Option<String> {
    let conn = pool.get().ok()?;
    conn.query_row(
        "SELECT name FROM dev_milestones WHERE id = ?1",
        [milestone_id],
        |row| row.get("name"),
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
        format!(
            "Status: {}{}",
            note.status.as_str(),
            status_gloss(note.status)
        ),
    ];

    match note.project_id.as_deref() {
        Some(pid) => {
            let name = project_name(sys_db, pid).unwrap_or_else(|| "(unknown project)".into());
            out.push(format!("Project: {name} (`{pid}`)"));
            // A LINKED note answers the milestone question by itself, and the
            // project's "open" milestone is then the wrong thing to name: this
            // note IS a milestone's brief, and everything live about that cut
            // is one read away rather than something to restate here.
            match note.milestone_id.as_deref() {
                Some(mid) => {
                    let mname =
                        milestone_name(sys_db, mid).unwrap_or_else(|| "(unknown milestone)".into());
                    out.push(format!(
                        "Milestone: {mname} (`{mid}`) — this note is its brief. For the live \
                         cut and readiness read `describe_ship_milestone {mid}`."
                    ));
                }
                None => match open_milestone(sys_db, pid) {
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
                },
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
    out.extend(thread_lines(sys_db, &note.id));

    out.push(String::new());
    out.push(
        "Suggest changes with `show_note_suggestions` (note_id above): section / edit / \
         question rows that land as inline blocks in the pad, where he accepts or rejects \
         each one. Body edits only apply while the note is a DRAFT. Answer on the thread \
         with `comment_on_note` (same note_id) — read the entries above first."
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

    /// The thread tail rides in the answer BEFORE the closing doctrine: the
    /// last eight entries only, oldest first, each clipped, with who wrote it
    /// and a review's verdict — so she reads the conversation before replying.
    #[test]
    fn the_answer_carries_the_thread_tail_before_the_doctrine() -> Result<(), crate::error::AppError>
    {
        let p = pool();
        let note = repo::create_note(&p, "Threaded", None)?;
        assert!(describe_note(&p, &note.id).contains("THREAD: empty"));
        for i in 0..10 {
            comments_repo::insert_comment(
                &p,
                &NewNoteComment::operator_comment(&note.id, &format!("entry number {i}")),
            )?;
        }
        let long = "y".repeat(THREAD_ENTRY_CAP + 50);
        comments_repo::insert_comment(
            &p,
            &NewNoteComment {
                note_id: &note.id,
                author_kind: NoteCommentAuthor::Agent,
                author_name: Some("note-task"),
                kind: NoteCommentKind::Review,
                body_md: &long,
                ref_kind: Some(crate::db::models::NoteCommentRef::Run),
                ref_id: Some("run-1"),
                verdict: None,
            },
        )?;
        let out = describe_note(&p, &note.id);
        assert!(out.contains("THREAD (the last 8 entries"), "{out}");
        assert!(!out.contains("entry number 2"), "only the tail: {out}");
        assert!(out.contains("entry number 3"), "{out}");
        assert!(
            out.contains("agent note-task · review [pending] (run)"),
            "{out}"
        );
        assert!(
            out.contains("[clipped"),
            "a long entry is clipped, visibly: {out}"
        );
        let thread_at = out.find("THREAD").unwrap_or(usize::MAX);
        let doctrine_at = out.find("comment_on_note").unwrap_or(0);
        assert!(thread_at < doctrine_at, "the doctrine stays last: {out}");
        Ok(())
    }

    #[test]
    fn comment_on_note_posts_an_athena_comment_and_clips_it() -> Result<(), crate::error::AppError>
    {
        let p = pool();
        let note = repo::create_note(&p, "Target", None)?;
        // Two bytes per char, so the 4 KiB cut must land on a char boundary.
        let long = "é".repeat(COMMENT_BODY_MAX_BYTES);
        let CommentOnNote::Posted(c) = comment_on_note(&p, &note.id, &long) else {
            panic!("expected the comment to post");
        };
        assert_eq!(c.author_kind, NoteCommentAuthor::Athena);
        assert_eq!(c.author_name.as_deref(), Some("Athena"));
        assert_eq!(c.kind, NoteCommentKind::Comment);
        assert!(c.body_md.len() <= COMMENT_BODY_MAX_BYTES);
        assert!(c.read_at.is_none(), "her comment is news to the operator");
        Ok(())
    }

    #[test]
    fn comment_on_note_refuses_an_unknown_note_and_an_empty_body_with_an_answer() {
        let p = pool();
        match comment_on_note(&p, "nope", "hello") {
            CommentOnNote::Refused(why) => {
                assert!(why.contains("No note has the id `nope`"), "{why}")
            }
            CommentOnNote::Posted(_) => panic!("an unknown note must not take a comment"),
        }
        assert!(matches!(
            comment_on_note(&p, "nope", "   "),
            CommentOnNote::Refused(_)
        ));
        assert!(matches!(
            comment_on_note(&p, "  ", "x"),
            CommentOnNote::Refused(_)
        ));
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
