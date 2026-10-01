//! Twin learn-from-sample tables (migration `e55_twin_samples`, spark
//! `twin-portable-blueprint`).
//!
//! A sample is a piece of the person's own writing; its background analysis
//! files PROPOSALS that change nothing until the accept door resolves them.
//! Rules this door holds:
//!
//! - **The vocabularies are the migration's CHECK lists**, named once here as
//!   consts ([`SOURCE_KINDS`], [`SAMPLE_STATUSES`], [`PROPOSAL_KINDS`],
//!   [`PROPOSAL_STATUSES`]) and pinned to the schema by a test that inserts
//!   every member.
//! - **A sample leaves `analyzing` exactly once.** Every settle is a
//!   compare-and-set on `status = 'analyzing'`, so a late writer (a lane that
//!   lost a race, a retry after a restart) changes nothing.
//! - **A ready sample lands whole**: its status, its proposals and the pending
//!   memories its facts became are one IMMEDIATE transaction
//!   ([`finish_ready`]).
//! - **An accepted proposal and the tone column it writes are one
//!   transaction** ([`resolve_proposal`]); a proposal is resolved at most once.
//! - Timestamps are RFC 3339, like every other twin table the frontend reads.

use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};

use crate::models::{TwinSample, TwinSampleProposal};
use crate::repos::twin::{self as twin_repo, ToneField};
use crate::DbPool;
use personas_core::error::AppError;

// ============================================================================
// Vocabularies (mirror the CHECKs in `e55_twin_samples`)
// ============================================================================

/// `twin_samples.source_kind`.
pub const SOURCE_KINDS: [&str; 3] = ["selection", "clipboard", "forge"];

pub const STATUS_ANALYZING: &str = "analyzing";
pub const STATUS_READY: &str = "ready";
pub const STATUS_FAILED: &str = "failed";
pub const STATUS_REFUSED: &str = "refused";
/// `twin_samples.status`.
pub const SAMPLE_STATUSES: [&str; 4] = [
    STATUS_ANALYZING,
    STATUS_READY,
    STATUS_FAILED,
    STATUS_REFUSED,
];

pub const KIND_EXEMPLAR: &str = "exemplar";
pub const KIND_VOICE: &str = "voice";
pub const KIND_CONSTRAINT: &str = "constraint";
pub const KIND_LENGTH: &str = "length";
pub const KIND_DIMS: &str = "dims";
/// `twin_sample_proposals.kind`.
pub const PROPOSAL_KINDS: [&str; 5] = [
    KIND_EXEMPLAR,
    KIND_VOICE,
    KIND_CONSTRAINT,
    KIND_LENGTH,
    KIND_DIMS,
];

pub const PROPOSAL_OPEN: &str = "open";
pub const PROPOSAL_ACCEPTED: &str = "accepted";
pub const PROPOSAL_EDITED: &str = "edited";
pub const PROPOSAL_DISMISSED: &str = "dismissed";
/// `twin_sample_proposals.status`.
pub const PROPOSAL_STATUSES: [&str; 4] = [
    PROPOSAL_OPEN,
    PROPOSAL_ACCEPTED,
    PROPOSAL_EDITED,
    PROPOSAL_DISMISSED,
];

/// The pending-memory channel a sample's self-facts are filed under.
pub const FACT_CHANNEL: &str = "sample";
/// The importance a sample's self-fact is filed at (the queue's default).
pub const FACT_IMPORTANCE: i32 = 3;

/// The most samples [`list_samples`] returns, newest first. A person teaches
/// a twin a handful of samples, not thousands; the bound keeps one read from
/// growing without limit.
pub const SAMPLE_LIST_LIMIT: i64 = 500;
/// The most proposals [`list_proposals`] returns, newest first.
pub const PROPOSAL_LIST_LIMIT: i64 = 1000;

// ============================================================================
// Projections + mappers
// ============================================================================

