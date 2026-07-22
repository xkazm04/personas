//! Shared serde helpers for `db::models` update-input structs.
//!
//! `double_option` was previously duplicated per-module (team.rs carried its
//! own private copy with a comment citing "avoid a cross-module re-export").
//! That's the exact drift a shared helper exists to prevent — one
//! implementation, imported everywhere it's needed.

use serde::{Deserialize, Deserializer};

/// Three-state deserializer for nullable update fields on `Option<Option<T>>`
/// columns.
///
/// Serde's default `Deserialize` for `Option<Option<T>>` cannot distinguish
/// "field omitted from the JSON payload" from "field explicitly set to
/// `null`" — both collapse to the outer `None`. For partial-update IPC
/// payloads that distinction matters: omitted means "leave unchanged",
/// `null` means "clear this column to NULL". This deserializer, paired with
/// `#[serde(default, deserialize_with = "double_option")]` on the field,
/// restores the distinction:
///
/// - field absent from JSON -> `#[serde(default)]` supplies `None` (preserve)
/// - `"field": null`        -> `Some(None)` (clear)
/// - `"field": <value>`     -> `Some(Some(value))` (set)
pub(crate) fn double_option<'de, T, D>(deserializer: D) -> Result<Option<Option<T>>, D::Error>
where
    T: Deserialize<'de>,
    D: Deserializer<'de>,
{
    Option::<T>::deserialize(deserializer).map(Some)
}

#[cfg(test)]
mod tests {
    use super::super::credential::UpdateCredentialInput;

    #[test]
    fn double_option_distinguishes_omitted_from_null() {
        let omitted: UpdateCredentialInput = serde_json::from_str("{}").unwrap();
        assert_eq!(omitted.metadata, None);

        let cleared: UpdateCredentialInput =
            serde_json::from_str(r#"{"metadata": null}"#).unwrap();
        assert_eq!(cleared.metadata, Some(None));

        let set: UpdateCredentialInput =
            serde_json::from_str(r#"{"metadata": "{\"k\":1}"}"#).unwrap();
        assert_eq!(set.metadata, Some(Some("{\"k\":1}".to_string())));
    }
}
