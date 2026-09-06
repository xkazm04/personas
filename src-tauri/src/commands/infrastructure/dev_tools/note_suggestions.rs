//! Athena's `show_note_suggestions` card: validation, text application, and
//! the one command that resolves a row.
//!
//! # The shape of the thing
//!
//! `show_note_suggestions` is the third card op in the family that already
//! holds `show_fleet_plan`, `show_ship_milestone` and `show_ship_goals`: it
//! auto-fires, it writes nothing, and the rendered rows ARE the consent
//! surface. What makes it different from its three siblings is that the consent
//! surface is not only in the chat — the same rows also render as inline blocks
//! inside the note itself, at the heading each row anchors to, which is where
//! an edit to a document is actually judged.
//!
//! So there is no batch Confirm. Each row resolves ON ITS OWN
//! ([`notepad_resolve_suggestion`]), and the card as a whole is marked
//! `dispatched` only once no row is left undecided — the card's job is to keep
//! the proposal alive across a refresh, not to gate it.
//!
//! # Why the validation fails closed
//!
//! A row that reaches the pad is a row the operator will read as Athena's
//! reading of HIS note. If we cannot prove the note exists, is not archived,
//! and that every row is bounded and well-formed, the honest outcome is no card
//! at all plus a warning she reads next turn — not a card with a broken row in
//! it that applies garbage into a document when he presses Accept.

use rusqlite::params;
use serde_json::{json, Value};

use crate::db::models::DevNote;
use crate::db::repos::dev_tools as repo;
use crate::error::AppError;

/// Rows one card may carry. Eight is the same reviewability ceiling every other
/// card op in this codebase uses, and it is the number the contract states.
pub(crate) const NOTE_SUGGESTIONS_MAX_ROWS: usize = 8;

/// Longest `body_md` one row may carry, in BYTES (the contract states 4 KiB).
/// A row is a paragraph or a section, not a document: a row longer than this is
/// a model pasting the whole note back.
pub(crate) const NOTE_SUGGESTION_BODY_MAX_BYTES: usize = 4096;

/// Longest anchor heading text. It has to MATCH a heading line in the body, and
/// a heading longer than this is not a heading.
pub(crate) const NOTE_SUGGESTION_ANCHOR_MAX: usize = 120;

/// Longest row title (the inline block's own label).
const NOTE_SUGGESTION_TITLE_MAX: usize = 120;

/// The three things a row can be. Spelled as an allow-list rather than a free
/// string because the pad renders a different affordance for each one — a
/// `question` has no body to apply, so accepting it must not touch the note.
pub(crate) const NOTE_SUGGESTION_KINDS: &[&str] = &["section", "edit", "question"];

/// The three terminal outcomes a row may reach. `null` is the fourth state and
/// means undecided; it is never written by a caller.
pub(crate) const NOTE_SUGGESTION_OUTCOMES: &[&str] = &["accepted", "rejected", "edited"];

/// One validated suggestion row, ready to become card config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NoteSuggestionRow {
    pub row_id: String,
    pub kind: String,
    /// The heading this row attaches to, already trimmed. `None` = end of note.
    pub anchor: Option<String>,
    pub title: Option<String>,
    pub body_md: String,
}

/// A validated `show_note_suggestions` proposal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NoteSuggestionsPlan {
    pub note_id: String,
    pub note_title: String,
    pub rows: Vec<NoteSuggestionRow>,
}

impl NoteSuggestionsPlan {
    /// The `config` blob the chat card carries.
    ///
    /// snake_case on purpose, matching `ship_goals` beside it: this JSON is
    /// hand-built here and parsed at the TS boundary
    /// (`parseNoteSuggestionRows`), so it is a wire format of its own and not a
    /// serde projection of a Rust struct. Naming it camelCase would imply a
    /// ts-rs binding that does not and should not exist.
    pub fn config(&self) -> Value {
        json!({
            "note_id": self.note_id,
            "note_title": self.note_title,
            "rows": self.rows.iter().map(|r| json!({
                "row_id": r.row_id,
                "kind": r.kind,
                "anchor": r.anchor.as_ref().map(|h| json!({ "after_heading": h })),
                "title": r.title,
                "body_md": r.body_md,
                // Always present, always null at proposal time. An absent key
                // and a null one are the same to JS but not to a reader, and
                // "undecided" is a state this card spends most of its life in.
                "outcome": Value::Null,
            })).collect::<Vec<_>>(),
        })
    }
}