const SAMPLE_COLUMNS: &str = "id, twin_id, text, channel, source_kind, source_host, status, \
     error, created_at, analyzed_at";

const PROPOSAL_COLUMNS: &str = "id, sample_id, twin_id, kind, channel, value, reason, status, \
     created_at, resolved_at";

row_mapper!(row_to_sample -> TwinSample {
    id, twin_id, text, channel, source_kind, source_host, status, error, created_at,
    analyzed_at,
});

row_mapper!(row_to_proposal -> TwinSampleProposal {
    id, sample_id, twin_id, kind, channel, value, reason, status, created_at, resolved_at,
});

fn now() -> String {
    chrono::Utc::now().to_rfc3339()
}

// ============================================================================
// Samples
// ============================================================================

/// A sample to store. The caller has validated and capped every field.
#[derive(Debug, Clone)]
pub struct NewSample<'a> {
    pub twin_id: &'a str,
    pub text: &'a str,
    /// One of [`SOURCE_KINDS`].
    pub source_kind: &'a str,
    pub source_host: Option<&'a str>,
}

/// Store a sample at `analyzing` and return it. A twin that does not exist is
/// `NotFound` (checked first, so the caller never sees a raw FK failure).
pub fn insert_sample(pool: &DbPool, sample: &NewSample<'_>) -> Result<TwinSample, AppError> {
    timed_query!("twin_samples", "twin_sample::insert_sample", {
        let conn = pool.get()?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM twin_profiles WHERE id = ?1) AS present",
            params![sample.twin_id],
            |row| row.get("present"),
        )?;
        if exists {
            let id = uuid::Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO twin_samples (id, twin_id, text, source_kind, source_host, status, created_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    id,
                    sample.twin_id,
                    sample.text,
                    sample.source_kind,
                    sample.source_host,
                    STATUS_ANALYZING,
                    now()
                ],
            )?;
            sample_on(&conn, &id)?.ok_or_else(|| AppError::NotFound(format!("Twin sample {id}")))
        } else {
            Err(AppError::NotFound(format!(
                "Twin profile {}",
                sample.twin_id
            )))
        }
    })
}

fn sample_on(conn: &Connection, id: &str) -> Result<Option<TwinSample>, AppError> {
    conn.query_row(
        &format!("SELECT {SAMPLE_COLUMNS} FROM twin_samples WHERE id = ?1"),
        params![id],
        row_to_sample,
    )
    .optional()
    .map_err(AppError::Database)
}

/// One sample, or `None` when there is no such row.
pub fn get_sample(pool: &DbPool, id: &str) -> Result<Option<TwinSample>, AppError> {
    timed_query!("twin_samples", "twin_sample::get_sample", {
        let conn = pool.get()?;
        sample_on(&conn, id)
    })
}

/// The twin's samples, newest first (at most [`SAMPLE_LIST_LIMIT`]).
pub fn list_samples(pool: &DbPool, twin_id: &str) -> Result<Vec<TwinSample>, AppError> {
    timed_query!("twin_samples", "twin_sample::list_samples", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {SAMPLE_COLUMNS} FROM twin_samples WHERE twin_id = ?1
             ORDER BY created_at DESC, rowid DESC LIMIT ?2"
        ))?;
        let rows = stmt.query_map(params![twin_id, SAMPLE_LIST_LIMIT], row_to_sample)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// The ids of the twin's samples still `analyzing`, oldest first: the work
