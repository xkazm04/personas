//! `dev_note_comments` — the per-note thread (e40).
//!
//! Every entry the pad shows under a note — an operator comment, Athena's
//! review of a suggestions card, the note-task agent's run review, a system
//! status milestone — is one row here. Rules this door holds:
//!
//! - **The operator's own words are born read.** An entry the operator wrote
//!   must not light the unread icon on their own card, so `read_at` is stamped
//!   at insert for `author_kind = operator`.
//! - **A verdict belongs to a review.** A `review` entry starts `pending` when
//!   the producer names none; a `comment` / `system` entry carrying a verdict is
//!   refused, and [`set_verdict`] refuses a non-review target.
//! - **Unread is counted, not remembered** — [`unread_counts`] is a live
//!   `GROUP BY` over `read_at IS NULL`.

use crate::models::{
    NoteComment, NoteCommentAuthor, NoteCommentKind, NoteCommentRef, NoteReviewVerdict, NoteUnread,
};
use crate::DbPool;
use personas_core::error::AppError;
use personas_core::validation::require_non_empty;
use rusqlite::params;

/// Every column of `dev_note_comments`, in the order [`row_to_comment_raw`]
/// reads them.
const COMMENT_COLUMNS: &str = "id, note_id, author_kind, author_name, kind, body_md, \
     ref_kind, ref_id, verdict, created_at, read_at";

row_mapper!(row_to_comment_raw -> NoteCommentRow {
    id, note_id, author_kind, author_name, kind, body_md,
    ref_kind, ref_id, verdict, created_at, read_at,
});

row_mapper!(row_to_unread -> NoteUnread { note_id, unread, latest_id });

/// The row as SQLite hands it over, vocabularies still `String`. Same shadow
/// pattern as `notes::DevNoteRow`: the macro keeps the column-name discipline,
/// [`row_to_comment`] does the fallible narrowing.
struct NoteCommentRow {
    id: String,
    note_id: String,
    author_kind: String,
    author_name: Option<String>,
    kind: String,
    body_md: String,
    ref_kind: Option<String>,
    ref_id: Option<String>,
    verdict: Option<String>,
    created_at: String,
    read_at: Option<String>,
}

fn vocab_error(column: &str, raw: &str) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            format!("unknown dev_note_comments.{column} `{raw}`"),
        )),
    )
}

fn parse_opt<T>(
    column: &str,
    raw: Option<String>,
    parse: fn(&str) -> Option<T>,
) -> rusqlite::Result<Option<T>> {
    match raw {
        None => Ok(None),
        Some(s) => parse(&s).map(Some).ok_or_else(|| vocab_error(column, &s)),
    }
}

fn row_to_comment(row: &rusqlite::Row) -> rusqlite::Result<NoteComment> {
    let raw = row_to_comment_raw(row)?;
    let author_kind = NoteCommentAuthor::parse(&raw.author_kind)
        .ok_or_else(|| vocab_error("author_kind", &raw.author_kind))?;
    let kind = NoteCommentKind::parse(&raw.kind).ok_or_else(|| vocab_error("kind", &raw.kind))?;
    Ok(NoteComment {
        id: raw.id,
        note_id: raw.note_id,
        author_kind,
        author_name: raw.author_name,
        kind,
        body_md: raw.body_md,
        ref_kind: parse_opt("ref_kind", raw.ref_kind, NoteCommentRef::parse)?,
        ref_id: raw.ref_id,
        verdict: parse_opt("verdict", raw.verdict, NoteReviewVerdict::parse)?,
        created_at: raw.created_at,
        read_at: raw.read_at,
    })
}

/// What a producer hands [`insert_comment`]. A struct rather than nine
/// positional arguments, because three of them are optional strings that are
/// easy to transpose.
#[derive(Debug, Clone)]
pub struct NewNoteComment<'a> {
    pub note_id: &'a str,
    pub author_kind: NoteCommentAuthor,
    pub author_name: Option<&'a str>,
    pub kind: NoteCommentKind,
    pub body_md: &'a str,
    pub ref_kind: Option<NoteCommentRef>,
    pub ref_id: Option<&'a str>,
    /// `None` on a `review` means `pending`; must be `None` on anything else.
    pub verdict: Option<NoteReviewVerdict>,
}

impl<'a> NewNoteComment<'a> {
    /// The common shape: an operator comment on a note.
    pub fn operator_comment(note_id: &'a str, body_md: &'a str) -> Self {
        Self {
            note_id,
            author_kind: NoteCommentAuthor::Operator,
            author_name: None,
            kind: NoteCommentKind::Comment,
            body_md,
            ref_kind: None,
            ref_id: None,
            verdict: None,
        }
    }