/// Validate a `show_note_suggestions` proposal against the real pad.
///
/// Fails CLOSED, and the `Err` string is what Athena reads next turn — so every
/// message says what would have worked, not just what did not.
pub(crate) fn validate_note_suggestions(
    pool: &crate::db::DbPool,
    note_id: &str,
    rows: &[Value],
) -> Result<NoteSuggestionsPlan, String> {
    let note_id = note_id.trim();
    if note_id.is_empty() {
        return Err("`note_id` is required — read the note with `describe_note` first".into());
    }
    if rows.is_empty() {
        return Err("`rows` is empty — there is nothing to suggest".into());
    }
    if rows.len() > NOTE_SUGGESTIONS_MAX_ROWS {
        return Err(format!(
            "{} rows is more than the {NOTE_SUGGESTIONS_MAX_ROWS} an operator can review \
             inside one note. Suggest the important ones and offer the rest next turn.",
            rows.len()
        ));
    }

    let note = repo::get_note(pool, note_id).map_err(|_| {
        format!(
            "no note `{note_id}` — resolve it with `describe_note` first, and use the id it prints"
        )
    })?;
    if note.status == crate::db::models::NoteStatus::Archived {
        return Err(format!(
            "note `{note_id}` is archived. Suggestions land as inline blocks in a note the \
             operator is still working on; say it is archived rather than proposing into it."
        ));
    }

    let mut out: Vec<NoteSuggestionRow> = Vec::with_capacity(rows.len());
    for (i, row) in rows.iter().enumerate() {
        let n = i + 1;
        let kind = row.get("kind").and_then(Value::as_str).unwrap_or("").trim();
        if !NOTE_SUGGESTION_KINDS.contains(&kind) {
            return Err(format!(
                "row {n}: `kind` must be one of {NOTE_SUGGESTION_KINDS:?}, got `{kind}`"
            ));
        }
        let body_md = row
            .get("body_md")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim();
        if body_md.is_empty() {
            return Err(format!(
                "row {n}: `body_md` is required — for a `question` row it is the question itself"
            ));
        }
        if body_md.len() > NOTE_SUGGESTION_BODY_MAX_BYTES {
            return Err(format!(
                "row {n}: `body_md` is {} bytes, over the {NOTE_SUGGESTION_BODY_MAX_BYTES} \
                 limit. A row is a section, not a rewrite of the note.",
                body_md.len()
            ));
        }
        let anchor = match row
            .get("anchor")
            .and_then(|a| a.get("after_heading"))
            .and_then(Value::as_str)
            .map(str::trim)
        {
            None | Some("") => None,
            Some(h) if h.chars().count() > NOTE_SUGGESTION_ANCHOR_MAX => {
                return Err(format!(
                    "row {n}: `anchor.after_heading` is {} characters, over the \
                     {NOTE_SUGGESTION_ANCHOR_MAX} limit — it must be a heading from the note, \
                     not a description of one",
                    h.chars().count()
                ));
            }
            Some(h) => Some(h.to_string()),
        };
        let title = match row.get("title").and_then(Value::as_str).map(str::trim) {
            None | Some("") => None,
            Some(t) if t.chars().count() > NOTE_SUGGESTION_TITLE_MAX => {
                return Err(format!(
                    "row {n}: `title` is too long (max {NOTE_SUGGESTION_TITLE_MAX} characters) \
                     — it is the block's label, and the prose belongs in `body_md`"
                ));
            }
            Some(t) => Some(t.to_string()),
        };

        out.push(NoteSuggestionRow {
            // Server-minted, never taken from the payload: the row id is what
            // `notepad_resolve_suggestion` addresses, and a model-supplied one
            // could collide with another row in the same card.
            row_id: uuid::Uuid::new_v4().to_string(),
            kind: kind.to_string(),
            anchor,
            title,
            body_md: body_md.to_string(),
        });
    }

    Ok(NoteSuggestionsPlan {
        note_id: note.id,
        note_title: note.title,
        rows: out,
    })
}