/// list a sample lane drains.
pub fn analyzing_ids(pool: &DbPool, twin_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("twin_samples", "twin_sample::analyzing_ids", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT id FROM twin_samples WHERE twin_id = ?1 AND status = ?2
             ORDER BY created_at ASC, rowid ASC LIMIT ?3",
        )?;
        let rows = stmt.query_map(
            params![twin_id, STATUS_ANALYZING, SAMPLE_LIST_LIMIT],
            |row| row.get::<_, String>("id"),
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

/// Move a sample out of `analyzing` to `failed` or `refused`, with the reason.
/// Returns `false` (and writes nothing) when the sample is gone or already
/// settled.
pub fn settle_sample(pool: &DbPool, id: &str, status: &str, error: &str) -> Result<bool, AppError> {
    if status != STATUS_FAILED && status != STATUS_REFUSED {
        return Err(AppError::Validation(format!(
            "settle_sample: \"{status}\" is not \"failed\" or \"refused\""
        )));
    }
    timed_query!("twin_samples", "twin_sample::settle_sample", {
        let conn = pool.get()?;
        let rows = conn.execute(
            "UPDATE twin_samples SET status = ?2, error = ?3, analyzed_at = ?4
             WHERE id = ?1 AND status = ?5",
            params![id, status, error, now(), STATUS_ANALYZING],
        )?;
        Ok(rows > 0)
    })
}

/// One proposal a ready sample files.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewProposal {
    /// One of [`PROPOSAL_KINDS`].
    pub kind: &'static str,
    pub channel: String,
    pub value: String,
    pub reason: Option<String>,
}

/// One self-fact a ready sample files as a pending memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewFact {
    pub title: Option<String>,
    pub content: String,
}

/// Land a finished analysis in ONE immediate transaction: the sample becomes
/// `ready` with its channel, every proposal is inserted `open`, every fact
/// becomes a pending memory (channel [`FACT_CHANNEL`]). Returns the sample's
/// open proposal count, or `None` (and writes nothing) when the sample was no
/// longer `analyzing`.
pub fn finish_ready(
    pool: &DbPool,
    sample_id: &str,
    channel: &str,
    proposals: &[NewProposal],
    facts: &[NewFact],
) -> Result<Option<u32>, AppError> {
    timed_query!("twin_samples", "twin_sample::finish_ready", {
        finish_ready_tx(pool, sample_id, channel, proposals, facts)
    })
}

fn finish_ready_tx(
    pool: &DbPool,
    sample_id: &str,
    channel: &str,
    proposals: &[NewProposal],
    facts: &[NewFact],
) -> Result<Option<u32>, AppError> {
    let mut conn = pool.get()?;
    // Immediate: the compare-and-set read decides every write after it.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let Some(sample) = sample_on(&tx, sample_id)? else {
        return Ok(None);
    };
    let moved = tx.execute(
        "UPDATE twin_samples SET status = ?2, channel = ?3, error = NULL, analyzed_at = ?4
         WHERE id = ?1 AND status = ?5",
        params![sample_id, STATUS_READY, channel, now(), STATUS_ANALYZING],
    )?;
    if moved == 0 {
        return Ok(None);
    }
    for proposal in proposals {
        insert_proposal_in(&tx, &sample, proposal)?;
    }
    for fact in facts {
        twin_repo::create_pending_memory_on(
            &tx,
            &sample.twin_id,
            Some(FACT_CHANNEL),
            &fact.content,
            fact.title.as_deref(),
            FACT_IMPORTANCE,
            None,
        )?;
    }
    let open = open_count_on(&tx, sample_id)?;
    tx.commit()?;
    Ok(Some(open))
}

pub(crate) fn insert_proposal_in(
    tx: &rusqlite::Transaction<'_>,
    sample: &TwinSample,
    proposal: &NewProposal,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO twin_sample_proposals
            (id, sample_id, twin_id, kind, channel, value, reason, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            uuid::Uuid::new_v4().to_string(),
            sample.id,
            sample.twin_id,
            proposal.kind,
            proposal.channel,
            proposal.value,
            proposal.reason,
            PROPOSAL_OPEN,
            now()
        ],
    )?;
    Ok(())
}

// ============================================================================
// Proposals
// ============================================================================

fn open_count_on(conn: &Connection, sample_id: &str) -> Result<u32, AppError> {
    let n: i64 = conn.query_row(
        "SELECT COUNT(id) AS n FROM twin_sample_proposals WHERE sample_id = ?1 AND status = ?2",
        params![sample_id, PROPOSAL_OPEN],
        |row| row.get("n"),
    )?;
    // INVARIANT: a COUNT is never negative; a sample files a handful of rows.
    Ok(u32::try_from(n).unwrap_or(u32::MAX))
}

