//! Twin Card v1.0 - the command-surface wire types for exporting, inspecting
//! and importing a portable twin (spark `twin-portable-blueprint`).
//!
//! The FILE format itself is specified in `docs/standards/twin-card/1.0/`
//! (SPEC.md + `twin-card.schema.json`); these types are only what the app's
//! commands take and return around it. Optionals serialize as `null`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What to put in an exported card, and where. The passphrase that seals the
/// personal partitions is NOT a field here: it travels as its own command
/// parameter so no serializable struct ever holds it (census
/// `secret-as-bare-string-field`).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinCardExportOptions {
    /// Any of `voice` | `knowledge` | `training` | `evidence`. `voice` is
    /// always written (identity rides with it) even when absent here.
    pub partitions: Vec<String>,
    /// `twin-card` | `ccv3` (Character Card V3, the full card preserved under
    /// `data.extensions["twin-card"]`).
    pub format: String,
    /// Absolute destination path chosen in the save dialog.
    pub path: String,
}

/// What an export wrote.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinCardExportResult {
    pub path: String,
    /// The partitions written, in file order.
    pub partitions: Vec<String>,
    /// The subset of `partitions` that was sealed.
    pub sealed: Vec<String>,
    /// An Ed25519 signature was written (false when no device identity key
    /// was available - readers then report `unsigned`).
    pub signed: bool,
    pub warnings: Vec<String>,
}

/// One partition as seen by `twin_card_inspect`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinCardPartitionInfo {
    /// `voice` | `knowledge` | `training` | `evidence`.
    pub name: String,
    pub sealed: bool,
    /// The partition's SHA-256 matched; `null` when sealed and no passphrase
    /// was given (the hash covers the plaintext, so it cannot be checked yet).
    pub hash_ok: Option<bool>,
}

/// A card read without importing it.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinCardInspection {
    /// The file's `spec_version` as written (`""` when absent).
    pub spec_version: String,
    /// This app can read that version (major 1). Distinct from `valid`: an
    /// unsupported card is not an invalid one.
    pub supported: bool,
    /// The card validated against the vendored schema.
    pub valid: bool,
    pub name: Option<String>,
    pub partitions: Vec<TwinCardPartitionInfo>,
    /// `valid` | `invalid` | `unsigned`.
    pub signature: String,
    pub warnings: Vec<String>,
}

/// What an import created.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct TwinCardImportResult {
    /// The new (or replaced) twin; `""` when the conflict choice was `skip`.
    pub twin_id: String,
    /// The partitions applied.
    pub imported: Vec<String>,
    pub warnings: Vec<String>,
}
