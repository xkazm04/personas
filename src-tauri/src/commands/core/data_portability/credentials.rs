//! The standalone credential-bundle format and its key derivation.
//!
//! Extracted verbatim from the former single-file `data_portability.rs`.

use super::*;

// ============================================================================
// Encrypted credential export / import (standalone)
// ============================================================================

pub(crate) const PBKDF2_ITERATIONS: u32 = 600_000;
pub(crate) const CREDENTIAL_EXPORT_FORMAT: &str = "personas_credentials_v1";

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialExportBundle {
    pub format_version: u32,
    pub exported_at: String,
    pub credentials: Vec<CredentialExportEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialExportEntry {
    pub name: String,
    pub service_type: String,
    pub metadata: Option<String>,
    pub fields: HashMap<String, String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct CredentialExportEnvelope {
    pub format: String,
    pub salt: String,
    pub nonce: String,
    pub ciphertext: String,
}

#[derive(Debug, Serialize, TS)]
#[ts(export)]
pub struct CredentialImportResult {
    pub created: u32,
    pub skipped: u32,
    pub replaced: u32,
    pub warnings: Vec<String>,
    /// Non-empty when conflicts detected — frontend should show resolution UI
    pub conflicts: Vec<CredentialConflict>,
    /// Path of the selected file — returned so the frontend can pass it back for resolution
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, TS, Clone)]
#[ts(export)]
pub struct CredentialConflict {
    pub name: String,
    pub service_type: String,
    pub existing_id: String,
}

/// Derive a 32-byte key from a passphrase using PBKDF2-HMAC-SHA256.
pub(crate) fn derive_key(passphrase: &str, salt: &[u8]) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2_hmac::<Sha256>(passphrase.as_bytes(), salt, PBKDF2_ITERATIONS, &mut key);
    key
}