    /// A status milestone: the note reached `status_token` (`completed`,
    /// `cut`, `shipped`). One row per transition — coalescing a burst of them
    /// into one bubble is the UI's job, not the table's. The body IS the
    /// token: the pad renders its own label from `ref_kind = status` +
    /// `ref_id`, so no English is stored here.
    pub fn status_milestone(note_id: &'a str, status_token: &'a str) -> Self {
        Self {
            note_id,
            author_kind: NoteCommentAuthor::System,
            author_name: None,
            kind: NoteCommentKind::System,
            body_md: status_token,
            ref_kind: Some(NoteCommentRef::Status),
            ref_id: Some(status_token),
            verdict: None,
        }
    }
}

/// Append one entry to a note's thread. The note must exist (FK); the body is
/// trimmed and must be non-empty.
pub fn insert_comment(pool: &DbPool, new: &NewNoteComment<'_>) -> Result<NoteComment, AppError> {
    let body = new.body_md.trim();
    require_non_empty("Comment body", body)?;
    let verdict = match (new.kind, new.verdict) {
        (NoteCommentKind::Review, None) => Some(NoteReviewVerdict::Pending),
        (NoteCommentKind::Review, v) => v,
        (_, None) => None,
        (_, Some(_)) => {
            return Err(AppError::Validation(
                "Only a review entry carries a verdict".into(),
            ))
        }
    };
    timed_query!("dev_note_comments", "dev_note_comments::insert", {
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let read_at = (new.author_kind == NoteCommentAuthor::Operator).then(|| now.clone());
        let conn = pool.get()?;
        conn.execute(
            "INSERT INTO dev_note_comments
                (id, note_id, author_kind, author_name, kind, body_md,
                 ref_kind, ref_id, verdict, created_at, read_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                new.note_id,
                new.author_kind.as_str(),
                new.author_name,
                new.kind.as_str(),
                body,
                new.ref_kind.map(|r| r.as_str()),
                new.ref_id,
                verdict.map(|v| v.as_str()),
                now,
                read_at,
            ],
        )?;
        drop(conn);
        get_comment(pool, &id)
    })
}

/// One entry by id.
pub fn get_comment(pool: &DbPool, id: &str) -> Result<NoteComment, AppError> {
    timed_query!("dev_note_comments", "dev_note_comments::get", {
        let conn = pool.get()?;
        conn.query_row(
            &format!("SELECT {COMMENT_COLUMNS} FROM dev_note_comments WHERE id = ?1"),
            params![id],
            row_to_comment,
        )
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => {
                AppError::NotFound(format!("Note comment {id}"))
            }
            other => AppError::Database(other),
        })
    })
}

/// A note's thread, oldest first (rowid breaks a same-instant tie in insert
/// order).
pub fn list_comments(pool: &DbPool, note_id: &str) -> Result<Vec<NoteComment>, AppError> {
    timed_query!("dev_note_comments", "dev_note_comments::list", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COMMENT_COLUMNS} FROM dev_note_comments WHERE note_id = ?1 \
             ORDER BY created_at ASC, rowid ASC"
        ))?;
        let rows = stmt.query_map(params![note_id], row_to_comment)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// The newest `limit` entries of a note's thread, returned OLDEST FIRST (the
/// order a reader reads them in). `describe_note` uses it so Athena reads the
/// tail of the conversation before she answers it.
pub fn recent_comments(
    pool: &DbPool,
    note_id: &str,
    limit: usize,
) -> Result<Vec<NoteComment>, AppError> {
    timed_query!("dev_note_comments", "dev_note_comments::recent", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {COMMENT_COLUMNS} FROM dev_note_comments WHERE note_id = ?1              ORDER BY created_at DESC, rowid DESC LIMIT ?2"
        ))?;
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        let rows = stmt.query_map(params![note_id, limit], row_to_comment)?;
        let mut out = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)?;
        out.reverse();
        Ok(out)
    })
}

/// Whether this note already carries the review for run `run_id`. The ingest
/// sweep keys its thread writes on this, so a re-sweep of the same run (a
/// marker that failed to write, an on-demand sweep racing the ticker) never
/// posts the same review twice.
pub fn has_run_review(pool: &DbPool, note_id: &str, run_id: &str) -> Result<bool, AppError> {
    timed_query!("dev_note_comments", "dev_note_comments::has_run_review", {
        let conn = pool.get()?;
        let found: i64 = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM dev_note_comments
                            WHERE note_id = ?1 AND kind = 'review'
                              AND ref_kind = 'run' AND ref_id = ?2) AS found",
            params![note_id, run_id],
            |row| row.get("found"),
        )?;
        Ok(found != 0)
    })
}