/// How many of a sample's proposals are still open.
pub fn open_count(pool: &DbPool, sample_id: &str) -> Result<u32, AppError> {
    timed_query!("twin_sample_proposals", "twin_sample::open_count", {
        let conn = pool.get()?;
        open_count_on(&conn, sample_id)
    })
}

/// The twin's proposals, newest first, optionally only those at `status` (one
/// of [`PROPOSAL_STATUSES`]; the caller validates it). At most
/// [`PROPOSAL_LIST_LIMIT`].
pub fn list_proposals(
    pool: &DbPool,
    twin_id: &str,
    status: Option<&str>,
) -> Result<Vec<TwinSampleProposal>, AppError> {
    timed_query!("twin_sample_proposals", "twin_sample::list_proposals", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(&format!(
            "SELECT {PROPOSAL_COLUMNS} FROM twin_sample_proposals
             WHERE twin_id = ?1 AND (?2 IS NULL OR status = ?2)
             ORDER BY created_at DESC, rowid DESC LIMIT ?3"
        ))?;
        let rows = stmt.query_map(
            params![twin_id, status, PROPOSAL_LIST_LIMIT],
            row_to_proposal,
        )?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(AppError::Database)
    })
}

fn proposal_on(conn: &Connection, id: &str) -> Result<Option<TwinSampleProposal>, AppError> {
    conn.query_row(
        &format!("SELECT {PROPOSAL_COLUMNS} FROM twin_sample_proposals WHERE id = ?1"),
        params![id],
        row_to_proposal,
    )
    .optional()
    .map_err(AppError::Database)
}

/// One proposal, or `None` when there is no such row.
pub fn get_proposal(pool: &DbPool, id: &str) -> Result<Option<TwinSampleProposal>, AppError> {
    timed_query!("twin_sample_proposals", "twin_sample::get_proposal", {
        let conn = pool.get()?;
        proposal_on(&conn, id)
    })
}

/// What an accept writes into the proposal's channel tone row. The value has
/// been validated by the caller (the app's accept door).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ToneEdit {
    /// One more item on `examples_json` (no duplicate is added).
    AppendExample(String),
    /// One more item on `constraints_json` (no duplicate is added).
    AppendConstraint(String),
    /// Replace `voice_directives`.
    SetDirectives(String),
    /// Replace `length_hint`.
    SetLength(String),
    /// Replace `style_json` with this serialized `TwinStyle`.
    SetStyle(String),
}

/// How a proposal is resolved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Resolution {
    /// `accepted`, `edited` or `dismissed`.
    pub status: &'static str,
    /// The value to record on the proposal (an edit replaces the proposed
    /// value); `None` keeps what was proposed.
    pub value: Option<String>,
    /// The tone write an accept makes; `None` for a dismiss.
    pub tone: Option<ToneEdit>,
}

/// Resolve one proposal in ONE immediate transaction: refuse a proposal that
/// is not `open` (`Validation`; `NotFound` when there is no such row), record
/// the verdict, and make the accept's tone write. Returns the resolved row.
pub fn resolve_proposal(
    pool: &DbPool,
    proposal_id: &str,
    resolution: &Resolution,
) -> Result<TwinSampleProposal, AppError> {
    if ![PROPOSAL_ACCEPTED, PROPOSAL_EDITED, PROPOSAL_DISMISSED].contains(&resolution.status) {
        return Err(AppError::Validation(format!(
            "resolve_proposal: \"{}\" is not a verdict",
            resolution.status
        )));
    }
    timed_query!("twin_sample_proposals", "twin_sample::resolve_proposal", {
        resolve_proposal_tx(pool, proposal_id, resolution)
    })
}

fn already_resolved(status: &str) -> AppError {
    AppError::Validation(format!("this proposal was already resolved ({status})"))
}