// ── applying an accepted row into the note body ──────────────────────────────

/// True when `line` is a markdown ATX heading whose text equals `heading`,
/// case-insensitively and ignoring surrounding whitespace.
fn heading_matches(line: &str, heading: &str) -> bool {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&hashes) {
        return false;
    }
    let rest = trimmed[hashes..].trim();
    // A `#Foo` with no space is not a heading in CommonMark; requiring the
    // separator here keeps `#hashtag` out of the match.
    if !trimmed[hashes..].starts_with(char::is_whitespace) {
        return false;
    }
    rest.eq_ignore_ascii_case(heading.trim())
}

/// Depth of an ATX heading line, or `None` when the line is not one.
fn heading_level(line: &str) -> Option<usize> {
    let trimmed = line.trim_start();
    let hashes = trimmed.chars().take_while(|c| *c == '#').count();
    if !(1..=6).contains(&hashes) || !trimmed[hashes..].starts_with(char::is_whitespace) {
        return None;
    }
    Some(hashes)
}

/// Insert `text` into `body`, after the section owned by `anchor`.
///
/// "After the section" means after its last non-blank line and before the next
/// heading of the SAME OR SHALLOWER depth — a `##` section ends where the next
/// `##` or `#` begins, and the `###` subsections in between belong to it. The
/// alternative (stop at the next heading of any level) would file every
/// addition under the first subsection, which is a different document.
///
/// With no anchor, or an anchor that matches nothing, the text goes at the END.
/// A miss appends rather than refusing on purpose: the operator can see where
/// the block landed and move it, and losing his accepted text because a heading
/// was renamed between proposal and click would be the worse failure.
pub(crate) fn apply_suggestion(body: &str, anchor: Option<&str>, text: &str) -> String {
    let text = text.trim_end();
    let append = |b: &str| -> String {
        let head = b.trim_end();
        if head.is_empty() {
            return text.to_string();
        }
        format!("{head}\n\n{text}\n")
    };

    let Some(anchor) = anchor.map(str::trim).filter(|a| !a.is_empty()) else {
        return append(body);
    };

    let lines: Vec<&str> = body.lines().collect();
    let Some(start) = lines.iter().position(|l| heading_matches(l, anchor)) else {
        return append(body);
    };
    let depth = heading_level(lines[start]).unwrap_or(1);

    // End of the section: the next heading at the same depth or shallower.
    let mut end = lines.len();
    for (i, line) in lines.iter().enumerate().skip(start + 1) {
        if heading_level(line).is_some_and(|d| d <= depth) {
            end = i;
            break;
        }
    }
    // Back off trailing blank lines so the insertion sits against the content,
    // not adrift in the gap before the next heading.
    let mut tail = end;
    while tail > start + 1 && lines[tail - 1].trim().is_empty() {
        tail -= 1;
    }

    let mut out: Vec<String> = lines[..tail].iter().map(|s| (*s).to_string()).collect();
    out.push(String::new());
    out.push(text.to_string());
    if tail < lines.len() {
        out.push(String::new());
        out.extend(lines[tail..].iter().map(|s| (*s).to_string()));
    } else {
        out.push(String::new());
    }
    out.join("\n")
}

// ── resolving one row ────────────────────────────────────────────────────────

/// What a resolution did, for the caller's log line.
#[derive(Debug)]
struct Resolution {
    note_id: String,
    /// The new body, when the row changed it.
    next_body: Option<String>,
    /// The heading the row attaches to, carried out of the row so the caller
    /// does not re-read the config it has already walked.
    anchor: Option<String>,
    /// True once every row in the card carries an outcome.
    settled: bool,
    accepted: usize,
    rejected: usize,
}

