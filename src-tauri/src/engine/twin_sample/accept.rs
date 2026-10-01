//! The accept door: a kept proposal writes through the twin's existing tone
//! row, exactly one column, in the same transaction as the verdict.
//!
//! | kind         | writes                                                   |
//! |--------------|----------------------------------------------------------|
//! | `exemplar`   | one more item on the channel's `examples_json`           |
//! | `voice`      | `voice_directives` (the proposal is the merged text)     |
//! | `constraint` | one more item on `constraints_json`                      |
//! | `length`     | `length_hint`                                            |
//! | `dims`       | `style_json`: a `TwinStyle` with `source: "learned"`     |
//!
//! A missing tone row for the channel is created. An `edited_value` replaces
//! the proposed value (and is what the proposal records, as `edited`); every
//! value passes the same caps the style door holds, and a learned style passes
//! `validate_style` itself. A dismiss writes nothing but the verdict. A
//! proposal is resolved once: a second verdict is `Validation`.

use crate::commands::infrastructure::twin_style::door::{
    validate_style, CONSTRAINT_MAX, LENGTH_HINT_MAX, VOICE_MAX,
};
use crate::db::models::{TwinSampleProposal, TwinStyle, TwinStyleDims};
use crate::db::repos::twin_sample::{
    self as repo, Resolution, ToneEdit, KIND_CONSTRAINT, KIND_DIMS, KIND_EXEMPLAR, KIND_LENGTH,
    KIND_VOICE, PROPOSAL_ACCEPTED, PROPOSAL_DISMISSED, PROPOSAL_EDITED, PROPOSAL_OPEN,
};
use crate::db::DbPool;
use crate::error::AppError;

use super::SAMPLE_MAX_CHARS;

/// The `source` a learned style is stored with.
pub(crate) const LEARNED_SOURCE: &str = "learned";

/// Resolve one proposal. `verdict` is `accept` or `dismiss`.
pub(crate) fn resolve(
    pool: &DbPool,
    proposal_id: &str,
    verdict: &str,
    edited_value: Option<&str>,
) -> Result<TwinSampleProposal, AppError> {
    let dismiss = match verdict.trim() {
        "accept" => false,
        "dismiss" => true,
        other => {
            return Err(AppError::Validation(format!(
                "verdict: \"{other}\" is not \"accept\" or \"dismiss\""
            )))
        }
    };
    let proposal = repo::get_proposal(pool, proposal_id)?
        .ok_or_else(|| AppError::NotFound(format!("Twin sample proposal {proposal_id}")))?;
    // Checked here for a clear answer before any validation; the repo checks
    // again inside its transaction, which is what makes "once" hold.
    if proposal.status != PROPOSAL_OPEN {
        return Err(AppError::Validation(format!(
            "this proposal was already resolved ({})",
            proposal.status
        )));
    }
    if dismiss {
        return repo::resolve_proposal(
            pool,
            proposal_id,
            &Resolution {
                status: PROPOSAL_DISMISSED,
                value: None,
                tone: None,
            },
        );
    }
    let edited = edited_value
        .map(str::trim)
        .filter(|v| !v.is_empty() && *v != proposal.value.trim());
    let value = edited.unwrap_or(proposal.value.as_str());
    let tone = tone_edit_for(&proposal, value)?;
    repo::resolve_proposal(
        pool,
        proposal_id,
        &Resolution {
            status: if edited.is_some() {
                PROPOSAL_EDITED
            } else {
                PROPOSAL_ACCEPTED
            },
            value: edited.map(str::to_string),
            tone: Some(tone),
        },
    )
}

fn capped(kind: &str, value: &str, max: usize) -> Result<String, AppError> {
    let value = value.trim();
    let n = value.chars().count();
    if n == 0 {
        return Err(AppError::Validation(format!("{kind}: empty")));
    }
    if n > max {
        return Err(AppError::Validation(format!(
            "{kind}: {n} characters, at most {max}"
        )));
    }
    Ok(value.to_string())
}

/// The tone write `value` makes for this proposal's kind, validated.
pub(crate) fn tone_edit_for(
    proposal: &TwinSampleProposal,
    value: &str,
) -> Result<ToneEdit, AppError> {
    match proposal.kind.as_str() {
        KIND_EXEMPLAR => Ok(ToneEdit::AppendExample(capped(
            KIND_EXEMPLAR,
            value,
            SAMPLE_MAX_CHARS,
        )?)),
        KIND_VOICE => Ok(ToneEdit::SetDirectives(capped(
            KIND_VOICE, value, VOICE_MAX,
        )?)),
        KIND_CONSTRAINT => Ok(ToneEdit::AppendConstraint(capped(
            KIND_CONSTRAINT,
            value,
            CONSTRAINT_MAX,
        )?)),
        KIND_LENGTH => Ok(ToneEdit::SetLength(capped(
            KIND_LENGTH,
            value,
            LENGTH_HINT_MAX,
        )?)),
        KIND_DIMS => {
            let dims: TwinStyleDims = serde_json::from_str(value.trim())
                .map_err(|e| AppError::Validation(format!("dims: not a style vector ({e})")))?;
            let style = TwinStyle {
                source: LEARNED_SOURCE.to_string(),
                preset_id: None,
                name: String::new(),
                summary: proposal.reason.clone().unwrap_or_default(),
                avoid: String::new(),
                dims,
            };
            match validate_style(&style).as_slice() {
                [] => Ok(ToneEdit::SetStyle(serde_json::to_string(&style)?)),
                errors => Err(AppError::Validation(errors.join("; "))),
            }
        }
        other => Err(AppError::Validation(format!(
            "kind: \"{other}\" is not a proposal kind"
        ))),
    }
}