fn resolve_proposal_tx(
    pool: &DbPool,
    proposal_id: &str,
    resolution: &Resolution,
) -> Result<TwinSampleProposal, AppError> {
    let mut conn = pool.get()?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let proposal = proposal_on(&tx, proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("Twin sample proposal {proposal_id}")))?;
    if proposal.status != PROPOSAL_OPEN {
        return Err(already_resolved(&proposal.status));
    }
    let claimed = tx.execute(
        "UPDATE twin_sample_proposals SET status = ?2, value = COALESCE(?3, value), resolved_at = ?4
         WHERE id = ?1 AND status = ?5",
        params![
            proposal_id,
            resolution.status,
            resolution.value,
            now(),
            PROPOSAL_OPEN
        ],
    )?;
    // The read above is in the same immediate transaction, so this cannot
    // miss; the count is still the verdict, and a miss writes nothing.
    if claimed != 1 {
        return Err(already_resolved(&proposal.status));
    }
    if let Some(edit) = &resolution.tone {
        apply_tone_edit_in(&tx, &proposal.twin_id, &proposal.channel, edit)?;
    }
    let resolved = proposal_on(&tx, proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("Twin sample proposal {proposal_id}")))?;
    tx.commit()?;
    Ok(resolved)
}

/// Make one accept's tone write inside the caller's transaction: read the
/// channel's row (when there is one) and write exactly the targeted column.
pub(crate) fn apply_tone_edit_in(
    tx: &rusqlite::Transaction<'_>,
    twin_id: &str,
    channel: &str,
    edit: &ToneEdit,
) -> Result<(), AppError> {
    let current = twin_repo::get_tone_optional_on(tx, twin_id, channel)?;
    let (field, value) = match edit {
        ToneEdit::AppendExample(item) => (
            ToneField::Examples,
            append_json_item(
                current.as_ref().and_then(|t| t.examples_json.as_deref()),
                item,
            ),
        ),
        ToneEdit::AppendConstraint(item) => (
            ToneField::Constraints,
            append_json_item(
                current.as_ref().and_then(|t| t.constraints_json.as_deref()),
                item,
            ),
        ),
        ToneEdit::SetDirectives(text) => (ToneField::Directives, text.clone()),
        ToneEdit::SetLength(text) => (ToneField::LengthHint, text.clone()),
        ToneEdit::SetStyle(json) => (ToneField::Style, json.clone()),
    };
    twin_repo::set_tone_field_on(tx, twin_id, channel, field, Some(&value))
}

/// One more item on a JSON-array column, the Rust twin of `appendJsonItem`
/// (`setup/fields/toneParts.ts`): a stored value that is not an array is kept
/// as the list's first item rather than thrown away, non-string items are kept
/// as their JSON text, and an item already on the list is not added twice.
pub fn append_json_item(raw: Option<&str>, item: &str) -> String {
    let item = item.trim();
    let stored = raw.map(str::trim).unwrap_or("");
    let mut items: Vec<String> = if stored.is_empty() {
        Vec::new()
    } else {
        match serde_json::from_str::<serde_json::Value>(stored) {
            Ok(serde_json::Value::Array(values)) => values
                .into_iter()
                .map(|v| match v {
                    serde_json::Value::String(s) => s,
                    other => other.to_string(),
                })
                .filter(|s| !s.trim().is_empty())
                .collect(),
            _ => vec![stored.to_string()],
        }
    };
    if !item.is_empty() && !items.iter().any(|existing| existing == item) {
        items.push(item.to_string());
    }
    serde_json::Value::from(items).to_string()
}

// ============================================================================
// The self-reinforcement guard's evidence
// ============================================================================

/// How many of the twin's newest outbound communications the guard reads.
pub const AUTHORED_SCAN_LIMIT: i64 = 2000;

