//! `standup_decide`: Athena writes the operator's decision onto ONE card of a
//! DRAFT standup from chat (the in-app twin of the terminal `/athena --standup`
//! client's `SC item`). It applies one [`StandupItemPatch`] through
//! [`plan::patch_item`] and nothing else: it never opens, arms or ends a
//! standup, so the go-gate stays a press on the Standup page.
//!
//! Auto-fire (no approval card): it edits the operator's own draft while he is
//! deciding it in the same conversation, it is reversible on the page, and the
//! go-gate still stands between it and any dispatch.
//!
//! The dispatcher has no `AppHandle`, so a landed decision is handed back by
//! standup id and the turn emits `standup://updated` (`service::emit_updated`).

use crate::db::UserDbPool;
use crate::error::AppError;

use super::model::{StandupItem, StandupItemPatch, StandupItemState, StandupStatus, StandupWindow};
use super::plan;

/// What [`decide`] did. Not a `Result`: a refusal is an ANSWER she reads next
/// turn, never an error that looks like nothing happened.
#[derive(Debug)]
pub enum StandupDecide {
    /// The patch is on the card; `item` is the card as written (the caller
    /// names its project and reports it with [`summary`]).
    Applied {
        standup_id: String,
        item: Box<StandupItem>,
    },
    /// Nothing was written; the text says why and what would work.
    Refused(String),
}

/// Read one optional string field.
fn str_field<'a>(params: &'a serde_json::Value, key: &str) -> Option<&'a str> {
    params.get(key).and_then(|v| v.as_str())
}

/// Read one optional enum field by its snake_case wire token.
fn enum_field<T: serde::de::DeserializeOwned>(
    params: &serde_json::Value,
    key: &str,
    allowed: &str,
) -> Result<Option<T>, String> {
    match params.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => serde_json::from_value::<T>(v.clone())
            .map(Some)
            .map_err(|_| {
                format!("`{key}` must be one of {allowed}; got {v}. Nothing was written.")
            }),
    }
}

/// Read one optional integer field.
fn int_field(params: &serde_json::Value, key: &str) -> Result<Option<i64>, String> {
    match params.get(key) {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(v) => v
            .as_i64()
            .map(Some)
            .ok_or_else(|| format!("`{key}` must be an integer; got {v}. Nothing was written.")),
    }
}

/// Parse the op's params into `(standup_id, patch)`. `standup_id` is `None`
/// when omitted (the live standup is meant).
fn parse(params: &serde_json::Value) -> Result<(Option<String>, StandupItemPatch), String> {
    let item_id = str_field(params, "item_id").map(str::trim).unwrap_or("");
    if item_id.is_empty() {
        return Err(
            "`standup_decide` needs an `item_id`: the card id from the thread's \
             `(card <itemId> of standup <standupId>)` line. Nothing was written."
                .into(),
        );
    }
    let standup_id = str_field(params, "standup_id")
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let priority = match int_field(params, "priority")? {
        Some(p) => Some(
            i32::try_from(p)
                .map_err(|_| format!("`priority` {p} is out of range. Nothing was written."))?,
        ),
        None => None,
    };
    let patch = StandupItemPatch {
        id: item_id.to_string(),
        state: enum_field::<StandupItemState>(params, "state", "accepted|edited|skipped|proposed")?,
        chosen: str_field(params, "chosen").map(str::to_string),
        window: enum_field::<StandupWindow>(params, "window", "day|night|any")?,
        priority,
        not_before_ms: int_field(params, "not_before_ms")?,
    };
    if patch.state.is_none()
        && patch.chosen.is_none()
        && patch.window.is_none()
        && patch.priority.is_none()
        && patch.not_before_ms.is_none()
    {
        return Err(
            "`standup_decide` carried nothing to write: give `chosen` (the agreed direction), \
             or `state: skipped`, and optionally `window`. Nothing was written."
                .into(),
        );
    }
    Ok((standup_id, patch))
}