/// Patch the row's outcome inside the card config and report the aggregate.
///
/// Returns the rewritten config plus the counts, or a validation error when the
/// row does not exist or has already been decided. Re-resolving is refused
/// rather than silently overwritten: the first accept already changed the note,
/// and a second one would apply the same text twice.
fn patch_row_outcome(
    config: &mut Value,
    row_id: &str,
    outcome: &str,
    body_md: Option<&str>,
) -> Result<Resolution, AppError> {
    let note_id = config
        .get("note_id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Validation("this card carries no `note_id`".into()))?
        .to_string();
    let rows = config
        .get_mut("rows")
        .and_then(Value::as_array_mut)
        .ok_or_else(|| AppError::Validation("this card carries no rows".into()))?;

    // Everything read out of the row is OWNED before the row is written to.
    // `serde_json::Value` gives out one borrow at a time, and holding a `&str`
    // into the row across its own mutation is exactly the shape the borrow
    // checker refuses — correctly, since the write can reallocate.
    let (kind, anchor, stored_body) = {
        let row = rows
            .iter()
            .find(|r| r.get("row_id").and_then(Value::as_str) == Some(row_id))
            .ok_or_else(|| AppError::NotFound(format!("suggestion row `{row_id}`")))?;
        // `is_some_and`, not `!…is_none_or(…)`: this workspace's clippy MSRV is
        // 1.80 and `Option::is_none_or` only stabilised in 1.82, so the tidier
        // spelling is a hard error here.
        if row.get("outcome").is_some_and(|o| !o.is_null()) {
            return Err(AppError::Validation(
                "This suggestion was already answered — reload the note to see where it landed."
                    .into(),
            ));
        }
        (
            row.get("kind")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
            row.get("anchor")
                .and_then(|a| a.get("after_heading"))
                .and_then(Value::as_str)
                .map(str::to_string),
            row.get("body_md")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string(),
        )
    };

    // An `edited` row applies the operator's text, not hers — that is the whole
    // difference between the two accepting outcomes.
    let applied_text = match outcome {
        "edited" => body_md.unwrap_or(&stored_body).to_string(),
        _ => stored_body,
    };

    if let Some(row) = rows
        .iter_mut()
        .find(|r| r.get("row_id").and_then(Value::as_str) == Some(row_id))
    {
        row["outcome"] = Value::String(outcome.to_string());
        if outcome == "edited" {
            // Keep the card honest about what was actually applied, so a later
            // read of the row shows the operator's version, not the proposal's.
            row["body_md"] = Value::String(applied_text.clone());
        }
    }

    let mut accepted = 0usize;
    let mut rejected = 0usize;
    let mut settled = true;
    for r in rows.iter() {
        match r.get("outcome").and_then(Value::as_str) {
            Some("rejected") => rejected += 1,
            Some(_) => accepted += 1,
            None => settled = false,
        }
    }

    // A `question` has nothing to apply: accepting it means "I will answer this
    // in the note myself", which is a decision about the ROW, not an edit.
    let changes_body = outcome != "rejected" && kind != "question";
    Ok(Resolution {
        note_id,
        next_body: changes_body.then_some(applied_text),
        anchor,
        settled,
        accepted,
        rejected,
    })
}

/// Read one chat-card row by id. Lives here rather than in `chat_cards` because
/// it is the only caller that needs a single card by id.
fn load_card(pool: &crate::db::UserDbPool, card_id: &str) -> Result<(String, String), AppError> {
    let conn = pool.get()?;
    conn.query_row(
        "SELECT kind, config_json FROM companion_chat_card WHERE id = ?1",
        params![card_id],
        |r| Ok((r.get("kind")?, r.get("config_json")?)),
    )
    .map_err(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => {
            AppError::NotFound(format!("chat card `{card_id}` not found"))
        }
        other => AppError::Database(other),
    })
}