/// The texts the TWIN wrote, newest first: every outbound communication that
/// is not a training answer. That is the browser placements (`key_facts_json`
/// kind `placement`, written by the draft lane) and the outbox replies the
/// operator approved (the twin's own generated text), plus anything an agent
/// logged as the twin. Training answers (channel `training`) are the person's
/// own words and are left out, unless one is tagged as a placement.
pub fn twin_authored_texts(pool: &DbPool, twin_id: &str) -> Result<Vec<String>, AppError> {
    timed_query!("twin_communications", "twin_sample::twin_authored_texts", {
        let conn = pool.get()?;
        let mut stmt = conn.prepare(
            "SELECT content, channel, key_facts_json FROM twin_communications
             WHERE twin_id = ?1 AND direction = 'out'
             ORDER BY occurred_at DESC, rowid DESC LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![twin_id, AUTHORED_SCAN_LIMIT], |row| {
            Ok((
                row.get::<_, String>("content")?,
                row.get::<_, String>("channel")?,
                row.get::<_, Option<String>>("key_facts_json")?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (content, channel, facts) = row?;
            if channel != "training" || is_placement(facts.as_deref()) {
                out.push(content);
            }
        }
        Ok(out)
    })
}

/// `key_facts_json` is `{"kind":"placement"}` (`src/api/twin/placement.ts`).
fn is_placement(raw: Option<&str>) -> bool {
    raw.and_then(|r| serde_json::from_str::<serde_json::Value>(r).ok())
        .is_some_and(|v| v.get("kind").and_then(serde_json::Value::as_str) == Some("placement"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn twin(pool: &DbPool) -> Result<String, AppError> {
        let id = uuid::Uuid::new_v4().to_string();
        pool.get()?.execute(
            "INSERT INTO twin_profiles (id, name, slug, obsidian_subpath) VALUES (?1, 'Ada', ?1, ?1)",
            params![id],
        )?;
        Ok(id)
    }

    fn sample(pool: &DbPool, twin_id: &str, kind: &str) -> Result<TwinSample, AppError> {
        insert_sample(
            pool,
            &NewSample {
                twin_id,
                text: "Hi Jo, Thursday works. M.",
                source_kind: kind,
                source_host: Some("mail.example.com"),
            },
        )
    }

    fn proposal(kind: &'static str, value: &str) -> NewProposal {
        NewProposal {
            kind,
            channel: "email".into(),
            value: value.into(),
            reason: Some("short and warm".into()),
        }
    }

    #[test]
    fn projections_prepare_against_the_real_schema() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let conn = pool.get()?;
        for (columns, table) in [
            (SAMPLE_COLUMNS, "twin_samples"),
            (PROPOSAL_COLUMNS, "twin_sample_proposals"),
        ] {
            conn.prepare(&format!("SELECT {columns} FROM {table} LIMIT 0"))?;
        }
        Ok(())
    }

    /// Every vocabulary member this module writes is accepted by the e55
    /// CHECKs: each source kind and sample status lands on a sample, each
    /// proposal kind and status on a proposal.
    #[test]
    fn every_written_value_passes_the_e55_checks() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let twin_id = twin(&pool)?;
        for kind in SOURCE_KINDS {
            let s = sample(&pool, &twin_id, kind)?;
            for status in SAMPLE_STATUSES {
                pool.get()?.execute(
                    "UPDATE twin_samples SET status = ?2 WHERE id = ?1",
                    params![s.id, status],
                )?;
            }
        }
        let s = sample(&pool, &twin_id, "clipboard")?;
        let all: Vec<NewProposal> = PROPOSAL_KINDS.iter().map(|k| proposal(k, "v")).collect();
        assert_eq!(finish_ready(&pool, &s.id, "email", &all, &[])?, Some(5));
        let rows = list_proposals(&pool, &twin_id, None)?;
        assert_eq!(rows.len(), 5);
        for status in PROPOSAL_STATUSES {
            pool.get()?.execute(
                "UPDATE twin_sample_proposals SET status = ?2 WHERE id = ?1",
                params![rows[0].id, status],
            )?;
        }
        Ok(())
    }

    #[test]
    fn a_sample_settles_once_and_lists_newest_first() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let twin_id = twin(&pool)?;
        let first = sample(&pool, &twin_id, "selection")?;
        let second = sample(&pool, &twin_id, "forge")?;
        assert_eq!(first.status, STATUS_ANALYZING);
        assert_eq!(
            analyzing_ids(&pool, &twin_id)?,
            vec![first.id.clone(), second.id.clone()]
        );

        assert!(settle_sample(
            &pool,
            &first.id,
            STATUS_REFUSED,
            "not theirs"
        )?);
        assert!(
            !settle_sample(&pool, &first.id, STATUS_FAILED, "late")?,
            "settles once"
        );
        let got = get_sample(&pool, &first.id)?.ok_or_else(|| AppError::NotFound("s".into()))?;
        assert_eq!(
            (got.status.as_str(), got.error.as_deref()),
            (STATUS_REFUSED, Some("not theirs"))
        );
        assert!(got.analyzed_at.is_some());
        assert!(
            settle_sample(&pool, &second.id, STATUS_READY, "x").is_err(),
            "ready has its own door"
        );

        let listed: Vec<String> = list_samples(&pool, &twin_id)?
            .into_iter()
            .map(|s| s.id)
            .collect();
        assert_eq!(listed, vec![second.id, first.id]);
        Ok(())
    }

    #[test]
    fn a_missing_twin_is_not_found() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let err = sample(&pool, "nobody", "clipboard");
        assert!(matches!(err, Err(AppError::NotFound(_))), "{err:?}");
        Ok(())
    }

    #[test]
    fn finish_ready_lands_proposals_and_facts_together_once() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let twin_id = twin(&pool)?;
        let s = sample(&pool, &twin_id, "selection")?;
        let facts = [NewFact {
            title: Some("Works Thursdays".into()),
            content: "They keep Thursdays for meetings.".into(),
        }];
        let open = finish_ready(
            &pool,
            &s.id,
            "email",
            &[proposal(KIND_VOICE, "Be brief.")],
            &facts,
        )?;
        assert_eq!(open, Some(1));
        let got = get_sample(&pool, &s.id)?.ok_or_else(|| AppError::NotFound("s".into()))?;
        assert_eq!(
            (got.status.as_str(), got.channel.as_deref()),
            (STATUS_READY, Some("email"))
        );
        let memories = twin_repo::list_pending_memories(&pool, &twin_id, Some("pending"), None)?;
        assert_eq!(memories.len(), 1);
        assert_eq!(memories[0].channel.as_deref(), Some(FACT_CHANNEL));
        assert_eq!(memories[0].source_communication_id, None);

        // A second landing is refused whole: nothing duplicated.
        assert_eq!(
            finish_ready(&pool, &s.id, "slack", &[proposal(KIND_VOICE, "x")], &facts)?,
            None
        );
        assert_eq!(list_proposals(&pool, &twin_id, None)?.len(), 1);
        assert_eq!(
            twin_repo::list_pending_memories(&pool, &twin_id, None, None)?.len(),
            1
        );
        Ok(())
    }

    #[test]
    fn append_json_item_mirrors_the_client_helper() {
        assert_eq!(append_json_item(None, " hi "), r#"["hi"]"#);
        assert_eq!(append_json_item(Some(r#"["a"]"#), "b"), r#"["a","b"]"#);
        assert_eq!(
            append_json_item(Some(r#"["a"]"#), "a"),
            r#"["a"]"#,
            "no duplicate"
        );
        assert_eq!(
            append_json_item(Some("legacy text"), "b"),
            r#"["legacy text","b"]"#
        );
        assert_eq!(
            append_json_item(Some("[1, \"x\"]"), "y"),
            r#"["1","x","y"]"#
        );
    }

    #[test]
    fn resolving_writes_one_column_and_only_once() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let twin_id = twin(&pool)?;
        twin_repo::upsert_tone(
            &pool,
            &twin_id,
            "email",
            "Warm.",
            Some(r#"["old"]"#),
            Some(r#"["Never use emoji."]"#),
            Some("Short"),
        )?;
        let s = sample(&pool, &twin_id, "selection")?;
        finish_ready(
            &pool,
            &s.id,
            "email",
            &[proposal(KIND_LENGTH, "One line")],
            &[],
        )?;
        let p = &list_proposals(&pool, &twin_id, Some(PROPOSAL_OPEN))?[0];

        let resolved = resolve_proposal(
            &pool,
            &p.id,
            &Resolution {
                status: PROPOSAL_ACCEPTED,
                value: None,
                tone: Some(ToneEdit::SetLength("One line".into())),
            },
        )?;
        assert_eq!(resolved.status, PROPOSAL_ACCEPTED);
        assert!(resolved.resolved_at.is_some());
        let tone = twin_repo::get_tone_optional(&pool, &twin_id, "email")?
            .ok_or_else(|| AppError::NotFound("tone".into()))?;
        assert_eq!(tone.length_hint.as_deref(), Some("One line"));
        assert_eq!(tone.voice_directives, "Warm.");
        assert_eq!(tone.examples_json.as_deref(), Some(r#"["old"]"#));
        assert_eq!(tone.style_json, None);

        let again = resolve_proposal(
            &pool,
            &p.id,
            &Resolution {
                status: PROPOSAL_DISMISSED,
                value: None,
                tone: None,
            },
        );
        assert!(matches!(again, Err(AppError::Validation(_))), "{again:?}");
        let missing = resolve_proposal(
            &pool,
            "nope",
            &Resolution {
                status: PROPOSAL_DISMISSED,
                value: None,
                tone: None,
            },
        );
        assert!(matches!(missing, Err(AppError::NotFound(_))), "{missing:?}");
        Ok(())
    }

    #[test]
    fn an_accept_creates_the_tone_row_when_the_channel_has_none() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let twin_id = twin(&pool)?;
        let s = sample(&pool, &twin_id, "selection")?;
        finish_ready(&pool, &s.id, "email", &[proposal(KIND_EXEMPLAR, "yo")], &[])?;
        let p = &list_proposals(&pool, &twin_id, None)?[0];
        resolve_proposal(
            &pool,
            &p.id,
            &Resolution {
                status: PROPOSAL_ACCEPTED,
                value: None,
                tone: Some(ToneEdit::AppendExample("yo".into())),
            },
        )?;
        let tone = twin_repo::get_tone_optional(&pool, &twin_id, "email")?
            .ok_or_else(|| AppError::NotFound("tone".into()))?;
        assert_eq!(tone.examples_json.as_deref(), Some(r#"["yo"]"#));
        assert_eq!(tone.voice_directives, "");
        assert_eq!(
            (tone.constraints_json, tone.length_hint, tone.style_json),
            (None, None, None)
        );
        Ok(())
    }

    #[test]
    fn the_guard_reads_twin_output_and_skips_training_answers() -> Result<(), AppError> {
        let pool = crate::init_test_db()?;
        let twin_id = twin(&pool)?;
        let log = |channel: &str, content: &str, facts: Option<&str>| {
            twin_repo::record_interaction(
                &pool, &twin_id, channel, "out", None, content, None, facts, false,
            )
        };
        log("browser", "placed draft", Some(r#"{"kind":"placement"}"#))?;
        log("email", "outbox reply", None)?;
        log(
            "training",
            "my own answer",
            Some(r#"{"kind":"training_qa"}"#),
        )?;
        twin_repo::record_interaction(
            &pool, &twin_id, "email", "in", None, "inbound", None, None, false,
        )?;
        let mut texts = twin_authored_texts(&pool, &twin_id)?;
        texts.sort();
        assert_eq!(texts, vec!["outbox reply", "placed draft"]);
        Ok(())
    }
}