/// Every note with at least one unread entry: the count and the newest unread
/// entry's id. Notes with nothing unread are absent, not zero.
pub fn unread_counts(pool: &DbPool) -> Result<Vec<NoteUnread>, AppError> {
    timed_query!("dev_note_comments", "dev_note_comments::unread_counts", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT c.note_id AS note_id,
                    COUNT(c.id) AS unread,
                    (SELECT l.id FROM dev_note_comments l
                      WHERE l.note_id = c.note_id AND l.read_at IS NULL
                      ORDER BY l.created_at DESC, l.rowid DESC LIMIT 1) AS latest_id
               FROM dev_note_comments c
              WHERE c.read_at IS NULL
              GROUP BY c.note_id
              ORDER BY c.note_id",
        )?;
        let rows = stmt.query_map([], row_to_unread)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Stamp every unread entry of one note read. Returns how many changed.
pub fn mark_read(pool: &DbPool, note_id: &str) -> Result<usize, AppError> {
    timed_query!("dev_note_comments", "dev_note_comments::mark_read", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        let changed = conn.execute(
            "UPDATE dev_note_comments SET read_at = ?1 WHERE note_id = ?2 AND read_at IS NULL",
            params![now, note_id],
        )?;
        Ok(changed)
    })
}

/// Record the operator's verdict on a review entry. Answering a review is
/// reading it, so `read_at` is stamped too when still NULL. A non-review
/// target is refused.
pub fn set_verdict(
    pool: &DbPool,
    comment_id: &str,
    verdict: NoteReviewVerdict,
) -> Result<NoteComment, AppError> {
    let current = get_comment(pool, comment_id)?;
    if current.kind != NoteCommentKind::Review {
        return Err(AppError::Validation(format!(
            "Note comment {comment_id} is not a review and takes no verdict"
        )));
    }
    timed_query!("dev_note_comments", "dev_note_comments::set_verdict", {
        let now = chrono::Utc::now().to_rfc3339();
        let conn = pool.get()?;
        conn.execute(
            "UPDATE dev_note_comments
                SET verdict = ?1, read_at = COALESCE(read_at, ?2)
              WHERE id = ?3",
            params![verdict.as_str(), now, comment_id],
        )?;
        drop(conn);
        get_comment(pool, comment_id)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::repos::dev::notes::{create_note, delete_note};

    fn pool() -> DbPool {
        crate::init_test_db().expect("test db")
    }

    fn review<'a>(note_id: &'a str, body: &'a str) -> NewNoteComment<'a> {
        NewNoteComment {
            note_id,
            author_kind: NoteCommentAuthor::Agent,
            author_name: Some("note-task"),
            kind: NoteCommentKind::Review,
            body_md: body,
            ref_kind: Some(NoteCommentRef::Run),
            ref_id: Some("run-1"),
            verdict: None,
        }
    }

    #[test]
    fn insert_and_list_keep_thread_order_and_map_every_column() {
        let p = pool();
        let note = create_note(&p, "n", None).unwrap();
        let a =
            insert_comment(&p, &NewNoteComment::operator_comment(&note.id, "  first  ")).unwrap();
        let b = insert_comment(&p, &review(&note.id, "run done")).unwrap();

        assert_eq!(a.body_md, "first", "body is trimmed at the door");
        assert_eq!(a.author_kind, NoteCommentAuthor::Operator);
        assert!(
            a.read_at.is_some(),
            "the operator's own words are born read"
        );
        assert!(a.verdict.is_none());

        assert_eq!(b.verdict, Some(NoteReviewVerdict::Pending));
        assert_eq!(b.ref_kind, Some(NoteCommentRef::Run));
        assert_eq!(b.ref_id.as_deref(), Some("run-1"));
        assert_eq!(b.author_name.as_deref(), Some("note-task"));
        assert!(b.read_at.is_none());

        let listed = list_comments(&p, &note.id).unwrap();
        let ids: Vec<&str> = listed.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec![a.id.as_str(), b.id.as_str()]);
    }

    #[test]
    fn insert_refuses_an_empty_body_and_a_verdict_off_a_review() {
        let p = pool();
        let note = create_note(&p, "n", None).unwrap();
        assert!(insert_comment(&p, &NewNoteComment::operator_comment(&note.id, "   ")).is_err());
        let mut bad = NewNoteComment::operator_comment(&note.id, "x");
        bad.verdict = Some(NoteReviewVerdict::Approved);
        assert!(matches!(
            insert_comment(&p, &bad),
            Err(AppError::Validation(_))
        ));
    }

    #[test]
    fn unread_counts_group_by_note_and_mark_read_clears_one_note() {
        let p = pool();
        let n1 = create_note(&p, "one", None).unwrap();
        let n2 = create_note(&p, "two", None).unwrap();
        insert_comment(&p, &review(&n1.id, "r1")).unwrap();
        let newest = insert_comment(&p, &review(&n1.id, "r2")).unwrap();
        insert_comment(&p, &review(&n2.id, "r3")).unwrap();
        // Operator-authored: never counts.
        insert_comment(&p, &NewNoteComment::operator_comment(&n2.id, "mine")).unwrap();

        let counts = unread_counts(&p).unwrap();
        let one = counts.iter().find(|u| u.note_id == n1.id).unwrap();
        let two = counts.iter().find(|u| u.note_id == n2.id).unwrap();
        assert_eq!(one.unread, 2);
        assert_eq!(one.latest_id.as_deref(), Some(newest.id.as_str()));
        assert_eq!(two.unread, 1);

        assert_eq!(mark_read(&p, &n1.id).unwrap(), 2);
        assert_eq!(
            mark_read(&p, &n1.id).unwrap(),
            0,
            "a re-mark changes nothing"
        );
        let counts = unread_counts(&p).unwrap();
        assert!(
            counts.iter().all(|u| u.note_id != n1.id),
            "read notes are absent"
        );
        assert_eq!(counts.len(), 1);
    }

    #[test]
    fn set_verdict_stamps_a_review_and_refuses_anything_else() {
        let p = pool();
        let note = create_note(&p, "n", None).unwrap();
        let r = insert_comment(&p, &review(&note.id, "r")).unwrap();
        let done = set_verdict(&p, &r.id, NoteReviewVerdict::Rejected).unwrap();
        assert_eq!(done.verdict, Some(NoteReviewVerdict::Rejected));
        assert!(done.read_at.is_some(), "answering a review reads it");

        let c = insert_comment(&p, &NewNoteComment::operator_comment(&note.id, "c")).unwrap();
        assert!(matches!(
            set_verdict(&p, &c.id, NoteReviewVerdict::Approved),
            Err(AppError::Validation(_))
        ));
        assert!(matches!(
            set_verdict(&p, "nope", NoteReviewVerdict::Approved),
            Err(AppError::NotFound(_))
        ));
    }

    #[test]
    fn recent_comments_takes_the_tail_oldest_first() -> Result<(), AppError> {
        let p = pool();
        let note = create_note(&p, "n", None)?;
        for body in ["a", "b", "c", "d"] {
            insert_comment(&p, &NewNoteComment::operator_comment(&note.id, body))?;
        }
        let tail: Vec<String> = recent_comments(&p, &note.id, 2)?
            .into_iter()
            .map(|c| c.body_md)
            .collect();
        assert_eq!(tail, vec!["c".to_string(), "d".to_string()]);
        Ok(())
    }

    #[test]
    fn has_run_review_keys_on_the_run_id() -> Result<(), AppError> {
        let p = pool();
        let note = create_note(&p, "n", None)?;
        assert!(!has_run_review(&p, &note.id, "run-1")?);
        insert_comment(&p, &review(&note.id, "r"))?;
        assert!(has_run_review(&p, &note.id, "run-1")?);
        assert!(!has_run_review(&p, &note.id, "run-2")?);
        Ok(())
    }

    #[test]
    fn a_status_milestone_is_a_system_row_carrying_its_token() -> Result<(), AppError> {
        let p = pool();
        let note = create_note(&p, "n", None)?;
        let row = insert_comment(&p, &NewNoteComment::status_milestone(&note.id, "cut"))?;
        assert_eq!(row.kind, NoteCommentKind::System);
        assert_eq!(row.author_kind, NoteCommentAuthor::System);
        assert_eq!(row.ref_kind, Some(NoteCommentRef::Status));
        assert_eq!(row.ref_id.as_deref(), Some("cut"));
        assert_eq!(row.body_md, "cut");
        assert!(row.verdict.is_none(), "a milestone carries no verdict");
        assert!(row.read_at.is_none(), "a milestone is news to the operator");
        Ok(())
    }

    #[test]
    fn deleting_the_note_takes_its_thread_with_it() {
        let p = pool();
        let note = create_note(&p, "n", None).unwrap();
        insert_comment(&p, &review(&note.id, "r")).unwrap();
        delete_note(&p, &note.id).unwrap();
        assert!(list_comments(&p, &note.id).unwrap().is_empty());
        assert!(unread_counts(&p).unwrap().is_empty());
    }
}
