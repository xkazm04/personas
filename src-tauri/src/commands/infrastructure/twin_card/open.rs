//! Reading a card file back: the Twin Card itself or the one a Character
//! Card V3 carries, its version, and each part's plaintext and hash state.
//! Shared by inspect (report) and import (decide).

use std::path::Path;

use serde_json::Value;

use super::canonical::part_hash;
use super::ccv3;
use super::seal::{is_sealed, unseal_part};
use super::types::{Part, SPEC, SUPPORTED_MAJOR};
use crate::error::AppError;

/// The largest card file read at all; the bounded JSON decoder
/// (`engine::safe_json`) holds the same line on the text.
const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;

/// A card as found in a file.
#[derive(Debug, Clone)]
pub(super) struct OpenedCard {
    /// The Twin Card object (unwrapped from a CCv3 when it came in one).
    pub card: Value,
    /// `spec_version` as written, `""` when absent.
    pub spec_version: String,
    /// Major version 1: this app can read it (SPEC.md 12).
    pub supported: bool,
}

/// One part of an opened card.
#[derive(Debug)]
pub(super) struct PartReading {
    pub part: Part,
    pub sealed: bool,
    /// The plaintext: the part itself, or what it unsealed to. `None` when
    /// sealed and not (or not successfully) unsealed.
    pub value: Option<Value>,
    /// The plaintext's SHA-256 matched `integrity.parts`; `None` when there
    /// is no plaintext to check.
    pub hash_ok: Option<bool>,
    /// Why a sealed part did not open, when a passphrase was tried.
    pub unseal_error: Option<AppError>,
}

/// Read and recognise a card file. Not a Twin Card (or a CCv3 without one)
/// is a `Validation` error; an unsupported version is not an error, it is
/// reported.
pub(super) fn read_card_file(path: &str) -> Result<OpenedCard, AppError> {
    let path = Path::new(path);
    let size = std::fs::metadata(path)
        .map_err(|e| AppError::NotFound(format!("Twin Card file {}: {e}", path.display())))?
        .len();
    if size > MAX_FILE_BYTES {
        return Err(AppError::Validation(format!(
            "This file is {size} bytes; a Twin Card is read up to {MAX_FILE_BYTES}."
        )));
    }
    let text = std::fs::read_to_string(path).map_err(|e| {
        AppError::Validation(format!(
            "This file is not a Twin Card: it is not UTF-8 text ({e})."
        ))
    })?;
    let root = crate::engine::safe_json::from_str(&text).map_err(|e| {
        AppError::Validation(format!(
            "This file is not a Twin Card: it is not JSON ({e})."
        ))
    })?;
    open_card(root)
}

/// Recognise a parsed file as a card.
pub(super) fn open_card(root: Value) -> Result<OpenedCard, AppError> {
    let card = if ccv3::is_ccv3(&root) {
        ccv3::embedded_card(&root).cloned().ok_or_else(|| {
            AppError::Validation(
                "This Character Card carries no Twin Card (no data.extensions[\"twin-card\"])."
                    .into(),
            )
        })?
    } else {
        root
    };
    if card.get("spec").and_then(Value::as_str) != Some(SPEC) {
        return Err(AppError::Validation(
            "This file is not a Twin Card (its \"spec\" is not \"twin-card\").".into(),
        ));
    }
    let spec_version = card
        .get("spec_version")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let supported = spec_version.split('.').next() == Some(SUPPORTED_MAJOR);
    Ok(OpenedCard {
        card,
        spec_version,
        supported,
    })
}

/// Every part the card has, in file order, with its plaintext and hash
/// state. Sealed parts open only with `passphrase`.
pub(super) fn read_parts(card: &Value, passphrase: Option<&str>) -> Vec<PartReading> {
    let hashes = card.pointer("/integrity/parts");
    Part::ALL
        .iter()
        .filter_map(|&part| {
            let found = card.get(part.key())?;
            let expected = hashes
                .and_then(|h| h.get(part.key()))
                .and_then(Value::as_str);
            let sealed = part.sealable() && is_sealed(found);
            let (value, unseal_error) = match (sealed, passphrase) {
                (false, _) => (Some(found.clone()), None),
                (true, None) => (None, None),
                (true, Some(pp)) => match unseal_part(found, pp, part.key()) {
                    Ok(value) => (Some(value), None),
                    Err(e) => (None, Some(e)),
                },
            };
            let hash_ok = value
                .as_ref()
                .map(|plain| expected.is_some_and(|hex| hex == part_hash(plain)));
            Some(PartReading {
                part,
                sealed,
                value,
                hash_ok,
                unseal_error,
            })
        })
        .collect()
}