fn store_config(
    pool: &crate::db::UserDbPool,
    card_id: &str,
    config_json: &str,
) -> Result<(), AppError> {
    let conn = pool.get()?;
    let changed = conn.execute(
        "UPDATE companion_chat_card SET config_json = ?2 WHERE id = ?1",
        params![card_id, config_json],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!(
            "chat card `{card_id}` not found"
        )));
    }
    Ok(())
}

/// Accept, edit or reject ONE suggestion row.
///
/// Order is load-bearing: the note is written FIRST, and the card is only
/// patched once that write succeeded. The other order would mark a row accepted
/// and then fail to apply it — an outcome the operator can neither see nor
/// retry, because the row would no longer offer him a button.
pub fn resolve_note_suggestion_core(
    db: &crate::db::DbPool,
    user_db: &crate::db::UserDbPool,
    card_id: &str,
    row_id: &str,
    outcome: &str,
    body_md: Option<&str>,
) -> Result<DevNote, AppError> {
    if !NOTE_SUGGESTION_OUTCOMES.contains(&outcome) {
        return Err(AppError::Validation(format!(
            "unknown suggestion outcome `{outcome}`"
        )));
    }
    let (kind, config_json) = load_card(user_db, card_id)?;
    if kind != "note_suggestions" {
        return Err(AppError::Validation(format!(
            "chat card `{card_id}` is a `{kind}` card, not a note suggestion"
        )));
    }
    let mut config: Value = serde_json::from_str(&config_json)
        .map_err(|e| AppError::Validation(format!("this card's config is unreadable: {e}")))?;

    let resolution = patch_row_outcome(&mut config, row_id, outcome, body_md)?;

    let note = if let Some(text) = resolution.next_body.as_deref() {
        let current = repo::get_note(db, &resolution.note_id)?;
        let body = apply_suggestion(&current.body_md, resolution.anchor.as_deref(), text);
        // The repo refuses a body edit on a non-draft note, which is the rule
        // this command inherits rather than restates. The pad hides the buttons
        // for a published note; this is the door that makes that true.
        repo::update_note(db, &resolution.note_id, None, Some(&body), None, None)?
    } else {
        repo::get_note(db, &resolution.note_id)?
    };

    let config_text = serde_json::to_string(&config)
        .map_err(|e| AppError::Validation(format!("suggestion config could not be stored: {e}")))?;
    store_config(user_db, card_id, &config_text)?;

    if resolution.settled {
        // The card's job is over: every row has an answer. `dispatched` is the
        // terminal status the chat-card table already uses for "this proposal
        // did what it was going to do".
        //
        // Best-effort, and this is the one step where that is right: the note
        // has already been written by the time we get here. Failing the command
        // now would report an error for an accept that succeeded, and the
        // operator's retry would be refused by the already-answered guard — so
        // he would be told it failed and then told he cannot try again. A card
        // left `pending` with every row answered renders no buttons; it is
        // tidy-up, not correctness.
        if let Err(e) = crate::commands::companion::chat_cards::resolve_card(
            user_db,
            card_id,
            "dispatched",
            Some(
                json!({
                    "accepted": resolution.accepted,
                    "rejected": resolution.rejected,
                })
                .to_string(),
            ),
        ) {
            tracing::warn!(card_id, error = %e, "notepad: suggestion card did not settle");
        }
    }

    Ok(note)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appends_when_there_is_no_anchor() {
        let out = apply_suggestion("# Title\n\nfirst para", None, "new text");
        assert_eq!(out, "# Title\n\nfirst para\n\nnew text\n");
    }

    #[test]
    fn appends_when_the_anchor_matches_nothing() {
        let out = apply_suggestion("# Title\n\nbody", Some("Nowhere"), "new text");
        assert!(out.ends_with("new text\n"), "{out}");
        assert!(out.contains("# Title"), "{out}");
    }

    /// The section ends at the next heading of the SAME depth, not at the next
    /// heading of any depth — a `##` owns the `###`s under it.
    #[test]
    fn inserts_at_the_end_of_the_anchored_section() {
        let body = "# Note\n\n## Plan\n\nstep one\n\n### Detail\n\nfine print\n\n## Risks\n\nnone";
        let out = apply_suggestion(body, Some("Plan"), "step two");
        let plan = out.find("## Plan").unwrap();
        let risks = out.find("## Risks").unwrap();
        let inserted = out.find("step two").unwrap();
        assert!(plan < inserted && inserted < risks, "{out}");
        assert!(out.find("fine print").unwrap() < inserted, "{out}");
    }

    #[test]
    fn the_anchor_match_ignores_case_and_surrounding_space() {
        let out = apply_suggestion("## Plan  \n\nx\n\n## Next\n\ny", Some("  plan "), "z");
        let inserted = out.find("\nz").unwrap();
        assert!(inserted < out.find("## Next").unwrap(), "{out}");
    }

    /// `#hashtag` is not a heading. Without the separator check an anchor could
    /// attach to a line the operator never wrote as a section.
    #[test]
    fn a_hash_without_a_space_is_not_a_heading() {
        assert!(!heading_matches("#hashtag", "hashtag"));
        assert!(heading_matches("# hashtag", "hashtag"));
        assert_eq!(heading_level("####### too deep"), None);
    }

    fn card_config() -> Value {
        json!({
            "note_id": "n1",
            "note_title": "T",
            "rows": [
                { "row_id": "r1", "kind": "section", "anchor": null, "title": null,
                  "body_md": "hers", "outcome": null },
                { "row_id": "r2", "kind": "question", "anchor": null, "title": null,
                  "body_md": "which one?", "outcome": null },
            ],
        })
    }

    #[test]
    fn an_accepted_section_row_carries_its_body_through() {
        let mut c = card_config();
        let r = patch_row_outcome(&mut c, "r1", "accepted", None).unwrap();
        assert_eq!(r.next_body.as_deref(), Some("hers"));
        assert!(!r.settled, "r2 is still open");
        assert_eq!(r.accepted, 1);
    }

    /// The whole point of `edited`: what lands in the note is HIS text.
    #[test]
    fn an_edited_row_applies_the_operators_text_and_stores_it() {
        let mut c = card_config();
        let r = patch_row_outcome(&mut c, "r1", "edited", Some("mine")).unwrap();
        assert_eq!(r.next_body.as_deref(), Some("mine"));
        assert_eq!(c["rows"][0]["body_md"], json!("mine"));
    }

    /// Accepting a question decides the ROW; it must not write into the note.
    #[test]
    fn accepting_a_question_changes_no_body() {
        let mut c = card_config();
        let r = patch_row_outcome(&mut c, "r2", "accepted", None).unwrap();
        assert!(r.next_body.is_none());
    }

    #[test]
    fn a_rejected_row_changes_no_body_and_counts_as_rejected() {
        let mut c = card_config();
        let r = patch_row_outcome(&mut c, "r1", "rejected", None).unwrap();
        assert!(r.next_body.is_none());
        assert_eq!(r.rejected, 1);
    }

    #[test]
    fn the_card_settles_only_once_every_row_is_answered() {
        let mut c = card_config();
        patch_row_outcome(&mut c, "r1", "accepted", None).unwrap();
        let r = patch_row_outcome(&mut c, "r2", "rejected", None).unwrap();
        assert!(r.settled);
        assert_eq!((r.accepted, r.rejected), (1, 1));
    }

    /// Re-resolving would apply the same text a second time.
    #[test]
    fn a_row_cannot_be_resolved_twice() {
        let mut c = card_config();
        patch_row_outcome(&mut c, "r1", "accepted", None).unwrap();
        let err = patch_row_outcome(&mut c, "r1", "rejected", None).unwrap_err();
        assert!(matches!(err, AppError::Validation(_)), "{err:?}");
    }

    #[test]
    fn an_unknown_row_is_not_found() {
        let mut c = card_config();
        let err = patch_row_outcome(&mut c, "nope", "accepted", None).unwrap_err();
        assert!(matches!(err, AppError::NotFound(_)), "{err:?}");
    }
}