/// What landed on the card, in one sentence she can confirm from.
/// `project_name` is the registered name of the card's project when the
/// caller could resolve it; otherwise the id stands in.
pub fn summary(project_name: Option<&str>, item: &StandupItem) -> String {
    let project = match (project_name, item.project_id.as_deref()) {
        (Some(name), _) => name,
        (None, Some(pid)) => pid,
        (None, None) => "the agent change",
    };
    let window = plan::token(&item.window).unwrap_or_else(|_| "?".into());
    let landed = match (item.state, item.chosen.as_deref()) {
        (StandupItemState::Skipped, _) => format!("{project} is skipped for this standup"),
        (_, Some(chosen)) => format!(
            "{project} now carries \"{chosen}\" ({}, {window} window)",
            plan::token(&item.state).unwrap_or_else(|_| "?".into())
        ),
        (state, None) => format!(
            "{project} is {} with no direction chosen ({window} window)",
            plan::token(&state).unwrap_or_else(|_| "?".into())
        ),
    };
    format!(
        "Written to the Standup card: {landed}. The page shows it now. Nothing is armed: \
         the go-gate stays his press on the Standup page."
    )
}

/// Apply one `standup_decide` op to the user DB (the only store it writes).
pub fn decide(user_db: &UserDbPool, params: &serde_json::Value) -> StandupDecide {
    let (standup_id, patch) = match parse(params) {
        Ok(p) => p,
        Err(why) => return StandupDecide::Refused(why),
    };
    let read = match standup_id.as_deref() {
        Some(id) => plan::get(user_db, id),
        None => plan::current(user_db),
    };
    let standup = match read {
        Ok(Some(s)) => s,
        Ok(None) => {
            return StandupDecide::Refused(match standup_id {
                Some(id) => format!(
                    "No standup has the id `{id}`. Use the id from the thread's \
                     `(card <itemId> of standup <standupId>)` line, or omit `standup_id` for \
                     the live one. Nothing was written."
                ),
                None => "There is no live standup to write to. He opens one on the Standup \
                         page; you do not open it from chat. Nothing was written."
                    .into(),
            })
        }
        Err(e) => {
            return StandupDecide::Refused(format!(
                "The standup could not be read ({e}). Tell the operator rather than retrying."
            ))
        }
    };
    if standup.status != StandupStatus::Draft {
        let status = plan::token(&standup.status).unwrap_or_else(|_| "not a draft".into());
        return StandupDecide::Refused(format!(
            "Standup `{}` is {status}, and only a DRAFT can be decided from chat. To amend an \
             armed plan he re-opens it on the Standup page (that writes a new draft); you do \
             not open, arm or end it. Nothing was written.",
            standup.id
        ));
    }
    if !standup.plan.items.iter().any(|i| i.id == patch.id) {
        return StandupDecide::Refused(format!(
            "Standup `{}` has no card `{}`. Use the exact id from the thread's \
             `(card <itemId> of standup <standupId>)` line; do not guess one. Nothing was written.",
            standup.id, patch.id
        ));
    }
    match plan::patch_item(user_db, &standup.id, &patch) {
        Ok(s) => match s.plan.items.into_iter().find(|i| i.id == patch.id) {
            Some(item) => StandupDecide::Applied {
                standup_id: s.id,
                item: Box::new(item),
            },
            // patch_item found the card inside its transaction, so this is a
            // write that left no card behind: say so rather than claim it.
            None => StandupDecide::Refused(format!(
                "Standup `{}` lost card `{}` while it was written. Tell the operator.",
                s.id, patch.id
            )),
        },
        // The draft moved under the pre-read (armed, or the card left): the
        // in-transaction check is the one that holds.
        Err(AppError::Validation(why)) | Err(AppError::NotFound(why)) => StandupDecide::Refused(
            format!("{why}. Nothing was written; you do not open, arm or end a standup."),
        ),
        Err(e) => StandupDecide::Refused(format!(
            "The card was not written ({e}). Tell the operator rather than retrying."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_takes_snake_case_fields_and_refuses_an_empty_patch() {
        let (sid, patch) = parse(&serde_json::json!({
            "item_id": "sti_1", "chosen": "Ship it", "window": "night", "not_before_ms": 5
        }))
        .unwrap();
        assert_eq!(sid, None);
        assert_eq!(patch.id, "sti_1");
        assert_eq!(patch.chosen.as_deref(), Some("Ship it"));
        assert_eq!(patch.window, Some(StandupWindow::Night));
        assert_eq!(patch.not_before_ms, Some(5));
        assert!(parse(&serde_json::json!({ "item_id": "sti_1" })).is_err());
        assert!(parse(&serde_json::json!({ "chosen": "x" })).is_err());
        assert!(parse(&serde_json::json!({ "item_id": "sti_1", "state": "armed" })).is_err());
        assert!(parse(&serde_json::json!({ "item_id": "sti_1", "window": "noon" })).is_err());
    }
}
